// =====================================================================
// MAP COMMON
// Shared by every map: the basemap (following the theme until one is
// picked in the map's Basemap panel), the focus-ring fix and pop-up
// docking.
// =====================================================================

import { MAP } from "../config.js";
import { getTheme, onThemeChange } from "../theme.js";

const maps = new Set();
let choice = null; // basemap id picked in a gallery; null = follow the theme

const currentBasemapId = () => choice ?? MAP.basemap[getTheme()];

// Resolves once the view is ready.
export async function setupMap(mapEl) {
  maps.add(mapEl);
  mapEl.basemap = currentBasemapId();
  mapEl.center = MAP.center;
  mapEl.zoom = MAP.zoom;
  initFocusRing(mapEl);

  await mapEl.viewOnReady();

  initPopupDocking(mapEl);
  await initBasemapGallery(mapEl);
}

// The map's Basemap panel: an <arcgis-basemap-gallery> in the same view.
// A pick changes every map and stays put when the theme is switched -
// except the light and dark gray pair, the theme's own basemaps: with
// either showing, switching theme swaps to the other.
async function initBasemapGallery(mapEl) {
  const gallery = mapEl.closest(".view")?.querySelector("arcgis-basemap-gallery");
  if (!gallery) return;
  const [Basemap, LocalBasemapsSource] = await $arcgis.import([
    "@arcgis/core/Basemap.js",
    "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js",
  ]);
  gallery.source = new LocalBasemapsSource({ basemaps: MAP.basemaps.map((id) => Basemap.fromId(id)) });
  gallery.addEventListener("arcgisPropertyChange", (event) => {
    if (event.detail?.name !== "activeBasemap") return;
    const id = gallery.activeBasemap?.id;
    // The same event fires when a gallery just follows a change made
    // elsewhere - only a real pick from the list counts.
    if (!id || id === currentBasemapId() || !MAP.basemaps.includes(id)) return;
    choice = id;
    applyBasemap();
  });
}

export const shownBasemapId = (mapEl) => mapEl.map?.basemap?.id;

function applyBasemap() {
  const id = currentBasemapId();
  maps.forEach((mapEl) => { if (shownBasemapId(mapEl) !== id) mapEl.basemap = id; });
}

// The pop-up is an <arcgis-popup slot="popup"> in index.html rather than
// the map's built-in one: the built-in one renders underneath the slotted
// search, legend and imagery buttons, the slotted one in front of them.
// A slotted pop-up doesn't dock by itself, so dock it top right whenever
// the map is narrow OR short - otherwise it floats off the map's edge.
const DOCK_BELOW = { width: 544, height: 480 };

function initPopupDocking(mapEl) {
  const popupEl = mapEl.querySelector("arcgis-popup");
  if (!popupEl) return;
  popupEl.dockOptions = { buttonEnabled: true, position: "top-right" };
  new ResizeObserver(() => {
    popupEl.dockEnabled = mapEl.clientWidth < DOCK_BELOW.width || mapEl.clientHeight < DOCK_BELOW.height;
  }).observe(mapEl);
}

onThemeChange(() => {
  if (choice === null || Object.values(MAP.basemap).includes(choice)) {
    choice = null;
    applyBasemap();
  }
});

export function goHome(mapEl) {
  return mapEl.goTo({ center: MAP.center, zoom: MAP.zoom });
}

// Hide the view's focus ring after mouse/touch input, show it again as
// soon as the keyboard is used - see .siteMap.pointerFocus in layout.css.
// A modifier on its own (Ctrl/Cmd-click to compare sites) isn't keyboard
// navigation, so it leaves the ring hidden.
function initFocusRing(mapEl) {
  mapEl.addEventListener("pointerdown", () => mapEl.classList.add("pointerFocus"));
  mapEl.addEventListener("keydown", (event) => {
    if (!isModifierKey(event)) mapEl.classList.remove("pointerFocus");
  });
}

export function isModifierKey(event) {
  return ["Control", "Meta", "Shift", "Alt"].includes(event.key);
}

// Pop-ups render inside <arcgis-map>'s shadow DOM, where page styles
// don't reach - each pop-up loads css/popup.css itself.
export const POPUP_STYLESHEET = `<link rel="stylesheet" href="css/popup.css" />`;
