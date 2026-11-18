// =====================================================================
// ORGANISATION TAB
// "About this organisation" - for now, the equipment it uses: one card
// per determinand it collects, naming the device behind that
// determinand's most recent reading anywhere in the organisation (not
// per site, and not date-filtered - an organisation's kit rarely
// changes, so its latest reading is a fair stand-in for "what they use").
// =====================================================================

import { getMetric, metricColor } from "../metrics.js";
import { onThemeChange } from "../theme.js";
import { getOrganisation } from "../filters.js";
import { onSummaryChange, getSummaryStatus, getSiteRows, getOrgObservations, availableMetrics } from "../data/org-summary.js";
import { fetchEquipment, normalizeGuid } from "../data/nrs-service.js";
import { escapeHtml, formatDateLong } from "../utils/format.js";

let containerEl = null;
let specsByGuid = null; // null until the Equipment table has loaded

export function initOrgDetails({ containerEl: el }) {
  containerEl = el;
  onSummaryChange(render);
  onThemeChange(render); // card accents use the determinand colours
  fetchEquipment().then((equipment) => {
    specsByGuid = equipment.specsByGuid;
    render();
  });
  render();
}

function render() {
  const org = getOrganisation();
  const status = getSummaryStatus();

  let message = "";
  if (!org) message = "Pick an organisation at the top to see its details.";
  else if (status === "loading" || !specsByGuid) message = "Loading…";
  else if (status === "error") message = "Couldn't load this organisation's surveys.";
  else if (!getSiteRows().length) message = "No sites found for this organisation.";

  const header = `
    <div class="leagueHeader">
      <h2>Organisation details</h2>
      ${org ? `<p class="leagueSubtitle">${escapeHtml(org.name)}</p>` : ""}
    </div>`;

  if (message) {
    containerEl.innerHTML = `${header}<p class="muted hint">${escapeHtml(message)}</p>`;
    return;
  }

  containerEl.innerHTML = `
    ${header}
    <h3 class="orgSubhead">Equipment in use</h3>
    <div class="equipGrid">${availableMetrics().map((m) => equipmentCard(m.key)).join("")}</div>`;
}

function equipmentCard(metricKey) {
  const m = getMetric(metricKey);
  // Latest reading of this determinand across the organisation.
  const latest = getOrgObservations()
    .filter((o) => o[m.observationField] != null)
    .reduce((best, o) => (!best || o.time_of_observation > best.time_of_observation ? o : best), null);
  const guid = latest?.[`${m.observationField}_equipment_id`];
  const spec = guid ? specsByGuid[normalizeGuid(guid)] : null;

  let body;
  if (!spec) {
    body = `<p class="equipNoData">${latest ? "No equipment recorded for the most recent reading." : "No readings recorded yet."}</p>`;
  } else {
    const rows = [
      spec.range_bottom != null && spec.range_top != null
        && ["Detection range", `${spec.range_bottom}–${spec.range_top}${spec.unit ? ` ${spec.unit}` : ""}`],
      spec.statistic_measure && ["Measure", spec.statistic_measure],
      ["Last used", formatDateLong(latest.time_of_observation)],
    ].filter(Boolean);
    body = `
      <div class="equipName">${escapeHtml(spec.equipment_name || "(unnamed device)")}</div>
      ${spec.manafacturer_name ? `<div class="equipMaker">${escapeHtml(spec.manafacturer_name)}</div>` : ""}
      <dl class="equipSpecs">
        ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
      ${/^https?:\/\//i.test(spec.documentation_url ?? "")
        ? `<calcite-link href="${escapeHtml(spec.documentation_url)}" target="_blank" rel="noopener noreferrer" icon-end="launch">Documentation</calcite-link>`
        : ""}`;
  }

  return `
    <article class="equipCard" style="--metric-color:${metricColor(m)}">
      <div class="equipMetric">${escapeHtml(m.label)}</div>
      ${body}
    </article>`;
}
