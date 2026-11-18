// =====================================================================
// CONFIG
// Everything that is "data" rather than "behaviour": service URLs, field
// names, thresholds, colours, starting extent, basemaps. When a service
// moves, a field is renamed or a threshold is agreed, this should be the
// only file that changes.
// =====================================================================

export const APP_TITLE = "National River Survey Data Dashboard";

export const MAP = {
  center: [-1.5, 53.15],
  zoom: 7,
  // Starting basemap, following the dark/light theme until the user picks
  // one from the basemap gallery.
  basemap: {
    dark: "dark-gray-vector",
    light: "gray-vector",
  },
  // The gallery's choices, in order: Esri basemap ids (the gallery shows
  // Esri's own name and thumbnail for each). Keep the two theme defaults
  // above in the list.
  basemaps: [
    "gray-vector",
    "dark-gray-vector",
    "streets-vector",
    "topo-vector",
    "terrain",
    "oceans",
    "satellite",
    "hybrid",
  ],
  // The basemaps that are dark: the river flow trails are drawn white on
  // these and dark on every other (light) one, as on the AQuA dashboard.
  darkBasemaps: ["dark-gray-vector", "satellite", "hybrid"],
};

// ---------------------------------------------------------------------
// National River Survey feature service
// Organisations (polygons) -> Locations (points, organisation_id = the
// organisation's GlobalID) -> Observations (table, location_id = the
// location's GlobalID). Equipment is a small lookup table.
// ---------------------------------------------------------------------
const NRS_SERVICE = "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/National_River_Survey/FeatureServer";

export const NRS = {
  organisationsUrl: `${NRS_SERVICE}/0`,
  locationsUrl: `${NRS_SERVICE}/1`,
  observationsUrl: `${NRS_SERVICE}/2`,
  equipmentUrl: `${NRS_SERVICE}/3`,
};

// ---------------------------------------------------------------------
// Determinands
// The one list every view reads: the map's determinand picker and
// symbology, the details panel, the trend chart and the league table.
//   locationField     its name in a site's date-filtered summary row
//                     (js/data/org-summary.js)
//   observationField  its raw field on the Observations table
//   equipmentLimitField  "<", ">", etc. when a reading was at/beyond the
//                     equipment's detection range
//   determinand       its spelling on the Equipment table (deliberately
//                     "Phosphate", not "Orthophosphate" - it's matched
//                     against data, not shown)
//   aggregation       how a site's readings roll up: ammonia, nitrate and
//                     nitrite are skewed by spikes, so they use the median
//   decimals          (optional) fixed decimal places for averages in the
//                     league table; otherwise up to two
// Colours are the validated categorical palette in order (dark / light
// steps); temperature's violet sits close to the first compare ring
// colour, a known trade-off.
// ---------------------------------------------------------------------
export const METRICS = [
  {
    key: "phosphate", label: "Orthophosphate", notation: "PO₄", unit: "mg/L", aggregation: "mean",
    locationField: "phosphateAverage", observationField: "phosphate", equipmentLimitField: "phosphate_equipment_limit",
    determinand: "Phosphate", colorDark: "#3987e5", colorLight: "#2a78d6",
    infoNote: "Orthophosphate may be reported elsewhere, including by the Environment Agency, as PO₄-P (phosphorus only). PO₄-P values are lower because phosphorus makes up only part of the phosphate molecule. To convert: PO₄ ÷ 3.066 = PO₄-P. For example, 0.31 mg/L PO₄ = 0.10 mg/L PO₄-P",
  },
  {
    key: "nitrate", label: "Nitrate", notation: "NO₃-N", unit: "mg/L", aggregation: "median",
    locationField: "nitrateAverage", observationField: "nitrate", equipmentLimitField: "nitrate_equipment_limit",
    determinand: "Nitrate", colorDark: "#d95926", colorLight: "#eb6834",
  },
  {
    key: "nitrite", label: "Nitrite", notation: "NO₂-N", unit: "mg/L", aggregation: "median",
    locationField: "nitriteAverage", observationField: "nitrite", equipmentLimitField: "nitrite_equipment_limit",
    determinand: "Nitrite", colorDark: "#199e70", colorLight: "#1baf7a",
  },
  {
    key: "ammonia", label: "Ammonia", notation: "NH₃-N", unit: "mg/L", aggregation: "median",
    locationField: "ammoniaAverage", observationField: "ammonia", equipmentLimitField: "ammonia_equipment_limit",
    determinand: "Ammonia", colorDark: "#c98500", colorLight: "#eda100",
  },
  {
    key: "turbidity", label: "Turbidity", unit: "NTU", aggregation: "mean",
    locationField: "turbidityAverage", observationField: "turbidity", equipmentLimitField: "turbidity_equipment_limit",
    determinand: "Turbidity", colorDark: "#d55181", colorLight: "#e87ba4",
  },
  {
    key: "conductivity", label: "Conductivity", unit: "uS/cm", aggregation: "mean", decimals: 0,
    locationField: "conductivityAverage", observationField: "conductivity", equipmentLimitField: "conductivity_equipment_limit",
    determinand: "Conductivity", colorDark: "#008300", colorLight: "#008300",
  },
  {
    key: "temperature", label: "Temperature", unit: "°C", aggregation: "mean", decimals: 1,
    locationField: "temperatureAverage", observationField: "water_temperature", equipmentLimitField: "water_temperature_equipment_limit",
    determinand: "Water Temperature", colorDark: "#9085e9", colorLight: "#4a3aa7",
  },
];

