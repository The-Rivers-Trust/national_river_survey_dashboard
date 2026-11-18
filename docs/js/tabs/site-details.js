// =====================================================================
// SITE DETAILS
// The Map tab's right-hand panel for the primary selected site, open
// while a site is selected (closing it clears the selection): a stat
// box per determinand (from the date-filtered site summary, tinted by
// its threshold band), wildlife and invasive species seen in range, the
// pollution reported in range (how many surveys saw each type, by
// amount, plus anything typed in as "other"), and
// a carousel of the last five surveys with their photos (opened in a
// dialog).
// =====================================================================

import {
  METRICS, WILDLIFE_FIELDS, INVASIVE_PLANT_FIELDS, POLLUTION_FIELDS, POLLUTION_OTHER_FIELD, POLLUTION_AMOUNTS, WEATHER_FIELDS, PHOTO_FIELDS,
} from "../config.js";
import { bandForValue, metricColor } from "../metrics.js";
import { getSiteRow, availableMetrics } from "../data/org-summary.js";
import { isWithinDateRange, hasDateRange } from "../filters.js";
import { escapeHtml, formatNumber, formatDateLong, capitalize, hexToRgba } from "../utils/format.js";

const RECENT_COUNT = 5;

const state = {
  els: null,
  site: null, // { locationID, name, orgName }
  history: null, // that site's { observations, daily }, null while loading
  recent: [],
  index: 0,
  photos: [],
  photoIndex: 0,
  photoCaption: "",
};

export function initSiteDetails(els) {
  state.els = els;
  els.prevEl.addEventListener("click", () => stepSurvey(-1));
  els.nextEl.addEventListener("click", () => stepSurvey(1));

  const { photoDialogEl, photoPrevEl, photoNextEl } = els;
  photoPrevEl.addEventListener("click", () => stepPhoto(-1));
  photoNextEl.addEventListener("click", () => stepPhoto(1));
  photoDialogEl.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") stepPhoto(-1);
    else if (event.key === "ArrowRight") stepPhoto(1);
  });

  els.statsEl.innerHTML = `
    <div class="statBox" data-metric="surveys">
      <div class="statValueRow"><span class="statValue"></span></div>
      <div class="statLabel">Total surveys</div>
    </div>` + METRICS.map((m) => `
    <div class="statBox" data-metric="${m.key}">
      <div class="statValueRow"><span class="statValue"></span><span class="statUnit">${escapeHtml(m.unit)}</span></div>
      <div class="statLabel">${m.aggregation === "median" ? "Median" : "Avg"} ${escapeHtml(m.label)}</div>
    </div>`).join("");
  clearSiteDetails();
}

export function clearSiteDetails() {
  state.site = null;
  state.history = null;
  state.els.panelEl.heading = "Site details";
  state.els.panelEl.description = "";
  state.els.panelEl.closed = true;
}

// Show a site; `history` is null while its surveys are still loading.
export function showSiteDetails(site, history) {
  const changed = state.site?.locationID !== site.locationID;
  state.site = site;
  state.history = history;
  const { panelEl } = state.els;
  panelEl.heading = site.name;
  panelEl.description = site.orgName ?? "";
  panelEl.closed = false;
  refreshSiteDetails(changed);
}

// Re-reads the summary and the date range (after either changes).
export function refreshSiteDetails(resetCarousel = true) {
  if (!state.site) return;
  renderStats();
  const inRange = state.history ? state.history.observations.filter((o) => isWithinDateRange(o.time_of_observation)) : [];
  renderTags(state.els.wildlifeEl, "isWildlife", WILDLIFE_FIELDS, inRange);
  renderTags(state.els.invasiveEl, "isInvasive", INVASIVE_PLANT_FIELDS, inRange);
  renderPollution(inRange);
  state.recent = inRange.slice(-RECENT_COUNT).reverse();
  if (resetCarousel || state.index >= state.recent.length) state.index = 0;
  renderSurvey();
}

// Metric colours (survey card swatches) follow the theme.
export function renderSurveyForTheme() {
  if (state.site) renderSurvey();
}

