// =====================================================================
// LEAGUE TABLES TAB
// Every site of the selected organisation with its survey count and each
// determinand it collects, from the same date-filtered summary rows as
// the Map tab (js/data/org-summary.js). Click a column header to sort
// (numbers lead with the highest, text A-Z; click again to flip);
// missing readings always sort to the bottom. Click rows (or Enter/Space)
// to pick sites - the Map tab then shows only the picked ones.
//
// Three views of the determinands (the switch above the table): the
// site's average / median, its highest single reading, or how many of its
// readings were High or Very High. Switching keeps the sort on the same
// determinand.
// =====================================================================

import { bandForValue, formatMetricValue } from "../metrics.js";
import { getOrganisation, dateRangeDescription } from "../filters.js";
import {
  onSummaryChange, onPickChange, getSiteRows, getSummaryStatus, availableMetrics,
  getPickedSites, togglePickedSite, clearPickedSites,
} from "../data/org-summary.js";
import { escapeHtml } from "../utils/format.js";

const CHECK_COL_PX = 40;
const MIN_COL_PX = 130;
// Header text shrinks between these to stay on one line (fitHeaders).
const HEAD_FONT_MAX = 12;
const HEAD_FONT_MIN = 10;

const VIEWS = [
  {
    key: "typical", label: "Average / median",
    intro: "Each site's average (or median) reading in the date range.",
  },
  {
    key: "max", label: "Maximum",
    intro: "The highest single reading at each site in the date range.",
  },
  {
    key: "high", label: "High or Very High",
    intro: "The share of each site's readings in the date range that were High or Very High.",
  },
];

// High or Very High view: each site's share of readings in those bands,
// coloured by these steps (upper bound inclusive). 0% gets no colour.
// The colours run from the Elevated band's yellow to beyond Very High.
const SHARE_STEPS = [
  { max: 0.25, label: "1–25%", color: "#e6b800" },
  { max: 0.5, label: "26–50%", color: "#f08c00" },
  { max: 0.75, label: "51–75%", color: "#d63129" },
  { max: 1, label: "76–100%", color: "#8f1d1a" },
];

function shareStep(share) {
  return share > 0 ? SHARE_STEPS.find((s) => share <= s.max) : null;
}

let containerEl = null;
let view = "typical";
// `key` is "locationName", "totalSurveys" or a determinand's key - so the
// sort survives switching view.
let sort = { key: "locationName", direction: "asc" };

export function initLeagueTable({ containerEl: el }) {
  containerEl = el;
  containerEl.addEventListener("click", handleClick);
  containerEl.addEventListener("calciteSegmentedControlChange", (event) => {
    view = event.target.value;
    render();
    containerEl.querySelector(".leagueViews")?.setFocus?.();
  });
  containerEl.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest("th[data-field], tr[data-site]")) {
      event.preventDefault();
      handleClick(event);
    }
  });
  onSummaryChange(render);
  onPickChange(render);
  // Columns change width with the window - refit the headers.
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitHeaders);
  }).observe(containerEl);
  render();
}

// Keeps every header on one line. Columns are equal and fixed
// (table-layout: fixed), so the text never moves them:
//  1. the table's min-width lets no column be narrower than the longest
//     header needs at HEAD_FONT_MIN (narrow screens scroll sideways);
//  2. headers then share the largest size, up to HEAD_FONT_MAX, at which
//     the longest one still fits.
function fitHeaders() {
  const table = containerEl.querySelector(".leagueTable");
  if (!table || !table.offsetWidth) return; // tab hidden - refit when shown
  const ths = [...table.querySelectorAll("thead th[data-field]")];
  const padding = (th) => {
    const style = getComputedStyle(th);
    return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  };
  const textWidth = (th) => th.querySelector(".leagueHeadText").getBoundingClientRect().width;

  table.style.setProperty("--league-head-size", `${HEAD_FONT_MIN}px`);
  const minCol = Math.max(MIN_COL_PX, ...ths.map((th) => Math.ceil(textWidth(th) + padding(th)) + 1));
  table.style.minWidth = `${CHECK_COL_PX + ths.length * minCol}px`;

  table.style.setProperty("--league-head-size", `${HEAD_FONT_MAX}px`);
  let ratio = 1;
  for (const th of ths) {
    const available = th.clientWidth - padding(th);
    const needed = textWidth(th);
    if (needed > available) ratio = Math.min(ratio, available / needed);
  }
  let size = Math.max(HEAD_FONT_MIN, Math.floor(HEAD_FONT_MAX * ratio * 10) / 10);
  table.style.setProperty("--league-head-size", `${size}px`);
  // Text doesn't scale exactly linearly - nudge down until it all fits.
  while (size > HEAD_FONT_MIN && ths.some((th) => textWidth(th) > th.clientWidth - padding(th))) {
    size = Math.max(HEAD_FONT_MIN, size - 0.2);
    table.style.setProperty("--league-head-size", `${size}px`);
  }
}

