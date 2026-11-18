// =====================================================================
// MAP TAB
// The picked organisation's survey sites (the map zooms to fit them all),
// coloured and sized by the selected determinand's threshold band for the
// date range. Click a site for its
// details and trend chart; Ctrl/Cmd-click a second site to compare the
// two on the chart.
//
// Laid out like the AQuA dashboard's maps. Left panel: the determinand
// picker and its colour key - click a band (or No reading) to show only
// those sites, as on AQuA. Centre: the map, with its Basemap, Map layers
// and Legend panels (js/map/tool-panels.js; the layers and map clicks are
// js/map/layers-panel.js, as on AQuA), and the trend chart, which
// slides up over the bottom of the map once a site is clicked. Right: the
// site details panel (js/tabs/site-details.js), open while a site is
// selected. The map can be expanded to hide both side panels.
// =====================================================================

import { NRS, METRICS } from "../config.js";
import { getMetric, metricColor, compareColor, bandsForMetric, bandForValue, formatMetricValue } from "../metrics.js";
import { onThemeChange } from "../theme.js";
import { onFilterChange, getOrganisation, isWithinDateRange, hasDateRange, dateRangeDescription } from "../filters.js";
import { onSummaryChange, onPickChange, getSiteRows, getSummaryStatus, getPickedSites, availableMetrics } from "../data/org-summary.js";
import { fetchSiteHistory, fetchEquipment, getLayer } from "../data/nrs-service.js";
import { setupMap, goHome } from "../map/map-common.js";
import { setupToolPanels } from "../map/tool-panels.js";
import { setupLayersPanel, showRivers } from "../map/layers-panel.js";
import { sitesRenderer } from "../map/sites-renderer.js";
import { renderTrendChart } from "../charts/trend-chart.js";
import { escapeHtml, escapeSql, hexToRgbArray } from "../utils/format.js";
import { initSiteDetails, showSiteDetails, clearSiteDetails, refreshSiteDetails, renderSurveyForTheme } from "./site-details.js";

const MAX_COMPARE = 2;

const state = {
  mapEl: null,
  els: null,
  layers: {},
  metricKey: METRICS[0].key,
  bands: new Set(), // band keys picked in the key ("none" = no reading); empty = all
  selected: [], // [{ locationID, name, geometry }] - the last one is "primary"
  histories: new Map(), // locationID -> { observations, daily }
  equipmentRanges: {},
  fitToData: false,
  chartClosed: false, // the chart's close button was used for this selection
  Graphic: null,
};

export async function initMapTab(els) {
  const { mapEl } = els;
  state.mapEl = mapEl;
  state.els = els;

  initSiteDetails(els.details);
  setupToolPanels(mapEl);
  await setupMap(mapEl);
  const [FeatureLayer, GraphicsLayer, Graphic] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
  ]);
  state.Graphic = Graphic;

  // The contextual layers go in first, so they sit under the sites. A
  // click on a site comes back here (Ctrl/Cmd-click compares two).
  await setupLayersPanel(mapEl, {
    isSiteLayer: (layer) => layer === state.layers.sites,
    onSiteClick: (graphic, native) => selectSite(graphic, !!(native && (native.ctrlKey || native.metaKey))),
  });

  const layers = state.layers;
  layers.sites = new FeatureLayer({
    url: NRS.locationsUrl,
    outFields: ["GlobalID", "location_name"],
    popupEnabled: false,
    visible: false,
    definitionExpression: "1 = 0",
    renderer: sitesRenderer(null, []),
    title: "Survey sites",
  });
  // A coloured ring round each selected site (the view's own highlight
  // only does one colour, and comparing needs two).
  layers.rings = new GraphicsLayer({ listMode: "hide" });

  mapEl.map.addMany([layers.sites, layers.rings]);

  initMetricSelect();
  els.sitesLegendEl.addEventListener("click", onLegendClick);
  initMapActions();
  initChartControls();
  // Closing the site panel deselects the site.
  els.details.panelEl.addEventListener("calcitePanelClose", clearSelection);

  onFilterChange(({ org }) => { if (org) handleOrganisationChange(); });
  onSummaryChange(handleSummaryChange);
  onPickChange(() => {
    applySiteFilters();
    renderSitesLegend();
  });
  onThemeChange(handleThemeChange);

  fetchEquipment().then(({ rangeByMetric }) => {
    state.equipmentRanges = rangeByMetric;
    renderChart();
  });

  // Redraw the chart at its new size (debounced - resize fires constantly).
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 150);
  }).observe(els.chart.wrapEl);

  handleOrganisationChange();
}

