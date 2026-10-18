# Site Model Kit

A static website (no server code, no build step) that turns any terrain STL into teaching pages. The menu shows the student pages (Sites, Contours, Sun & climate, Model kit, Your model) and **Advanced**; Sections, Projection and Add a site are reached from the Advanced page so first-year students aren't sent there by default.

| Page | What it does |
|---|---|
| `contours.html` | Reading contours: build the hill in layers (sheets of board stacked one per contour, with a Stack the sheets button), landform patterns, the site's own features, gradient and section tool, water flow, quiz |
| `sun.html` | Sun path in 3D, terrain shadows, hours of sun, aspect, sun-path diagram; rainfall and wind rose from Met Éireann CSVs |
| `kit.html` | Whole-site laser-cut model at 1:100, 1:200, 1:500 or 1:1000 (the largest that keeps the model within about 2.5 m is chosen first): sheets (SVG/DXF/PDF), assembly guide PDF, contour DXF, 3D build guide |
| `model.html` | A student's own square at 1:100, 1:200, 1:500 or 1:1000: contour plan PDF, plus laser-cut contour layers, waffle sections or engraved relief, a 3D print, a plaster casting mould or a CNC carving file; optionally as one tile of a class model |
| `index.html` | Choose the site; staff notes |
| `advanced.html` | Advanced: links to Sections, Projection and Add a site |
| `setup.html` | Add or edit a site: STL or GeoTIFF lidar tiles → levels, details, traced or imported features → site pack |

## Trying it on your own computer
The pages load data and the 3D viewer as separate files, which browsers block when a page is opened straight from the folder (a `file://` address). The Sections page then says so; other pages show "needs the website served over http". To test locally, open Terminal in the website folder and run `python3 -m http.server 8000`, then go to http://localhost:8000. VS Code's Live Server works too. GitHub Pages needs nothing extra.

## Sites

Each site is one **site pack** (`.json`): ground levels on a regular grid, plus name, location, time zone, north, datum and features.

- **Published sites** live in `sites/` and are listed in `sites/index.json`. Everyone sees these.
- **Sites added in the browser** (setup page, or *Import a site pack*) are stored in that browser on that computer (IndexedDB) until downloaded.

To publish a site: download its pack from the setup page or the Sites page, copy it into `sites/`, add a line to `sites/index.json`, commit and push.

```json
{ "sites": [
  { "id": "gleniff-2026", "name": "Gleniff Barytes Mill", "place": "Ballintrillick, Co. Sligo", "year": "2026", "file": "sites/gleniff-2026.json" }
] }
```

## GeoTIFF elevation tiles (Irish open lidar)

The setup page also reads **GeoTIFF elevation tiles** instead of an STL, for example the free GSI Open Topographic Lidar for Ireland (data.gov.ie; download viewer on the Irish Government geodata hub). Use the **DTM** (bare earth).