function columns() {
  return [
    { key: "locationName", field: "locationName", label: "Location", type: "text" },
    { key: "totalSurveys", field: "totalSurveys", label: "Surveys", type: "number" },
    ...availableMetrics().map((m) => metricColumn(m)),
  ];
}

function metricColumn(m) {
  const base = { key: m.key, metric: m };
  if (view === "max") return { ...base, field: `${m.locationField}Max`, label: `Max ${m.label}`, unit: m.unit, type: "metric" };
  if (view === "high") {
    // By share, then (e.g. 100% of 4 above 100% of 1) by count.
    return { ...base, field: `${m.locationField}HighShare`, tiebreak: `${m.locationField}HighCount`, label: `${m.label} High+`, type: "highShare" };
  }
  return {
    ...base,
    field: m.locationField,
    label: `${m.aggregation === "median" ? "Median" : "Avg"} ${m.label}`,
    unit: m.unit,
    type: "metric",
  };
}

function viewSwitch() {
  return `
    <calcite-segmented-control class="leagueViews" scale="s" label="What to show for each determinand">
      ${VIEWS.map((v) => `<calcite-segmented-control-item value="${v.key}" ${v.key === view ? "checked" : ""}>${escapeHtml(v.label)}</calcite-segmented-control-item>`).join("")}
    </calcite-segmented-control>`;
}

function render() {
  const org = getOrganisation();
  const status = getSummaryStatus();
  // Only sites surveyed in the date range - like the map.
  const rows = getSiteRows().filter((r) => r.totalSurveys > 0);

  let message = "";
  if (!org) message = "Pick an organisation at the top to see its site league table.";
  else if (status === "loading") message = "Loading survey history…";
  else if (status === "error") message = "Couldn't load this organisation's surveys.";
  else if (!getSiteRows().length) message = "No sites found for this organisation.";
  else if (!rows.length) message = "None of this organisation's sites were surveyed in this date range.";

  const header = `
    <div class="leagueHeader">
      <h2>Site league table</h2>
      ${org ? `<p class="leagueSubtitle">${escapeHtml(org.name)} · ${escapeHtml(dateRangeDescription())}</p>` : ""}
      ${message ? "" : `
        <div class="leagueViewBar">
          ${viewSwitch()}
          <p class="leagueSubtitle">${escapeHtml(VIEWS.find((v) => v.key === view).intro)}</p>
          ${view === "high" ? `
            <ul class="leagueShareKey" aria-label="Colour key">
              ${SHARE_STEPS.map((s) => `<li><span class="leagueSwatch" style="background:${s.color}" aria-hidden="true"></span>${s.label}</li>`).join("")}
            </ul>` : ""}
        </div>
        <p class="leagueSubtitle">Click a column to sort. Click sites to show only those on the map.</p>`}
    </div>`;

  if (message) {
    containerEl.innerHTML = `${header}<p class="muted hint">${escapeHtml(message)}</p>`;
    return;
  }

  const cols = columns();
  const picked = getPickedSites();
  const pickedShown = rows.filter((r) => picked.has(r.locationID)).length;
  const sortCol = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => compareRows(a, b, sortCol));

  containerEl.innerHTML = `
    ${header}
    ${picked.size ? `
      <div class="leagueSelectionBar">
        <span>${pickedShown} of ${rows.length} sites shown on the map</span>
        <calcite-button appearance="outline" kind="neutral" scale="s" icon-start="x" data-action="clear-picks">Show all sites</calcite-button>
      </div>` : ""}
    <div class="tableScroll">
      <!-- Every column the same width (fixed layout); min-width set by fitHeaders(). -->
      <table class="leagueTable">
        <colgroup><col style="width:${CHECK_COL_PX}px">${cols.map(() => "<col>").join("")}</colgroup>
        <thead><tr><th class="leagueColCheck"><span class="visuallyHidden">Shown on map</span></th>${cols.map(headerCell).join("")}</tr></thead>
        <tbody>${sorted.map((row) => rowHtml(row, cols, picked.has(row.locationID))).join("")}</tbody>
      </table>
    </div>`;
  fitHeaders();
}