// ---------------------------------------------------------------------
// Organisation and summaries
// ---------------------------------------------------------------------

function handleOrganisationChange() {
  const org = getOrganisation();
  const { sites } = state.layers;
  clearSelection();
  state.bands.clear();

  sites.visible = !!org;
  sites.definitionExpression = "1 = 0";

  if (org?.guid) zoomToSites(org.guid);
  else if (!org) goHome(state.mapEl).catch(() => {});
  renderMetricPanel();
}

// Fits the map to every one of the organisation's sites - all of them,
// not just those surveyed in the date range, so changing the dates
// doesn't move the map. A single site (or several on one spot) is shown
// at ZOOM_ONE_SITE rather than zoomed right in. The first time, the river
// network and its flow animation are switched on too (each draws once
// zoomed in past its own limit); after that they're left as the user set
// them.
const ZOOM_ONE_SITE = 14;
let zoomRequest = 0;
let riversShown = false;

async function zoomToSites(orgGuid) {
  const request = ++zoomRequest;
  const mapEl = state.mapEl;
  try {
    const layer = await getLayer(NRS.locationsUrl);
    const { extent, count } = await layer.queryExtent({
      where: `organisation_id = '${escapeSql(orgGuid)}'`,
      outSpatialReference: mapEl.view.spatialReference,
    });
    if (request !== zoomRequest || !count || !extent) return; // picked another meanwhile, or no sites
    if (extent.width < 200 && extent.height < 200) await mapEl.goTo({ center: extent.center, zoom: ZOOM_ONE_SITE });
    else await mapEl.goTo(extent.clone().expand(1.25));
    if (!riversShown) {
      riversShown = true;
      showRivers();
    }
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("NRS dashboard: couldn't zoom to the organisation's sites:", error);
  }
}

// The summary rows changed: a new organisation finished loading, or the
// date range moved.
function handleSummaryChange() {
  applySiteFilters();

  // The picked determinand may not be collected by this organisation.
  const available = availableMetrics();
  if (!available.some((m) => m.key === state.metricKey)) state.metricKey = available[0].key;

  renderMetricPanel();
  applySymbology();
  refreshSiteDetails();
  renderChart();
}

// Sites with a survey in the date range, narrowed to any picked in the
// League table and to any bands picked in the key.
function applySiteFilters() {
  const org = getOrganisation();
  const picked = getPickedSites();
  const surveyed = getSiteRows()
    .filter((r) => r.totalSurveys > 0 && (!picked.size || picked.has(r.locationID)) && (!state.bands.size || state.bands.has(bandKey(r))))
    .map((r) => r.locationID);
  const orgClause = org?.guid ? `organisation_id = '${escapeSql(org.guid)}'` : "1 = 0";
  state.layers.sites.definitionExpression = `${orgClause} AND ${idListClause(surveyed)}`;
}

// A summary row's band for the current determinand; "none" = no reading.
function bandKey(row) {
  const metric = getMetric(state.metricKey);
  return bandForValue(metric.key, row[metric.locationField])?.key ?? "none";
}

function idListClause(ids) {
  return ids.length ? `GlobalID IN (${ids.map((id) => `'${escapeSql(id)}'`).join(", ")})` : "1 = 0";
}

function applySymbology() {
  const metric = getMetric(state.metricKey);
  state.layers.sites.renderer = sitesRenderer(metric, getSiteRows());
  state.layers.sites.title = metric.label;
}

function handleThemeChange() {
  applySymbology();
  renderMetricPanel();
  updateRings();
  renderSurveyForTheme();
  renderChart();
}

// ---------------------------------------------------------------------
// Determinand picker
// ---------------------------------------------------------------------

function initMetricSelect() {
  const { metricSelectEl } = state.els;
  metricSelectEl.addEventListener("calciteSelectChange", () => {
    const key = metricSelectEl.value;
    if (!key || key === state.metricKey) return;
    state.metricKey = key;
    // Band picks belong to one determinand's bands - start fresh.
    state.bands.clear();
    applySiteFilters();
    applySymbology();
    renderSitesLegend();
    renderChart();
  });
}