- Drop one tile or several neighbouring tiles at once: they are joined into one map. Missing data (the file's no-data value, and the −99 placeholder some tiles use) is left out, and lidar flown along a road or river shows as a strip.
- Drag a box round the site on the shaded map, or press *Use all the data*. The ground is sampled every 1–2 m (never finer than the tiles; coarser for very large boxes so the site pack stays a sensible size).
- Heights stay real (metres above OD Malin for Irish data): the lowest ground becomes the site's level datum, so drawings show true levels.
- Latitude and longitude come from the box centre, and north from the grid convergence, for ITM (EPSG:2157), Irish Grid (29902/29903), British National Grid (27700) and UTM (326xx, 258xx). Old Irish Grid and BNG ignore the datum shift (up to about 100 m), which doesn't matter for the sun.
- The survey credit fills in when the file names start with one of the open-lidar organisations (GSI_, TII_, OPW_…): "Contains Irish Public Sector Data (Geological Survey Ireland) licensed under CC BY 4.0", as the licence asks. Keep it on anything you publish.
- GeoJSON or DXF features in map metres or longitude/latitude are then placed exactly: the corner fields fill themselves in.
- Reader: geotiff.js 2.1.3 (`vendor/geotiff.min.js`, MIT), used only on the setup page; `js/dem-import.js` does the mosaic, box, sampling and projections.

The tiles are 2 m (TII, OPW) or 1 m (GSI) apart, against 0.4 m for a drone survey: good for whole valleys at 1:500 and 1:1000, context models and sites with no survey of their own; softer than a drone survey for detailed 1:100–1:200 work.

## STL requirements

- North up (+Y). If not, enter the angle on the setup page.
- Any scale: choose it on the setup page (1:100–1:1000 in mm, or metres).
- A flat base, skirt or walls under the terrain are ignored: only the up-facing ground surface is read.
- If the STL was exported with vertical exaggeration (QGIS DEMto3D "Z exaggeration"), enter it.
- Levels are relative by default (0 m = lowest ground). Enter a real level for the lowest ground if known.

Command-line alternative (Node 18+): `node tools/stl2pack.js site.stl sites/site.json --name "Site" --scale 200 --lat 54.4 --lon -8.4 --year 2027`

## Features

Traced on the setup page or imported from GeoJSON (QGIS) or DXF (CAD). Types: watercourse, road, path, building, site boundary, area to point out, point. A note on a feature turns it into a "find it on the plan" item on the contours page; text before the first full stop becomes its heading. One feature can be the *main feature*: pages centre on it.

Imported coordinates can be in STL units, map metres (give the easting/northing of the STL's south-west corner) or longitude/latitude (placed using the site's latitude/longitude as the survey centre; use the shift fields to line up).

## Model scale (`model.html`, `kit.html`)

Both model pages offer 1:100, 1:200, 1:500 and 1:1000. The model size stays the same physical size; the scale sets how much ground it covers (a 300 mm square is 30, 60, 150 or 300 m) and the height of one board layer (5 mm = 0.5, 1, 2.5 or 5 m). Every output, label, guide, README, setup sheet and file name follows the chosen scale. The plan PDF picks the largest of 1:100, 1:200, 1:500, 1:1000 or 1:2000 that fits A0, with contours every 0.5, 1 or 2 m and spot heights every 10, 20, 50 or 100 m to suit. Sizes quoted below are at 1:200.

## 3D print and plaster mould (`model.html`)

On the Your Model page students choose **Card model** or **3D print**. The 3D print has two forms, built from the same 0.4 m grid as the card model and plan (2 mm on the model):

- **Model:** a watertight 230 × 230 mm solid (46 × 46 m at 1:200) with a 2/3/5 mm base slab, true-scale or 1.5×/2× heights, and an optional north arrow recessed into the underside.
- **Plaster mould:** an open tray on the same 230 mm footprint. Its floor is the square upside down and mirrored east–west, so a plaster cast reads the right way round when turned over. The rim is the pour line. Inner walls taper from 10 mm to 3 mm so the cast releases, which leaves a 210 mm cast (42 × 42 m). The page reports the plaster volume.

Both download as 3MF (mm units) or STL, sized for the Bambu Lab P1S. 230 mm, not 250: the P1S can't print in an 18 × 28 mm area at the front-left of its 256 mm plate, so each file is placed 22 mm in from the left. Size and placement are `PRINT`, `MOULD` and `PLACE` at the top of `js/model.js`; the geometry is `buildPrint`, `buildMould`, `print3MFParts` and `printSTL` in `js/model-core.js`. The page blocks downloads over 250 mm tall.

## Laser cutter: waffle sections and engraved relief (`model.html`)

The Laser cutter output has three forms: **Contour layers** (the card model above), **Waffle sections** and **Engraved relief**.

- **Waffle sections:** an egg-crate of true 1:200 site sections. A pieces run west–east (A1 south) and are slotted from below; B pieces run south–north (B1 west) and are slotted from above. Each crossing gets one slot height, shared by both pieces: half the lowest top across the slot on either piece, so slots never break through where the ground drops away and the tops always meet flush. A 10 mm solid strip runs under the lowest ground. Every piece is engraved with its name and a direction arrow. Spacing 15–30 mm. Pieces are shelf-packed onto the chosen sheet; the ZIP has SVG/DXF/PDF sheets, an assembly guide with a key, the plan and a README. `buildWaffle`, `packShelves`, `shelfPaths`, `pathsSVG`, `pathsDXF` in `js/model-core.js`. Checked across 1,584 waffles: every outline a simple polygon, every slot pair exact, at least 5 mm of board above any bottom slot.
- **Engraved relief:** a greyscale PNG for the laser's 3D/greyscale engraving mode: black = lowest ground (engraved deepest), white = highest. 254, 318 or 400 dpi; the PNG carries a pHYs chunk so it imports at its physical size. Heights are not to scale. `reliefGrid` in `js/model-core.js`.

## Class tile model (`model.html`)

The *Class tile model* switch works with every output. The survey is divided into a grid of squares the size of the chosen output, from its south-west corner (columns A, B, C… west to east; rows 1, 2, 3… south to north), and the square snaps to a tile. Every tile uses one base level, the lowest ground of the whole survey, so neighbouring tiles line up: contour layers start from it, prints and carvings measure heights from it, casts and waffles too, and the relief maps the whole site's range to black–white. CNC *Fit to the material* uses the whole site's relief, so every tile gets the same vertical scale. File names and the plan's title block carry the tile name. *Download class tile map* gives tutors an A3 sheet of the grid over the site with every tile named.
Solid outputs read the survey directly at each grid point (not the edge-softened window used for contours), so tiles agree along every seam: checked at 0 mm difference across all neighbouring pairs for prints, moulds and carvings.

## CNC carving (`model.html`)

The third output on the Your Model page is a carving for the department's CNC router (Mantech Falcon 1325: bed 2500 × 1300 mm, Z travel 200 mm, VCarve Pro, DSP controller loading from USB). The page does not write G-code: the router's manual requires toolpaths to go through VCarve Pro and the post processor supplied with the machine.

- **Sizes:** 300, 400, 600, 900 or 1200 mm square at 1:200 (60–240 m of site). Squares over 600 mm use every second grid point (4 mm), which keeps the STL under about 10 MB.
- **Material:** 18–150 mm. Heights are true scale, or *Fit to the material*, which flattens them (never exaggerates) and reports the vertical scale. True scale blocks the download if the carving is taller than the material; over 75 mm deep the page warns about long-reach bits.
- **Uncut base:** 3, 6 or 10 mm left under the lowest ground.
- **Download:** a ZIP with the STL (watertight solid, mm, origin at the south-west bottom corner, north +Y), a one-page setup sheet PDF (VCarve job setup, import, 3D roughing and finishing, post processor), and a README.
- The plan PDF steps from 1:100 to 1:200 or 1:500 when a square is too big for A0.

Geometry: `buildCarve` in `js/model-core.js`. Checked across 517 squares: all watertight, never over the material in fit mode.

## Sections through the scan (`sections.html`)

Cuts the site's 3D Gaussian-splat scan along any vertical plane, with the surveyed ground drawn solid in the cut.

- **Section line.** Drag the ends on the plan (Shift snaps to 15°), drag the line to move it, or draw a new one. "Look the other way" flips the view.
- **Views.** Section (narrow lens, square to the cut), 3D and Plan. Keys 1, 2 and 3 switch views.
- **Cut controls.** "Show behind the cut" leaves only a slice of the given depth. "Hide above" removes the canopy above a level. Toggles cover the poché, the bare-earth survey surface, the scan and the cut itself.
- **Section drawing.** The ground along A–B from the survey, with:
  - levels;
  - spot heights at the ends and at the high and low points;
  - the features the line crosses (named from the site pack);
  - a scale bar and title.

  It downloads as SVG, or as a PDF at 1:100, 1:200 or 1:500 on the smallest A-size sheet that fits. "Download this view" saves the 3D view as a PNG.
- **Scan in the site pack.** Gleniff's scan is the full DJI Terra scan (3.69 million splats, 293 MB .ply) thinned for the web to `sites/gleniff-lite.spz` (23.4 MB, 1.45 million splats: every splat around the mill kept, the smallest and faintest dropped elsewhere; small enough for GitHub's web uploader). The page tries `file` first, then each name in `alt` (here `sites/gleniff-full.spz`, the whole scan as SPZ, if you add it). A .glb with KHR_gaussian_splatting + SPZ also works. The page reads the SPZ data straight out of the .glb. The pack's `splat` field holds `{ file, yaw, x, y, z, scale }`:
  - Scan coordinates are z-up, in metres.
  - survey east, north = rotate(yaw)·(x, y)·scale + (x, y)
  - level = z·scale + z + levelOffset
