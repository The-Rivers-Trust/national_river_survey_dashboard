// =====================================================================
// RIVER TOPOLOGY
// Works out how an organisation's sites sit on the real river network,
// for the Schematics tab. NRS sites have no river names or numbering, so
// everything comes from the Open River Network (ORN):
//
//  1. Snap - each site is placed on the nearest ORN river section within
//     RIVER_NETWORK.snapDistance. Sites with nothing that close (ponds,
//     culverted streams, a mis-placed point) are "off network" and left
//     off the diagrams - the tab lists them instead.
//  2. Catchment - each snapped section carries its CaBA catchment; every
//     section in that catchment is loaded (attributes only) for tracing.
//  3. Trace - from each site's section, follow the network downstream (a
//     section's Tnode is the next one's Fnode; ORN lines are digitised in
//     flow direction) to the catchment's edge or the sea. Sites whose
//     paths end in the same place are on one river system - one diagram.
//     A catchment with several separate rivers gets one per river.
//  4. Tree - from where a diagram's paths first meet, walk back upstream:
//     at each confluence the main stem follows the river with the higher
//     Strahler order, else the one that keeps its ORN name, else the one
//     with most river upstream (US_Accum), until the main river has no
//     more sites. Sites on it are stations; every other group of sites
//     becomes a branch joining where its path first meets the stem, built
//     the same way recursively (so a beck joining a tributary hangs off
//     that tributary, not the main river).
//
// Tree shape (what js/charts/river-schematic.js draws):
//   line = { river, items: [ { kind: "station", site, river } | { kind: "junction", line } ] }
// items run upstream -> downstream. A station's `river` is the ORN name of
// the section the site is on; a line's is the name at its upstream end.
// =====================================================================

import { NRS, RIVER_NETWORK } from "../config.js";
import { getLayer, queryAll } from "./nrs-service.js";
import { escapeSql } from "../utils/format.js";

const ORN_FIELDS = "OBJECTID,name1,Fnode,Tnode,Strahler,US_Accum,CaBA_Catchment";
const BNG = 27700; // British National Grid - the ORN's own SR
const NO_CATCHMENT_BUFFER = 10000; // m around sites whose section has no CaBA catchment
export const UNNAMED_RIVER = "Unnamed watercourse";
// Unnamed sections come back as "" or " ".
const riverName = (section) => section?.name1?.trim() || UNNAMED_RIVER;

const networkCache = new Map(); // organisation GlobalID -> Promise<network>

// Every site of an organisation, placed on the network: { sites, snaps,
// segmentsByCatchment }. sites: [{ locationID, locationName, x, y }] in
// BNG; snaps: locationID -> { id, along, catchment }. Cached per
// organisation - the date range only changes which sites are drawn.
export function loadOrgNetwork(orgGuid) {
  if (!networkCache.has(orgGuid)) {
    const promise = loadNetwork(orgGuid);
    networkCache.set(orgGuid, promise);
    promise.catch(() => networkCache.delete(orgGuid)); // try again next time
  }
  return networkCache.get(orgGuid);
}

// ---------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------