function renderStats() {
  const row = getSiteRow(state.site.locationID);
  const collected = new Set(availableMetrics().map((m) => m.key));
  for (const box of state.els.statsEl.querySelectorAll(".statBox")) {
    const key = box.dataset.metric;
    const valueEl = box.querySelector(".statValue");
    if (key === "surveys") {
      valueEl.textContent = row ? row.totalSurveys : "-";
      continue;
    }
    // Only the determinands this organisation collects.
    const metric = METRICS.find((m) => m.key === key);
    box.hidden = !collected.has(key);
    const value = row ? row[metric.locationField] : null;
    valueEl.textContent = formatNumber(value);
    const band = collected.has(key) ? bandForValue(key, value) : null;
    box.style.background = band ? hexToRgba(band.color, 0.22) : "";
    box.querySelector(".statValueRow").style.color = band ? band.color : "";
    box.title = band ? `${metric.label}: ${band.label}` : "";
  }
}

function renderTags(container, className, fields, observations) {
  const tags = fields
    .map((f) => ({ label: f.label, count: observations.filter((o) => o[f.observationField] === "Yes").length }))
    .filter((t) => t.count > 0)
    .map((t) => `<span class="speciesTag ${className}">${escapeHtml(t.label)} (${t.count})</span>`);
  container.innerHTML = tags.length
    ? tags.join("")
    : `<span class="muted">${state.history ? "None recorded" : "Loading…"}${state.history && hasDateRange() ? " in this date range" : ""}.</span>`;
}

const OTHER_POLLUTION_SHOWN = 5;

// One row per pollution type seen, most often reported first, with a chip
// per amount ("3 small", "1 moderate"); then the "other" reports, most
// recent first.
function renderPollution(observations) {
  const el = state.els.pollutionEl;
  if (!state.history) {
    el.innerHTML = `<span class="muted">Loading…</span>`;
    return;
  }
  const types = POLLUTION_FIELDS
    .map((f) => ({
      label: f.label,
      amounts: POLLUTION_AMOUNTS
        .map((a) => ({ ...a, count: observations.filter((o) => o[f.observationField] === a.value).length }))
        .filter((a) => a.count > 0),
    }))
    .map((t) => ({ ...t, total: t.amounts.reduce((sum, a) => sum + a.count, 0) }))
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);

  const otherCounts = new Map();
  for (const o of [...observations].reverse()) {
    const text = o[POLLUTION_OTHER_FIELD]?.trim();
    if (text) otherCounts.set(text, (otherCounts.get(text) ?? 0) + 1);
  }
  const others = [...otherCounts];

  if (!types.length && !others.length) {
    el.innerHTML = `<span class="muted">None recorded${hasDateRange() ? " in this date range" : ""}.</span>`;
    return;
  }
  const surveys = (n) => `${n} ${n === 1 ? "survey" : "surveys"}`;
  el.innerHTML = `
    ${types.length ? `<ul class="pollutionList">${types.map((t) => `
      <li class="pollutionRow">
        <span class="pollutionType">${escapeHtml(t.label)}</span>
        <span class="pollutionAmounts" title="${escapeHtml(`Reported on ${surveys(t.total)}`)}">${t.amounts.map((a) => `
          <span class="pollutionAmount pollutionAmount--${a.value}">${a.count} ${escapeHtml(a.value)}</span>`).join("")}
        </span>
      </li>`).join("")}</ul>` : ""}
    ${others.length ? `
      <p class="pollutionOther"><span class="pollutionOtherLabel">Other reports:</span>
        ${others.slice(0, OTHER_POLLUTION_SHOWN).map(([text, n]) => `${escapeHtml(text)}${n > 1 ? ` (${n})` : ""}`).join("; ")}${others.length > OTHER_POLLUTION_SHOWN ? `; and ${others.length - OTHER_POLLUTION_SHOWN} more` : ""}
      </p>` : ""}`;
}

// The pollution one survey reported, as text ("Litter (small), Foam
// (moderate), Other: ...") - or "" if none.
function surveyPollutionText(survey) {
  const parts = POLLUTION_FIELDS
    .filter((f) => survey[f.observationField])
    .map((f) => `${f.label} (${survey[f.observationField]})`);
  const other = survey[POLLUTION_OTHER_FIELD]?.trim();
  if (other) parts.push(`Other: ${other}`);
  return parts.join(", ");
}

function stepSurvey(direction) {
  const next = state.index + direction;
  if (next < 0 || next >= state.recent.length) return;
  state.index = next;
  renderSurvey();
}

