// =====================================================================
// METRICS
// Determinand lookups and threshold banding, using METRICS /
// BAND_STYLE / BAND_THRESHOLDS from config.js.
// =====================================================================

import { METRICS, BAND_STYLE, BAND_THRESHOLDS, COMPARE_SITE_COLORS } from "./config.js";
import { getTheme } from "./theme.js";

export function getMetric(key) {
  return METRICS.find((m) => m.key === key) ?? null;
}

// A determinand's colour for the current theme.
export function metricColor(metric) {
  return getTheme() === "light" ? metric.colorLight : metric.colorDark;
}

export function compareColor(index) {
  return COMPARE_SITE_COLORS[index][getTheme()];
}

// The five { key, label, color, max } bands for a determinand, or null if
// it has no thresholds. The last band's max is null (open-ended).
export function bandsForMetric(metricKey) {
  const thresholds = BAND_THRESHOLDS[metricKey];
  if (!thresholds) return null;
  return BAND_STYLE.map((style, i) => ({ ...style, max: i < thresholds.length ? thresholds[i] : null }));
}

// The band a reading falls in (upper bounds inclusive), or null.
export function bandForValue(metricKey, value) {
  if (value == null) return null;
  const bands = bandsForMetric(metricKey);
  return bands?.find((band) => band.max === null || value <= band.max) ?? null;
}

// A reading as text: the determinand's fixed `decimals` if it has one,
// else up to two decimal places.
export function formatMetricValue(metric, value) {
  if (value == null) return "–";
  const digits = metric.decimals ?? 2;
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: metric.decimals ?? 0,
    maximumFractionDigits: digits,
  });
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
