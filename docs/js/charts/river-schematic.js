// =====================================================================
// RIVER SCHEMATIC
// A river system drawn like a metro map from a river tree (built by
// js/data/river-topology.js): the main river as a horizontal line flowing
// left (upstream) to right (downstream), each tributary a branch bending
// in at 45 degrees to where it joins - and tributaries of tributaries
// branching off those, further out. Sites are the stations, coloured by
// their reading's threshold band and numbered (site names are too long to
// fit; the tab lists them by number under each diagram).
//
// Branches off the main line alternate above / below it; nested ones stay
// on their parent's side, one level further out. Each tributary sits over
// the stretch of river just upstream of where it joins, so nothing
// crosses anything else (see layoutTree). Lines are neutral and
// named in text - the stations are the only coloured (data) marks;
// unnamed watercourses are just "*". Where a river name partway along a
// line needs more room than STEP, the line is spaced out so the name
// clears the next name and any tributary coming in on its side.
// Matches the AQuA dashboard's river diagrams.
// =====================================================================

import { escapeHtml } from "../utils/format.js";
import { UNNAMED_RIVER } from "../data/river-topology.js";

export const UNNAMED_MARK = "*";
const STEP = 56; // gap between neighbouring stations / junctions
const ROW = 56; // vertical gap per branch level (also the 45-degree run)
const STATION_R = 7;
const PAD = 24;
const CHAR_W = 6.6; // rough label width per character at 12px
const LABEL_GAP = STATION_R + 10;
const STRETCH_Y = STATION_R + 12; // a stretch name's offset from its line
const LABEL_PAD = 8; // clear space after a stretch name

// tree: { items: [{ kind: "station", site, river } | { kind: "junction", line }] }
// pointsBySite: locationID -> { number, name, river, state: "value"|"none",
// value, color, bandLabel }. valueText(p) is the reading as text.
export function renderRiverSchematic(containerEl, { title, subtitle, tree, pointsBySite, valueText, tooltipEl }) {
  const layout = layoutTree(tree);

  const minX = Math.min(...layout.spans.map((s) => s[0]));
  const maxX = Math.max(...layout.spans.map((s) => s[1]));
  const dx = PAD - minX;
  const mainY = PAD + 20 + layout.levels[-1] * ROW;
  const height = mainY + layout.levels[1] * ROW + 44 + PAD;
  const width = maxX - minX + PAD * 2 + 90; // + the "Downstream" label
  const X = (x) => x + dx;
  const Y = (side, level) => mainY + side * level * ROW;

  const lines = [];
  const junctions = [];
  const labels = [];
  const stations = [];

  for (const ln of layout.lines) {
    const y = Y(ln.side, ln.level);
    const xs = ln.itemXs;
    if (ln.isMain) {
      lines.push(`<line class="schemLine schemLine--main" x1="${X(xs[0])}" y1="${y}" x2="${X(xs[xs.length - 1])}" y2="${y}" />`);
      labels.push(`<text class="schemFlow" x="${X(xs[xs.length - 1]) + STATION_R + 12}" y="${y}" dominant-baseline="middle">Downstream →</text>`);
    } else {
      const parentY = Y(ln.side, ln.parentLevel);
      lines.push(`<polyline class="schemLine" points="${X(xs[0])},${y} ${X(ln.bendX)},${y} ${X(ln.junctionX)},${parentY}" />`);
      junctions.push(`<circle class="schemJunction" cx="${X(ln.junctionX)}" cy="${parentY}" r="4" />`);
    }

    // River name at the start of the line; where the name changes along
    // it (a stream becoming a river), the new name where that stretch
    // begins - above the main line, on a branch's inner side.
    labels.push(`<text class="schemRiver" x="${X(xs[0]) - LABEL_GAP}" y="${y}" text-anchor="end" dominant-baseline="middle">${escapeHtml(lineName(ln.line))}</text>`);
    const stretches = stretchNames(ln.line);
    ln.line.items.forEach((it, i) => {
      if (it.kind !== "station") return;
      if (stretches.has(i)) {
        const labelY = ln.isMain ? y - STRETCH_Y : y - ln.side * STRETCH_Y;
        labels.push(`<text class="schemRiver schemRiver--stretch" x="${X(xs[i]) - STATION_R}" y="${labelY}" dominant-baseline="middle">${escapeHtml(stretches.get(i))}</text>`);
      }
      const p = pointsBySite.get(it.site.locationID);
      if (p) stations.push({ p, x: X(xs[i]), y, side: ln.isMain ? 1 : ln.side });
    });
  }

  const stationMarks = stations.map(({ p, x, y }) => stationMark(p, x, y)).join("");
  // Site numbers: below main-line stations, on the outer side of branches.
  const siteLabels = stations
    .map(({ p, x, y, side }) => `<text class="schemSite" x="${x}" y="${y + side * (STATION_R + 14)}" text-anchor="middle" dominant-baseline="middle">${p.number}</text>`)
    .join("");
  const hits = stations
    .map(({ p, x, y }, i) => `<circle class="schemHit" data-i="${i}" data-site="${escapeHtml(p.locationID)}" cx="${x}" cy="${y}" r="16" tabindex="0" role="img" aria-label="${escapeHtml(`${p.number}. ${p.name}, ${p.river}, ${valueText(p)}${p.bandLabel ? `, ${p.bandLabel}` : ""}`)}" />`)
    .join("");

  containerEl.innerHTML = `
    <figure class="schemFigure">
      <figcaption class="schemCaption">
        <span class="schemTitle">${escapeHtml(title)}</span>
        <span class="schemSubtitle">${escapeHtml(subtitle)}</span>
      </figcaption>
      <div class="schemScroll">
        <svg class="schemSvg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(`${title} river diagram: ${subtitle}`)}">
          ${lines.join("")}
          ${junctions.join("")}
          ${labels.join("")}
          ${stationMarks}
          ${siteLabels}
          ${hits}
        </svg>
      </div>
    </figure>`;

  containerEl.querySelectorAll(".schemHit").forEach((hit) => {
    const show = () => showTooltip(tooltipEl, hit, stations[Number(hit.dataset.i)].p, valueText);
    const hide = () => { tooltipEl.hidden = true; };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
  });
}