- **How Gleniff was fitted.** The fit used the ground the scan can see: the lowest splat per metre cell where it is also a local low. These cells were matched to the bare-earth survey, maximising the share within ±0.5 m. About 68% of open ground cells fit.
- **Your own scan.** "Scan position" loads `.spz`, `.ply`, `.splat`, `.ksplat`, `.sog`, or a .glb using KHR_gaussian_splatting with SPZ compression.
  - Turn the scan by eye, then "Find it on the survey" runs the same fit in the browser: turn within ±10° and any position on the survey.
  - The position is remembered per file name in `localStorage` (`sitekit-sections-<site>`). The scan itself is not stored.
- **Renderer.** Spark 2.3.1 (`vendor/spark`, MIT) on three.js 0.180 (`vendor/three`, MIT, ES modules via an import map). This page only; the other pages keep three r128. The page draws only while something changes.

## Projection mapping (`project.html`)

Projects layers onto a physical white site model from a projector pointing straight down.

- **Model on the table.** Whole survey, the class tile model, or the square saved on Your model. Base thickness and height exaggeration match the model that was made. **Model scale** (1:200 for kit models, down to 1:2500 for a town model) sets the height correction, the projector offsets and GIS line widths; the corner pins handle the plan at any scale.
- **Layers.** Elevation colours, hillshade, contours (0.5–5 m), slope for access (1:20–1:12 amber, steeper red), site features, water level, sun and shadow for any date and time (with Play the day), and your own image stretched to the model outline.
- **GIS layers.** GeoJSON files from QGIS or ArcGIS (several at once), a GeoJSON URL, a WFS URL, or an ArcGIS feature service layer (`…/FeatureServer/0`, fetched as GeoJSON in WGS 84, only near the model, paged past the service's record limit). Coordinates are read from the file's `crs` or worked out from the numbers (WGS 84, ITM, Irish Grid, Web Mercator, site metres) and can be changed per layer. Sites built from GeoTIFF tiles already know their map position; for an STL site type the ITM easting and northing of the survey's south-west corner (otherwise it is estimated from the site's latitude and longitude), with east/north nudges and a turn. Per layer: colour, width, strength, fill, **Colour by** a field (categories, or five equal-count classes for numbers, with a key), and **Animate** (dashes run along lines; areas and points pulse). Geometry is kept in IndexedDB (`sitekit-gis`, per site) and styles with the other projection settings, so layers survive a reload and reach the projector window. The service must allow cross-origin requests (ArcGIS Online public layers do); otherwise export GeoJSON and load the file.
- **Two windows.** The control page drives a projector window (`project.html?out`, black, full screen with F). They stay in step through BroadcastChannel. "Full screen here" serves a mirrored display.
- **Calibration.** Drag the four corners onto the model base, then set lens height and projector east/north offset until the red crosshairs sit on the three high points. The image is warped by the height of each point (parallax) and then a four-corner homography. Settings are saved per site and model in `localStorage` (`sitekit-proj-<site>`). C toggles handles; arrow keys nudge the last corner (Shift ×10).
- **Defaults.** Lens 1400 mm above the corners (2.55 m room, table about 750 mm, projector body about 300 mm) and 16:10 output (1920 × 1200).