function renderSurvey() {
  const { carouselEl, surveyEmptyEl, positionEl, prevEl, nextEl, cardEl } = state.els;

  if (!state.recent.length) {
    carouselEl.hidden = true;
    surveyEmptyEl.hidden = false;
    if (!state.history) surveyEmptyEl.textContent = "Loading surveys…";
    else if (hasDateRange() && state.history.observations.length) surveyEmptyEl.textContent = "No surveys recorded for this location in the selected date range.";
    else surveyEmptyEl.textContent = "No survey records found for this location.";
    return;
  }

  carouselEl.hidden = false;
  surveyEmptyEl.hidden = true;
  positionEl.textContent = `${state.index + 1} of ${state.recent.length}`;
  prevEl.disabled = state.index === 0;
  nextEl.disabled = state.index === state.recent.length - 1;

  const a = state.recent[state.index];
  const dateStr = a.time_of_observation ? formatDateLong(a.time_of_observation) : "Unknown date";
  const weather = WEATHER_FIELDS.filter((w) => a[w.field]).map((w) => `<span class="weatherTag">${escapeHtml(w.label)}</span>`).join("");
  const photos = PHOTO_FIELDS.map((f) => a[f]).filter(Boolean);
  const metrics = METRICS.filter((m) => a[m.observationField] != null);
  const pollution = surveyPollutionText(a);

  cardEl.innerHTML = `
    <div class="surveyDate">${escapeHtml(dateStr)}</div>
    ${weather ? `<div class="weatherTags">${weather}</div>` : ""}
    <dl class="surveyFields">
      ${[["Rainfall (24h)", a.rain_previous_24hrs], ["Clarity", a.clarity], ["Water level", a.water_level], ["Flow", a.water_flow]]
        .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(capitalize(value) || "-")}</dd></div>`).join("")}
    </dl>
    ${metrics.length
      ? `<div class="surveyMetrics">${metrics.map((m) => `
          <div class="surveyMetric">
            <span class="surveyMetricSwatch" style="background:${metricColor(m)}"></span>
            <span class="surveyMetricLabel">${escapeHtml(m.label)}</span>
            <span class="surveyMetricValue">${formatNumber(a[m.observationField])}</span>
          </div>`).join("")}</div>`
      : `<div class="surveyMetricsEmpty">No water quality readings recorded for this survey.</div>`}
    ${pollution ? `<div class="surveyPollution"><span class="surveyPollutionLabel">Pollution:</span> ${escapeHtml(pollution)}</div>` : ""}
    ${photos.length
      ? `<div class="surveyPhotos">${photos.map((url, i) => `
          <button type="button" class="surveyPhotoThumb" data-photo-index="${i}" aria-label="Open photo ${i + 1}">
            <img src="${escapeHtml(url)}" alt="Photo ${i + 1} from the survey on ${escapeHtml(dateStr)}" loading="lazy" />
          </button>`).join("")}</div>`
      : ""}`;

  cardEl.querySelectorAll(".surveyPhotoThumb").forEach((button) => {
    button.addEventListener("click", () => openPhotos(photos, Number(button.dataset.photoIndex), dateStr));
  });
}

function openPhotos(photos, index, caption) {
  state.photos = photos;
  state.photoIndex = index;
  state.photoCaption = caption;
  renderPhoto();
  state.els.photoDialogEl.open = true;
}

function stepPhoto(direction) {
  const next = state.photoIndex + direction;
  if (next < 0 || next >= state.photos.length) return;
  state.photoIndex = next;
  renderPhoto();
}

function renderPhoto() {
  const { photoDialogEl, photoImgEl, photoPrevEl, photoNextEl } = state.els;
  const n = state.photos.length;
  photoImgEl.src = state.photos[state.photoIndex];
  photoImgEl.alt = `Photo ${state.photoIndex + 1} from the survey on ${state.photoCaption}`;
  photoDialogEl.heading = `Survey on ${state.photoCaption}`;
  photoDialogEl.description = n > 1 ? `Photo ${state.photoIndex + 1} of ${n}` : "";
  photoPrevEl.hidden = n < 2;
  photoNextEl.hidden = n < 2;
  photoPrevEl.disabled = state.photoIndex === 0;
  photoNextEl.disabled = state.photoIndex === n - 1;
}
