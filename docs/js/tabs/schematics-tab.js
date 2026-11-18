// =====================================================================
// SCHEMATICS TAB
// The selected organisation's sites drawn as metro-map style river
// diagrams (js/charts/river-schematic.js), one per river system, laid out
// purely from the Open River Network (js/data/river-topology.js) - NRS
// sites have no river names or numbering to go on. Stations are coloured
// by the chosen determinand's threshold band, from the same date-filtered
// summary rows as the Map tab and League table, and only sites surveyed
// in the date range are drawn. Sites too far from any river section are
// left off and listed under the diagrams.
// =====================================================================

import { BAND_STYLE, RIVER_NETWORK } from "../config.js";
import { bandForValue, formatMetricValue } from "../metrics.js";
import { getOrganisation, dateRangeDescription } from "../filters.js";
import { onSummaryChange, getSiteRows, getSummaryStatus, availableMetrics } from "../data/org-summary.js";
import { loadOrgNetwork, buildSchematics } from "../data/river-topology.js";
import { renderRiverSchematic, stationsInOrder, UNNAMED_MARK } from "../charts/river-schematic.js";
import { escapeHtml } from "../utils/format.js";

const state = {
  els: null,
  metricKey: null,
  renderToken: 0,
};

export function initSchematicsTab({ containerEl, tooltipEl }) {
  containerEl.innerHTML = `
    <div class="leagueHeader">
      <h2>River schematics</h2>
      <p class="leagueSubtitle" data-part="subtitle"></p>
    </div>
    <div class="schemControls" data-part="controls" hidden>
      <calcite-label layout="inline" class="schemMetricLabel">
        Determinand
        <calcite-select data-part="metric" scale="s" label="Determinand"></calcite-select>
      </calcite-label>
      <ul class="schemKey" data-part="key" aria-label="Colour key"></ul>
    </div>
    <div data-part="body"></div>`;
  const part = (name) => containerEl.querySelector(`[data-part="${name}"]`);
  state.els = {
    subtitleEl: part("subtitle"),
    controlsEl: part("controls"),
    metricEl: part("metric"),
    keyEl: part("key"),
    bodyEl: part("body"),
    tooltipEl,
  };
  state.els.metricEl.addEventListener("calciteSelectChange", () => {
    state.metricKey = state.els.metricEl.value;
    render();
  });
  // A scrolled diagram would leave the tooltip behind.
  containerEl.addEventListener("scroll", () => { tooltipEl.hidden = true; }, true);

  onSummaryChange(render);
  render();
}

function renderMetricOptions(metrics) {
  if (!metrics.some((m) => m.key === state.metricKey)) state.metricKey = metrics[0]?.key ?? null;
  state.els.metricEl.innerHTML = metrics
    .map((m) => `<calcite-option value="${m.key}" ${m.key === state.metricKey ? "selected" : ""}>${escapeHtml(m.label)} (${escapeHtml(m.unit)})</calcite-option>`)
    .join("");
}

function renderKey() {
  const items = [
    ...BAND_STYLE.map((b) => `<li><span class="schemKeySwatch" style="background:${b.color}"></span>${escapeHtml(b.label)}</li>`),
    `<li><span class="schemKeySwatch schemKeySwatch--none"></span>No reading</li>`,
  ];
  state.els.keyEl.innerHTML = items.join("");
}

