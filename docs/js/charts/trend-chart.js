// =====================================================================
// TREND CHART
// Plain-SVG line chart of one determinand over time for the selected
// site(s), one point per survey day. Two sites = two lines (solid and
// dashed) in the compare colours, with a legend. Threshold bands shade
// the plot behind the data; readings at/beyond the equipment's detection
// range get a faint red ring.
//
// The y-axis is fixed to the equipment's detection range for the
// determinand (so it doesn't jump between sites) unless "Fit to data" is
// on. Sized from its container, so call it again after a resize.
// A series is { siteName, color, dashed, points: [{ date, value, atLimit }] }.
// =====================================================================

import { bandsForMetric } from "../metrics.js";
import { formatTickValue, formatDateShort, formatDateLong, hexToRgba } from "../utils/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PER_POINT_LABEL_MAX = 12; // above this, only the latest value is labelled
const MARGIN = { left: 42, right: 16, top: 14, bottom: 26 };

// Returns a short message when there's nothing to draw, else null.
export function renderTrendChart({ svg, wrapEl, tooltipEl, legendEl, metric, series, equipRange, fitToData, rangeActive }) {
  svg.replaceChildren();
  tooltipEl.hidden = true;
  const comparing = series.length > 1;

  legendEl.replaceChildren();
  legendEl.hidden = !comparing;
  if (comparing) {
    for (const s of series) {
      const item = document.createElement("span");
      item.className = "trendLegendItem";
      const swatch = document.createElement("span");
      swatch.className = `trendLegendSwatch${s.dashed ? " isDashed" : ""}`;
      swatch.style.setProperty("--legend-color", s.color);
      const label = document.createElement("span");
      label.textContent = s.siteName + (s.points.length === 0 ? " (no data)" : "");
      item.append(swatch, label);
      legendEl.append(item);
    }
  }

  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  if (!series.some((s) => s.points.length >= 2)) {
    const name = metric.label.toLowerCase();
    return totalPoints === 0
      ? `No ${name} readings recorded for the selected site${comparing ? "s" : ""}${rangeActive ? " in this date range." : "."}`
      : `Not enough ${name} readings recorded${rangeActive ? " in this date range" : " yet"} to chart a trend.`;
  }

  // Match the viewBox to the rendered box, so text never gets scaled.
  const box = wrapEl.getBoundingClientRect();
  const width = Math.round(box.width) || 600;
  const height = Math.round(box.height) || 200;
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 20);
  const plotH = Math.max(height - MARGIN.top - MARGIN.bottom, 20);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const allPoints = series.flatMap((s) => s.points);
  const dates = allPoints.map((p) => p.date);
  const values = allPoints.map((p) => p.value);
  const xMin = Math.min(...dates);
  const xMax = Math.max(...dates);

  // Fixed equipment range, or "nice" data-driven ticks - still clamped to
  // what the equipment can physically read.
  let y;
  if (equipRange && !fitToData) {
    y = { min: equipRange.min, max: equipRange.max, ticks: evenlySpacedTicks(equipRange.min, equipRange.max, 4) };
  } else {
    y = niceTicks(Math.min(...values), Math.max(...values), 4);
    if (equipRange) {
      const min = Math.max(y.min, equipRange.min);
      const max = Math.min(y.max, equipRange.max);
      if (max > min) y = { min, max, ticks: evenlySpacedTicks(min, max, 4) };
    }
  }

  const xScale = (d) => (xMax === xMin ? MARGIN.left + plotW / 2 : MARGIN.left + ((d - xMin) / (xMax - xMin)) * plotW);
  const yScale = (v) => (y.max === y.min ? MARGIN.top + plotH / 2 : MARGIN.top + plotH - ((v - y.min) / (y.max - y.min)) * plotH);

  const add = (tag, attrs, className) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (className) el.setAttribute("class", className);
    svg.append(el);
    return el;
  };

  // Threshold bands, clipped to the visible range; labelled if tall enough.
  const bands = bandsForMetric(metric.key);
  bands?.forEach((band, i) => {
    const lo = Math.max(i === 0 ? -Infinity : bands[i - 1].max, y.min);
    const hi = Math.min(band.max === null ? Infinity : band.max, y.max);
    if (hi <= lo) return;
    const top = yScale(hi);
    const bottom = yScale(lo);
    add("rect", { x: MARGIN.left, y: top, width: plotW, height: Math.max(bottom - top, 0), fill: hexToRgba(band.color, 0.14) });
    if (bottom - top >= 14) {
      add("text", { x: width - MARGIN.right - 3, y: (top + bottom) / 2 + 3, "text-anchor": "end" }, "trendBandLabel").textContent = band.label;
    }
  });

  for (const t of y.ticks) {
    add("text", { x: MARGIN.left - 6, y: yScale(t) + 3, "text-anchor": "end" }, "trendTick").textContent = formatTickValue(t);
  }
  add("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH }, "trendBaseline");

  // First / middle / last date labels, never duplicated.
  const sorted = [...dates].sort((a, b) => a - b);
  const labelDates = sorted.length > 2
    ? [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]]
    : [sorted[0], sorted[sorted.length - 1]];
  const seenX = new Set();
  labelDates.forEach((d, i) => {
    const x = Math.round(xScale(d));
    if (seenX.has(x)) return;
    seenX.add(x);
    const anchor = i === 0 ? "start" : i === labelDates.length - 1 ? "end" : "middle";
    add("text", { x: xScale(d), y: height - 6, "text-anchor": anchor }, "trendTick").textContent = formatDateShort(d);
  });

  const valueLabel = (x, yPos, text, anchor = "middle") =>
    add("text", { x, y: yPos, "text-anchor": anchor }, "trendValueLabel").textContent = text;

  for (const s of series) {
    if (s.points.length >= 2) {
      const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.date).toFixed(1)},${yScale(p.value).toFixed(1)}`).join(" ");
      add("path", { d, stroke: s.color, "stroke-dasharray": s.dashed ? "5,4" : "none" }, "trendLine");
    }
    s.points.forEach((p, i) => {
      const isLast = i === s.points.length - 1;
      const r = isLast || s.points.length === 1 ? 4 : 3;
      if (p.atLimit) add("circle", { cx: xScale(p.date), cy: yScale(p.value), r: r + 3 }, "trendLimitRing");
      add("circle", { cx: xScale(p.date), cy: yScale(p.value), r, fill: s.color, "stroke-width": isLast ? 2 : 1.5 }, "trendPoint");
    });

    // Value labels: every point while they fit, else just the latest.
    // None when comparing - two crossing sets of labels are just noise.
    if (comparing || !s.points.length) continue;
    if (s.points.length <= PER_POINT_LABEL_MAX) {
      for (const p of s.points) {
        const cy = yScale(p.value);
        valueLabel(xScale(p.date), cy - 9 < MARGIN.top + 8 ? cy + 15 : cy - 9, formatTickValue(p.value));
      }
    } else {
      const last = s.points[s.points.length - 1];
      const cx = xScale(last.date);
      const cy = yScale(last.value);
      const nearRight = cx > width - MARGIN.right - 30;
      valueLabel(nearRight ? cx - 8 : cx + 8, cy - 8 < MARGIN.top + 8 ? cy + 14 : cy - 8, formatTickValue(last.value), nearRight ? "end" : "start");
    }
  }

  addHoverLayer({ svg, tooltipEl, add, series, comparing, xScale, yScale, width, height, plotW, plotH });
  return null;
}

// Crosshair + tooltip that snaps to the nearest point of each series
// (their survey dates rarely line up), by mouse or arrow keys.
function addHoverLayer({ svg, tooltipEl, add, series, comparing, xScale, yScale, width, height, plotW, plotH }) {
  const crosshair = add("line", { y1: MARGIN.top, y2: MARGIN.top + plotH, visibility: "hidden" }, "trendBaseline");
  const dots = series.map((s) => add("circle", { r: 5, fill: s.color, "stroke-width": 2, visibility: "hidden" }, "trendPoint"));
  const overlay = add("rect", { x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH, fill: "transparent", tabindex: 0 }, "trendOverlay");
  overlay.setAttribute("aria-label", "Chart readings - use the left and right arrow keys to step through them");

  const hoverIdx = series.map((s) => s.points.length - 1);
  const refIdx = series.findIndex((s) => s.points.length >= 2);

  function showAt(px) {
    tooltipEl.replaceChildren();
    let crossX = null;
    series.forEach((s, si) => {
      if (!s.points.length) {
        dots[si].setAttribute("visibility", "hidden");
        return;
      }
      let nearest = 0;
      s.points.forEach((p, i) => {
        if (Math.abs(xScale(p.date) - px) < Math.abs(xScale(s.points[nearest].date) - px)) nearest = i;
      });
      hoverIdx[si] = nearest;
      const p = s.points[nearest];
      dots[si].setAttribute("cx", xScale(p.date));
      dots[si].setAttribute("cy", yScale(p.value));
      dots[si].setAttribute("visibility", "visible");
      crossX ??= xScale(p.date);

      const row = document.createElement("div");
      row.className = "trendTooltipRow";
      const lines = [
        comparing && ["trendTooltipSite", s.siteName],
        ["trendTooltipValue", formatTickValue(p.value) + (p.atLimit ? " *" : "")],
        ["trendTooltipDate", formatDateLong(p.date)],
        p.atLimit && ["trendTooltipLimit", "At/beyond equipment detection limit"],
      ].filter(Boolean);
      for (const [className, text] of lines) {
        const line = document.createElement("div");
        line.className = className;
        line.textContent = text;
        row.append(line);
      }
      tooltipEl.append(row);
    });
    if (crossX === null) return;

    crosshair.setAttribute("x1", crossX);
    crosshair.setAttribute("x2", crossX);
    crosshair.setAttribute("visibility", "visible");

    // The tooltip is position: fixed - convert through the live svg box.
    const rect = svg.getBoundingClientRect();
    const topCy = Math.min(...dots.filter((d) => d.getAttribute("visibility") === "visible").map((d) => Number(d.getAttribute("cy"))));
    tooltipEl.style.left = `${rect.left + crossX * (rect.width / width)}px`;
    tooltipEl.style.top = `${rect.top + topCy * (rect.height / height)}px`;
    tooltipEl.hidden = false;

    // Nudge back on-screen.
    const tt = tooltipEl.getBoundingClientRect();
    const edge = 8;
    if (tt.left < edge) tooltipEl.style.left = `${parseFloat(tooltipEl.style.left) + edge - tt.left}px`;
    else if (tt.right > window.innerWidth - edge) tooltipEl.style.left = `${parseFloat(tooltipEl.style.left) - (tt.right - window.innerWidth + edge)}px`;
    if (tt.top < edge) tooltipEl.style.top = `${parseFloat(tooltipEl.style.top) + edge - tt.top}px`;
  }

  function hide() {
    crosshair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    tooltipEl.hidden = true;
  }

  overlay.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    showAt((event.clientX - rect.left) * (width / rect.width));
  });
  overlay.addEventListener("pointerleave", hide);
  overlay.addEventListener("focus", () => showAt(xScale(series[refIdx].points[hoverIdx[refIdx]].date)));
  overlay.addEventListener("blur", hide);
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const points = series[refIdx].points;
    const next = Math.max(0, Math.min(points.length - 1, hoverIdx[refIdx] + (event.key === "ArrowRight" ? 1 : -1)));
    showAt(xScale(points[next].date));
  });
}

// Ticks across an already-fixed domain - never rounded outward.
export function evenlySpacedTicks(min, max, divisions) {
  const ticks = [];
  for (let i = 0; i <= divisions; i++) ticks.push(Math.round((min + (i / divisions) * (max - min)) * 1000) / 1000);
  return ticks;
}

// "Nice" round ticks (0 / 0.5 / 1, not 0.137 / 0.482).
export function niceTicks(min, max, tickCount) {
  if (min === max) { min -= 1; max += 1; }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / (tickCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: niceMin, max: niceMax, ticks };
}

export function niceNumber(value, round) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let nice;
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}