function stationMark(p, x, y) {
  if (p.state === "value") return `<circle class="schemStation" cx="${x}" cy="${y}" r="${STATION_R}" style="fill:${p.color}" />`;
  return `<circle class="schemStation schemStation--none" cx="${x}" cy="${y}" r="${STATION_R}" />`;
}

// Built with textContent - site names are data. Fixed-position, centred
// above the station (the .trendTooltip styles).
function showTooltip(tooltipEl, anchor, p, valueText) {
  const row = (className, text) => {
    const div = document.createElement("div");
    div.className = className;
    div.textContent = text;
    return div;
  };
  tooltipEl.replaceChildren(
    row("trendTooltipValue", valueText(p) + (p.bandLabel ? ` · ${p.bandLabel}` : "")),
    row("trendTooltipSite", `${p.number}. ${p.name}`),
    row("trendTooltipDate", p.river),
  );
  const box = anchor.getBoundingClientRect();
  tooltipEl.style.left = `${box.left + box.width / 2}px`;
  tooltipEl.style.top = `${box.top}px`;
  tooltipEl.hidden = false;
}

// Stations in reading order - down each line, a branch's stations before
// the main line carries on past its junction. The tab numbers them so.
export function stationsInOrder(line, out = []) {
  for (const it of line.items) {
    if (it.kind === "station") out.push(it);
    else stationsInOrder(it.line, out);
  }
  return out;
}

// ---------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------

// Positions every line. Lines run left (upstream) to right (downstream),
// STEP apart or further where a stretch name needs the room (itemGaps) -
// and a junction moves further right if its tributary needs the room:
// every tributary (with its own tributaries) sits over the stretch of its
// parent just upstream of where it joins, clear of the one before it on
// that side. So nothing - lines, 45-degree runs or names - crosses
// anything else. Main-line tributaries alternate above / below, starting
// above; a tributary's own tributaries go one level further out on its
// side.
const BRANCH_GAP = 16; // clear space between neighbouring tributaries

function layoutTree(tree) {
  const root = measure(tree, true);
  const lines = [{ line: tree, isMain: true, side: 1, level: 0, itemXs: root.xs }];
  const place = (node, offset, side, level) => {
    for (const child of node.children) {
      const childSide = level === 0 ? child.side : side;
      const junctionX = offset + node.xs[child.i];
      const childOffset = offset + child.offset;
      lines.push({
        line: child.line,
        isMain: false,
        side: childSide,
        level: level + 1,
        parentLevel: level,
        junctionX,
        bendX: junctionX - ROW,
        itemXs: child.sub.xs.map((x) => x + childOffset),
      });
      place(child.sub, childOffset, childSide, level + 1);
    }
  };
  place(root, 0, 1, 0);
  return { lines, spans: [[root.minX, root.maxX]], levels: root.depth };
}