async function ornQuery(params) {
  const body = new URLSearchParams({ f: "json", inSR: BNG, outSR: BNG, ...params });
  const response = await fetch(`${RIVER_NETWORK.url}/query`, { method: "POST", body });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

// Pages through every matching section.
async function ornQueryAll(params) {
  const features = [];
  for (let offset = 0; ; ) {
    const page = await ornQuery({ ...params, resultOffset: offset, resultRecordCount: 2000 });
    features.push(...page.features);
    if (!page.exceededTransferLimit) return features;
    offset += page.features.length;
  }
}

async function loadNetwork(orgGuid) {
  const layer = await getLayer(NRS.locationsUrl);
  const features = await queryAll(layer, {
    where: `organisation_id = '${escapeSql(orgGuid)}'`,
    outFields: ["GlobalID", "location_name"],
    returnGeometry: true,
    outSpatialReference: { wkid: BNG },
  });
  const sites = features
    .filter((f) => f.geometry)
    .map((f) => ({ locationID: f.attributes.GlobalID, locationName: f.attributes.location_name, x: f.geometry.x, y: f.geometry.y }));
  if (!sites.length) return { sites, snaps: new Map(), segmentsByCatchment: new Map() };

  // 1. Sections near any site, with geometry, for snapping.
  const near = await ornQueryAll({
    geometry: JSON.stringify({ points: sites.map((s) => [s.x, s.y]), spatialReference: { wkid: BNG } }),
    geometryType: "esriGeometryMultipoint",
    spatialRel: "esriSpatialRelIntersects",
    distance: RIVER_NETWORK.snapDistance,
    units: "esriSRUnit_Meter",
    outFields: ORN_FIELDS,
    returnGeometry: true,
  });
  const snaps = new Map();
  for (const site of sites) {
    const snap = snapSite(site, near);
    if (snap) snaps.set(site.locationID, snap);
  }

  // 2. Every section in each catchment the sites snapped into.
  const segmentsByCatchment = new Map();
  const catchments = [...new Set([...snaps.values()].map((s) => s.catchment))];
  await Promise.all(catchments.map(async (catchment) => {
    let params;
    if (catchment) {
      params = { where: `CaBA_Catchment = '${escapeSql(catchment)}'` };
    } else {
      // Rare: sections outside every CaBA catchment - an area round them.
      const located = sites.filter((s) => snaps.get(s.locationID)?.catchment === catchment);
      const xs = located.map((s) => s.x);
      const ys = located.map((s) => s.y);
      const b = NO_CATCHMENT_BUFFER;
      params = {
        where: "CaBA_Catchment IS NULL",
        geometry: [Math.min(...xs) - b, Math.min(...ys) - b, Math.max(...xs) + b, Math.max(...ys) + b].join(","),
        geometryType: "esriGeometryEnvelope",
        spatialRel: "esriSpatialRelIntersects",
      };
    }
    const segments = await ornQueryAll({ ...params, outFields: ORN_FIELDS, returnGeometry: false });
    segmentsByCatchment.set(catchment, segments.map((f) => f.attributes));
  }));

  return { sites, snaps, segmentsByCatchment };
}

// The nearest section within snapDistance, or null.
function snapSite(site, features) {
  let best = null;
  for (const f of features) {
    const hit = nearestOnPath(site.x, site.y, f.geometry?.paths ?? []);
    if (hit.distance <= RIVER_NETWORK.snapDistance && (!best || hit.distance < best.distance)) best = { attrs: f.attributes, ...hit };
  }
  return best && { id: best.attrs.OBJECTID, along: best.along, catchment: best.attrs.CaBA_Catchment ?? null };
}

// Distance from a point to a polyline, and how far along it (0-1) the
// nearest point is - used to order sites on the same section.
function nearestOnPath(x, y, paths) {
  let best = { distance: Infinity, along: 0 };
  let total = 0;
  const lengths = paths.map((p) => p.slice(1).reduce((sum, pt, i) => sum + Math.hypot(pt[0] - p[i][0], pt[1] - p[i][1]), 0));
  const fullLength = lengths.reduce((a, b) => a + b, 0) || 1;
  paths.forEach((path) => {
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len))) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best.distance) best = { distance: d, along: (total + t * len) / fullLength };
      total += len;
    }
  });
  return best;
}

// ---------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------