// ---------------------------------------------------------------------
// Threshold bands (agreed 2026-09-23)
// Five bands shared by every determinand - same names and colours
// everywhere - with each determinand's own thresholds. A threshold is
// that band's upper bound, INCLUSIVE; "Very High" is open-ended. Ammonia
// and nitrite's Low of 0 means only a true zero reading is Low.
// Conductivity's High is 2000 (the 200 supplied broke the ascending
// order - flag if that guess is wrong).
// ---------------------------------------------------------------------
export const BAND_STYLE = [
  { key: "low", label: "Low", color: "#0072b0" },
  { key: "slightlyElevated", label: "Slightly Elevated", color: "#56d5e8" },
  { key: "elevated", label: "Elevated", color: "#e6b800" },
  { key: "high", label: "High", color: "#f08c00" },
  { key: "veryHigh", label: "Very High", color: "#d63129" },
];

// determinand key -> [lowMax, slightlyElevatedMax, elevatedMax, highMax]
export const BAND_THRESHOLDS = {
  ammonia: [0, 0.5, 1, 3], // mg/L
  conductivity: [500, 1000, 1500, 2000], // uS/cm
  nitrate: [0.5, 2, 5, 20], // mg/L
  nitrite: [0, 0.15, 0.3, 1.5], // mg/L
  phosphate: [0.1, 0.3, 0.75, 1], // mg/L
  temperature: [14, 18, 20, 23], // °C
  turbidity: [12, 25, 50, 100], // NTU
};

// Trend chart y-axis caps on top of the equipment's own range (a river
// is never realistically recorded at the 80 °C the probes can read).
export const EQUIPMENT_RANGE_MAX_OVERRIDE = { temperature: 40 };

// Per-survey "Yes" fields on the Observations table.
export const WILDLIFE_FIELDS = [
  { observationField: "wildlife_otter", label: "Otter" },
  { observationField: "wildlife_dipper", label: "Dipper" },
  { observationField: "wildlife_water_vole", label: "Water Vole" },
  { observationField: "wildlife_kingfisher", label: "Kingfisher" },
  { observationField: "wildlife_dragonflies_damselflies", label: "Dragonflies/Damselflies" },
  { observationField: "wildlife_heron", label: "Heron" },
  { observationField: "wildlife_fish", label: "Fish" },
  { observationField: "wildlife_grey_wagtail", label: "Grey Wagtail" },
  { observationField: "wildlife_bat", label: "Bats" },
  { observationField: "wildlife_mayflies_caddisflies", label: "Mayflies/Caddisflies" },
];