// One line laid out in its own coordinates (first item at 0): item xs,
// its tributaries ({ i: junction item, side, offset: where the
// sub-layout's 0 sits, sub }), how far left and right it and its
// tributaries reach (minX, maxX), how many levels of tributaries it has on
// each side (depth), and the gap from its last item to its bend (tail). A
// branch's tributaries are all on its outer side (side 1 here; the caller
// maps it) and its stretch names on the inner one.
function measure(line, isMain) {
  const sides = new Map(); // junction item -> side
  let count = 0;
  line.items.forEach((it, i) => {
    if (it.kind === "junction") sides.set(i, isMain && count++ % 2 === 0 ? -1 : 1);
  });
  // The main line's stretch names sit above it, with the tributaries on side -1.
  const { gaps, tail } = itemGaps(line, (i) => isMain && sides.get(i) === -1, !isMain);

  const xs = [];
  const children = [];
  const rightmost = { [-1]: -Infinity, [1]: -Infinity }; // last junction on each side
  const depth = { [-1]: 0, [1]: 0 };
  line.items.forEach((it, i) => {
    let x = i === 0 ? 0 : xs[i - 1] + gaps[i];
    if (it.kind === "junction") {
      const sub = measure(it.line, false);
      const subLast = sub.xs[sub.xs.length - 1];
      // From the junction back to the tributary's left edge.
      const reach = ROW + sub.tail + subLast - sub.minX;
      const side = sides.get(i);
      x = Math.max(x, rightmost[side] + BRANCH_GAP + reach);
      rightmost[side] = x;
      depth[side] = Math.max(depth[side], 1 + sub.depth[1]);
      children.push({ i, side, line: it.line, offset: x - ROW - sub.tail - subLast, sub });
    }
    xs.push(x);
  });
  const minX = Math.min(
    xs[0] - labelWidth(lineName(line)) - LABEL_GAP,
    ...children.map((c) => c.offset + c.sub.minX),
  );
  const stretchEnds = [...stretchNames(line)].map(([i, name]) => xs[i] - STATION_R + labelWidth(name));
  const maxX = Math.max(xs[xs.length - 1], ...stretchEnds);
  return { xs, children, minX, maxX, depth, tail };
}

// The gap before each item (gaps[0] unused) and, for a branch, from its
// last item to its bend (tail): STEP (STEP / 2 for the tail), widened
// wherever a stretch name needs the room - it has to end before the next
// stretch name, before the next junction whose tributary comes in on the
// name's side (onNameSide(i)), and, on a branch, before the bend.
function itemGaps(line, onNameSide, isBranch) {
  const stretches = stretchNames(line);
  const gaps = line.items.map((_, i) => (i === 0 ? 0 : STEP));
  let tail = STEP / 2;
  let name = null; // { width, run }: the last stretch name, and how far its station is behind
  line.items.forEach((it, i) => {
    if (name && i > 0) {
      name.run += gaps[i];
      // A stretch name starts at its station's left edge; a tributary's
      // 45-degree run crosses the names' row STRETCH_Y left of its
      // junction (and the text is ~14px tall, so a little more).
      let need = 0;
      if (stretches.has(i)) need = name.width + LABEL_PAD;
      else if (it.kind === "junction" && onNameSide(i)) need = name.width - STATION_R + STRETCH_Y + LABEL_PAD + 10;
      if (need) {
        gaps[i] += Math.max(0, need - name.run);
        name = null;
      }
    }
    if (stretches.has(i)) name = { width: labelWidth(stretches.get(i)), run: 0 };
  });
  // The bend's run into the parent crosses the names' row STRETCH_Y right
  // of it.
  if (name && isBranch) tail = Math.max(tail, name.width - STATION_R - STRETCH_Y + LABEL_PAD - name.run);
  return { gaps, tail };
}

// Stretch names, by item index: a station whose river isn't the one
// before it on the line.
function stretchNames(line) {
  const names = new Map();
  let previous = null;
  line.items.forEach((it, i) => {
    if (it.kind !== "station") return;
    if (previous !== null && it.river !== previous) names.set(i, displayName(it.river));
    previous = it.river;
  });
  return names;
}

// A line is named after its first (most upstream) station's river, or its
// own if all its sites are on its tributaries.
function lineName(line) {
  return displayName(line.items.find((it) => it.kind === "station")?.river ?? line.river ?? "");
}

const displayName = (river) => (river === UNNAMED_RIVER ? UNNAMED_MARK : river);

function labelWidth(text) {
  return (String(text ?? "").length + 2) * CHAR_W;
}
