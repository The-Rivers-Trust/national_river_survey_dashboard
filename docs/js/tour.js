// =====================================================================
// GUIDED TOUR
// A short walk through the dashboard for first-time users: a dimmed page
// with a spotlight on one part of it and a card that explains it, with
// Back / Next / Skip. Wording is in STEPS below - edit it there.
//
// It is not offered on phones (the layout is different and there is no
// room for the spotlight). The first time someone picks an organisation on
// a bigger screen a small card offers it (main.js calls offerTour); after
// that it is only the "?" button in the header. Ported from the AQuA
// dashboard's tour. "Seen it" is remembered in the browser (localStorage) - if
// that isn't available the offer just shows again next time.
//
// Keys while it is open: right / left arrow or Enter go forward / back,
// Esc closes it. Other keys (including the map shortcuts) do nothing.
// =====================================================================

const SEEN_KEY = "nrs-tour-seen";
const PHONE = "(max-width: 720px)";
const GAP = 14; // card to spotlight
const PAD = 6; // spotlight around its target

const $ = (selector, root = document) => root.querySelector(selector);

// What a step can point at. Each returns an element, or a rectangle
// ({ left, top, right, bottom }), or null for a step with no target.
const visibleView = () => $(".view:not([hidden])");
const tabTitle = (view) => () => $(`calcite-tab-title[data-view="${view}"]`);
const mapButtons = () => {
  const els = [".basemapAction", ".layersAction", ".legendAction"].map((s) => $(s, visibleView())).filter(Boolean);
  if (!els.length) return null;
  const rects = els.map((e) => e.getBoundingClientRect());
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
};

// tab: the tab to be on for this step. placement: where the card sits
// relative to the target (bottom, top, left, right, inside, or center for
// a step with no target).
const STEPS = [
  {
    tab: "map",
    placement: "center",
    title: "Welcome to the National River Survey Data Dashboard",
    body: "Volunteers in National River Survey groups survey their local rivers: water quality readings such as phosphate, nitrate and temperature, plus the wildlife, pollution and invasive plants they spot. This dashboard brings those surveys together. This short tour shows you around - it takes about a minute.",
  },
  {
    tab: "map",
    target: tabTitle("map"),
    placement: "bottom",
    title: "Map",
    body: "Where the organisation's volunteers survey. Every site is coloured by its reading for the determinand you pick, so you can see at a glance where the river is in good shape and where it isn't.",
  },
  {
    tab: "map",
    target: tabTitle("league"),
    placement: "bottom",
    title: "League tables",
    body: "Every site with its survey count and its readings, side by side. Click a column to sort, and click sites to pick them - the map then shows only those.",
  },
  {
    tab: "map",
    target: tabTitle("org"),
    placement: "bottom",
    title: "Organisation",
    body: "About the organisation: the equipment its volunteers use for each determinand.",
  },
  {
    tab: "map",
    target: tabTitle("schematics"),
    placement: "bottom",
    title: "Schematics",
    body: "Each river system drawn like an underground tube map, so you can follow a reading from upstream to downstream and see where the tributaries join.",
  },
  {
    tab: "map",
    target: () => $(".headerFilters"),
    placement: "bottom",
    title: "Choose an organisation and dates",
    body: "Switch organisation, or narrow everything to a date range - pick dates or use a quick range such as the last 3 months. These apply on every tab.",
  },
  {
    tab: "map",
    target: () => $(".sidePanel", visibleView()),
    placement: "right",
    title: "Choose what the map shows",
    body: "Pick a determinand to colour the sites by. The key shows each band and how many sites fall in it - the higher the band, the bigger the dot.",
  },
  {
    tab: "map",
    target: () => $("arcgis-map", visibleView()),
    placement: "inside",
    title: "Click a site for its story",
    body: "Click any site to open its details - its averages, the wildlife and invasive species seen, and its recent surveys with photos - and its trend over time along the bottom. Ctrl/Cmd-click a second site to compare the two.",
  },
  {
    tab: "map",
    target: mapButtons,
    placement: "left",
    title: "Change the map",
    body: "Use these buttons to change the background map (for example aerial imagery), add contextual layers such as WFD classifications, land cover, the river network and storm overflows, and view the legend. Shortcut keys: R river network, F flow direction, S storm overflows, E storm overflow spill returns.",
  },
  {
    tab: "map",
    target: () => $("#dataGuideAction"),
    placement: "bottom",
    title: "What the colours mean",
    body: "The data guide lists the Low to Very High thresholds for every determinand.",
  },
  {
    tab: "map",
    placement: "center",
    title: "You're ready to explore",
    body: "You can take this tour again at any time from the ? button at the top right.",
  },
];