// The diagrams for a set of the organisation's sites (`locationIDs`):
// { diagrams: [{ catchment, river, siteCount, root }], offNetwork: [site] }.
// Diagrams are sorted by catchment, then biggest first.
export function buildSchematics(network, locationIDs) {
  const wanted = new Set(locationIDs);
  const sites = network.sites.filter((s) => wanted.has(s.locationID));
  const offNetwork = [];
  const byCatchment = new Map();
  for (const site of sites) {
    const snap = network.snaps.get(site.locationID);
    if (!snap) offNetwork.push(site);
    else (byCatchment.get(snap.catchment) ?? byCatchment.set(snap.catchment, []).get(snap.catchment)).push({ site, snap });
  }

  const diagrams = [];
  for (const [catchment, members] of byCatchment) {
    const segments = network.segmentsByCatchment.get(catchment) ?? [];
    const byId = new Map(segments.map((s) => [s.OBJECTID, s]));
    const byFnode = new Map();
    for (const s of segments) (byFnode.get(s.Fnode) ?? byFnode.set(s.Fnode, []).get(s.Fnode)).push(s);

    // Downstream path (section ids) from a section, within the catchment.
    // At a split (braids, mill leats) follow the bigger channel.
    const downstream = (startId) => {
      const path = [startId];
      const seen = new Set(path);
      for (let current = byId.get(startId); current; ) {
        const next = (byFnode.get(current.Tnode) ?? [])
          .filter((s) => !seen.has(s.OBJECTID))
          .sort((a, b) => b.Strahler - a.Strahler)[0];
        if (!next) break;
        path.push(next.OBJECTID);
        seen.add(next.OBJECTID);
        current = next;
      }
      return path;
    };

    // One river system per place the paths end.
    const systems = new Map();
    for (const m of members) {
      if (!byId.has(m.snap.id)) {
        offNetwork.push(m.site);
        continue;
      }
      const path = downstream(m.snap.id);
      const end = path[path.length - 1];
      (systems.get(end) ?? systems.set(end, []).get(end)).push({ ...m, path });
    }
    for (const system of systems.values()) {
      // The first section every path passes through is where they meet.
      const rootId = system[0].path.find((id) => system.every((m) => m.path.includes(id)));
      diagrams.push({
        catchment: catchment ?? "Outside the CaBA catchments",
        river: riverName(byId.get(rootId)),
        siteCount: system.length,
        root: buildLine(rootId, system, byId, segments),
      });
    }
  }

  diagrams.sort((a, b) => a.catchment.localeCompare(b.catchment, "en-GB") || b.siteCount - a.siteCount || a.river.localeCompare(b.river, "en-GB"));
  offNetwork.sort((a, b) => String(a.locationName).localeCompare(String(b.locationName), "en-GB"));
  return { diagrams, offNetwork };
}

// One line of the tree: the stem from `rootId` upstream, its stations,
// and junctions to sub-lines for every other group of sites.
function buildLine(rootId, members, byId, segments) {
  // Only the sections these sites' paths use, up to and including root.
  const used = new Set();
  for (const m of members) {
    for (const id of m.path) {
      used.add(id);
      if (id === rootId) break;
    }
  }
  const byTnode = new Map();
  for (const s of segments) (byTnode.get(s.Tnode) ?? byTnode.set(s.Tnode, []).get(s.Tnode)).push(s);

  // Stem: from root upstream, at each confluence the main river - the one
  // with the higher Strahler order (the order-3 Lea flows into the
  // order-4 Beane), else, for two streams of the same order, the one
  // that keeps the name, else the one with most river above it. The
  // choice is made from every section, not just the sites' paths, and the
  // stem stops where the main river has no more sites: a tributary with
  // sites further up (Temple Brook above the last Axe site) then joins
  // there as a branch, rather than carrying the main line on up it.
  const stem = [rootId];
  for (let current = byId.get(rootId); ; ) {
    const name = current.name1?.trim();
    const keepsName = (s) => (name && s.name1?.trim() === name ? 1 : 0);
    const up = (byTnode.get(current.Fnode) ?? [])
      .sort((a, b) => b.Strahler - a.Strahler || keepsName(b) - keepsName(a) || b.US_Accum - a.US_Accum)[0];
    if (!up || !used.has(up.OBJECTID)) break;
    stem.unshift(up.OBJECTID);
    current = up;
  }
  const stemIndex = new Map(stem.map((id, i) => [id, i])); // 0 = furthest upstream

  const items = [];
  const groups = new Map(); // entry section -> members joining through it
  for (const m of members) {
    if (stemIndex.has(m.snap.id)) {
      items.push({
        kind: "station",
        site: m.site,
        river: riverName(byId.get(m.snap.id)),
        key: [stemIndex.get(m.snap.id), m.snap.along, m.site.locationName],
      });
      continue;
    }
    // Where this site's path reaches the stem, and the section it comes in by.
    const at = m.path.findIndex((id) => stemIndex.has(id));
    const entry = m.path[at - 1];
    const group = groups.get(entry) ?? { joinId: m.path[at], members: [] };
    group.members.push(m);
    groups.set(entry, group);
  }
  for (const [entry, group] of groups) {
    // A branch joins at the upstream end of the stem section it flows
    // into - before any station on that section.
    items.push({
      kind: "junction",
      line: buildLine(entry, group.members, byId, segments),
      key: [stemIndex.get(group.joinId), -1, ""],
    });
  }
  items.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || String(a.key[2]).localeCompare(String(b.key[2])));
  // river: the stem's own name, for a line whose sites are all on its
  // tributaries.
  return { river: riverName(byId.get(stem[0])), items: items.map(({ key, ...it }) => it) };
}