// The left panel: what's loading or missing, else the picker and key.
function renderMetricPanel() {
  const { panelEl, metricGroupEl, metricSelectEl, metricHintEl } = state.els;
  const org = getOrganisation();
  const status = getSummaryStatus();
  panelEl.description = org?.name ?? "";

  let hint = "";
  if (!org) hint = "Choose an organisation at the top.";
  else if (status === "loading") hint = "Loading survey history…";
  else if (status === "error") hint = "Couldn't load this organisation's surveys.";
  else if (!getSiteRows().length) hint = "No sites found for this organisation.";
  metricHintEl.textContent = hint;
  metricHintEl.hidden = !hint;
  metricGroupEl.hidden = Boolean(hint);

  metricSelectEl.innerHTML = availableMetrics()
    .map((m) => `<calcite-option value="${m.key}" ${m.key === state.metricKey ? "selected" : ""}>${escapeHtml(m.label)} (${escapeHtml(m.unit)})</calcite-option>`)
    .join("");
  renderSitesLegend();
}

// The colour key for the sites, with how many surveyed sites fall in each
// band. Each band is a toggle: picked bands show, the rest are dimmed.
function renderSitesLegend() {
  const { sitesLegendEl, metricGroupEl } = state.els;
  sitesLegendEl.hidden = metricGroupEl.hidden;
  if (sitesLegendEl.hidden) return;

  const metric = getMetric(state.metricKey);
  const picked = getPickedSites();
  const rows = getSiteRows().filter((r) => r.totalSurveys > 0 && (!picked.size || picked.has(r.locationID)));
  const counts = new Map();
  for (const row of rows) counts.set(bandKey(row), (counts.get(bandKey(row)) ?? 0) + 1);
  const bands = bandsForMetric(metric.key) ?? [];
  const items = bands.map((band, i) => legendRow(band.key, band.color, band.label + bandRange(metric, bands, i), counts.get(band.key) ?? 0));
  items.push(legendRow("none", null, "No reading", counts.get("none") ?? 0));
  const shown = rows.filter((r) => state.bands.has(bandKey(r))).length;
  const note = state.bands.size
    ? `Showing ${shown} ${shown === 1 ? "site" : "sites"} in the selected band${state.bands.size === 1 ? "" : "s"}.
       <button type="button" class="legendShowAll" data-action="show-all">Show all</button>`
    : `${rows.length} ${rows.length === 1 ? "site" : "sites"} surveyed. Click a band to show only those sites. The higher the band, the bigger the dot.`;
  sitesLegendEl.innerHTML = `
    <p class="legendTitle">${escapeHtml(metric.label)} (${escapeHtml(metric.unit)}), ${escapeHtml(dateRangeDescription())}</p>
    <ul class="legendList" aria-label="Filter the map by ${escapeHtml(metric.label)} band">${items.join("")}</ul>
    <p class="legendNote">${note}</p>`;
}

// A band as a toggle button; while any are picked the rest are dimmed.
function legendRow(key, color, label, count) {
  const swatch = color
    ? `<span class="legendSwatch" style="background:${color}"></span>`
    : `<span class="legendSwatch legendSwatch--none"></span>`;
  const selected = state.bands.has(key);
  return `
    <li>
      <button type="button" class="legendRow legendRow--toggle${state.bands.size && !selected ? " isDimmed" : ""}"
        data-band="${key}" aria-pressed="${selected}">
        ${swatch}<span class="legendLabel">${escapeHtml(label)}</span><span class="legendCount">${count}</span>
      </button>
    </li>`;
}

function onLegendClick(event) {
  const button = event.target.closest("[data-band]");
  let focusKey = null;
  if (button) {
    focusKey = button.dataset.band;
    if (state.bands.has(focusKey)) state.bands.delete(focusKey);
    else state.bands.add(focusKey);
  } else if (event.target.closest("[data-action='show-all']")) {
    state.bands.clear();
  } else {
    return;
  }
  applySiteFilters();
  renderSitesLegend();
  // Re-rendering replaced the buttons - put keyboard focus back.
  const { sitesLegendEl } = state.els;
  (focusKey ? sitesLegendEl.querySelector(`[data-band="${CSS.escape(focusKey)}"]`) : sitesLegendEl.querySelector("[data-band]"))?.focus();
}

// " (up to 0.5)", " (0.5–2)", " (over 20)" - band maxes are inclusive.
function bandRange(metric, bands, i) {
  const fmt = (v) => formatMetricValue(metric, v);
  const from = i === 0 ? null : bands[i - 1].max;
  const to = bands[i].max;
  if (to == null) return ` (over ${fmt(from)})`;
  if (from == null) return ` (up to ${fmt(to)})`;
  return ` (${fmt(from)}–${fmt(to)})`;
}

// ---------------------------------------------------------------------
// Map actions: expand
// ---------------------------------------------------------------------