export const INVASIVE_PLANT_FIELDS = [
  { observationField: "invasive_plants_himalayan_balsam", label: "Himalayan Balsam" },
  { observationField: "invasive_plants_japanese_knotweed", label: "Japanese Knotweed" },
  { observationField: "invasive_plants_giant_hogweed", label: "Giant Hogweed" },
  { observationField: "invasive_plants_skunk_cabbage", label: "Skunk Cabbage" },
  { observationField: "invasive_plants_curly_waterweed", label: "Curly Waterweed" },
  { observationField: "invasive_plants_floating_pennywort", label: "Floating Pennywort" },
];

// Pollution seen on a survey: each type's field holds how much ("small",
// "moderate", "large" - the AGOL Amount domain), blank if none; anything
// else the volunteer typed is in pollution_other.
export const POLLUTION_FIELDS = [
  { observationField: "pollution_litter", label: "Litter" },
  { observationField: "pollution_bulky_waste", label: "Bulky waste" },
  { observationField: "pollution_sewage_litter", label: "Sewage litter" },
  { observationField: "pollution_sewage_fungus", label: "Sewage fungus" },
  { observationField: "pollution_odour", label: "Odour" },
  { observationField: "pollution_surface_scum", label: "Surface scum" },
  { observationField: "pollution_oily_sheen", label: "Oily sheen" },
  { observationField: "pollution_foam", label: "Foam" },
  { observationField: "pollution_cattle_stock_access", label: "Cattle/stock access" },
  { observationField: "pollution_dead_fish", label: "Dead fish" },
];
export const POLLUTION_OTHER_FIELD = "pollution_other";
// Smallest first.
export const POLLUTION_AMOUNTS = [
  { value: "small", label: "Small" },
  { value: "moderate", label: "Moderate" },
  { value: "large", label: "Large" },
];

export const WEATHER_FIELDS = [
  { field: "weather_sunny", label: "Sunny" },
  { field: "weather_cloudy", label: "Cloudy" },
  { field: "weather_rainy", label: "Rainy" },
  { field: "weather_windy", label: "Windy" },
  { field: "weather_snowy", label: "Snowy" },
];

export const PHOTO_FIELDS = ["photo_1", "photo_2", "photo_3", "photo_4"];

// ---------------------------------------------------------------------
// Map colours that have to be literal values (ArcGIS symbols), per theme.
// ---------------------------------------------------------------------
export const MAP_COLORS = {
  dark: {
    markerOutline: "#ffffff",
  },
  light: {
    markerOutline: "#2a2a27",
  },
};

// Selected-site rings and the trend chart's comparison lines. Index 1 is
// the everyday "selected" colour; index 0 only appears for the first of
// two compared sites.
export const COMPARE_SITE_COLORS = [
  { dark: "#9b6cf5", light: "#6d3fc9" },
  { dark: "#3fd0e0", light: "#0e8fa3" },
];

// Site marker size by map scale: min/max dot size at each reference
// scale (the band rank picks where in that range a site falls).
export const MARKER_SCALE_STOPS = [
  { value: 50000, min: 5, max: 22 },
  { value: 250000, min: 4, max: 18 },
  { value: 1000000, min: 3, max: 13 },
  { value: 5000000, min: 2, max: 9 },
  { value: 20000000, min: 1.5, max: 6 },
];

// ---------------------------------------------------------------------
// Contextual layers (Map tab side panel)
// ---------------------------------------------------------------------

// Environment Agency WFD river water body catchments, cycle 4. Coloured
// client-side by one of three classification fields.
export const WFD_CATCHMENTS = {
  url: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/WFD_River_Water_Body_Catchments_Cycle_4_With_Coastal/FeatureServer/0",
  title: "WFD Waterbody Classification 2025",
  opacity: 0.4,
  fields: [
    { field: "ecological_class", label: "Ecological" },
    { field: "ammonia_phys_chem_class", label: "Ammonia" },
    { field: "phosphate_class", label: "Orthophosphate" },
  ],
  // Same colours as the EA's own ecological_class renderer.
  classes: [
    { value: "High", color: [0, 114, 176, 255] },
    { value: "Good", color: [86, 213, 232, 255] },
    { value: "Moderate", color: [230, 184, 0, 255] },
    { value: "Poor", color: [240, 140, 0, 255] },
    { value: "Bad", color: [214, 49, 41, 255] },
  ],
  notAssessedColor: [156, 156, 156, 255],
};

