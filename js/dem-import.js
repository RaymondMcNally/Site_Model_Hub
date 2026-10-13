/* GeoTIFF terrain import for the setup page: one or more elevation tiles (for example the GSI Open Topographic
   Lidar DTM in ITM) → a mosaic → a box chosen on the map → a ground grid like SiteKit.rasterise returns.
   Uses geotiff.js (vendor/geotiff.min.js, MIT). Also map projections for the common grids (ITM, Irish Grid,
   British National Grid, UTM) so a site gets its latitude and longitude from the tiles. */
(function (root) {
  'use strict';
  // ---------------------------------------------------------------- projections (transverse Mercator, Snyder)
  const ELL = { GRS80: [6378137, 1 / 298.257222101], WGS84: [6378137, 1 / 298.257223563], AIRY: [6377563.396, 1 - 6356256.909 / 6377563.396], AIRYMOD: [6377340.189, 1 - 6356034.447 / 6377340.189] };
  const CRS = {
    2157: { name: 'Irish Transverse Mercator (ITM)', ell: 'GRS80', lat0: 53.5, lon0: -8, k0: 0.99982, FE: 600000, FN: 750000 },
    29903: { name: 'Irish Grid (TM65)', ell: 'AIRYMOD', lat0: 53.5, lon0: -8, k0: 1.000035, FE: 200000, FN: 250000 },
    29902: { name: 'Irish Grid (TM65)', ell: 'AIRYMOD', lat0: 53.5, lon0: -8, k0: 1.000035, FE: 200000, FN: 250000 },
    27700: { name: 'British National Grid', ell: 'AIRY', lat0: 49, lon0: -2, k0: 0.9996012717, FE: 400000, FN: -100000 }
  };
  function crsOf(epsg) {
    if (CRS[epsg]) return CRS[epsg];
    if (epsg >= 32601 && epsg <= 32660) return { name: `UTM zone ${epsg - 32600}N (WGS 84)`, ell: 'WGS84', lat0: 0, lon0: -183 + 6 * (epsg - 32600), k0: 0.9996, FE: 500000, FN: 0 };
    if (epsg >= 25828 && epsg <= 25838) return { name: `UTM zone ${epsg - 25800}N (ETRS89)`, ell: 'GRS80', lat0: 0, lon0: -183 + 6 * (epsg - 25800), k0: 0.9996, FE: 500000, FN: 0 };
    return null;
  }
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  function tmParams(c) {
    const [a, f] = ELL[c.ell], e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const M = phi => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    return { a, e2, ep2, M, M0: M(rad(c.lat0)) };
  }
  // latitude, longitude (degrees) → easting, northing
  function forward(epsg, lat, lon) {
    const c = crsOf(epsg); if (!c) return null; const { a, e2, ep2, M, M0 } = tmParams(c);
    const phi = rad(lat), N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * rad(lon - c.lon0);
    const x = c.k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const y = c.k0 * (M(phi) - M0 + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return [c.FE + x, c.FN + y];
  }
  // easting, northing → latitude, longitude (degrees)
  function inverse(epsg, E, N) {
    const c = crsOf(epsg); if (!c) return null; const { a, e2, ep2, M0 } = tmParams(c);
    const Mv = M0 + (N - c.FN) / c.k0, mu = Mv / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (E - c.FE) / (N1 * c.k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = c.lon0 + deg((D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1));
    return [deg(lat), lon];
  }
  // grid convergence: the angle of true north clockwise from grid north (degrees), for the north arrow
  function convergence(epsg, E, N) {
    const p = inverse(epsg, E, N), q = p && forward(epsg, p[0] + 0.001, p[1]); if (!q) return 0;
    return deg(Math.atan2(q[0] - E, q[1] - N));
  }

  // ---------------------------------------------------------------- reading tiles
  // Returns { name, w, h, res, E0 (west edge), N1 (north edge), epsg, Z (Float32Array, NaN = no data, row 0 = north) }
  async function readTile(file) {
    if (!root.GeoTIFF) throw new Error('The GeoTIFF reader did not load.');
    const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer()), img = await tiff.getImage();
    const w = img.getWidth(), h = img.getHeight(), [rx, ry] = img.getResolution(), [ox, oy] = img.getOrigin();
    if (Math.abs(Math.abs(rx) - Math.abs(ry)) > 1e-6 * Math.abs(rx)) throw new Error(`${file.name}: pixels are not square.`);
    const gk = img.getGeoKeys() || {}, epsg = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || 0;
    if (gk.GTModelTypeGeoKey === 2 || (epsg >= 4000 && epsg < 5000)) throw new Error(`${file.name} is in longitude/latitude. Use tiles in map metres (for example ITM, as the Irish lidar comes).`);
    const ras = await img.readRasters({ samples: [0], interleave: true });
    const nd = img.getGDALNoData(), Z = new Float32Array(w * h);
    let valid = 0;
    for (let k = 0; k < Z.length; k++) {
      const v = ras[k];
      // missing: the file's own no-data value, or the -99 / -9999 / -3.4e38 placeholders some tiles use
      if (!(v === v) || (nd !== null && v === nd) || v <= -50 || v > 9000) Z[k] = NaN; else { Z[k] = v; valid++; }
    }
    return { name: file.name, w, h, res: Math.abs(rx), E0: ox, N1: oy, epsg, Z, valid };
  }
  // tiles on one grid: the union of their extents at the coarsest resolution
  function mosaic(tiles) {
    const epsg = tiles[0].epsg;
    if (tiles.some(t => t.epsg !== epsg)) throw new Error('The tiles are in different coordinate systems.');
    const res = Math.max(...tiles.map(t => t.res));
    const E0 = Math.min(...tiles.map(t => t.E0)), N1 = Math.max(...tiles.map(t => t.N1));
    const E1 = Math.max(...tiles.map(t => t.E0 + t.w * t.res)), N0 = Math.min(...tiles.map(t => t.N1 - t.h * t.res));
    const w = Math.round((E1 - E0) / res), h = Math.round((N1 - N0) / res);
    if (w * h > 60e6) throw new Error('Those tiles together are too big to open at once. Choose fewer tiles.');
    const Z = new Float32Array(w * h).fill(NaN);
    tiles.forEach(t => {
      for (let r = 0; r < h; r++) {
        const N = N1 - (r + 0.5) * res, tr = Math.floor((t.N1 - N) / t.res); if (tr < 0 || tr >= t.h) continue;
        for (let c = 0; c < w; c++) {
          const E = E0 + (c + 0.5) * res, tc = Math.floor((E - t.E0) / t.res); if (tc < 0 || tc >= t.w) continue;
          const v = t.Z[tr * t.w + tc]; if (v === v) Z[r * w + c] = v;
        }
      }
    });
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (Z[r * w + c] === Z[r * w + c]) { if (c < x0) x0 = c; if (c > x1) x1 = c; if (r < y0) y0 = r; if (r > y1) y1 = r; }
    if (x1 < 0) throw new Error('These tiles have no ground data in them.');
    const dataBox = { E0: E0 + x0 * res, E1: E0 + (x1 + 1) * res, N0: N1 - (y1 + 1) * res, N1: N1 - y0 * res };
    return { epsg, res, E0, N1, E1, N0, w, h, Z, dataBox, names: tiles.map(t => t.name) };
  }
  // heights at a map point: bilinear between pixel centres, using whichever of the four neighbours have data
  function sampler(m) {
    return (E, N) => {
      const fx = (E - m.E0) / m.res - 0.5, fy = (m.N1 - N) / m.res - 0.5, c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r;
      let s = 0, wsum = 0;
      for (const [dr, dc, wt] of [[0, 0, (1 - tx) * (1 - ty)], [0, 1, tx * (1 - ty)], [1, 0, (1 - tx) * ty], [1, 1, tx * ty]]) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= m.h || cc >= m.w) continue;
        const v = m.Z[rr * m.w + cc]; if (v === v && wt > 0) { s += v * wt; wsum += wt; }
      }
      return wsum > 0.25 ? s / wsum : NaN;
    };
  }
  // the box (map metres) as a ground grid: row 0 = south, 0 m = the lowest ground, like SiteKit.rasterise
  function grid(m, box, step) {
    const widthM = box.E1 - box.E0, depthM = box.N1 - box.N0;
    step = step || Math.max(m.res, SiteKit.autoStep ? SiteKit.autoStep(widthM, depthM) : Math.max(0.4, Math.sqrt(widthM * depthM / 2.2e6)));
    step = Math.round(step * 10) / 10;
    const w = Math.floor(widthM / step + 1e-6) + 1, h = Math.floor(depthM / step + 1e-6) + 1, at = sampler(m), Z = new Float32Array(w * h);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const v = at(box.E0 + j * step, box.N0 + i * step); Z[i * w + j] = v; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!(hi > lo)) throw new Error('There is no ground data inside that box.');
    let missing = 0; for (let k = 0; k < Z.length; k++) { if (Z[k] === Z[k]) Z[k] -= lo; else missing++; }
    return { w, h, step, Z, lo: 0, hi: hi - lo, widthM: (w - 1) * step, depthM: (h - 1) * step, groundLevel: lo, missing: missing / Z.length };
  }
  // the Irish open lidar files are named after the organisation that flew them
  const ORGS = { GSI: 'Geological Survey Ireland', TII: 'Transport Infrastructure Ireland', OPW: 'Office of Public Works', DCHG: 'Dept. of Culture, Heritage and the Gaeltacht', DP: 'Dublin Port', HC: 'Heritage Council', NY: 'National Monuments Service', WMCC: 'Westmeath County Council' };
  function credit(m) {
    const orgs = [...new Set(m.names.map(n => (n.match(/^([A-Z]+)_/) || [])[1]).filter(o => ORGS[o]))];
    if (!orgs.length || m.epsg !== 2157) return '';
    return `GSI Open Topographic Lidar DTM (${orgs.join(', ')}), ${m.res} m. Contains Irish Public Sector Data (Geological Survey Ireland) licensed under CC BY 4.0`;
  }
  root.DEMImport = { readTile, mosaic, grid, sampler, crsOf, forward, inverse, convergence, credit };
})(typeof window !== 'undefined' ? window : globalThis);
