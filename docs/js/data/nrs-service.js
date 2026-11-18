// =====================================================================
// NRS SERVICE
// Reads from the National River Survey feature service: organisations,
// their sites, survey observations and the equipment lookup. Per-site
// histories and the equipment table are cached for the session.
// =====================================================================

import {
  NRS, METRICS, WILDLIFE_FIELDS, INVASIVE_PLANT_FIELDS, POLLUTION_FIELDS, POLLUTION_OTHER_FIELD, WEATHER_FIELDS, PHOTO_FIELDS,
  EQUIPMENT_RANGE_MAX_OVERRIDE,
} from "../config.js";
import { escapeSql } from "../utils/format.js";

const layers = {};
const siteHistoryCache = new Map(); // locationID -> promise of history
let equipmentPromise = null;

export async function getLayer(url) {
  if (!layers[url]) {
    const [FeatureLayer] = await $arcgis.import(["@arcgis/core/layers/FeatureLayer.js"]);
    const layer = new FeatureLayer({ url });
    layers[url] = layer.load().then(() => layer);
  }
  return layers[url];
}

// Pages through a layer/table until every matching record is returned, so
// nothing is silently cut off at the service's maxRecordCount.
export async function queryAll(layer, params) {
  const pageSize = 1000;
  const features = [];
  for (let start = 0; ; start += pageSize) {
    const result = await layer.queryFeatures({ ...params, start, num: pageSize, orderByFields: params.orderByFields ?? [layer.objectIdField] });
    features.push(...result.features);
    if (!result.exceededTransferLimit && result.features.length < pageSize) return features;
  }
}

// The Python loader writes GUIDs without braces, lowercase; the Equipment
// table's own GlobalIDs come back braced and uppercase. Normalise both.
export function normalizeGuid(guid) {
  return guid ? String(guid).replace(/[{}]/g, "").toLowerCase() : guid;
}

export async function fetchOrganisationNames() {
  const layer = await getLayer(NRS.organisationsUrl);
  const result = await layer.queryFeatures({
    where: "1=1",
    outFields: ["organisation_name"],
    returnDistinctValues: true,
    orderByFields: ["organisation_name"],
    returnGeometry: false,
  });
  return result.features.map((f) => f.attributes.organisation_name).filter(Boolean);
}

// { name, guid } for an organisation, or null if not found.
export async function fetchOrganisation(name) {
  const layer = await getLayer(NRS.organisationsUrl);
  const result = await layer.queryFeatures({
    where: `organisation_name = '${escapeSql(name)}'`,
    outFields: ["organisation_name", "GlobalID"],
    returnGeometry: false,
  });
  const feature = result.features[0];
  return feature ? { name, guid: feature.attributes.GlobalID } : null;
}

// [{ locationID, locationName }] for one organisation.
export async function fetchOrganisationSites(orgGuid) {
  const layer = await getLayer(NRS.locationsUrl);
  const features = await queryAll(layer, {
    where: `organisation_id = '${escapeSql(orgGuid)}'`,
    outFields: ["GlobalID", "location_name"],
    returnGeometry: false,
  });
  return features.map((f) => ({ locationID: f.attributes.GlobalID, locationName: f.attributes.location_name }));
}

// Every observation for a set of sites, lean fields only (what the site
// summaries and the equipment cards need), as plain attribute objects.
export async function fetchObservationsForSites(locationIDs) {
  if (!locationIDs.length) return [];
  const layer = await getLayer(NRS.observationsUrl);
  const idList = locationIDs.map((id) => `'${escapeSql(id)}'`).join(", ");
  const features = await queryAll(layer, {
    where: `location_id IN (${idList})`,
    outFields: [
      "location_id", "time_of_observation",
      ...METRICS.map((m) => m.observationField),
      ...METRICS.map((m) => `${m.observationField}_equipment_id`),
    ],
    returnGeometry: false,
  });
  return features.map((f) => f.attributes);
}