function handleClick(event) {
  if (event.target.closest("[data-action='clear-picks']")) {
    clearPickedSites();
    return;
  }
  const th = event.target.closest("th[data-field]");
  if (th) {
    const col = columns().find((c) => c.key === th.dataset.field);
    sort = sort.key === col.key
      ? { key: col.key, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { key: col.key, direction: col.type === "text" ? "asc" : "desc" };
    render();
    containerEl.querySelector(`th[data-field="${CSS.escape(col.key)}"]`)?.focus();
    return;
  }
  const tr = event.target.closest("tr[data-site]");
  if (tr) {
    const id = tr.dataset.site;
    togglePickedSite(id); // re-renders via onPickChange
    containerEl.querySelector(`tr[data-site="${CSS.escape(id)}"]`)?.focus();
  }
}

function compareRows(a, b, { field, tiebreak }) {
  const av = a[field];
  const bv = b[field];
  const byName = () => String(a.locationName ?? "").localeCompare(String(b.locationName ?? ""), "en-GB");
  // Missing readings sort to the bottom whichever way round, rather than
  // masquerading as zero.
  if (av == null && bv == null) return byName();
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = (typeof av === "string" ? av.localeCompare(bv, "en-GB") : av - bv)
    || (tiebreak ? (a[tiebreak] ?? 0) - (b[tiebreak] ?? 0) : 0);
  return (sort.direction === "asc" ? cmp : -cmp) || byName();
}

function headerCell(col) {
  const active = sort.key === col.key;
  const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  return `
    <th data-field="${col.key}" tabindex="0" role="button" aria-sort="${ariaSort}" class="${col.type === "text" ? "" : "leagueColNum"}">
      <span class="leagueHeadText">${escapeHtml(col.label)}${col.unit ? ` (${escapeHtml(col.unit)})` : ""}${active ? `<span class="sortArrow" aria-hidden="true">${sort.direction === "asc" ? " ▲" : " ▼"}</span>` : ""}</span>
    </th>`;
}

function rowHtml(row, cols, isPicked) {
  const cells = cols.map((col) => {
    const v = row[col.field];
    if (col.type === "metric") {
      const band = bandForValue(col.metric.key, v);
      return `
        <td class="leagueColNum">
          ${v == null ? `<span class="muted">–</span>` : `
            <span class="leagueValue">
              ${band ? `<span class="leagueSwatch" style="background:${band.color}" aria-hidden="true"></span>` : ""}
              ${formatMetricValue(col.metric, v)}
            </span>
            ${band ? `<span class="leagueBand">${escapeHtml(band.label)}</span>` : ""}`}
        </td>`;
    }
    if (col.type === "highShare") {
      if (v == null) return `<td class="leagueColNum"><span class="muted">–</span></td>`;
      const count = row[`${col.metric.locationField}HighCount`];
      const readings = row[`${col.metric.locationField}Readings`];
      const step = shareStep(v);
      return `
        <td class="leagueColNum">
          <span class="leagueValue leagueShare${step ? " hasHigh" : ""}">
            <span class="leagueSwatch" style="background:${step ? step.color : "transparent"}" aria-hidden="true"></span>
            ${Math.round(v * 100)}%
          </span>
          <span class="leagueBand">${count} of ${readings} reading${readings === 1 ? "" : "s"}</span>
        </td>`;
    }
    if (col.type === "number") return `<td class="leagueColNum">${v ?? "–"}</td>`;
    return `<td>${escapeHtml(v ?? "(unnamed location)")}</td>`;
  }).join("");

  const name = escapeHtml(row.locationName ?? "this site");
  return `
    <tr data-site="${escapeHtml(row.locationID)}" tabindex="0" role="checkbox" aria-checked="${isPicked}"
      class="${isPicked ? "isPicked" : ""}" title="${isPicked ? `Remove ${name} from` : `Add ${name} to`} the sites shown on the map">
      <td class="leagueColCheck"><calcite-checkbox ${isPicked ? "checked" : ""} tabindex="-1" aria-hidden="true"></calcite-checkbox></td>
      ${cells}
    </tr>`;
}