// Open River Network: one fixed blue, width by Strahler order, only drawn
// once zoomed in past ~1:1,000,000 (183k segments nationally). Digitised
// in flow direction, which the animated flow overlay relies on.
export const RIVER_NETWORK = {
  url: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/OpenRiverNetwork_CaBA_ID/FeatureServer/0",
  title: "Open River Network",
  flowTitle: "River flow direction",
  // A softened, slightly see-through blue and fairly thin lines, so the
  // rivers sit behind the sites and the other layers - halfway between
  // the old solid blue and the AQuA dashboard's softer blue-grey (a
  // [r, g, b, alpha] colour).
  color: [56, 135, 185, 0.8],
  minScale: 1000000,
  // The flow animation is heavier (it draws every section in view), so it
  // only runs zoomed in much further - roughly city / river-reach level.
  flowMinScale: 150000,
  // Schematics tab: a site is placed on the nearest river section within
  // snapDistance metres (see js/data/river-topology.js); further away than
  // that it's "off network" and left off the diagrams.
  snapDistance: 150,
  // Line width (points) by Strahler stream order; the flow-direction trail
  // is drawn from the same widths.
  widthByStrahler: [
    { value: 1, size: 0.3 },
    { value: 2, size: 0.6 },
    { value: 3, size: 1 },
    { value: 4, size: 1.55 },
    { value: 5, size: 2.3 },
    { value: 7, size: 3.9 },
  ],
};

// National Soil Map (LandIS Soilscapes). Same zoom range as the river
// network; its categories are read from the service at start-up.
export const SOIL_MAP = {
  url: "https://utility.arcgis.com/usrsvcs/servers/608cab5c64ae44789d65582007fb2350/rest/services/NationalSoilMap/FeatureServer/0",
  title: "National Soil Map",
  field: "SOILSCAPE",
};

// UKCEH Land Cover Map (a WMS), a background in the Map layers panel - as
// on the AQuA dashboard.
export const LAND_COVER = {
  url: "https://catalogue.ceh.ac.uk/maps/688492ef-d9db-43b7-8107-3675c6150568",
  title: "Land Cover Map 2024",
  sublayer: "LC.10m.GB",
  copyright: "Based upon LCM2024 © UKCEH 2025",
  opacity: 0.75,
  // The service publishes no legend, so this one is drawn by hand from
  // UKCEH's published colours for the 21 classes.
  classes: [
    ["Broadleaved, mixed & yew woodland", "#ff0000"], ["Coniferous woodland", "#006600"], ["Arable and horticulture", "#732600"],
    ["Improved grassland", "#00ff00"], ["Neutral grassland", "#7fe57f"], ["Calcareous grassland", "#70a800"],
    ["Acid grassland", "#998100"], ["Fen, marsh & swamp", "#ffff00"], ["Heather", "#801a80"],
    ["Heather grassland", "#e68ca6"], ["Bog", "#008073"], ["Inland rock", "#d2d2ff"],
    ["Saltwater", "#000080"], ["Freshwater", "#0000ff"], ["Supralittoral rock", "#cccc00"],
    ["Supralittoral sediment", "#cc9900"], ["Littoral rock", "#ffff80"], ["Littoral sediment", "#ccb300"],
    ["Saltmarsh", "#8080ff"], ["Urban", "#000000"], ["Suburban", "#808080"],
  ],
};