// One site's full survey history, oldest first: { observations, daily }.
// `daily` averages same-day surveys into one point (for the chart).
export function fetchSiteHistory(locationID) {
  if (!siteHistoryCache.has(locationID)) {
    const promise = getLayer(NRS.observationsUrl)
      .then((layer) => queryAll(layer, {
        where: `location_id = '${escapeSql(locationID)}'`,
        outFields: [
          "time_of_observation", "clarity", "water_level", "water_flow", "rain_previous_24hrs",
          ...METRICS.map((m) => m.observationField),
          ...METRICS.map((m) => m.equipmentLimitField),
          ...WEATHER_FIELDS.map((w) => w.field),
          ...PHOTO_FIELDS,
          ...WILDLIFE_FIELDS.map((w) => w.observationField),
          ...INVASIVE_PLANT_FIELDS.map((w) => w.observationField),
          ...POLLUTION_FIELDS.map((p) => p.observationField),
          POLLUTION_OTHER_FIELD,
        ],
        orderByFields: ["time_of_observation ASC"],
        returnGeometry: false,
      }))
      .then((features) => {
        const observations = features.map((f) => f.attributes);
        return { observations, daily: groupByDay(observations) };
      })
      .catch((error) => {
        console.error("NRS dashboard: site history failed to load:", error);
        siteHistoryCache.delete(locationID);
        return { observations: [], daily: [] };
      });
    siteHistoryCache.set(locationID, promise);
  }
  return siteHistoryCache.get(locationID);
}

// One row per local calendar day, each determinand averaged across that
// day's surveys. A day is flagged "<field>_atLimit" if any of its readings
// was at/beyond the equipment's detection range.
function groupByDay(observations) {
  const byDay = new Map();
  for (const a of observations) {
    if (a.time_of_observation == null) continue;
    const d = new Date(a.time_of_observation);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), sums: {}, atLimit: {} });
    }
    const entry = byDay.get(dayKey);
    for (const m of METRICS) {
      const v = a[m.observationField];
      if (v == null) continue;
      const sum = (entry.sums[m.observationField] ??= { total: 0, count: 0 });
      sum.total += v;
      sum.count += 1;
      const limit = a[m.equipmentLimitField];
      if (limit != null && limit !== "") entry.atLimit[m.observationField] = true;
    }
  }

  return [...byDay.values()]
    .map((entry) => {
      const row = { time_of_observation: entry.date };
      for (const m of METRICS) {
        const sum = entry.sums[m.observationField];
        row[m.observationField] = sum ? sum.total / sum.count : null;
        row[`${m.observationField}_atLimit`] = !!entry.atLimit[m.observationField];
      }
      return row;
    })
    .sort((a, b) => a.time_of_observation - b.time_of_observation);
}

// The Equipment table: { specsByGuid, rangeByMetric }. rangeByMetric is
// metric key -> { min, max }, the widest range any listed device can read
// for that determinand - the trend chart's fixed y-axis.
export function fetchEquipment() {
  if (!equipmentPromise) {
    equipmentPromise = getLayer(NRS.equipmentUrl)
      .then((layer) => queryAll(layer, {
        where: "1=1",
        outFields: [
          "GlobalID", "equipment_name", "manafacturer_name", "documentation_url", "determinand",
          "range_bottom", "range_top", "unit", "statistic_measure",
        ],
        returnGeometry: false,
      }))
      .then((features) => {
        const specsByGuid = {};
        for (const f of features) specsByGuid[normalizeGuid(f.attributes.GlobalID)] = f.attributes;
        return { specsByGuid, rangeByMetric: equipmentRanges(Object.values(specsByGuid)) };
      })
      .catch((error) => {
        console.error("NRS dashboard: equipment specs failed to load:", error);
        return { specsByGuid: {}, rangeByMetric: {} };
      });
  }
  return equipmentPromise;
}

function equipmentRanges(specs) {
  const ranges = {};
  for (const m of METRICS) {
    const matching = specs.filter((s) => s.determinand === m.determinand);
    const bottoms = matching.map((s) => s.range_bottom).filter((v) => v != null);
    const tops = matching.map((s) => s.range_top).filter((v) => v != null);
    if (!bottoms.length || !tops.length) continue;
    let max = Math.max(...tops);
    if (EQUIPMENT_RANGE_MAX_OVERRIDE[m.key] !== undefined) max = Math.min(max, EQUIPMENT_RANGE_MAX_OVERRIDE[m.key]);
    ranges[m.key] = { min: Math.min(...bottoms), max };
  }
  return ranges;
}
