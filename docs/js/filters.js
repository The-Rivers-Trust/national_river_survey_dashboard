// =====================================================================
// FILTERS
// The header filters shared by every tab: the organisation and the date
// range (with quick presets). Tabs read them with getOrganisation() /
// isWithinDateRange() and subscribe with onFilterChange(fn), which is
// called with { org, dates } flags saying which of the two changed.
//
// Nothing works without an organisation, so the start screen (a dialog
// listing them) stays open until one is chosen and reopens if it's
// cleared. Picking one resolves it to its GlobalID (everything
// downstream filters by GlobalID).
// =====================================================================

import { fetchOrganisationNames, fetchOrganisation } from "./data/nrs-service.js";
import { formatDateLong } from "./utils/format.js";

// Keys match the data-preset items in index.html.
const PRESETS = {
  month: { label: "Last month", shift: (d) => d.setMonth(d.getMonth() - 1) },
  quarter: { label: "Last 3 months", shift: (d) => d.setMonth(d.getMonth() - 3) },
  year: { label: "Last year", shift: (d) => d.setFullYear(d.getFullYear() - 1) },
};

const state = {
  els: null,
  org: null, // { name, guid, geometry } once resolved
  from: null, // ms, start of day - null = unbounded
  to: null, // ms, end of day - null = unbounded
  orgRequest: 0,
};

const listeners = new Set();

export function onFilterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(changes) {
  listeners.forEach((fn) => fn(changes));
}

export function getOrganisation() {
  return state.org;
}

export function hasDateRange() {
  return state.from !== null || state.to !== null;
}

export function getDateRange() {
  return { from: state.from, to: state.to };
}

export function isWithinDateRange(ms) {
  if (ms == null) return false;
  if (state.from !== null && ms < state.from) return false;
  if (state.to !== null && ms > state.to) return false;
  return true;
}

// "Last 3 months", "1 Jan 2026 - 30 Jun 2026", "All available data", ...
export function dateRangeDescription() {
  if (!hasDateRange()) return "All available data";
  const [fromStr, toStr] = state.els.dateEl.value ?? [];
  const preset = Object.keys(PRESETS).find((key) => {
    const range = presetRange(key);
    return fromStr === range[0] && toStr === range[1];
  });
  if (preset) return PRESETS[preset].label;
  if (state.from !== null && state.to !== null) return `${formatDateLong(state.from)} - ${formatDateLong(state.to)}`;
  return state.from !== null ? `From ${formatDateLong(state.from)}` : `Up to ${formatDateLong(state.to)}`;
}

// splashEl: the start screen - a dialog that can't be dismissed without
// picking an organisation (splashListEl), and comes back if it's cleared.
export async function initFilters({ orgEl, dateEl, presetsEl, clearDatesEl, splashEl, splashListEl }) {
  state.els = { orgEl, dateEl, presetsEl, clearDatesEl, splashEl, splashListEl };

  dateEl.max = toInputDate(new Date());
  dateEl.addEventListener("calciteInputDatePickerChange", applyDateRange);
  presetsEl.addEventListener("calciteDropdownSelect", () => {
    const key = presetsEl.selectedItems?.[0]?.dataset.preset;
    if (key) {
      dateEl.value = presetRange(key);
      applyDateRange();
    }
  });
  clearDatesEl.addEventListener("click", () => {
    dateEl.value = ["", ""];
    applyDateRange();
  });

  orgEl.addEventListener("calciteComboboxChange", () => {
    const name = orgEl.value || "";
    if (name !== (state.org?.name ?? "")) selectOrganisation(name);
  });

  splashListEl.addEventListener("calciteListChange", () => {
    const name = splashListEl.selectedItems[0]?.value;
    if (name) selectOrganisation(name);
  });

  let names;
  try {
    names = await fetchOrganisationNames();
  } catch (error) {
    splashEl.querySelector("[data-splash-status]").textContent = "Couldn't load the organisations - try reloading the page.";
    throw error;
  }
  orgEl.replaceChildren(...names.map((name) => {
    const item = document.createElement("calcite-combobox-item");
    item.value = name;
    item.heading = name;
    return item;
  }));
  splashListEl.replaceChildren(...names.map((name) => {
    const item = document.createElement("calcite-list-item");
    item.value = name;
    item.label = name;
    return item;
  }));
  splashEl.querySelector("[data-splash-status]").hidden = true;
  splashListEl.hidden = false;
  orgEl.disabled = false;
}

// Select an organisation by name ("" clears it).
export async function selectOrganisation(name) {
  const request = ++state.orgRequest;
  const { orgEl, splashEl, splashListEl } = state.els;
  if ((orgEl.value || "") !== name) orgEl.value = name;
  splashEl.open = !name;

  if (!name) {
    splashListEl.selectedItems.forEach((item) => { item.selected = false; });
    state.org = null;
    notify({ org: true, dates: false });
    return;
  }

  let org = null;
  try {
    org = await fetchOrganisation(name);
  } catch (error) {
    console.error(`NRS dashboard: couldn't look up "${name}":`, error);
  }
  if (request !== state.orgRequest) return; // superseded by a newer pick
  state.org = org ?? { name, guid: null };
  notify({ org: true, dates: false });
}

function applyDateRange() {
  const { dateEl, presetsEl, clearDatesEl } = state.els;
  const [fromStr = "", toStr = ""] = dateEl.value ?? [];
  state.from = parseInputDate(fromStr, false);
  state.to = parseInputDate(toStr, true);
  clearDatesEl.hidden = !hasDateRange();

  // Tick the preset the range matches, if any.
  presetsEl.querySelectorAll("calcite-dropdown-item").forEach((item) => {
    const range = presetRange(item.dataset.preset);
    item.selected = fromStr === range[0] && toStr === range[1];
  });

  notify({ org: false, dates: true });
}

// A rolling window ending today, as ["YYYY-MM-DD", "YYYY-MM-DD"].
function presetRange(key) {
  const from = new Date();
  PRESETS[key].shift(from);
  return [toInputDate(from), toInputDate(new Date())];
}

// Local date parts, not toISOString (which can land on the wrong day).
function toInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseInputDate(value, endOfDay) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}