function initMapActions() {
  const { expandEl, viewEl } = state.els;

  const setExpanded = (expanded) => {
    viewEl.classList.toggle("isExpanded", expanded);
    expandEl.active = expanded;
    expandEl.icon = expanded ? "minimize" : "maximize";
    expandEl.text = expanded ? "Exit expanded map" : "Expand map";
  };
  expandEl.addEventListener("click", () => setExpanded(!viewEl.classList.contains("isExpanded")));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && viewEl.classList.contains("isExpanded") && !viewEl.hidden) setExpanded(false);
  });
}

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

// A plain click replaces the selection; Ctrl/Cmd-click toggles a site in
// or out of the comparison (dropping the oldest past MAX_COMPARE).
function selectSite(graphic, addToCompare) {
  const site = { locationID: graphic.attributes.GlobalID, name: graphic.attributes.location_name || "(unnamed location)", geometry: graphic.geometry };
  if (addToCompare) {
    const existing = state.selected.findIndex((s) => s.locationID === site.locationID);
    if (existing !== -1) state.selected.splice(existing, 1);
    else {
      state.selected.push(site);
      if (state.selected.length > MAX_COMPARE) state.selected.shift();
    }
  } else {
    state.selected = [site];
  }
  state.chartClosed = false;

  if (!state.selected.length) {
    clearSelection();
    return;
  }
  updateRings();
  loadSelected();
}

function clearSelection() {
  state.selected = [];
  state.layers.rings?.removeAll();
  clearSiteDetails();
  renderChart();
}

async function loadSelected() {
  const primary = state.selected[state.selected.length - 1];
  const orgName = getOrganisation()?.name;
  showSiteDetails({ ...primary, orgName }, state.histories.get(primary.locationID) ?? null);
  renderChart();

  await Promise.all(state.selected.map(async (s) => {
    if (!state.histories.has(s.locationID)) state.histories.set(s.locationID, await fetchSiteHistory(s.locationID));
  }));
  // Only if the selection hasn't moved on meanwhile.
  if (state.selected[state.selected.length - 1] !== primary) return;
  showSiteDetails({ ...primary, orgName }, state.histories.get(primary.locationID));
  renderChart();
}

// One selected site uses compare colour 1; two use 0 and 1.
function updateRings() {
  const { rings } = state.layers;
  rings.removeAll();
  state.selected.forEach((s, i) => {
    const color = compareColor(state.selected.length === 1 ? 1 : i);
    rings.add(new state.Graphic({
      geometry: s.geometry,
      symbol: { type: "simple-marker", style: "circle", color: hexToRgbArray(color, 0.18), size: 34, outline: { color, width: 2.5 } },
    }));
  });
}

// ---------------------------------------------------------------------
// Trend chart
// ---------------------------------------------------------------------

function initChartControls() {
  const { fitEl, closeEl } = state.els.chart;
  fitEl.addEventListener("calciteSwitchChange", () => {
    state.fitToData = fitEl.checked;
    renderChart();
  });
  closeEl.addEventListener("click", () => {
    state.chartClosed = true;
    renderChart();
  });
}

function renderChart() {
  const c = state.els.chart;
  const metric = getMetric(state.metricKey);
  const comparing = state.selected.length > 1;

  c.drawerEl.hidden = !state.selected.length || state.chartClosed;
  if (c.drawerEl.hidden) return;

  const series = state.selected.map((s, i) => {
    const daily = state.histories.get(s.locationID)?.daily ?? [];
    return {
      siteName: s.name,
      color: comparing ? compareColor(i) : metricColor(metric),
      dashed: i === 1,
      points: daily
        .map((d) => ({ date: d.time_of_observation, value: d[metric.observationField], atLimit: d[`${metric.observationField}_atLimit`] }))
        .filter((p) => p.value != null && isWithinDateRange(p.date)),
    };
  });

  c.titleEl.textContent = `${metric.label} over time${comparing ? ` — comparing ${series.length} sites` : ""}`;
  const equipRange = state.equipmentRanges[metric.key];
  c.fitEl.disabled = !equipRange;
  c.limitNoteEl.hidden = !series.some((s) => s.points.some((p) => p.atLimit));

  const loading = state.selected.some((s) => !state.histories.has(s.locationID));
  const message = loading
    ? "Loading surveys…"
    : renderTrendChart({
      svg: c.svgEl, wrapEl: c.wrapEl, tooltipEl: c.tooltipEl, legendEl: c.legendEl,
      metric, series, equipRange, fitToData: state.fitToData, rangeActive: hasDateRange(),
    });
  if (loading) c.svgEl.replaceChildren();
  c.svgEl.hidden = !!message;
  c.emptyEl.hidden = !message;
  c.emptyEl.textContent = message ?? "";
}