## Splash screen (`index.html`)

The home page opens with a full-screen splash drawn from whichever site is open. Each visit picks one of two openings at random:

- **Laser bed:** a laser head traces the site's contours, blue engrave lines at the contour interval and red cut lines every fifth. 2D canvas, no libraries.
- **Survey sweep:** a scan line passes over a point cloud of the site, which settles into contour bands. Uses `vendor/three.min.js`, loaded only when this opening is picked; if 3D can't start, the laser bed plays instead.

It plays once per browser session, has Skip (or Esc) and Enter (or the Enter key), and doesn't play for visitors with reduced motion switched on. Add `?intro` to the address to replay it, or `?intro=laser` / `?intro=sweep` to choose. A safety net shows the home page after 4 seconds if the splash can't start. Files: `js/splash.js`, `css/splash.css`, and a short gate script in the `<head>` of `index.html` that hides the page before it paints.

Every page footer carries the credit "Created by R McNally" (`footer .credit` in `css/site.css`).

## Hosting

Serve over http(s) (GitHub Pages works). Opening the files directly from disk blocks the published sites and the background nesting worker.

## Files

- `js/sitekit.js` STL reader, ground sampler, pack format, storage
- `js/site.js` loads the open site, plan drawing, header and site switcher
- `js/model-core.js` slicing, hollow layers, whole-site tiling, nesting, SVG/DXF output, 3D print, plaster mould (3MF/STL) and CNC carving (STL)
- `js/nest-worker.js` runs nesting in the background
- `js/contours.js`, `js/sun.js`, `js/climate.js`, `js/kit.js`, `js/model.js`, `js/setup.js`, `js/home.js` page scripts
- `js/splash.js`, `css/splash.css` home-page splash
- `js/project.js`, `css/project.css` projection mapping
- `js/gis-layers.js` GIS layers for projection: GeoJSON and ArcGIS/WFS reading, placement on the site, colour classes, drawing, IndexedDB store
- `js/sections.js`, `css/sections.css` sections through the scan (ES module)
- `js/dem-import.js` GeoTIFF tiles → mosaic → site grid, and map projections (setup and projection pages)
- `vendor/` three.js r128, OrbitControls, jsPDF 2.5.1, JSZip 3.10.1, geotiff.js 2.1.3 (setup page); `vendor/three` (three.js 0.180 modules) and `vendor/spark` (Spark 2.3.1) for the Sections page
