/* Projection mapping onto a physical site model.
   One script, two windows: project.html (controls + preview) and project.html?out (the projector window).
   They share state through a BroadcastChannel and localStorage, so either window can be calibrated.

   How the image lands on the model
   - Layers are drawn into a texture in plan coordinates (north up), covering the model's outline.
   - A grid mesh covers the outline. Each vertex is a point on the ground: (x, y) in plan mm at 1:200 and
     z = base + (level − datum) × 1000 / model scale × vertical scale, in mm above the surface the corners are pinned to.
     (The physical model can be at another scale, for example 1:1000 for a town; only z, the projector offsets and
     GIS line widths depend on it, because the four corner pins take care of the plan.)
   - The projector is a point at (cx, cy, h) above that surface. The ray from it through a raised point meets the
     surface further out: p' = c + (p − c) × h / (h − z). That base-plane point is then taken to the screen with the
     homography fixed by the four corner pins. So the four pins square the image up, and the projector height and
     position make it hug the hills. */
(async function () {
  'use strict';
  const OUT = document.documentElement.classList.contains('proj-out');
  const G = await window.loadSite('project.html'); if (!G) return;
  const { css, $, W, H, pack } = G;
  const KEY = 'sitekit-proj-' + pack.id;
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const send = m => { try { ch && ch.postMessage(m); } catch (e) { } };

  // ---------------------------------------------------------------- state
  const today = (() => { const d = new Date(); return d.toISOString().slice(0, 10); })();
  const S = {
    area: 'site', base: 3, vex: 1, aspect: 1.6, scale: 200,   // scale: the physical model's scale, 1:scale
    layers: { elev: true, hill: true, cont: true, slope: false, feat: true, flood: false, sun: false, img: false, cal: false, gis: true, sect: true, sectDim: true },
    ci: 1, flood: 0.2, date: today, time: 0.5, imgOp: 0.85,
    calib: {},                                  // per model: { corners: [[u,v]×4 SW,SE,NE,NW], h, nx, ny }
    gis: [],                                    // GIS layer styles, top of the list drawn last (geometry is in IndexedDB)
    gisPlace: { crs: 'auto', E: '', N: '', dx: 0, dy: 0, rot: 0 }   // where map data sits on the site
  };
  const PLACE0 = Object.assign({}, S.gisPlace);
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { Object.assign(S, s); S.layers = Object.assign({}, S.layers, s.layers); S.gisPlace = Object.assign({}, PLACE0, s.gisPlace); } } catch (e) { }
  if (!Array.isArray(S.gis)) S.gis = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
  let IMG = null;                               // the user's image (not saved, sent between windows)

  // the student's square / tile size from the Your model page
  const MS = (() => { try { return JSON.parse(localStorage.getItem(pack.modelKey || ('sitekit-model-' + pack.id)) || 'null') || {}; } catch (e) { return {}; } })();

  // ---------------------------------------------------------------- the model's outline and heights
  let A = null;                                  // { x0, y0, w, h, datum, key, grid… }
  function area() {
    const size = +MS.size || 300;
    let a;
    if (S.area === 'tiles') { const nc = Math.ceil(W / size), nr = Math.ceil(H / size); a = { x0: 0, y0: 0, w: nc * size, h: nr * size, key: 'tiles' + size, siteDatum: true, label: `class tile model, ${nc} × ${nr} tiles of ${size} mm` }; }
    else if (S.area === 'square' && MS.size) a = { x0: +MS.x || 0, y0: +MS.y || 0, w: size, h: size, key: `sq${Math.round(MS.x)}_${Math.round(MS.y)}_${size}`, siteDatum: !!MS.tile, label: `your ${size} mm square${MS.tile ? ' (class tile)' : ''}` };
    else a = { x0: 0, y0: 0, w: W, h: H, key: 'site', siteDatum: true, label: S.area === 'square' ? 'the whole survey (choose a square on Your model first)' : 'the whole survey' };
    // height grid, long side 400 cells
    const n = 400, gw = a.w >= a.h ? n : Math.max(8, Math.round(n * a.w / a.h)), gh = a.w >= a.h ? Math.max(8, Math.round(n * a.h / a.w)) : n;
    const hg = new Float32Array(gw * gh); let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      const v = G.height(a.x0 + (c + 0.5) / gw * a.w, a.y0 + (r + 0.5) / gh * a.h); hg[r * gw + c] = v;    // row 0 = south
      if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    Object.assign(a, { gw, gh, hg, lo: lo === Infinity ? G.lo : lo, hi: hi === -Infinity ? G.hi : hi });
    a.datum = a.siteDatum ? G.lo : a.lo;
    // the highest points, well apart: crosshairs for checking the projector height
    const pins = [], used = [];
    const order = [...hg.keys()].filter(i => hg[i] === hg[i]).sort((i, j) => hg[j] - hg[i]);
    for (const i of order) {
      const c = i % gw, r = Math.floor(i / gw), x = a.x0 + (c + 0.5) / gw * a.w, y = a.y0 + (r + 0.5) / gh * a.h;
      if (used.some(([u, v]) => Math.hypot(u - x, v - y) < 0.3 * Math.max(a.w, a.h))) continue;
      used.push([x, y]); pins.push({ x, y, hm: hg[i] }); if (pins.length === 3) break;
    }
    a.pins = pins;
    return a;
  }
  const K = () => 200 / (+S.scale || 200);                     // model mm per plan mm (plan mm are always 1:200)
  const zmm = (A0, hm) => S.base + ((hm === hm ? hm : A0.datum) - A0.datum) * 1000 / (+S.scale || 200) * S.vex;     // mm above the pinned surface
  const heightAt = (A0, x, y) => { const v = G.height(x, y); return v === v ? v : NaN; };
  const cal = () => {
    const k = A.key; if (!S.calib[k]) S.calib[k] = { corners: null, h: 1400, nx: 0, ny: 0 };
    const c = S.calib[k]; if (!c.corners) c.corners = defaultCorners(); return c;
  };
  function defaultCorners() {                    // fit the outline in the output with a margin, north up (u, v in 0–1)
    const a = A.w / A.h, R = S.aspect, m = 0.88;
    let ww = m, hh = m * R / a; if (hh > m) { hh = m; ww = m * a / R; }
    const u0 = (1 - ww) / 2, v0 = (1 - hh) / 2;
    return [[u0, v0 + hh], [u0 + ww, v0 + hh], [u0 + ww, v0], [u0, v0]];      // SW, SE, NE, NW (screen y down)
  }

  // ---------------------------------------------------------------- sun (NOAA equations, as on the sun page)
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI, LAT = +pack.lat || 53.3, LON = +pack.lon || -8, TZ = pack.tz || 'Europe/Dublin';
  let tzFmt = null;
  function tzOffset(ms) {
    try {
      if (!tzFmt) tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      const o = {}; tzFmt.formatToParts(new Date(ms)).forEach(p => o[p.type] = +p.value);
      return Math.round((Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute) - Math.floor(ms / 60000) * 60000) / 60000) / 60;
    } catch (e) { return 0; }
  }
  function solar(ms) {
    const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
    const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(om));
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(om));
    const dec = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lam)))), y = Math.tan(rad(eps / 2)) ** 2;
    const eqt = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
    const d = new Date(ms), mins = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    let tst = (mins + eqt + 4 * LON) % 1440; if (tst < 0) tst += 1440;
    let ha = tst / 4 - 180; if (ha < -180) ha += 360;
    const cz = Math.sin(rad(LAT)) * Math.sin(rad(dec)) + Math.cos(rad(LAT)) * Math.cos(rad(dec)) * Math.cos(rad(ha));
    const zen = deg(Math.acos(Math.max(-1, Math.min(1, cz))));
    let az = deg(Math.atan2(Math.sin(rad(ha)), Math.cos(rad(ha)) * Math.sin(rad(LAT)) - Math.tan(rad(dec)) * Math.cos(rad(LAT)))) + 180;
    return { alt: 90 - zen, az: (az + 360) % 360 };
  }
  const hourOf = t => 4 + t * 18;                                    // slider 0–1 → 04:00–22:00 site time
  function sunNow() {
    const [y, m, d] = (S.date || today).split('-').map(Number), hrs = hourOf(S.time);
    const wall = Date.UTC(y, m - 1, d) + hrs * 3600e3; let ms = wall - tzOffset(wall) * 3600e3; ms = wall - tzOffset(ms) * 3600e3;
    return Object.assign(solar(ms), { hrs });
  }
  const compass = az => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];
  const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

  // ---------------------------------------------------------------- texture: layers in plan coordinates
  const TEXL = 2048;
  const tex = document.createElement('canvas'), tctx = tex.getContext('2d');
  const vec = document.createElement('canvas'), vctx = vec.getContext('2d');        // contours + features + grid (cached)
  const ras = document.createElement('canvas'), rctx = ras.getContext('2d');
  const RAMP = [[0, [62, 125, 90]], [0.33, [156, 191, 110]], [0.6, [226, 214, 140]], [0.82, [211, 165, 107]], [1, [244, 239, 230]]];
  const ramp = t => { for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [a0, c0] = RAMP[i - 1], [a1, c1] = RAMP[i], f = (t - a0) / (a1 - a0); return c0.map((v, k) => v + (c1[k] - v) * f); } return RAMP[RAMP.length - 1][1]; };
  const TX = x => (x - A.x0) / A.w * tex.width, TY = y => (1 - (y - A.y0) / A.h) * tex.height;
  const north = rad(+pack.north || 0);

  const gis = document.createElement('canvas'), gctx = gis.getContext('2d');          // GIS layers (cached unless animated)
  function sizeTex() {
    const tw = A.w >= A.h ? TEXL : Math.round(TEXL * A.w / A.h), th = A.w >= A.h ? Math.round(TEXL * A.h / A.w) : TEXL;
    for (const c of [tex, vec, gis]) { c.width = tw; c.height = th; }
    ras.width = A.gw; ras.height = A.gh;
  }
  function drawVector() {                                            // contours, features, alignment grid
    const c = vctx; c.clearRect(0, 0, vec.width, vec.height); c.lineCap = 'round'; c.lineJoin = 'round';
    const px = tex.width / A.w;                                      // texture px per plan mm
    if (S.layers.cont) {
      const ci = +S.ci, start = Math.ceil(A.lo / ci) * ci;
      for (let L = start; L <= A.hi + 1e-9; L = +(L + ci).toFixed(3)) {
        const idx = Math.abs(L / (5 * ci) - Math.round(L / (5 * ci))) < 1e-6, s = G.contour(+L.toFixed(3));
        c.strokeStyle = 'rgba(24,30,32,' + (idx ? 0.95 : 0.7) + ')'; c.lineWidth = Math.max(1.2, (idx ? 1.1 : 0.55) * px);
        c.beginPath();
        for (let k = 0; k < s.length; k += 4) { c.moveTo(TX(s[k]), TY(s[k + 1])); c.lineTo(TX(s[k + 2]), TY(s[k + 3])); }
        c.stroke();
      }
    }
    if (S.layers.feat) G.feats.forEach(f => {
      const pts = f.P; if (!pts.length) return;
      const path = close => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(TX(p[0]), TY(p[1])) : c.moveTo(TX(p[0]), TY(p[1]))); if (close) c.closePath(); };
      c.setLineDash([]);
      if (f.kind === 'water') { c.strokeStyle = '#1f6fd1'; c.lineWidth = 2.4 * px; path(false); c.stroke(); }
      else if (f.kind === 'road') { c.strokeStyle = '#4a4f52'; c.lineWidth = 3 * px; path(false); c.stroke(); }
      else if (f.kind === 'path') { c.strokeStyle = '#7a5a2e'; c.lineWidth = 1.2 * px; c.setLineDash([4 * px, 3 * px]); path(false); c.stroke(); }
      else if (f.kind === 'building') { c.fillStyle = 'rgba(20,20,20,.35)'; path(true); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 1 * px; c.stroke(); }
      else if (f.kind === 'boundary') { c.strokeStyle = '#d12a1a'; c.lineWidth = 1.6 * px; c.setLineDash([8 * px, 3 * px, 2 * px, 3 * px]); path(true); c.stroke(); }
      else if (f.kind === 'area') { c.strokeStyle = '#e0a400'; c.lineWidth = 1.6 * px; c.setLineDash([5 * px, 3 * px]); path(true); c.stroke(); }
      else if (f.kind === 'point') { const [x, y] = pts[0]; c.fillStyle = '#111'; c.beginPath(); c.arc(TX(x), TY(y), 2.5 * px, 0, 7); c.fill(); }
      c.setLineDash([]);
    });
    if (S.layers.cal) {                                              // alignment grid every 10 m, outline, north arrow
      c.strokeStyle = '#fff'; c.lineWidth = Math.max(1.5, 0.5 * px);
      for (let x = Math.ceil(A.x0 / 50) * 50; x <= A.x0 + A.w; x += 50) { c.beginPath(); c.moveTo(TX(x), 0); c.lineTo(TX(x), vec.height); c.stroke(); }
      for (let y = Math.ceil(A.y0 / 50) * 50; y <= A.y0 + A.h; y += 50) { c.beginPath(); c.moveTo(0, TY(y)); c.lineTo(vec.width, TY(y)); c.stroke(); }
      c.strokeStyle = '#ffb000'; c.lineWidth = Math.max(4, 2 * px); c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, vec.width - c.lineWidth, vec.height - c.lineWidth);
      const ax = vec.width - 30 * px, ay = 34 * px; c.fillStyle = '#ffb000'; c.beginPath(); c.moveTo(ax, ay - 22 * px); c.lineTo(ax - 8 * px, ay); c.lineTo(ax + 8 * px, ay); c.closePath(); c.fill();
    }
  }
  function drawRaster() {                                            // colours, shading, slope, water, sun: one pixel per grid cell
    const { gw, gh, hg } = A, im = rctx.createImageData(gw, gh), d = im.data, L = S.layers;
    const cm = A.w / gw / 5, span = Math.max(0.5, A.hi - A.lo);       // cell size in metres
    const lev = A.lo + S.flood * (A.hi - A.lo);
    let sun = null, shade = null;
    if (L.sun) { sun = sunNow(); if (sun.alt > 0.5) shade = shadows(sun); }
    const azp = sun ? rad(sun.az) - north : 0, sx = sun ? Math.sin(azp) * Math.cos(rad(sun.alt)) : 0, sy = sun ? Math.cos(azp) * Math.cos(rad(sun.alt)) : 0, sz = sun ? Math.sin(rad(sun.alt)) : 1;
    const lx = Math.sin(rad(315) - north) * 0.7071, ly = Math.cos(rad(315) - north) * 0.7071, lz = 0.7071;   // hillshade light from the NW, 45° up
    const at = (r, c) => hg[Math.max(0, Math.min(gh - 1, r)) * gw + Math.max(0, Math.min(gw - 1, c))];
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      const h = hg[r * gw + c], o = ((gh - 1 - r) * gw + c) * 4;     // image row 0 = north
      if (!(h === h)) { d[o] = d[o + 1] = d[o + 2] = 18; d[o + 3] = 255; continue; }
      let col = L.elev ? ramp((h - A.lo) / span) : [255, 255, 255];
      const e = at(r, c + 1), w = at(r, c - 1), n = at(r + 1, c), s = at(r - 1, c);
      const dzdx = ((e === e ? e : h) - (w === w ? w : h)) / (2 * cm), dzdy = ((n === n ? n : h) - (s === s ? s : h)) / (2 * cm), nl = Math.hypot(dzdx, dzdy, 1);
      if (L.hill) { const sh = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / nl); col = col.map(v => v * (0.5 + 0.6 * sh)); }
      if (L.slope) { const e2 = at(r, c + 2), w2 = at(r, c - 2), n2 = at(r + 2, c), s2 = at(r - 2, c), ok = v => v === v;
        const g = ok(e2) && ok(w2) && ok(n2) && ok(s2) ? Math.hypot((e2 - w2) / (4 * cm), (n2 - s2) / (4 * cm)) : Math.hypot(dzdx, dzdy);   // wider stencil: smoother bands
        if (g > 1 / 12) col = col.map((v, k) => v * 0.25 + [229, 83, 61][k] * 0.75); else if (g > 1 / 20) col = col.map((v, k) => v * 0.3 + [242, 182, 50][k] * 0.7); }
      if (L.flood && h < lev) col = col.map((v, k) => v * 0.3 + [42, 127, 212][k] * 0.7);
      if (L.sun) {
        if (!shade) col = col.map(v => v * 0.12);                      // night
        else { const lam = Math.max(0, (-dzdx * sx - dzdy * sy + sz) / nl), sh = shade[Math.min(shade.gh - 1, r >> 1) * shade.gw + Math.min(shade.gw - 1, c >> 1)]; col = col.map(v => v * (sh ? 0.24 : 0.42 + 0.58 * lam)); }
      }
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    rctx.putImageData(im, 0, 0);
  }
  function shadows(sun) {                                            // terrain shadows on a half-resolution grid
    const gw = Math.ceil(A.gw / 2), gh = Math.ceil(A.gh / 2), hs = new Float32Array(gw * gh), cm = A.w / gw / 5;
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) { const v = A.hg[Math.min(A.gh - 1, r * 2) * A.gw + Math.min(A.gw - 1, c * 2)]; hs[r * gw + c] = v === v ? v : A.lo; }
    const azp = rad(sun.az) - north, dx = Math.sin(azp), dy = Math.cos(azp), rise = Math.tan(rad(sun.alt)) * cm, out = new Uint8Array(gw * gh), top = A.hi;
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      const h0 = hs[r * gw + c]; let x = c, y = r, z = h0 + 0.25;          // small lift: no self-shadow speckle from survey noise
      for (let k = 0; k < 2000; k++) {
        x += dx; y += dy; z += rise; if (z > top) break;
        const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= gw || yi >= gh) break;
        if (hs[yi * gw + xi] > z) { out[r * gw + c] = 1; break; }
      }
    }
    return Object.assign(out, { gw, gh });
  }
  // ---------------------------------------------------------------- GIS layers (js/gis-layers.js)
  // Each window keeps the layers' geometry in memory (RAW, as read) and converted to site metres for the current
  // placement (CONV). Styles live in S.gis, so they are saved and sent between windows with everything else.
  const GL = window.GISLayers, RAW = new Map(), CONV = new Map(), pending = new Set();
  const gisKey = id => pack.id + ':' + id;
  const gisOrigin = () => GL ? GL.origin(pack, G, S.gisPlace) : null;
  function convFor(st) {
    const raw = RAW.get(st.id); if (!raw || !GL) return null;
    const k = JSON.stringify(S.gisPlace) + '|' + st.epsg;
    let c = CONV.get(st.id);
    if (!c || c.k !== k) {
      try { c = { k, conv: GL.convert(raw, st.epsg, gisOrigin(), G, S.gisPlace) }; } catch (e) { c = { k, conv: null, err: e.message }; }
      CONV.set(st.id, c);
    }
    return c;
  }
  let gisDirty = true;
  function drawGis(t) {
    gctx.clearRect(0, 0, gis.width, gis.height);
    if (!S.layers.gis || !GL) return;
    const px = tex.width / A.w / K(), X = m => TX(m * 5), Y = m => TY(m * 5);    // texture px per model mm
    for (let i = S.gis.length - 1; i >= 0; i--) { const st = S.gis[i], c = convFor(st); if (c && c.conv) GL.draw(gctx, st, c.conv, X, Y, px, t); }
  }
  function loadMissing() {                                          // geometry for layers this window has not seen yet
    if (!GL) return;
    S.gis.forEach(st => {
      if (RAW.has(st.id) || pending.has(st.id)) return;
      pending.add(st.id);
      GL.store.get(gisKey(st.id)).then(r => { if (r && !RAW.has(st.id)) { RAW.set(st.id, r); CONV.delete(st.id); gisDirty = true; compose(true); if (!OUT) renderGis(); } })
        .catch(() => { }).finally(() => pending.delete(st.id));
    });
  }
  const gisAnimating = () => S.layers.gis && S.gis.some(s => s.on && s.anim && RAW.has(s.id));
  let animF = 0, animLast = 0;
  function animTick(now) {
    if (!gisAnimating()) { animF = 0; return; }
    if (now - animLast > 45) { animLast = now; compose(true); }      // about 20 frames a second is plenty for dashes
    animF = requestAnimationFrame(animTick);
  }
  const ensureAnim = () => { if (!animF && gisAnimating()) animF = requestAnimationFrame(animTick); };

  // ---------------------------------------------------------------- the section cut from the Sections page
  // Sections (and its big-screen window) send the cut on the channel 'sitekit-link-<site>'; the last one is also in
  // localStorage, so the line is there even if Sections is opened later or closed.
  const LINK = 'BroadcastChannel' in window ? new BroadcastChannel('sitekit-link-' + pack.id) : null;
  let CUT = null;
  const takeCut = s => { CUT = s && s.A && s.B ? { A: s.A, B: s.B, look: s.look || 1, depth: +s.depth || 201 } : CUT; };
  try { takeCut(JSON.parse(localStorage.getItem('sitekit-sections-' + pack.id) || 'null')); } catch (e) { }
  if (LINK) {
    LINK.onmessage = ({ data: m }) => { if (m.t === 'cut' && m.s) { takeCut(m.s); if (A) compose(true); if (!OUT) showCut(); } };
    try { LINK.postMessage({ t: 'cut-request' }); } catch (e) { }
  }
  function drawCut(c) {
    if (!S.layers.sect || !CUT) return;
    const [ax, ay] = CUT.A, [bx, by] = CUT.B, L = Math.hypot(bx - ax, by - ay); if (L < 1) return;
    const u = [(bx - ax) / L, (by - ay) / L], v = [-u[1] * CUT.look, u[0] * CUT.look];           // v: the way the section looks
    const X = m => TX(m * 5), Y = m => TY(m * 5), BIG = 3 * Math.max(A.w, A.h) / 5;
    const px = Math.max(tex.width, tex.height) / 400;                  // sizes relative to the model, so they read at any scale
    const at = (t, o) => [ax + u[0] * t + v[0] * o, ay + u[1] * t + v[1] * o];
    const path = pts => { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); };
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    if (S.layers.sectDim) {                                          // what the cut takes away, and beyond "show behind the cut"
      c.fillStyle = 'rgba(0,0,0,.62)';
      path([at(-BIG, 0), at(BIG, 0), at(BIG, -BIG), at(-BIG, -BIG)]); c.fill();
      if (CUT.depth <= 200) { c.fillStyle = 'rgba(0,0,0,.45)'; path([at(-BIG, CUT.depth), at(BIG, CUT.depth), at(BIG, BIG), at(-BIG, BIG)]); c.fill(); }
    }
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, 0.7 * px); c.setLineDash([6 * px, 4 * px]);
    path([at(-BIG, 0), at(BIG, 0)]); c.stroke(); c.setLineDash([]);                       // the plane, right across the model
    c.strokeStyle = '#000'; c.lineWidth = 5 * px; path([CUT.A, CUT.B]); c.stroke();
    c.strokeStyle = '#ff3b30'; c.lineWidth = 3 * px; path([CUT.A, CUT.B]); c.stroke();
    const dx = v[0], dy = -v[1], len = 22 * px, hw = 7 * px;                             // arrows: the way you look
    [[ax, ay, 'A', -1], [bx, by, 'B', 1]].forEach(([x, y, t, sgn]) => {
      const qx = X(x), qy = Y(y);
      c.strokeStyle = '#ff3b30'; c.lineWidth = 2.5 * px; c.beginPath(); c.moveTo(qx, qy); c.lineTo(qx + dx * len, qy + dy * len); c.stroke();
      c.fillStyle = '#ff3b30'; c.beginPath(); c.moveTo(qx + dx * (len + 10 * px), qy + dy * (len + 10 * px)); c.lineTo(qx + dx * len - dy * hw, qy + dy * len + dx * hw); c.lineTo(qx + dx * len + dy * hw, qy + dy * len - dx * hw); c.closePath(); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(qx, qy, 3.5 * px, 0, Math.PI * 2); c.fill(); c.lineWidth = 1.5 * px; c.stroke();
      c.font = `800 ${Math.round(11 * px)}px Archivo, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const lx = qx + u[0] * sgn * 11 * px, ly = qy - u[1] * sgn * 11 * px;
      c.lineWidth = 3 * px; c.strokeStyle = '#000'; c.strokeText(t, lx, ly); c.fillStyle = '#fff'; c.fillText(t, lx, ly);
    });
    c.restore();
  }

  let vecDirty = true;
  function compose(lite) {                                           // lite: GIS only changed, keep the terrain raster
    if (vecDirty) { drawVector(); vecDirty = false; }
    if (!lite) drawRaster();
    if (gisDirty || gisAnimating()) { drawGis(performance.now() / 1000); gisDirty = false; }
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
    tctx.fillStyle = '#000'; tctx.fillRect(0, 0, tex.width, tex.height);
    tctx.drawImage(ras, 0, 0, tex.width, tex.height);
    if (S.layers.img && IMG) { tctx.globalAlpha = S.imgOp; tctx.drawImage(IMG, 0, 0, tex.width, tex.height); tctx.globalAlpha = 1; }
    if (S.layers.gis && S.gis.length) tctx.drawImage(gis, 0, 0);
    tctx.drawImage(vec, 0, 0);
    drawCut(tctx);
    views.forEach(v => v.texUpdate());
    ensureAnim();
  }

  // ---------------------------------------------------------------- mapping: plan point + height → screen
  function homography(src, dst) {
    const M = [], b = [];
    for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i]; M.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); M.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
    for (let i = 0; i < 8; i++) {                                    // Gaussian elimination with pivoting
      let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < 8; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < 8; c++) M[r][c] -= f * M[i][c]; b[r] -= f * b[i]; }
    }
    const h = new Array(8);
    for (let i = 7; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < 8; c++) s -= M[i][c] * h[c]; h[i] = s / M[i][i]; }
    return h.concat(1);
  }
  const applyH = (h, x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
  function mapper(wpx, hpx) {
    const c = cal(), base = [[A.x0, A.y0], [A.x0 + A.w, A.y0], [A.x0 + A.w, A.y0 + A.h], [A.x0, A.y0 + A.h]];
    const Hm = homography(base, c.corners.map(([u, v]) => [u * wpx, v * hpx]));
    const cx = A.x0 + A.w / 2 + c.nx / K(), cy = A.y0 + A.h / 2 + c.ny / K(), hh = Math.max(50, c.h);   // offsets are real mm on the table
    return (x, y, z) => { const s = hh / Math.max(1, hh - z); return applyH(Hm, cx + (x - cx) * s, cy + (y - cy) * s); };
  }

  // ---------------------------------------------------------------- a view: three.js warp + 2D overlay for handles
  const views = [];
  function View(canvas, overlay, wrap) {
    const R = new THREE.WebGLRenderer({ canvas, antialias: true }); R.setClearColor(0x000000, 1);
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    const t3 = new THREE.CanvasTexture(tex); t3.minFilter = THREE.LinearFilter; t3.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: t3, side: THREE.DoubleSide });
    let mesh = null, wpx = 1, hpx = 1, MX = 0, MY = 0;
    const oc = overlay.getContext('2d');
    function build() {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      MX = A.w >= A.h ? 140 : Math.max(8, Math.round(140 * A.w / A.h)); MY = A.w >= A.h ? Math.max(8, Math.round(140 * A.h / A.w)) : 140;
      const g = new THREE.BufferGeometry(), pos = new Float32Array((MX + 1) * (MY + 1) * 3), uv = new Float32Array((MX + 1) * (MY + 1) * 2), idx = [];
      for (let j = 0; j <= MY; j++) for (let i = 0; i <= MX; i++) { const k = j * (MX + 1) + i; uv[k * 2] = i / MX; uv[k * 2 + 1] = j / MY; }
      for (let j = 0; j < MY; j++) for (let i = 0; i < MX; i++) { const a = j * (MX + 1) + i, b = a + 1, c = a + MX + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      mesh = new THREE.Mesh(g, mat); scene.add(mesh);
      // heights at the mesh vertices
      mesh.userData.z = new Float32Array((MX + 1) * (MY + 1));
      for (let j = 0; j <= MY; j++) for (let i = 0; i <= MX; i++) mesh.userData.z[j * (MX + 1) + i] = zmm(A, heightAt(A, A.x0 + i / MX * A.w, A.y0 + j / MY * A.h));
      warp();
    }
    function warp() {
      if (!mesh) return;
      const f = mapper(wpx, hpx), pos = mesh.geometry.attributes.position.array, z = mesh.userData.z;
      for (let j = 0; j <= MY; j++) for (let i = 0; i <= MX; i++) { const k = j * (MX + 1) + i, [sx, sy] = f(A.x0 + i / MX * A.w, A.y0 + j / MY * A.h, z[k]); pos[k * 3] = sx; pos[k * 3 + 1] = sy; }
      mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.computeBoundingSphere();
      draw();
    }
    function resize() {
      const r = wrap.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      wpx = Math.max(2, Math.round(r.width * dpr)); hpx = Math.max(2, Math.round(r.height * dpr));
      R.setSize(wpx, hpx, false); overlay.width = wpx; overlay.height = hpx;
      cam.left = 0; cam.right = wpx; cam.top = 0; cam.bottom = hpx; cam.updateProjectionMatrix();
      warp();
    }
    function draw() { R.render(scene, cam); handles(); }
    function handles() {
      oc.clearRect(0, 0, wpx, hpx);
      if (!S.layers.cal) { overlay.style.pointerEvents = 'none'; return; }
      overlay.style.pointerEvents = 'auto';
      const c = cal(), r = Math.max(9, Math.min(wpx, hpx) * 0.018), f = mapper(wpx, hpx);
      c.corners.forEach(([u, v], i) => {
        const x = u * wpx, y = v * hpx;
        oc.strokeStyle = '#ff9a00'; oc.lineWidth = Math.max(2, r * 0.22); oc.beginPath(); oc.arc(x, y, r, 0, 7); oc.stroke();
        oc.beginPath(); oc.moveTo(x - r * 1.6, y); oc.lineTo(x + r * 1.6, y); oc.moveTo(x, y - r * 1.6); oc.lineTo(x, y + r * 1.6); oc.stroke();
        oc.fillStyle = '#ff9a00'; oc.font = `600 ${Math.round(r * 1.1)}px "IBM Plex Mono", monospace`; oc.fillText(['SW', 'SE', 'NE', 'NW'][i], x + r * 1.3, y - r * 1.1);
      });
      A.pins.forEach((p, i) => {                                   // crosshairs where the highest points should land
        const [x, y] = f(p.x, p.y, zmm(A, p.hm));
        oc.strokeStyle = '#ff2a2a'; oc.lineWidth = Math.max(2, r * 0.2);
        oc.beginPath(); oc.moveTo(x - r * 2, y); oc.lineTo(x + r * 2, y); oc.moveTo(x, y - r * 2); oc.lineTo(x, y + r * 2); oc.stroke();
        oc.beginPath(); oc.arc(x, y, r * 0.6, 0, 7); oc.stroke();
        oc.fillStyle = '#ff2a2a'; const t = i ? `high point ${i + 1}` : 'highest point', tw = oc.measureText(t).width, flip = x + r * 1.2 + tw > oc.canvas.width - 4, up = y + r * 2.4 > oc.canvas.height - 4;
        oc.fillText(t, flip ? x - r * 1.2 - tw : x + r * 1.2, up ? y - r * 1.6 : y + r * 2.4);
      });
    }
    // drag corners (in either window)
    let dragI = -1, lastI = 0;
    overlay.addEventListener('pointerdown', e => {
      if (!S.layers.cal) return;
      const b = overlay.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height, c = cal();
      let best = -1, bd = 1e9; c.corners.forEach(([u, v], i) => { const d = Math.hypot((u - x) * b.width, (v - y) * b.height); if (d < bd) { bd = d; best = i; } });
      if (bd < 60) { dragI = lastI = best; overlay.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    overlay.addEventListener('pointermove', e => {
      if (dragI < 0) return;
      const b = overlay.getBoundingClientRect(); cal().corners[dragI] = [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
      calChanged();
    });
    overlay.addEventListener('pointerup', () => { if (dragI >= 0) { dragI = -1; calChanged(true); } });
    const nudge = (dx, dy) => { const c = cal(); c.corners[lastI] = [c.corners[lastI][0] + dx / wpx, c.corners[lastI][1] + dy / hpx]; calChanged(true); };
    new ResizeObserver(resize).observe(wrap);
    const v = { build, warp, draw, resize, nudge, texUpdate() { t3.needsUpdate = true; draw(); } };
    views.push(v); return v;
  }

  // ---------------------------------------------------------------- changes and sync
  let syncT = 0;
  function calChanged(final) { views.forEach(v => v.warp()); showCal(); if (final) { save(); } clearTimeout(syncT); syncT = setTimeout(() => send({ t: 'state', s: S }), final ? 0 : 30); }
  function rebuild() { A = area(); sizeTex(); vecDirty = true; gisDirty = true; compose(); views.forEach(v => v.build()); showArea(); }
  function changed(what) {                                         // what: 'area' | 'vec' | 'ras' | 'geo' | 'gis'
    if (what === 'area') rebuild();
    else if (what === 'gis') { gisDirty = true; compose(true); }
    else { if (what === 'vec') vecDirty = true; if (what === 'geo') views.forEach(v => v.build()); compose(); }
    save(); send({ t: 'state', s: S }); syncUI();
  }
  if (ch) ch.onmessage = ({ data: m }) => {
    if (m.t === 'state') {
      const areaChanged = m.s.area !== S.area || m.s.base !== S.base || m.s.vex !== S.vex || m.s.aspect !== S.aspect || m.s.scale !== S.scale;
      const vecChanged = ['cont', 'feat', 'cal'].some(k => m.s.layers[k] !== S.layers[k]) || m.s.ci !== S.ci;
      const gisChanged = JSON.stringify(m.s.gis) !== JSON.stringify(S.gis) || JSON.stringify(m.s.gisPlace) !== JSON.stringify(S.gisPlace) || m.s.layers.gis !== S.layers.gis;
      const s2 = JSON.parse(JSON.stringify(m.s));
      Object.assign(S.layers, s2.layers); delete s2.layers;           // keep the same layers object: the controls hold it
      Object.assign(S, s2);
      if (gisChanged) { gisDirty = true; [...RAW.keys()].forEach(id => { if (!S.gis.some(s => s.id === id)) { RAW.delete(id); CONV.delete(id); } }); loadMissing(); }
      if (areaChanged) rebuild(); else { if (vecChanged) vecDirty = true; compose(); views.forEach(v => v.warp()); }
      syncUI(); if (gisChanged && !OUT) { renderGis(); showPlace(); }
    } else if (m.t === 'img') { loadImg(m.d, false); }
    else if (m.t === 'gisAdd') { RAW.set(m.id, m.raw); CONV.delete(m.id); gisDirty = true; compose(true); }
    else if (m.t === 'hello' && !OUT) { if (m.aspect) { S.aspect = +m.aspect.toFixed(4); setAspect(); } send({ t: 'state', s: S }); if (IMG) send({ t: 'img', d: IMG.src }); RAW.forEach((raw, id) => send({ t: 'gisAdd', id, raw })); link(true); }
    else if (m.t === 'bye' && !OUT) link(false);
    else if (m.t === 'ping' && OUT) send({ t: 'hello', aspect: innerWidth / Math.max(1, innerHeight) });
  };
  function loadImg(src, broadcast) {
    if (!src) { IMG = null; compose(); return; }
    const im = new Image(); im.onload = () => { IMG = im; compose(); if (broadcast) send({ t: 'img', d: src }); }; im.src = src;
  }

  // ---------------------------------------------------------------- projector window
  if (OUT) {
    const st = $('outStage'); st.hidden = false;
    const v = View($('out'), $('outOv'), st);
    rebuild(); loadMissing();
    const hello = () => send({ t: 'hello', aspect: innerWidth / Math.max(1, innerHeight) });
    hello(); addEventListener('resize', () => { hello(); });
    addEventListener('beforeunload', () => send({ t: 'bye' }));
    let quiet; const wake = () => { st.classList.remove('quiet'); clearTimeout(quiet); quiet = setTimeout(() => st.classList.add('quiet'), 2500); }; wake(); addEventListener('pointermove', wake);
    addEventListener('keydown', e => keys(e, v, () => document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { })));
    const showCalCls = () => st.classList.toggle('cal', !!S.layers.cal);
    showCalCls(); setInterval(showCalCls, 400);
    return;
  }

  // ---------------------------------------------------------------- control window
  const pv = View($('pv'), $('pvOv'), $('pvWrap'));
  const setAspect = () => { $('pvWrap').style.aspectRatio = String(S.aspect); const sel = $('pAspect'); if ([...sel.options].some(o => Math.abs(+o.value - S.aspect) < 0.01)) sel.value = [...sel.options].find(o => Math.abs(+o.value - S.aspect) < 0.01).value; };
  let outWin = null;
  function link(on) { $('link').textContent = on ? 'Projector window connected' : 'No projector window yet'; $('link').dataset.on = on ? '1' : '0'; }
  $('openOut').onclick = () => { outWin = window.open('project.html?out', 'sitekit-projector', 'popup,width=960,height=600'); };
  $('fullHere').onclick = () => { const el = $('pvWrap'); (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => { }); };
  function keys(e, v, full) {
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); full(); }
    else if (k === 'c') { S.layers.cal = !S.layers.cal; changed('vec'); }
    else if (S.layers.cal && e.key.startsWith('Arrow')) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; v.nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0); }
  }
  addEventListener('keydown', e => keys(e, pv, () => $('fullHere').click()));

  const L = S.layers;
  const bindCheck = (id, k, kind) => { $(id).checked = !!L[k]; $(id).onchange = e => { L[k] = e.target.checked; changed(kind); }; };
  bindCheck('lElev', 'elev', 'ras'); bindCheck('lHill', 'hill', 'ras'); bindCheck('lCont', 'cont', 'vec'); bindCheck('lSlope', 'slope', 'ras');
  bindCheck('lFeat', 'feat', 'vec'); bindCheck('lFlood', 'flood', 'ras'); bindCheck('lSun', 'sun', 'ras'); bindCheck('lImg', 'img', 'ras'); bindCheck('lCal', 'cal', 'vec');
  bindCheck('lGis', 'gis', 'gis'); bindCheck('lSect', 'sect', 'gis'); bindCheck('lSectDim', 'sectDim', 'gis');
  function showCut() {
    const el = $('oSect'); if (!el) return;
    if (!CUT) { el.textContent = 'none yet'; return; }
    const L = Math.hypot(CUT.B[0] - CUT.A[0], CUT.B[1] - CUT.A[1]), v = [-(CUT.B[1] - CUT.A[1]) / (L || 1) * CUT.look, (CUT.B[0] - CUT.A[0]) / (L || 1) * CUT.look];
    const a = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
    el.textContent = `${L.toFixed(0)} m, looking ${compass(a)}`;
  }
  $('pArea').value = S.area; $('pArea').onchange = e => { S.area = e.target.value; changed('area'); };
  $('pBase').value = S.base; $('pBase').onchange = e => { S.base = +e.target.value; changed('geo'); };
  $('pVex').value = S.vex; $('pVex').onchange = e => { S.vex = +e.target.value; changed('geo'); };
  $('pScale').value = String(S.scale || 200); $('pScale').onchange = e => { S.scale = +e.target.value; changed('area'); };
  $('pCI').value = S.ci; $('pCI').onchange = e => { S.ci = +e.target.value; changed('vec'); };
  $('pFlood').value = Math.round(S.flood * 1000); $('pFlood').oninput = e => { S.flood = +e.target.value / 1000; if (!L.flood) { L.flood = true; $('lFlood').checked = true; } changed('ras'); };
  $('pDate').value = S.date; $('pDate').onchange = e => { S.date = e.target.value || today; if (!L.sun) { L.sun = true; $('lSun').checked = true; } changed('ras'); };
  $('pTime').value = Math.round(S.time * 1000); $('pTime').oninput = e => { S.time = +e.target.value / 1000; if (!L.sun) { L.sun = true; $('lSun').checked = true; } changed('ras'); };
  $('pImgOp').value = Math.round(S.imgOp * 100); $('pImgOp').oninput = e => { S.imgOp = +e.target.value / 100; changed('ras'); };
  $('pImg').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { L.img = true; $('lImg').checked = true; loadImg(rd.result, true); save(); send({ t: 'state', s: S }); }; rd.readAsDataURL(f); };
  let playT = 0;
  $('pPlay').onclick = () => {
    if (playT) { cancelAnimationFrame(playT); playT = 0; $('pPlay').textContent = 'Play the day'; return; }
    L.sun = true; $('lSun').checked = true; $('pPlay').textContent = 'Stop';
    let t0 = performance.now(), from = S.time > 0.9 ? 0 : S.time, last = 0;
    const step = now => {
      S.time = Math.min(1, from + (now - t0) / 20000);
      if (now - last > 90) { last = now; $('pTime').value = Math.round(S.time * 1000); compose(); syncUI(); send({ t: 'state', s: S }); }
      if (S.time < 1) playT = requestAnimationFrame(step); else { playT = 0; $('pPlay').textContent = 'Play the day'; save(); }
    };
    playT = requestAnimationFrame(step);
  };
  const calInputs = () => { const c = cal(); $('pH').value = c.h; $('pNx').value = c.nx; $('pNy').value = c.ny; };
  ['pH', 'pNx', 'pNy'].forEach(id => $(id).oninput = e => { const c = cal(); c[{ pH: 'h', pNx: 'nx', pNy: 'ny' }[id]] = +e.target.value; calChanged(true); });
  $('pReset').onclick = () => { cal().corners = defaultCorners(); calChanged(true); };
  $('pAspect').onchange = e => { S.aspect = +e.target.value; setAspect(); changed('area'); };

  function showCal() {
    if (OUT) return;
    const c = cal();
    $('oH').textContent = `${c.h} mm`; $('oNx').textContent = `${c.nx > 0 ? '+' : ''}${c.nx} mm`; $('oNy').textContent = `${c.ny > 0 ? '+' : ''}${c.ny} mm`;
    $('specH').textContent = `${c.h} mm`;
  }
  function showArea() {
    if (OUT) return;
    const relief = (A.hi - A.datum) * 1000 / (+S.scale || 200) * S.vex + S.base, k = K();
    $('areaNote').textContent = `Projecting onto ${A.label}: ${Math.round(A.w * k)} × ${Math.round(A.h * k)} mm at 1:${S.scale || 200} (${Math.round(A.w / 5)} × ${Math.round(A.h / 5)} m), up to ${relief.toFixed(0)} mm high. The projected image must be at least this big on the table.`;
    calInputs(); showCal();
  }
  function syncUI() {
    if (OUT) return;
    Object.entries({ lElev: 'elev', lHill: 'hill', lCont: 'cont', lSlope: 'slope', lFeat: 'feat', lFlood: 'flood', lSun: 'sun', lImg: 'img', lCal: 'cal', lGis: 'gis', lSect: 'sect', lSectDim: 'sectDim' }).forEach(([id, k]) => $(id).checked = !!L[k]);
    $('oFlood').textContent = L.flood ? `${G.fmt(A.lo + S.flood * (A.hi - A.lo))} m` : '—';
    if (L.sun) { const s = sunNow(); $('oSun').textContent = s.alt > 0 ? `${hhmm(s.hrs)} · ${s.alt.toFixed(0)}° from the ${compass(s.az)}` : `${hhmm(s.hrs)} · below the horizon`; } else $('oSun').textContent = '—';
    $('specOut').textContent = { 1.6: '1920 × 1200', 1.7778: '1920 × 1080', 1.3333: '1024 × 768' }[S.aspect] || `${S.aspect.toFixed(2)} : 1`;
  }
  // ---------------------------------------------------------------- GIS layers: loading, list, placement
  const EPSG_NAME = { 4326: 'lon/lat', 2157: 'ITM', 29903: 'Irish Grid', 29902: 'Irish Grid', 3857: 'Web Mercator', site: 'site metres', 27700: 'British National Grid' };
  const epsgName = e => EPSG_NAME[e] || 'EPSG ' + e;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gmsg = (t, k) => { const el = $('gMsg'); el.hidden = !t; el.textContent = t || ''; el.dataset.k = k || 'ok'; };
  async function addLayer(p, name, url) {
    if (!p.feats.length) throw new Error(`${name}: no features in it.`);
    const pc = S.gisPlace.crs, fallback = pc === 'auto' ? null : pc === 'site' ? 'site' : +pc;
    const epsg = p.epsg || fallback || GL.guessEpsg(p.feats, pack.source && pack.source.epsg);
    const kind = GL.kindOf(p.feats);
    const st = {
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, on: true,
      color: GL.COLOURS[S.gis.length % GL.COLOURS.length], width: kind === 'line' ? 2.5 : kind === 'point' ? 2.5 : 1,
      op: 0.9, fill: true, by: '', anim: false, kind, props: GL.props(p.feats), count: p.feats.length, epsg, url: url || ''
    };
    RAW.set(st.id, p.feats);
    let kept = true; try { await GL.store.put(gisKey(st.id), p.feats); } catch (e) { kept = false; }
    S.gis.unshift(st);
    send({ t: 'gisAdd', id: st.id, raw: p.feats });
    changed('gis'); renderGis();
    const c = convFor(st);
    if (c.err) return gmsg(`${name}: ${c.err}`, 'err');
    const on = c.conv.inside, o = gisOrigin();
    gmsg(`${name}: ${on.toLocaleString()} of ${c.conv.total.toLocaleString()} features fall on the model (read as ${epsgName(epsg)}).` +
      (!on ? ' None land on the model: check the coordinates under Where the data sits, or the layer\'s own coordinate setting.' : o && o.approx && epsg !== 'site' ? ' The site\'s map position is estimated: type its south-west corner for an exact fit.' : '') +
      (kept ? '' : ' This browser could not keep it, so it will be gone after a reload.'), !on ? 'warn' : o && o.approx && epsg !== 'site' ? 'warn' : 'ok');
  }
  $('gFile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      try { gmsg(`Reading ${f.name}…`); await addLayer(GL.parse(await f.text()), f.name.replace(/\.(geo)?json$/i, ''), ''); }
      catch (er) { gmsg(`${f.name}: ${er.message}`, 'err'); }
    }
  };
  $('gUrlGo').onclick = async () => {
    const url = $('gUrl').value.trim(); if (!url) return;
    $('gUrlGo').disabled = true; gmsg('Loading…');
    try {
      const o = gisOrigin(), b = o ? GL.boundsLL(o, G, S.gisPlace) : null;
      const p = await GL.fetchLayer(url, b, n => gmsg(`Loading… ${n.toLocaleString()} features so far`));
      await addLayer(p, p.name, url); $('gUrl').value = '';
    } catch (er) { gmsg(er.message, 'err'); }
    $('gUrlGo').disabled = false;
  };
  $('gUrl').onkeydown = e => { if (e.key === 'Enter') $('gUrlGo').click(); };

  function renderGis() {
    const box = $('gList'); box.innerHTML = '';
    S.gis.forEach((st, i) => {
      const c = convFor(st), cls = c && c.conv ? GL.legendFor(c.conv, st.by) : null;
      const row = document.createElement('div'); row.className = 'pj-gl'; row.dataset.on = st.on ? '1' : '0';
      const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
      row.innerHTML = `
        <div class="pj-gh"><input type="checkbox" data-k="on"${st.on ? ' checked' : ''} aria-label="Show ${esc(st.name)}">
          <input type="color" data-k="color" value="${esc(st.color)}" aria-label="Colour"${st.by ? ' disabled' : ''}>
          <span class="pj-gn" title="${esc(st.name)}${st.url ? '\n' + esc(st.url) : ''} · double-click to rename">${esc(st.name)}</span>
          <span class="pj-gb"><button type="button" data-a="up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button type="button" data-a="down" aria-label="Move down"${i < S.gis.length - 1 ? '' : ' disabled'}>↓</button><button type="button" data-a="del" class="danger" aria-label="Remove">✕</button></span></div>
        <div class="pj-gmeta">${{ line: 'lines', poly: 'areas', point: 'points', mixed: 'mixed' }[st.kind] || ''} · ${c && c.conv ? `${c.conv.inside.toLocaleString()} of ${c.conv.total.toLocaleString()} on the model${c.conv.inside ? '' : ' <b>· none on the model</b>'}` : !RAW.has(st.id) ? '<b>not in this browser: load the file again</b>' : `<b>${esc(c.err)}</b>`}</div>
        <div class="pj-gopts">
          <label title="Line width or point size on the model">${st.kind === 'poly' ? 'Outline' : st.kind === 'point' ? 'Size' : 'Width'} <input type="range" data-k="width" min="0.2" max="6" step="0.1" value="${st.width}"></label>
          <label>Strength <input type="range" data-k="op" min="0.1" max="1" step="0.05" value="${st.op}"></label>
          <label class="wide">Colour by <select data-k="by">${opt('', 'one colour', !st.by)}${(st.props || []).map(k => opt(k, k, st.by === k)).join('')}</select></label>
          <label class="wide">Coordinates <select data-k="epsg">${[4326, 2157, 29903, 3857, 'site'].concat([4326, 2157, 29903, 3857, 'site'].includes(st.epsg) ? [] : [st.epsg]).map(e => opt(e, epsgName(e), String(e) === String(st.epsg))).join('')}</select></label>
          <label><input type="checkbox" data-k="anim"${st.anim ? ' checked' : ''}> ${st.kind === 'line' ? 'Animate' : 'Pulse'}</label>
          ${st.kind === 'poly' || st.kind === 'mixed' ? `<label><input type="checkbox" data-k="fill"${st.fill !== false ? ' checked' : ''}> Fill</label>` : ''}
        </div>
        ${cls ? `<div class="pj-leg">${cls.legend.map(([col, t]) => `<span title="${esc(t)}"><i style="--c:${col}"></i>${esc(t)}</span>`).join('')}</div>` : ''}`;
      row.querySelectorAll('[data-k]').forEach(el => {
        const k = el.dataset.k, live = el.type === 'range' || el.type === 'color';
        el[live ? 'oninput' : 'onchange'] = () => {
          st[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : k === 'epsg' ? (el.value === 'site' ? 'site' : +el.value) : el.value;
          if (k === 'on') row.dataset.on = st.on ? '1' : '0';
          changed('gis');
          if (k === 'by' || k === 'epsg') renderGis();
        };
      });
      row.querySelector('.pj-gn').ondblclick = () => { const n = prompt('Layer name', st.name); if (n && n.trim()) { st.name = n.trim(); changed('gis'); renderGis(); } };
      row.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'del') { if (!confirm(`Remove ${st.name} from this site?`)) return; S.gis.splice(i, 1); RAW.delete(st.id); CONV.delete(st.id); GL.store.del(gisKey(st.id)).catch(() => { }); }
        else { const j = a === 'up' ? i - 1 : i + 1; [S.gis[i], S.gis[j]] = [S.gis[j], S.gis[i]]; }
        changed('gis'); renderGis();
      });
      box.appendChild(row);
    });
  }

  // where the data sits: the survey's south-west corner on the map, and small corrections
  function showPlace() {
    const o = gisOrigin(), src = pack.source || {}, packGeo = src.type === 'geotiff' && src.origin;
    $('gCrs').value = S.gisPlace.crs;
    $('gE').value = S.gisPlace.E; $('gN').value = S.gisPlace.N; $('gDx').value = S.gisPlace.dx; $('gDy').value = S.gisPlace.dy; $('gRot').value = S.gisPlace.rot;
    const def = (() => { const save = [S.gisPlace.E, S.gisPlace.N]; S.gisPlace.E = S.gisPlace.N = ''; const d = gisOrigin(); [S.gisPlace.E, S.gisPlace.N] = save; return d; })();
    $('gE').placeholder = def ? def.E.toFixed(0) : 'easting'; $('gN').placeholder = def ? def.N.toFixed(0) : 'northing';
    const sys = o ? epsgName(o.epsg) : 'ITM';
    $('gOrigNote').textContent = !o ? 'This site has no map position yet: type the easting and northing (ITM) of the survey\'s south-west corner.'
      : o.source === 'pack' ? `From the site's survey: the south-west corner is E ${o.E.toFixed(1)}, N ${o.N.toFixed(1)} (${sys}). Leave the boxes empty to use it.`
      : o.source === 'typed' ? `Using the corner you typed (${sys}). Empty both boxes to go back to ${packGeo || pack.geo ? 'the survey' : 'the estimate'}.`
      : `Estimated from the site's latitude and longitude (${(+pack.lat).toFixed(4)}, ${(+pack.lon).toFixed(4)}), so it can be tens of metres out. Type the ITM easting and northing of the survey's south-west corner for an exact fit, then use the nudges.`;
    const tweak = +S.gisPlace.dx || +S.gisPlace.dy || +S.gisPlace.rot ? ' · nudged' : '';
    $('gPlaceSum').textContent = (!o ? 'not set' : o.source === 'pack' ? 'from the survey tiles' : o.source === 'typed' ? 'typed in' : 'estimated') + tweak;
  }
  const placeChanged = () => { CONV.clear(); changed('gis'); showPlace(); renderGis(); };
  $('gCrs').onchange = e => { S.gisPlace.crs = e.target.value; save(); send({ t: 'state', s: S }); };
  [['gE', 'E'], ['gN', 'N']].forEach(([id, k]) => $(id).onchange = e => { S.gisPlace[k] = e.target.value === '' ? '' : +e.target.value; placeChanged(); });
  [['gDx', 'dx'], ['gDy', 'dy'], ['gRot', 'rot']].forEach(([id, k]) => $(id).onchange = e => { S.gisPlace[k] = +e.target.value || 0; placeChanged(); });
  if (gisOrigin()?.approx && S.gis.length) $('gPlace').open = true;
  if (!GL) $('gisGroup').hidden = true;

  setAspect(); rebuild(); syncUI(); link(false);
  showPlace(); loadMissing(); renderGis(); showCut();
  send({ t: 'state', s: S }); send({ t: 'ping' });
})();
