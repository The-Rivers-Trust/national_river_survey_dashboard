// =====================================================================
// MAIN
// App start-up: theme, header (filters, tour, Data guide, What's new),
// tab switching, then each tab's own init. Filters and the organisation
// summary are set up first so every tab can subscribe from the start.
// Only the first tab is initialised up front; the others the first time
// they're opened.
// To add a tab: a <calcite-tab-title data-view="x"> and a
// <section data-view="x"> in index.html, a module in js/tabs/, and an
// entry in TAB_INITS below.
// =====================================================================

import { initTheme, getTheme, onThemeChange } from "./theme.js";
import { initOrgSummary } from "./data/org-summary.js";
import { renderDataGuide } from "./data-guide.js";
import { initMapTab } from "./tabs/map-tab.js";
import { isModifierKey } from "./map/map-common.js";
import { initLeagueTable } from "./tabs/league-table.js";
import { initOrgDetails } from "./tabs/org-details.js";
import { initSchematicsTab } from "./tabs/schematics-tab.js";
import { initTour, offerTour } from "./tour.js";
import { initShortcuts } from "./shortcuts.js";
import { initFilters, onFilterChange, getOrganisation } from "./filters.js";

const byId = (id) => document.getElementById(id);

// data-view -> that tab's init.
const TAB_INITS = {
  league: () => initLeagueTable({ containerEl: byId("leagueView") }),
  org: () => initOrgDetails({ containerEl: byId("orgView") }),
  schematics: () => initSchematicsTab({ containerEl: byId("schematicsView"), tooltipEl: byId("schematicsTooltip") }),
  map: () => initMapTab({
    viewEl: document.querySelector('.view[data-view="map"]'),
    mapEl: byId("nrsMap"),
    panelEl: byId("sitesPanel"),
    metricGroupEl: byId("metricGroup"),
    metricSelectEl: byId("metricSelect"),
    metricHintEl: byId("metricHint"),
    sitesLegendEl: byId("sitesLegend"),
    expandEl: byId("expandAction"),
    chart: {
      drawerEl: byId("chartDrawer"),
      closeEl: byId("chartClose"),
      titleEl: byId("chartTitle"),
      limitNoteEl: byId("chartLimitNote"),
      fitEl: byId("chartFitToggle"),
      legendEl: byId("chartLegend"),
      wrapEl: byId("chartWrap"),
      svgEl: byId("chartSvg"),
      emptyEl: byId("chartEmpty"),
      tooltipEl: byId("chartTooltip"),
    },
    details: {
      panelEl: byId("detailsPanel"),
      statsEl: byId("statGrid"),
      wildlifeEl: byId("wildlifeTags"),
      invasiveEl: byId("invasiveTags"),
      pollutionEl: byId("pollutionSummary"),
      carouselEl: byId("surveyCarousel"),
      surveyEmptyEl: byId("surveyEmpty"),
      positionEl: byId("surveyPosition"),
      prevEl: byId("surveyPrev"),
      nextEl: byId("surveyNext"),
      cardEl: byId("surveyCard"),
      photoDialogEl: byId("photoDialog"),
      photoImgEl: byId("photoImg"),
      photoPrevEl: byId("photoPrev"),
      photoNextEl: byId("photoNext"),
    },
  }),
};

const started = new Map(); // data-view -> init promise
let filtersReady = null;

function startTab(view) {
  if (!started.has(view) && TAB_INITS[view]) {
    // A tab still starts if the organisation list failed to load.
    const run = filtersReady
      .catch(() => {})
      .then(() => TAB_INITS[view]())
      .catch((error) => console.error(`NRS dashboard: "${view}" tab failed to start:`, error));
    started.set(view, run);
  }
  return started.get(view);
}

function initViewSwitching() {
  const nav = byId("viewTabs");
  const views = document.querySelectorAll(".view[data-view]");

  nav.addEventListener("calciteTabChange", () => {
    const selectedTitle = nav.selectedTitle;
    const selected = selectedTitle?.dataset.view;
    // A standalone calcite-tab-nav (no calcite-tabs around it) tracks the
    // selection but never updates each title's own `selected`, so the
    // underline would stay on the first tab - set it here.
    nav.querySelectorAll("calcite-tab-title").forEach((title) => {
      title.selected = title === selectedTitle;
    });
    views.forEach((view) => {
      view.hidden = view.dataset.view !== selected;
    });
    startTab(selected);
  });

  // No focus box after a mouse click, but keep it for keyboard users -
  // see .viewTabs.pointerFocus in layout.css.
  nav.addEventListener("pointerdown", () => nav.classList.add("pointerFocus"));
  nav.addEventListener("keydown", (event) => {
    if (!isModifierKey(event)) nav.classList.remove("pointerFocus");
  });
}

function initHeader() {
  for (const [actionId, dialogId] of [["dataGuideAction", "dataGuideDialog"], ["whatsNewAction", "whatsNewDialog"]]) {
    byId(actionId).addEventListener("click", () => { byId(dialogId).open = true; });
  }
  renderDataGuide(byId("dataGuideTable"));

  // The Rivers Trust logo has a version for each background.
  const logo = byId("appLogo");
  const splashLogo = byId("splashLogo");
  const applyLogo = (theme) => {
    logo.thumbnail = `assets/rivers-trust-logo-${theme}.png`;
    splashLogo.src = `assets/rivers-trust-logo-${theme}.png`;
  };
  applyLogo(getTheme());
  onThemeChange(applyLogo);
}

initTheme(byId("themeToggle"));
initHeader();
initOrgSummary();
filtersReady = initFilters({
  orgEl: byId("orgFilter"),
  dateEl: byId("dateRange"),
  presetsEl: byId("datePresets"),
  clearDatesEl: byId("clearDates"),
  splashEl: byId("orgSplash"),
  splashListEl: byId("splashOrgList"),
});
filtersReady.catch((error) => console.error("NRS dashboard: filters failed to start:", error));
initViewSwitching();
initShortcuts();
startTab("map"); // the tab marked selected in index.html

// The tour is offered once an organisation is chosen - before that the
// start screen is in the way, and the map has nothing on it to show.
initTour(byId("tourButton"));
const stopWaiting = onFilterChange(() => {
  if (!getOrganisation()) return;
  stopWaiting();
  setTimeout(offerTour, 1500);
});
