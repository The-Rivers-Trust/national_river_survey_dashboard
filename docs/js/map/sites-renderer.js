// =====================================================================
// SITES RENDERER
// Survey site symbology for the selected determinand. The values come
// from the date-filtered site summaries (js/data/org-summary.js), not
// fields on the layer, so they're injected as an Arcade Decode() on the
// site's GlobalID. Each site is coloured by its threshold band and sized
// by the band's rank (Very High biggest) - so size means the same thing
// everywhere - with dot sizes scaled to the zoom (MARKER_SCALE_STOPS).
// A site with no reading is a hollow ring.
// =====================================================================

import { MAP_COLORS, MARKER_SCALE_STOPS } from "../config.js";
import { bandsForMetric, metricColor } from "../metrics.js";
import { getTheme } from "../theme.js";

// Legend swatch sizes, Low smallest to Very High largest, at ~1:250,000.
const LEGEND_REF_STOP = MARKER_SCALE_STOPS.find((s) => s.value === 250000) ?? MARKER_SCALE_STOPS[0];

function legendSize(rank, count) {
  const t = count === 1 ? 0 : rank / (count - 1);
  return LEGEND_REF_STOP.min + t * (LEGEND_REF_STOP.max - LEGEND_REF_STOP.min);
}

function marker(color, size = 8, outlineWidth = 1) {
  return {
    type: "simple-marker",
    style: "circle",
    color,
    size,
    outline: { color: MAP_COLORS[getTheme()].markerOutline, width: outlineWidth },
  };
}

// "var value = Decode($feature.GlobalID, 'id1', 0.4, 'id2', 1.2, null);"
function valueArcade(field, rows) {
  const cases = rows
    .filter((row) => row[field] != null)
    .flatMap((row) => [`'${String(row.locationID).replace(/'/g, "\\'")}'`, String(row[field])]);
  return `var value = Decode($feature.GlobalID, ${[...cases, "null"].join(", ")});\n`;
}

// Bands are checked in ascending order, upper bounds inclusive.
function bandArcade(field, rows, bands, result) {
  const lines = bands.map((band, i) => (band.max === null
    ? `return ${result(band, i)};`
    : `if (value <= ${band.max}) { return ${result(band, i)}; }`));
  return `${valueArcade(field, rows)}if (IsEmpty(value)) { return ${result(null)}; }\n${lines.join("\n")}`;
}

export function sitesRenderer(metric, rows) {
  const bands = metric ? bandsForMetric(metric.key) : null;
  if (!metric || !rows.length) {
    return { type: "simple", symbol: marker(metric ? metricColor(metric) : "#e8590c") };
  }
  if (!bands) {
    return { type: "simple", symbol: marker(metricColor(metric)) };
  }

  return {
    type: "unique-value",
    valueExpression: bandArcade(metric.locationField, rows, bands, (band) => (band ? `"${band.key}"` : `"none"`)),
    valueExpressionTitle: `${metric.label} band`,
    uniqueValueInfos: bands.map((band, i) => ({
      value: band.key,
      label: band.label,
      symbol: marker(band.color, legendSize(i, bands.length)),
    })),
    defaultSymbol: marker([0, 0, 0, 0], 8, 1.5),
    defaultLabel: `No ${metric.label.toLowerCase()} data`,
    visualVariables: [{
      type: "size",
      valueExpression: bandArcade(metric.locationField, rows, bands, (band, i) => (band ? i : "null")),
      minDataValue: 0,
      maxDataValue: bands.length - 1,
      minSize: { type: "size", valueExpression: "$view.scale", stops: MARKER_SCALE_STOPS.map((s) => ({ value: s.value, size: s.min })) },
      maxSize: { type: "size", valueExpression: "$view.scale", stops: MARKER_SCALE_STOPS.map((s) => ({ value: s.value, size: s.max })) },
      // The band entries above already show Low-to-Very High sizes.
      legendOptions: { showLegend: false },
    }],
  };
}
