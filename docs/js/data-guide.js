// =====================================================================
// DATA GUIDE
// The header's "Data guide" dialog: every determinand's threshold bands,
// built from the same METRICS / BAND_STYLE / BAND_THRESHOLDS the map,
// stat boxes and chart use, so it can't drift from what they show.
// =====================================================================

import { METRICS, BAND_STYLE, BAND_THRESHOLDS } from "./config.js";
import { escapeHtml, formatTickValue, hexToRgba } from "./utils/format.js";

export function renderDataGuide(tableEl) {
  const head = `
    <thead>
      <tr>
        <th scope="col">Determinand</th>
        <th scope="col">Unit</th>
        ${BAND_STYLE.map((band) => `
          <th scope="col" class="guideBandHeader">
            <span class="guideSwatch" style="background:${band.color}"></span>${escapeHtml(band.label)}
          </th>`).join("")}
      </tr>
    </thead>`;

  const rows = METRICS.map((m) => {
    const thresholds = BAND_THRESHOLDS[m.key];
    const notation = m.notation ? ` <span class="muted">(${escapeHtml(m.notation)})</span>` : "";
    // Orthophosphate's PO4 vs PO4-P note.
    const info = m.infoNote
      ? `<calcite-action id="guideInfo-${m.key}" icon="information" text="About ${escapeHtml(m.label)} units" scale="s"></calcite-action>
         <calcite-popover reference-element="guideInfo-${m.key}" label="About ${escapeHtml(m.label)}" placement="right" closable auto-close>
           <p class="guideInfoNote">${escapeHtml(m.infoNote)}</p>
         </calcite-popover>`
      : "";
    const cells = thresholds
      ? BAND_STYLE.map((band, i) => {
        const lower = i === 0 ? null : thresholds[i - 1];
        const upper = i < thresholds.length ? thresholds[i] : null;
        const text = lower === null ? `&le; ${formatTickValue(upper)}`
          : upper === null ? `&gt; ${formatTickValue(lower)}`
            : `${formatTickValue(lower)}&ndash;${formatTickValue(upper)}`;
        return `<td style="background:${hexToRgba(band.color, 0.16)}">${text}</td>`;
      }).join("")
      : `<td colspan="${BAND_STYLE.length}">No thresholds defined</td>`;
    return `
      <tr>
        <th scope="row"><span class="guideMetric">${escapeHtml(m.label)}${notation}${info}</span></th>
        <td class="muted">${escapeHtml(m.unit)}</td>
        ${cells}
      </tr>`;
  }).join("");

  tableEl.innerHTML = `${head}<tbody>${rows}</tbody>`;
}