// Live storm overflow status from each water company. Most share these
// field names; a source only overrides the ones that differ.
export const STORM_OVERFLOWS = {
  title: "Storm Overflows",
  refreshMinutes: 5,
  recentHours: 48,
  defaultFields: {
    id: "Id",
    company: "Company",
    status: "Status",
    statusStart: "StatusStart",
    latestEventStart: "LatestEventStart",
    latestEventEnd: "LatestEventEnd",
    receivingWaterCourse: "ReceivingWaterCourse",
    lastUpdated: "LastUpdated",
  },
  sources: [
    { url: "https://services-eu1.arcgis.com/MSNNjkZ51iVh8yBj/arcgis/rest/services/Northumbrian_Water_Storm_Overflow_Activity_2_view/FeatureServer/0" },
    { url: "https://services3.arcgis.com/VCOY1atHWVcDlvlJ/arcgis/rest/services/stream_service_outfall_locations_view/FeatureServer/0" },
    { url: "https://services1.arcgis.com/NO7lTIlnxRMMG9Gw/arcgis/rest/services/Severn_Trent_Water_Storm_Overflow_Activity/FeatureServer/0" },
    { url: "https://services-eu1.arcgis.com/6qJmARkS2dt2IjVA/arcgis/rest/services/SouthernWater_StormOverflowActivity_PROD_view/FeatureServer/0" },
    {
      // camelCase field names throughout
      url: "https://services-eu1.arcgis.com/OMdMOtfhATJPcHe3/arcgis/rest/services/NEH_outlets_PROD/FeatureServer/0",
      fields: {
        company: "company",
        status: "status",
        statusStart: "statusStart",
        latestEventStart: "latestEventStart",
        latestEventEnd: "latestEventEnd",
        receivingWaterCourse: "receivingWaterCourse",
        lastUpdated: "lastUpdated",
      },
    },
    { url: "https://services2.arcgis.com/g6o32ZDQ33GpCIu3/arcgis/rest/services/Thames_Water_Storm_Overflow_Activity_(Production)_view/FeatureServer/0" },
    { url: "https://services5.arcgis.com/5eoLvR0f8HKb7HWP/arcgis/rest/services/United_Utilities_Storm_Overflow_Activity/FeatureServer/0" },
    { url: "https://services.arcgis.com/3SZ6e0uCvPROr4mS/arcgis/rest/services/Wessex_Water_Storm_Overflow_Activity/FeatureServer/0" },
    { url: "https://services-eu1.arcgis.com/1WqkK5cDKUbF0CkH/arcgis/rest/services/Yorkshire_Water_Storm_Overflow_Activity/FeatureServer/0" },
    {
      // The end-of-discharge field is LatestEventFinish (LatestEventEnd is
      // only its alias, which queries can't use).
      url: "https://services-eu1.arcgis.com/zat3uNEZelYVksuM/arcgis/rest/services/STREAM_Data/FeatureServer/0",
      fields: { latestEventEnd: "LatestEventFinish" },
    },
  ],
  // Emoji rather than dots so outfalls never read as survey sites. The
  // two states that need attention draw larger and on top.
  categories: [
    { key: "spilling", label: "Currently discharging", headline: "Discharging Now", glyph: "\u{1F4A9}", size: 20, priority: 3 },
    { key: "recent", label: "Discharged in last 48 hours", headline: "Discharged in last 48 hours", glyph: "⚠️", size: 20, priority: 2 },
    { key: "notspilling", label: "Not discharged in last 48 hours", headline: "Not discharged in last 48 hours", glyph: "✅", size: 8, priority: 0 },
    { key: "offline", label: "Offline", headline: "Offline", glyph: "❓", size: 8, priority: 1 },
  ],
};

// Event Duration Monitoring 2025: the water companies' annual spill returns,
// an overlay in the Map layers panel - as on the AQuA dashboard.
export const EDM_2025 = {
  url: "https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/Event_Duration_Monitoring_Storm_Overflows_2025/FeatureServer/0",
  title: "Event Duration Monitoring 2025",
  color: [99, 79, 63, 190],
  // Spill counts: [highest count in the class, label, symbol size].
  classes: [
    [0, "No spills", 4],
    [19, "1 - 19 spills", 7],
    [39, "20 - 39 spills", 10],
    [59, "40 - 59 spills", 13],
    [99, "60 - 99 spills", 16],
    [366, "100 or more spills", 19],
  ],
};
