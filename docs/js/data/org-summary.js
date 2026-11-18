// =====================================================================
// ORG SUMMARY
// The selected organisation's sites and survey history, rolled up into
// one row per site for the current date range:
//   { locationID, locationName, totalSurveys, <metric.locationField>... }
// Each determinand is a mean or median per its `aggregation` in config.
// For the League table's other views, each determinand also gets
// <locationField>Max (the highest single reading), <locationField>HighCount
// (readings in the High or Very High band), <locationField>Readings (how
// many readings there were) and <locationField>HighShare (HighCount as a
// fraction of Readings, 0-1) - all null when there were none.
// The Map tab's symbology and stat boxes and the League table all read
// these same rows, so they always agree and all move with the date
// range. Changing organisation re-queries; changing dates only
// recomputes. Subscribe with onSummaryChange(fn).
//
// Also holds the sites picked in the League table, which narrow the Map
// tab to just those sites (none picked = all). Cleared when the
// organisation changes; subscribe with onPickChange(fn).
// =====================================================================

import { METRICS } from "../config.js";
import { median, bandForValue } from "../metrics.js";

// Bands counted by <locationField>HighCount.
const HIGH_BANDS = new Set(["high", "veryHigh"]);
import { onFilterChange, getOrganisation, isWithinDateRange } from "../filters.js";
import { fetchOrganisationSites, fetchObservationsForSites } from "./nrs-service.js";

const state = {
  status: "none", // "none" | "loading" | "ready" | "error"
  sites: [], // [{ locationID, locationName }]
  observations: [], // lean attribute objects, every date
  rows: [],
  request: 0,
  picked: new Set(), // locationIDs picked in the League table
};

const listeners = new Set();
const pickListeners = new Set();

export function onPickChange(fn) {
  pickListeners.add(fn);
  return () => pickListeners.delete(fn);
}

export function getPickedSites() {
  return state.picked;
}

export function togglePickedSite(locationID) {
  if (state.picked.has(locationID)) state.picked.delete(locationID);
  else state.picked.add(locationID);
  pickListeners.forEach((fn) => fn());
}

export function clearPickedSites() {
  state.picked.clear();
  pickListeners.forEach((fn) => fn());
}

export function onSummaryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function getSummaryStatus() {
  return state.status;
}

export function getSiteRows() {
  return state.rows;
}

export function getSiteRow(locationID) {
  return state.rows.find((r) => r.locationID === locationID) ?? null;
}

export function getOrgObservations() {
  return state.observations;
}

// Determinands the organisation actually collects (some value in range
// at some site). Everything, when there's nothing to narrow by.
export function availableMetrics() {
  if (!state.rows.length) return METRICS;
  const collected = METRICS.filter((m) => state.rows.some((r) => r[m.locationField] != null));
  return collected.length ? collected : METRICS;
}

export function initOrgSummary() {
  onFilterChange(({ org, dates }) => {
    if (org) load();
    else if (dates && state.status === "ready") {
      recompute();
      notify();
    }
  });
}

async function load() {
  const request = ++state.request;
  const org = getOrganisation();
  state.sites = [];
  state.observations = [];
  state.rows = [];
  state.picked.clear();
  state.status = org ? "loading" : "none";
  notify();
  if (!org?.guid) {
    if (org) state.status = "ready";
    notify();
    return;
  }

  try {
    const sites = await fetchOrganisationSites(org.guid);
    const observations = await fetchObservationsForSites(sites.map((s) => s.locationID));
    if (request !== state.request) return; // a newer organisation was picked
    state.sites = sites;
    state.observations = observations;
    state.status = "ready";
    recompute();
  } catch (error) {
    if (request !== state.request) return;
    console.error("NRS dashboard: organisation data failed to load:", error);
    state.status = "error";
  }
  notify();
}

// Every site gets a row, even with no surveys in range.
function recompute() {
  const inRange = new Map();
  for (const o of state.observations) {
    if (!isWithinDateRange(o.time_of_observation)) continue;
    if (!inRange.has(o.location_id)) inRange.set(o.location_id, []);
    inRange.get(o.location_id).push(o);
  }

  state.rows = state.sites.map((site) => {
    const obs = inRange.get(site.locationID) ?? [];
    const row = { locationID: site.locationID, locationName: site.locationName, totalSurveys: obs.length };
    for (const m of METRICS) {
      const values = obs.map((o) => o[m.observationField]).filter((v) => v != null);
      const f = m.locationField;
      if (!values.length) {
        row[f] = row[`${f}Max`] = row[`${f}HighCount`] = row[`${f}Readings`] = row[`${f}HighShare`] = null;
        continue;
      }
      row[f] = m.aggregation === "median" ? median(values) : values.reduce((a, b) => a + b, 0) / values.length;
      row[`${f}Max`] = Math.max(...values);
      row[`${f}HighCount`] = values.filter((v) => HIGH_BANDS.has(bandForValue(m.key, v)?.key)).length;
      row[`${f}Readings`] = values.length;
      row[`${f}HighShare`] = row[`${f}HighCount`] / values.length;
    }
    return row;
  });
}
