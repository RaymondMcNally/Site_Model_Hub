/* GIS layers for the projection page: GeoJSON from QGIS or ArcGIS (a file, a URL, or an ArcGIS feature service),
   placed on the site with the map projections in dem-import.js, kept in this browser (IndexedDB) and drawn into the
   projector texture.

   Coordinates
   - Site metres: from the survey's south-west corner, x east, y north (plan mm = site metres × 5 at 1:200).
   - A layer is stored as read, in its own coordinate system (epsg), and converted to site metres when drawn, so
     changing the placement never needs the file again.
   - The survey's south-west corner on the map ("origin") comes from the site pack (pack.geo, or a pack built from GeoTIFF
     tiles), or is typed in, or is estimated from the site's latitude and longitude (good to a few metres at best).
   Feature shape (raw and converted): { t: 'T' points [[x,y]…] | 'L' lines [[[x,y]…]…] | 'P' polygons [[[ring]…]…], p: properties } */
(function (root) {
  'use strict';
  const D = () => root.DEMImport;
  const R_MERC = 6378137;
  const COLOURS = ['#ff3b30', '#ffd60a', '#30d158', '#0aa2ff', '#ff2d92', '#bf5af2', '#ff9f0a', '#64d2ff'];
  const CATS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];
  const SEQ = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];
  const OTHER = '#8a8a8a';

  // ---------------------------------------------------------------- reading GeoJSON
  function epsgOfCrs(j) {
    const n = j && j.crs && j.crs.properties && (j.crs.properties.name || j.crs.properties.code);
    if (!n) return null;
    if (/CRS84|4326/.test(String(n))) return 4326;
    const m = String(n).match(/EPSG:{0,2}(\d+)/i) || String(n).match(/^(\d+)$/);
    if (!m) return null;
    const e = +m[1];
    return e === 102100 || e === 900913 ? 3857 : e;
  }
  function parse(j) {
    if (typeof j === 'string') j = JSON.parse(j);
    if (j && j.error) throw new Error(j.error.message || 'The service returned an error.');
    const out = [];
    const geom = (g, p) => {
      if (!g) return;
      const c = g.coordinates;
      if (g.type === 'Point') out.push({ t: 'T', parts: [c.slice(0, 2)], p });
      else if (g.type === 'MultiPoint') out.push({ t: 'T', parts: c.map(q => q.slice(0, 2)), p });
      else if (g.type === 'LineString') out.push({ t: 'L', parts: [c.map(q => q.slice(0, 2))], p });
      else if (g.type === 'MultiLineString') out.push({ t: 'L', parts: c.map(l => l.map(q => q.slice(0, 2))), p });
      else if (g.type === 'Polygon') out.push({ t: 'P', parts: [c.map(r => r.map(q => q.slice(0, 2)))], p });
      else if (g.type === 'MultiPolygon') out.push({ t: 'P', parts: c.map(pl => pl.map(r => r.map(q => q.slice(0, 2)))), p });
      else if (g.type === 'GeometryCollection') (g.geometries || []).forEach(x => geom(x, p));
    };
    const feat = f => geom(f.geometry, f.properties || {});
    if (!j) throw new Error('The file is empty.');
    if (j.type === 'FeatureCollection') (j.features || []).forEach(feat);
    else if (j.type === 'Feature') feat(j);
    else if (j.type) geom(j, {});
    else throw new Error('This is not GeoJSON. From QGIS use Export › Save Features As › GeoJSON; from ArcGIS use Features To JSON with the GeoJSON option.');
    return { feats: out, epsg: epsgOfCrs(j) };
  }
  const eachXY = (f, fn) => {
    if (f.t === 'T') f.parts.forEach(fn);
    else if (f.t === 'L') f.parts.forEach(l => l.forEach(fn));
    else f.parts.forEach(pl => pl.forEach(r => r.forEach(fn)));
  };
  // what system the numbers are in, when the file does not say
  function guessEpsg(feats, fallback) {
    let n = 0, lonlat = 0, itm = 0, ig = 0, merc = 0, small = 0;
    for (const f of feats) {
      eachXY(f, ([x, y]) => {
        if (n++ > 4000) return;
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) lonlat++;
        else if (x > 400000 && x < 800000 && y > 500000 && y < 1000000) itm++;
        else if (x > 0 && x < 400000 && y > 0 && y < 500000) ig++;
        else if (Math.abs(x) > 1e5 && Math.abs(y) > 5e6) merc++;
        else if (Math.abs(x) < 20000 && Math.abs(y) < 20000) small++;
      });
      if (n > 4000) break;
    }
    const best = [[lonlat, 4326], [itm, 2157], [ig, 29903], [merc, 3857], [small, 'site']].sort((a, b) => b[0] - a[0])[0];
    return best[0] ? best[1] : (fallback || 4326);
  }
  function props(feats) {
    const keys = new Map();
    feats.slice(0, 800).forEach(f => Object.keys(f.p || {}).forEach(k => { const v = f.p[k]; if (v !== null && typeof v !== 'object') keys.set(k, (keys.get(k) || 0) + 1); }));
    return [...keys.keys()];
  }
  function kindOf(feats) {
    const t = new Set(feats.map(f => f.t));
    return t.size > 1 ? 'mixed' : t.has('P') ? 'poly' : t.has('L') ? 'line' : 'point';
  }

  // ---------------------------------------------------------------- where the site is on the map
  // pack + saved placement → { epsg, E, N, approx, source }
  function origin(pack, G, place) {
    place = place || {};
    const src = pack.source || {};
    const geo = pack.geo && pack.geo.origin && D() && D().crsOf(pack.geo.epsg) ? { epsg: pack.geo.epsg, E: +pack.geo.origin[0], N: +pack.geo.origin[1] } : null;   // georeferenced after the fact (e.g. matched to a DEM)
    const packGeo = geo || (src.type === 'geotiff' && src.origin && D() && D().crsOf(src.epsg) ? { epsg: src.epsg, E: +src.origin[0], N: +src.origin[1] } : null);
    if (place.E !== '' && place.E != null && place.N !== '' && place.N != null && isFinite(+place.E) && isFinite(+place.N)) {
      return { epsg: packGeo ? packGeo.epsg : 2157, E: +place.E, N: +place.N, approx: false, source: 'typed' };
    }
    if (packGeo) return Object.assign(packGeo, { approx: false, source: 'pack' });
    if (D() && isFinite(+pack.lat) && isFinite(+pack.lon)) {
      const c = D().forward(2157, +pack.lat, +pack.lon);
      return { epsg: 2157, E: Math.round(c[0] - G.widthM / 2), N: Math.round(c[1] - G.depthM / 2), approx: true, source: 'latlon' };
    }
    return null;
  }
  const mercToLL = (x, y) => [(2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * 180 / Math.PI, x / R_MERC * 180 / Math.PI];
  // a function [x, y] in the layer's system → [x, y] site metres
  function converter(epsg, o, G, place) {
    place = place || {};
    const rot = (+place.rot || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot), cx = G.widthM / 2, cy = G.depthM / 2;
    const dx = +place.dx || 0, dy = +place.dy || 0;
    let toMap;
    if (epsg === 'site') toMap = null;
    else {
      if (!o) throw new Error('Type the map position of the survey\'s south-west corner first.');
      const dem = D(), oe = o.epsg;
      if (epsg === oe) toMap = p => p;
      else if (epsg === 4326) toMap = ([x, y]) => dem.forward(oe, y, x);
      else if (epsg === 3857) toMap = ([x, y]) => { const ll = mercToLL(x, y); return dem.forward(oe, ll[0], ll[1]); };
      else if (dem.crsOf(epsg)) toMap = ([x, y]) => { const ll = dem.inverse(epsg, x, y); return dem.forward(oe, ll[0], ll[1]); };
      else throw new Error(`EPSG ${epsg} is not one this page can convert. Reproject the layer to ITM (EPSG:2157) or WGS 84 (EPSG:4326) before exporting.`);
    }
    return p => {
      let x, y;
      if (toMap) { const m = toMap(p); x = m[0] - o.E; y = m[1] - o.N; } else { x = +p[0]; y = +p[1]; }
      if (rot) { const ux = x - cx, uy = y - cy; x = cx + ux * cr + uy * sr; y = cy - ux * sr + uy * cr; }   // clockwise
      return [x + dx, y + dy];
    };
  }
  function convert(raw, epsg, o, G, place) {
    const f = converter(epsg, o, G, place), feats = [];
    let inside = 0;
    const m = 0.02 * Math.max(G.widthM, G.depthM);
    raw.forEach(r => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pt = q => { const [x, y] = f(q); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; return [x, y]; };
      let parts;
      if (r.t === 'T') parts = r.parts.map(pt);
      else if (r.t === 'L') parts = r.parts.map(l => l.map(pt));
      else parts = r.parts.map(pl => pl.map(rg => rg.map(pt)));
      const on = x1 >= -m && y1 >= -m && x0 <= G.widthM + m && y0 <= G.depthM + m;
      if (on) inside++;
      feats.push({ t: r.t, parts, p: r.p, on });
    });
    return { feats, inside, total: raw.length };
  }
  // the survey's outline in longitude/latitude, for asking a service only for what is on the model
  function boundsLL(o, G, place) {
    if (!o || !D()) return null;
    const pad = 0.1 * Math.max(G.widthM, G.depthM), rot = (+place?.rot || 0) * Math.PI / 180;
    const R = Math.hypot(G.widthM, G.depthM) / 2 * (rot ? 1 : 0);
    const xs = [-pad - R, G.widthM + pad + R], ys = [-pad - R, G.depthM + pad + R];
    const ll = [];
    xs.forEach(x => ys.forEach(y => ll.push(D().inverse(o.epsg, o.E + x - (+place?.dx || 0), o.N + y - (+place?.dy || 0)))));
    return { w: Math.min(...ll.map(p => p[1])), s: Math.min(...ll.map(p => p[0])), e: Math.max(...ll.map(p => p[1])), n: Math.max(...ll.map(p => p[0])) };
  }

  // ---------------------------------------------------------------- fetching from a URL or an ArcGIS / QGIS server
  function serviceKind(url) {
    if (/\/(FeatureServer|MapServer)\/\d+\/?(\?.*)?$/i.test(url)) return 'arcgis-layer';
    if (/\/(FeatureServer|MapServer)\/\d+\/query/i.test(url)) return 'arcgis-query';
    if (/[?&]service=WFS/i.test(url)) return 'wfs';
    return 'file';
  }
  async function getJSON(url) {
    let r;
    try { r = await fetch(url, { mode: 'cors' }); }
    catch (e) { throw new Error('The browser could not reach that address. The server may not allow pages on other sites to read it (CORS), or you are offline. Download the layer as GeoJSON and load the file instead.'); }
    if (!r.ok) throw new Error(`The server answered ${r.status} ${r.statusText || ''}. Check the address, and that the layer is shared publicly.`.trim());
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('That address did not return JSON. For a QGIS Server or GeoServer WFS add outputFormat=application/json; for ArcGIS give the layer address ending in /FeatureServer/0.'); }
  }
  async function fetchLayer(url, bounds, progress) {
    url = url.trim();
    const kind = serviceKind(url);
    let name = decodeURIComponent((url.split('?')[0].split('/').filter(Boolean).slice(-1)[0] || 'layer').replace(/\.(geo)?json$/i, ''));
    if (kind === 'file') { const j = await getJSON(url); return Object.assign(parse(j), { name, url }); }
    if (kind === 'wfs') {
      const u = new URL(url);
      if (!u.searchParams.has('outputFormat') && !u.searchParams.has('outputformat')) u.searchParams.set('outputFormat', 'application/json');
      if (!u.searchParams.has('request')) u.searchParams.set('request', 'GetFeature');
      if (!/srsName/i.test(u.search)) u.searchParams.set('srsName', 'EPSG:4326');
      if (bounds && !/bbox/i.test(u.search)) u.searchParams.set('bbox', `${bounds.s},${bounds.w},${bounds.n},${bounds.e},urn:ogc:def:crs:EPSG::4326`);
      name = u.searchParams.get('typeName') || u.searchParams.get('typeNames') || name;
      const j = await getJSON(u.toString());
      const p = parse(j); if (!p.epsg) p.epsg = 4326;
      return Object.assign(p, { name, url });
    }
    // ArcGIS REST: ask for GeoJSON in WGS 84, only the features near the model, page by page
    const base = kind === 'arcgis-layer' ? url.split('?')[0].replace(/\/$/, '') : url.split('/query')[0];
    try { const info = await getJSON(base + '?f=json'); if (info && info.name) name = info.name; } catch (e) { }
    const feats = []; let offset = 0;
    for (let page = 0; page < 60; page++) {
      const u = new URL(base + '/query');
      if (kind === 'arcgis-query') new URL(url).searchParams.forEach((v, k) => u.searchParams.set(k, v));
      if (!u.searchParams.has('where')) u.searchParams.set('where', '1=1');
      if (!u.searchParams.has('outFields')) u.searchParams.set('outFields', '*');
      u.searchParams.set('outSR', '4326'); u.searchParams.set('f', 'geojson'); u.searchParams.set('returnGeometry', 'true');
      if (bounds && !u.searchParams.has('geometry')) {
        u.searchParams.set('geometry', `${bounds.w},${bounds.s},${bounds.e},${bounds.n}`);
        u.searchParams.set('geometryType', 'esriGeometryEnvelope'); u.searchParams.set('inSR', '4326'); u.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
      }
      if (offset) u.searchParams.set('resultOffset', String(offset));
      const j = await getJSON(u.toString()), p = parse(j);
      feats.push(...p.feats); offset += (j.features || []).length;
      if (progress) progress(feats.length);
      const more = (j.properties && j.properties.exceededTransferLimit) || j.exceededTransferLimit;
      if (!more || !(j.features || []).length) break;
    }
    return { feats, epsg: 4326, name, url };
  }

  // ---------------------------------------------------------------- colours by attribute
  function classify(feats, key) {
    if (!key) return null;
    const vals = feats.map(f => f.p ? f.p[key] : undefined);
    const nums = vals.filter(v => v !== null && v !== '' && v !== undefined && isFinite(+v)).map(Number);
    const uniq = new Set(vals.map(v => String(v)));
    if (nums.length >= 0.9 * vals.length && uniq.size > 8) {          // numbers: five classes with equal counts
      const s = nums.slice().sort((a, b) => a - b), q = k => s[Math.min(s.length - 1, Math.floor(k * s.length / 5))];
      const br = [q(1), q(2), q(3), q(4)];
      const at = v => { if (!(v !== null && v !== '' && isFinite(+v))) return OTHER; let i = 0; while (i < 4 && +v > br[i]) i++; return SEQ[i]; };
      const f2 = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (+v.toFixed(2)).toString();
      const legend = [[SEQ[0], `≤ ${f2(br[0])}`], [SEQ[1], `${f2(br[0])}–${f2(br[1])}`], [SEQ[2], `${f2(br[1])}–${f2(br[2])}`], [SEQ[3], `${f2(br[2])}–${f2(br[3])}`], [SEQ[4], `> ${f2(br[3])}`]];
      return { at: f => at(f.p ? f.p[key] : null), legend };
    }
    const count = new Map(); vals.forEach(v => { const k = v === null || v === undefined || v === '' ? '—' : String(v); count.set(k, (count.get(k) || 0) + 1); });
    const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, CATS.length).map(e => e[0]);
    const map = new Map(top.map((k, i) => [k, CATS[i]]));
    const legend = top.map(k => [map.get(k), k]); if (count.size > top.length) legend.push([OTHER, `other (${count.size - top.length})`]);
    return { at: f => { const v = f.p ? f.p[key] : null; return map.get(v === null || v === undefined || v === '' ? '—' : String(v)) || OTHER; }, legend };
  }

  // classes cached on the converted layer (memory only: styles are saved and sent between windows as plain JSON)
  function legendFor(conv, key) {
    if (!key || !conv) return null;
    if (!conv._cls || conv._cls.key !== key) conv._cls = { key, cls: classify(conv.feats.filter(f => f.on), key) };
    return conv._cls.cls;
  }

  // ---------------------------------------------------------------- drawing into the texture
  // ctx: texture context. X, Y: site metres → texture px. px: texture px per model mm. t: seconds (animation)
  function draw(ctx, style, conv, X, Y, px, t) {
    if (!conv || !style.on) return;
    const cls = legendFor(conv, style.by);
    const lw = Math.max(1, (+style.width || 1.5) * px), op = style.op == null ? 0.9 : +style.op;
    const pulse = style.anim ? 0.55 + 0.45 * Math.sin(t * 3) : 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ring = r => { r.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))); ctx.closePath(); };
    // polygons first, then lines, then points, so small things stay visible
    for (const pass of ['P', 'L', 'T']) for (const f of conv.feats) {
      if (f.t !== pass || !f.on) continue;
      const col = cls ? cls.at(f) : style.color;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      if (f.t === 'P') {
        ctx.beginPath(); f.parts.forEach(pl => pl.forEach(ring));
        if (style.fill !== false) { ctx.globalAlpha = op * 0.6 * pulse; ctx.fill('evenodd'); }
        ctx.globalAlpha = op; ctx.lineWidth = lw; ctx.setLineDash([]); ctx.stroke();
      } else if (f.t === 'L') {
        ctx.globalAlpha = op; ctx.lineWidth = lw;
        if (style.anim) { ctx.setLineDash([4 * px, 3 * px]); ctx.lineDashOffset = -t * 8 * px; } else ctx.setLineDash([]);
        ctx.beginPath(); f.parts.forEach(l => l.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
      } else {
        ctx.globalAlpha = op; ctx.setLineDash([]);
        const r = Math.max(2, (+style.width || 1.5) * 1.6 * px * (style.anim ? 0.8 + 0.4 * pulse : 1));
        f.parts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); });
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- keeping layers in this browser
  const DB = 'sitekit-gis', ST = 'layers';
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction(ST, mode), s = t.objectStore(ST), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  const store = {
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    get: k => tx('readonly', s => s.get(k)),
    del: k => tx('readwrite', s => s.delete(k))
  };

  root.GISLayers = { parse, guessEpsg, props, kindOf, origin, converter, convert, boundsLL, fetchLayer, serviceKind, classify, legendFor, draw, store, COLOURS };
})(typeof window !== 'undefined' ? window : globalThis);
