# National River Survey Data Dashboard

The National River Survey dashboard, restructured to match the AQuA dashboard: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/) 5.1 and [Calcite](https://developers.arcgis.com/calcite-design-system/) components, both loaded from Esri's CDN. Plain HTML, CSS and JavaScript modules, so there's no build step.

**Status:** the Map, League tables and Organisation tabs replace the original single-file dashboard (since retired). Scorecards were dropped for now; they will be built in the Southern app and ported back. A Schematics tab draws each organisation's sites as underground tube map style river diagrams, ported from the AQuA dashboard.

## Running it locally

The page is split into ES modules, which browsers won't load straight from disk (`file://`), so it needs a small local web server. Pick one:

- **npm** (Node.js installed): `npm start`. It serves on http://localhost:8081 and opens the browser. Caching is off, so a refresh always picks up your edits.
- **VS Code**: install the *Live Server* extension, open `index.html`, and click **Go Live**.
- **Python**: `python -m http.server 8081`, then open http://localhost:8081.

## Publishing

The live site is https://the-rivers-trust.github.io/national_river_survey_dashboard/, served by GitHub Pages from the `docs/` folder of the public repo [The-Rivers-Trust/national_river_survey_dashboard](https://github.com/The-Rivers-Trust/national_river_survey_dashboard). Don't edit that repo by hand: every push to `main` here that changes `dashboard/` runs `.github/workflows/publish-dashboard.yml`, which copies this folder into the public repo's `docs/` and pushes. You can also run it by hand from the Actions tab ("Publish dashboard to public repo", Run workflow).

One-off setup, so the workflow can push to the public repo:

1. Make a key pair (no passphrase): `ssh-keygen -t ed25519 -N "" -C "publish-dashboard" -f publish_key`
2. In the public repo: Settings, Deploy keys, Add deploy key. Paste `publish_key.pub`, and tick **Allow write access**.
3. In the private repo: Settings, Secrets and variables, Actions, New repository secret. Name it `PUBLIC_REPO_DEPLOY_KEY` and paste the whole of `publish_key`.
4. Delete both key files from your machine.

## Project layout

```
index.html            page structure: header, tabs, map, panels, dialogs
assets/               Rivers Trust logo (one version per theme)
css/
  theme.css           app colour/spacing tokens, built on Calcite's variables
  layout.css          page layout: header, tabs, views, side panels
  map-tab.css         Map tab: side panel, chart, site details; header dialogs
  org-tabs.css        League tables and Organisation tabs
  scorecards.css      Scorecards tab: Catchment Health panel, wheel, bar charts
  schematics.css      Schematics tab: river diagram cards, numbered site lists
  popup.css           storm overflow pop-up (loaded inside the pop-up - it's in the map's shadow DOM)
js/
  main.js             start-up: theme, header, tab switching, each tab's init
  config.js           service URLs, determinands, threshold bands, colours, contextual layers,
                      Catchment Health thresholds and themes
  metrics.js          determinand lookups, bandForValue(), theme colours
  filters.js          header filters (organisation, date range + presets) shared by every tab
  theme.js            dark/light switching
  data-guide.js       the header's Data guide table
  data/
    nrs-service.js    queries the NRS service (organisations, sites, observations, equipment)
    org-summary.js    the selected organisation's per-site summary for the date range -
                      drives the map symbology, stat boxes and league table; also the
                      sites picked in the league table (which narrow the map)
    river-topology.js places sites on the Open River Network (nearest section within
                      RIVER_NETWORK.snapDistance), traces downstream per CaBA catchment and
                      builds one river tree per river system (main stem keeps its name, else
                      higher Strahler order); line widths show Strahler order
  map/
    map-common.js     shared map setup (basemap/theme, satellite imagery, focus fix, pop-up docking)
    sites-renderer.js survey sites coloured + sized by threshold band; organisation outlines
    contextual-layers.js  WFD classification, National Soil Map, storm overflows (+ pop-up)
    river-network.js  Open River Network + animated flow direction (shared with AQuA)
  charts/
    trend-chart.js    plain-SVG trend chart (threshold bands, compare two sites, tooltip)
    bar-chart.js      scorecard bar charts (day/week/month averages over threshold bands),
                      as SVG or a PNG for the PDF
    wheels.js         Catchment Health wheel, as SVG or a PNG for the PDF
    river-schematic.js  metro-map style river diagram, drawn from a river tree
  scorecards/
    ratings.js        scoring rules: value/count -> High..Bad rank, overall averages
    waterbody-data.js queries a waterbody's NRS, Riverfly and NBS data;
                      computeScorecard()
    scorecard-text.js wording shared by the panel and the PDF
    pdf-common.js     loads jsPDF on first use; drawing helpers
    pdf-catchment-health.js  Catchment Health report
  tabs/
    map-tab.js        the Map tab: layers, side panel, selection, chart
    site-details.js   the Map tab's site details panel and photo viewer
    league-table.js   sortable site league table; click rows to pick sites for the map
    schematics-tab.js river diagrams for the chosen determinand, numbered site lists,
                      and a note of sites too far from the network to be drawn
    org-details.js    the organisation's equipment in use, per determinand
    scorecards-tab.js waterbody map, Catchment Health panel, PDF download
  utils/
    format.js         escapeHtml, escapeSql, number/date formatting, colour helpers
```

### Changing thresholds or determinands

Everything lives in `js/config.js`: `METRICS` (one entry per determinand), `BAND_STYLE` (band names and colours) and `BAND_THRESHOLDS` (each determinand's upper bounds, inclusive). The map, stat boxes, trend chart and Data guide all read from there.

### Adding a tab

1. In `index.html`, add `<calcite-tab-title data-view="x">` to the tab bar and a `<section class="view" data-view="x" hidden>` in `<main>`.
2. Create `js/tabs/x-tab.js` exporting an `initXTab` function.
3. Add it to `TAB_INITS` in `js/main.js` (it's initialised the first time the tab is opened).
4. Respect the header filters: subscribe with `onFilterChange(fn)` from `js/filters.js`, and read `getOrganisation()` / `isWithinDateRange(ms)`. For per-site figures, use `getSiteRows()` and `onSummaryChange(fn)` from `js/data/org-summary.js` rather than recomputing them.