let state = null; // { index, els, opener, onKey, onResize } while the tour is open

export function isPhone() {
  return window.matchMedia(PHONE).matches;
}

// ---------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------

export function startTour() {
  if (state || isPhone()) return;
  dismissOffer();
  const opener = document.activeElement;

  const backdrop = el("div", "tourBackdrop");
  const spotlight = el("div", "tourSpotlight");
  const card = el("div", "tourCard");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "tourTitle");
  card.setAttribute("aria-describedby", "tourBody");
  card.innerHTML = `
    <button type="button" class="tourClose" data-tour="close" aria-label="Close the tour">&times;</button>
    <p class="tourProgress" data-progress></p>
    <h2 id="tourTitle" class="tourTitle"></h2>
    <p id="tourBody" class="tourText"></p>
    <div class="tourActions">
      <button type="button" class="tourBtn tourBtn--quiet" data-tour="close">Skip tour</button>
      <span class="tourDots" data-dots aria-hidden="true"></span>
      <button type="button" class="tourBtn" data-tour="back">Back</button>
      <button type="button" class="tourBtn tourBtn--primary" data-tour="next">Next</button>
    </div>`;
  document.body.append(backdrop, spotlight, card);

  const onKey = (event) => {
    // Nothing else (the map shortcuts, say) should react while the tour is open.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); stopTour(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    else if (event.key === "Tab") trapFocus(event, card);
  };
  const onResize = () => {
    if (isPhone()) stopTour();
    else show(state.index, { switchTab: false });
  };
  card.addEventListener("click", (event) => {
    const action = event.target.closest("[data-tour]")?.dataset.tour;
    if (action === "next") go(1);
    else if (action === "back") go(-1);
    else if (action === "close") stopTour();
  });
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);

  state = { index: 0, els: { backdrop, spotlight, card }, opener, onKey, onResize };
  markSeen();
  show(0, { switchTab: true });
}

export function stopTour() {
  if (!state) return;
  const { els, opener, onKey, onResize } = state;
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onResize);
  Object.values(els).forEach((e) => e.remove());
  state = null;
  if (opener?.isConnected) opener.focus?.();
}

function go(step) {
  const next = state.index + step;
  if (next < 0) return;
  if (next >= STEPS.length) { stopTour(); return; }
  state.index = next;
  show(next, { switchTab: true });
}

// ---------------------------------------------------------------------
// One step
// ---------------------------------------------------------------------