async function render() {
  const { subtitleEl, controlsEl, bodyEl, tooltipEl } = state.els;
  const token = ++state.renderToken;
  tooltipEl.hidden = true;

  const org = getOrganisation();
  const status = getSummaryStatus();
  const rows = getSiteRows().filter((r) => r.totalSurveys > 0);
  subtitleEl.textContent = org ? `${org.name} · ${dateRangeDescription()}` : "";

  let message = "";
  if (!org) message = "Pick an organisation at the top to see its river schematics.";
  else if (status === "loading") message = "Loading survey history…";
  else if (status === "error") message = "Couldn't load this organisation's surveys.";
  else if (!getSiteRows().length) message = "No sites found for this organisation.";
  else if (!rows.length) message = "None of this organisation's sites were surveyed in this date range.";
  controlsEl.hidden = Boolean(message);
  if (message) {
    bodyEl.innerHTML = `<p class="muted hint">${escapeHtml(message)}</p>`;
    return;
  }

  const metrics = availableMetrics();
  renderMetricOptions(metrics);
  renderKey();
  const metric = metrics.find((m) => m.key === state.metricKey);

  bodyEl.innerHTML = `<p class="muted hint">Placing sites on the Open River Network…</p>`;
  let network;
  try {
    network = await loadOrgNetwork(org.guid);
  } catch (error) {
    console.error("NRS dashboard: river network lookup failed:", error);
    if (token === state.renderToken) bodyEl.innerHTML = `<p class="muted hint">Couldn't load the Open River Network. Try again later.</p>`;
    return;
  }
  if (token !== state.renderToken) return; // filters changed while loading

  const rowById = new Map(rows.map((r) => [r.locationID, r]));
  const { diagrams, offNetwork } = buildSchematics(network, [...rowById.keys()]);
  // Sites with no location at all can't be placed either.
  const placed = new Set(network.sites.map((s) => s.locationID));
  const unlocated = rows.filter((r) => !placed.has(r.locationID)).map((r) => ({ locationName: r.locationName }));
  const leftOff = [...offNetwork, ...unlocated];

  const statLabel = metric.aggregation === "median" ? "Median" : "Mean";
  const valueText = (p) => (p.state === "value" ? `${formatMetricValue(metric, p.value)} ${metric.unit}` : "No reading");
  const drawnCount = diagrams.reduce((n, d) => n + d.siteCount, 0);

  bodyEl.innerHTML = `
    <p class="leagueSubtitle schemIntro">${statLabel} ${escapeHtml(metric.label.toLowerCase())} per site. Each river system is drawn as a schematic,
      not to scale: the main river flows left to right and tributaries join where they meet it on the Open River Network.
      ${UNNAMED_MARK} marks an unnamed watercourse.
      ${drawnCount} of ${rows.length} surveyed sites shown. Hover a station for its reading.</p>
    ${diagrams.map((_, i) => `<div class="schemCard" data-i="${i}"><div class="schemChart"></div><ol class="schemSiteList"></ol></div>`).join("")}
    ${leftOff.length ? offNetworkNote(leftOff, Boolean(diagrams.length)) : ""}`;

  diagrams.forEach((diagram, i) => {
    const card = bodyEl.querySelector(`.schemCard[data-i="${i}"]`);
    const ordered = stationsInOrder(diagram.root);
    const points = new Map(ordered.map((it, n) => {
      const row = rowById.get(it.site.locationID);
      const value = row?.[metric.locationField] ?? null;
      const band = bandForValue(metric.key, value);
      return [it.site.locationID, {
        locationID: it.site.locationID,
        number: n + 1,
        name: it.site.locationName,
        river: it.river,
        state: value == null ? "none" : "value",
        value,
        color: band?.color,
        bandLabel: band?.label,
      }];
    }));
    const withValue = [...points.values()].filter((p) => p.state === "value").length;
    renderRiverSchematic(card.querySelector(".schemChart"), {
      title: `${diagram.river} · ${diagram.catchment} catchment`,
      subtitle: `${metric.label} (${metric.unit}) · ${withValue} of ${points.size} ${points.size === 1 ? "site" : "sites"} with a reading`,
      tree: diagram.root,
      pointsBySite: points,
      valueText,
      tooltipEl,
    });
    card.querySelector(".schemSiteList").innerHTML = [...points.values()].map((p) => `
      <li data-site="${escapeHtml(p.locationID)}">
        <span class="schemSiteNumber">${p.number}</span>
        <span class="schemSiteName">${escapeHtml(p.name)}</span>
        <span class="schemSiteValue">${p.state === "value" ? `<span class="schemKeySwatch" style="background:${p.color}"></span>` : ""}${escapeHtml(valueText(p))}</span>
      </li>`).join("");
  });
  linkListToStations(bodyEl);
}

function offNetworkNote(sites, anyDiagrams) {
  const names = sites.map((s) => s.locationName || "Unnamed site");
  return `
    <div class="schemOffNetwork">
      <calcite-icon icon="information" scale="s" aria-hidden="true"></calcite-icon>
      <div>
        <strong>${anyDiagrams ? `${names.length} ${names.length === 1 ? "site isn't" : "sites aren't"} shown` : "No sites could be placed on the river network"}</strong>
        - not within ${RIVER_NETWORK.snapDistance} m of an Open River Network river: ${names.map(escapeHtml).join(", ")}.
      </div>
    </div>`;
}

// Hovering a site in a list highlights its station, and the reverse.
function linkListToStations(bodyEl) {
  bodyEl.querySelectorAll(".schemCard").forEach((card) => {
    const setActive = (id, on) => {
      card.querySelectorAll(`[data-site="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle("isActive", on));
    };
    card.querySelectorAll("[data-site]").forEach((el) => {
      el.addEventListener("pointerenter", () => setActive(el.dataset.site, true));
      el.addEventListener("pointerleave", () => setActive(el.dataset.site, false));
    });
  });
}