async function show(index, { switchTab }) {
  const step = STEPS[index];
  const { spotlight, card } = state.els;

  if (switchTab && step.tab) await selectTab(step.tab);
  if (!state || state.index !== index) return; // closed or moved on while the tab changed

  $("[data-progress]", card).textContent = `Step ${index + 1} of ${STEPS.length}`;
  $("#tourTitle", card).textContent = step.title;
  $("#tourBody", card).textContent = step.body;
  $("[data-dots]", card).innerHTML = STEPS.map((_, i) => `<i class="${i === index ? "isOn" : ""}"></i>`).join("");
  const back = $('[data-tour="back"]', card);
  const next = $('[data-tour="next"]', card);
  back.hidden = index === 0;
  next.textContent = index === STEPS.length - 1 ? "Done" : index === 0 ? "Start tour" : "Next";

  const rect = toRect(step.target?.());
  if (rect) {
    spotlight.hidden = false;
    Object.assign(spotlight.style, {
      left: `${rect.left - PAD}px`, top: `${rect.top - PAD}px`,
      width: `${rect.right - rect.left + PAD * 2}px`, height: `${rect.bottom - rect.top + PAD * 2}px`,
    });
  } else {
    spotlight.hidden = true;
  }
  // A target as wide as the screen (the side panel on a tablet, where it sits
  // under the map) has no room beside it, so the card goes above it.
  let placement = rect ? step.placement : "center";
  if ((placement === "left" || placement === "right") && rect.right - rect.left > window.innerWidth * 0.5) placement = "top";
  place(card, rect, placement);
  next.focus({ preventScroll: true });
}

// Makes the tab current the way a click would, and waits for it to show.
async function selectTab(view) {
  if (visibleView()?.dataset.view === view) return;
  tabTitle(view)()?.click();
  await new Promise((resolve) => setTimeout(resolve, 450));
}

function toRect(target) {
  if (!target) return null;
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  return r.right - r.left > 0 && r.bottom - r.top > 0 ? r : null;
}

// Puts the card next to the target, kept on screen; flips to the other
// side when there isn't room.
function place(card, rect, placement) {
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let left;
  let top;

  if (!rect || placement === "center") {
    left = (vw - w) / 2;
    top = (vh - h) / 2;
  } else if (placement === "inside") {
    left = rect.left + (rect.right - rect.left - w) / 2;
    top = rect.top + (rect.bottom - rect.top - h) / 2;
  } else if (placement === "left" || placement === "right") {
    const roomRight = vw - rect.right - GAP - margin;
    const roomLeft = rect.left - GAP - margin;
    const useRight = placement === "right" ? roomRight >= w || roomRight >= roomLeft : roomLeft < w && roomRight > roomLeft;
    left = useRight ? rect.right + GAP + PAD : rect.left - w - GAP - PAD;
    top = rect.top;
  } else {
    const roomBelow = vh - rect.bottom - GAP - margin;
    const below = placement === "bottom" ? roomBelow >= h || roomBelow >= rect.top : roomBelow >= h && rect.top < h;
    top = below ? rect.bottom + GAP + PAD : rect.top - h - GAP - PAD;
    left = rect.left + (rect.right - rect.left - w) / 2;
  }
  card.style.left = `${Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin))}px`;
  card.style.top = `${Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin))}px`;
}

function trapFocus(event, card) {
  const focusable = [...card.querySelectorAll("button:not([hidden])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!card.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

// ---------------------------------------------------------------------
// First visit
// ---------------------------------------------------------------------

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch (error) { /* private window etc. - it will just be offered again */ }
}

function hasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (error) { return false; }
}

function dismissOffer() {
  $(".tourOffer")?.remove();
}

// A small card in the corner, once, on a screen big enough for the tour.
export function offerTour() {
  if (hasSeen() || isPhone() || $(".tourOffer")) return;
  const offer = el("div", "tourOffer");
  offer.setAttribute("role", "region");
  offer.setAttribute("aria-label", "Dashboard tour");
  offer.innerHTML = `
    <p class="tourOfferTitle">New here?</p>
    <p class="tourOfferText">Take a one-minute tour of the dashboard.</p>
    <div class="tourOfferActions">
      <button type="button" class="tourBtn tourBtn--quiet" data-offer="no">Not now</button>
      <button type="button" class="tourBtn tourBtn--primary" data-offer="yes">Take the tour</button>
    </div>`;
  offer.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-offer]")?.dataset.offer;
    if (choice === "yes") startTour();
    else if (choice === "no") { markSeen(); dismissOffer(); }
  });
  document.body.append(offer);
}

// Wires the header button.
export function initTour(buttonEl) {
  buttonEl?.addEventListener("click", startTour);
}
