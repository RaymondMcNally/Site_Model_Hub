/* Sun position (NOAA solar calculator equations) + terrain shadow tools, for whichever site is open. */
let LAT = 53.35, LON = -7.0, TZ = 'Europe/Dublin';
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// offset of the site's time zone from UTC (hours) at a moment, using the browser's time zone data
let tzFmt = null;
function tzOffset(ms) {
  try {
    if (!tzFmt) tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const o = {}; tzFmt.formatToParts(new Date(ms)).forEach(p => o[p.type] = +p.value);
    return Math.round((Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute) - Math.floor(ms / 60000) * 60000) / 60000) / 60;
  } catch (e) { return 0; }
}
function solar(ms) {                                  // ms = UTC epoch → {alt, az} in degrees, az clockwise from north
  const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(om));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos(rad(om));
  const dec = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lam))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqt = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const d = new Date(ms), mins = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let tst = (mins + eqt + 4 * LON) % 1440; if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180; if (ha < -180) ha += 360;
  const cz = Math.sin(rad(LAT)) * Math.sin(rad(dec)) + Math.cos(rad(LAT)) * Math.cos(rad(dec)) * Math.cos(rad(ha));
  const zen = deg(Math.acos(Math.max(-1, Math.min(1, cz))));
  let az = deg(Math.atan2(Math.sin(rad(ha)), Math.cos(rad(ha)) * Math.sin(rad(LAT)) - Math.tan(rad(dec)) * Math.cos(rad(LAT)))) + 180;
  az = (az + 360) % 360;
  return { alt: 90 - zen, az, dec, eqt };
}
// site wall-clock → UTC ms
function localToUTC(y, m, d, hours) {
  const wall = Date.UTC(y, m, d) + hours * 3600e3; let t = wall - tzOffset(wall) * 3600e3;
  const o2 = tzOffset(t); return wall - o2 * 3600e3;
}
// sunrise / sunset in local hours (apparent, refraction 0.833°)
function riseSet(y, m, d) {
  let rise = null, set = null, noon = null, best = -99;
  let prev = solar(localToUTC(y, m, d, 0)).alt;
  for (let h = 1 / 60; h <= 24; h += 1 / 60) {
    const a = solar(localToUTC(y, m, d, h)).alt;
    if (prev < -0.833 && a >= -0.833) rise = h;
    if (prev >= -0.833 && a < -0.833) set = h;
    if (a > best) { best = a; noon = h; }
    prev = a;
  }
  return { rise, set, noon, maxAlt: best };
}
const hhmm = h => h == null ? '—' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
if (typeof module !== 'undefined') module.exports = { solar, riseSet, localToUTC, hhmm };

(async function () {
  if (typeof window === 'undefined') return;
  const G = await window.loadSite('sun.html'); if (!G) return;
  const { css, $, W, H, GW, GH, ST, at, Plan, pack } = G;
  LAT = +pack.lat; LON = +pack.lon; TZ = pack.tz || 'Europe/Dublin'; tzFmt = null;
  fillSite(G);
  const YEAR = new Date().getFullYear(), CS = G.cs, NORTH = G.north;
  {
    const su = riseSet(YEAR, 5, 21), wi = riseSet(YEAR, 11, 21), put = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    put('spLat', `${Math.abs(LAT).toFixed(2)}° ${LAT >= 0 ? 'N' : 'S'}`); put('spLon', `${Math.abs(LON).toFixed(2)}° ${LON >= 0 ? 'E' : 'W'}`);
    put('spSum', `${su.maxAlt.toFixed(0)}° high`); put('spWin', `${wi.maxAlt.toFixed(0)}° high`);
    put('spLong', `${hhmm(su.rise)}–${hhmm(su.set)}`); put('spShort', `${hhmm(wi.rise)}–${hhmm(wi.set)}`);
    document.querySelectorAll('[data-site="tz"]').forEach(el => el.textContent = TZ.replace(/_/g, ' '));
  }
  const MAXH = (() => { let m = -1e9; for (const v of G.Hm) if (v === v && v > m) m = v; return m; })();

  // ---------- state
  const dateIn = $('sunDate'), timeIn = $('sunTime');
  let mode = 'shadow', hoursCache = {};
  const dOY = n => { const d = new Date(Date.UTC(YEAR, 0, 1) + (n - 1) * 86400e3); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
  const label = n => { const [y, m, d] = dOY(n); return new Date(Date.UTC(y, m, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
  const doy = (m, d) => Math.round((Date.UTC(YEAR, m, d) - Date.UTC(YEAR, 0, 1)) / 86400e3) + 1;
  const today = new Date(); dateIn.value = doy(today.getMonth(), today.getDate());
  document.querySelectorAll('[data-day="today"]').forEach(b => b.dataset.day = `${today.getMonth() + 1}-${today.getDate()}`);

  // ---------- shadow raster (1 m grid)
  const off = document.createElement('canvas'); off.width = GW; off.height = GH;
  const octx = off.getContext('2d'), img = octx.createImageData(GW, GH);
  function lit(i, j, sx, sy, tanA) {                     // true if cell (i,j) sees the sun
    const h0 = at(i, j); let x = j, y = i, z = h0 + 0.05;
    for (let k = 1; k < 2000; k++) {
      x += sx; y += sy; z += tanA * CS;
      if (z > MAXH) return true;
      const jj = Math.round(x), ii = Math.round(y);
      if (ii < 0 || jj < 0 || ii >= GH || jj >= GW) return true;
      const h = at(ii, jj); if (h !== h) return true;
      if (h > z) return false;
    }
    return true;
  }
  function sunVec(alt, az) { const a = rad(az + NORTH); return { sx: Math.sin(a), sy: Math.cos(a), tanA: Math.tan(rad(alt)) }; }
  function paintShadow(alt, az) {
    const D = img.data; D.fill(0);
    const ink = css('--ink'); const dark = G.isDark();
    const sh = dark ? [0, 0, 0, 150] : [20, 28, 45, 120];
    if (alt <= 0) { for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) if (at(i, j) === at(i, j)) { const k = ((GH - 1 - i) * GW + j) * 4; D[k] = sh[0]; D[k + 1] = sh[1]; D[k + 2] = sh[2]; D[k + 3] = 170; } }
    else {
      const { sx, sy, tanA } = sunVec(alt, az);
      for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
        if (at(i, j) !== at(i, j)) continue;
        if (!lit(i, j, sx, sy, tanA)) { const k = ((GH - 1 - i) * GW + j) * 4; D[k] = sh[0]; D[k + 1] = sh[1]; D[k + 2] = sh[2]; D[k + 3] = sh[3]; }
      }
    }
    octx.putImageData(img, 0, 0);
  }
  function paintHours(n) {
    if (!hoursCache[n]) {
      const [y, m, d] = dOY(n), rs = riseSet(y, m, d), S = 2, step = 0.25;
      const cnt = new Float32Array(GW * GH);
      for (let h = Math.ceil((rs.rise ?? 0) / step) * step; h <= (rs.set ?? 24); h += step) {
        const p = solar(localToUTC(y, m, d, h)); if (p.alt <= 0) continue;
        const { sx, sy, tanA } = sunVec(p.alt, p.az);
        for (let i = 0; i < GH; i += S) for (let j = 0; j < GW; j += S) if (at(i, j) === at(i, j) && lit(i, j, sx, sy, tanA)) cnt[i * GW + j] += step;
      }
      hoursCache[n] = { cnt, max: (rs.set - rs.rise) || 1 };
    }
    const { cnt, max } = hoursCache[n], D = img.data; D.fill(0);
    const lo = [38, 52, 80], hi = [242, 177, 52];
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
      if (at(i, j) !== at(i, j)) continue;
      const v = cnt[(i - i % 2) * GW + (j - j % 2)] / max, k = ((GH - 1 - i) * GW + j) * 4;
      D[k] = lo[0] + (hi[0] - lo[0]) * v; D[k + 1] = lo[1] + (hi[1] - lo[1]) * v; D[k + 2] = lo[2] + (hi[2] - lo[2]) * v; D[k + 3] = 170;
    }
    octx.putImageData(img, 0, 0);
  }
  function paintAspect() {
    const D = img.data; D.fill(0);
    const cols = { N: [70, 110, 160], E: [140, 170, 120], S: [235, 170, 60], W: [200, 120, 90] };
    for (let i = 1; i < GH - 1; i++) for (let j = 1; j < GW - 1; j++) {
      const h = at(i, j); if (h !== h) continue;
      const dx = (at(i, j + 1) - at(i, j - 1)) / 2, dy = (at(i + 1, j) - at(i - 1, j)) / 2;
      if (dx !== dx || dy !== dy) continue;
      const slope = Math.hypot(dx, dy) / CS, k = ((GH - 1 - i) * GW + j) * 4;
      if (slope < 1 / 20) { D[k] = 200; D[k + 1] = 200; D[k + 2] = 195; D[k + 3] = 60; continue; }
      const az = (deg(Math.atan2(-dx, -dy)) - NORTH + 720) % 360;   // true bearing the slope faces (downhill)
      const c = az < 45 || az >= 315 ? cols.N : az < 135 ? cols.E : az < 225 ? cols.S : cols.W;
      D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; D[k + 3] = Math.min(200, 70 + slope * 300);
    }
    octx.putImageData(img, 0, 0);
  }

  // ---------- plan
  const P = Plan($('sunPlan'));
  let cur = null;
  P.draw = () => {
    const c = P.ctx;
    P.base({ contourAlpha: 0.6, shadeAlpha: 0.75, labels: true });
    c.imageSmoothingEnabled = true; c.drawImage(off, P.X(0), P.Y(H), W * P.s, H * P.s);
    P.features({ alpha: 0.8, tags: 'focus' });
    if (mode === 'shadow' && cur && cur.alt > 0) {            // sun direction arrow
      const a = rad(cur.az + NORTH), x0 = P.X(W) - 90, y0 = P.Y(H) + 50, L = 30;
      const sx = Math.sin(a), sy = -Math.cos(a);
      c.strokeStyle = css('--gold'); c.fillStyle = css('--gold'); c.lineWidth = 2.5;
      c.beginPath(); c.arc(x0 + sx * L, y0 + sy * L, 9, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x0 + sx * (L - 12), y0 + sy * (L - 12)); c.lineTo(x0 - sx * L * 0.6, y0 - sy * L * 0.6); c.stroke();
      c.font = '600 10px "IBM Plex Mono", monospace'; c.fillStyle = css('--ink'); c.textAlign = 'center';
      c.fillText('shadows fall this way', x0, y0 + L + 26);
    }
    P.north(); P.scalebar();
  };

  // ---------- sun path diagram
  function sunPath(n, now) {
    const svg = $('sunPath'), R = 130, cx = 160, cy = 160, ink = css('--ink'), mut = css('--muted'), rule = css('--rule'), gold = css('--gold'), acc = css('--accent');
    const pt = (alt, az) => { const r = R * (90 - alt) / 90, a = rad(az); return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
    let o = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${mut}" stroke-width="1"/>`;
    for (const a of [30, 60]) o += `<circle cx="${cx}" cy="${cy}" r="${R * (90 - a) / 90}" fill="none" stroke="${rule}" stroke-width="1"/><text x="${cx + 3}" y="${cy - R * (90 - a) / 90 - 3}" font-size="9" fill="${mut}" font-family="IBM Plex Mono, monospace">${a}°</text>`;
    for (let az = 0; az < 360; az += 30) { const [x, y] = pt(0, az), [x2, y2] = pt(-4, az); o += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${mut}"/>`; }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, az]) => { const [x, y] = pt(-12, az); o += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${ink}" font-family="IBM Plex Mono, monospace">${t}</text>`; });
    const path = (y, m, d, col, w, dash) => {
      let p = '', on = false;
      for (let h = 0; h <= 24; h += 1 / 12) { const s = solar(localToUTC(y, m, d, h)); if (s.alt > 0) { const [x, yy] = pt(s.alt, s.az); p += `${on ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)} `; on = true; } else on = false; }
      return `<path d="${p}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    };
    o += path(YEAR, 5, 21, mut, 1.2, '4 3') + path(YEAR, 2, 20, mut, 1.2, '4 3') + path(YEAR, 11, 21, mut, 1.2, '4 3');
    const lab = (y, m, d, t) => { const r = riseSet(y, m, d); const s = solar(localToUTC(y, m, d, r.noon)); const [x, yy] = pt(s.alt, s.az); return `<text x="${x + 6}" y="${yy + 3}" font-size="9" fill="${mut}" font-family="IBM Plex Mono, monospace">${t}</text>`; };
    o += lab(YEAR, 5, 21, '21 Jun') + lab(YEAR, 2, 20, 'equinox') + lab(YEAR, 11, 21, '21 Dec');
    const [y, m, d] = dOY(n); o += path(y, m, d, acc, 2.4);
    if (now && now.alt > 0) { const [x, yy] = pt(now.alt, now.az); o += `<circle cx="${x}" cy="${yy}" r="8" fill="${gold}" stroke="${ink}" stroke-width="1.2"/>`; }
    svg.innerHTML = o;
  }

  // ---------- 3D sun path
  const sky = (function () {
    const stage = $('skyStage'), cv = $('skyGL');
    if (!window.THREE || !stage) return null;
    const R = Math.max(80, Math.max(G.widthM, G.depthM) * 0.95);   // sky dome radius (m)
    const K = R / 320;                                     // scale for labels and markers
    const C0 = [G.focus[0] * 0.2, G.focus[1] * 0.2];       // centre on the main feature (real m)
    const LO = G.lo, fh = G.height(G.focus[0], G.focus[1]), FH = (fh === fh ? fh : G.lo) - LO;
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.5, R * 16);
    const ctl = new THREE.OrbitControls(cam, cv); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.495;
    const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x5b5e55, 0.55); scene.add(hemi);
    const sunL = new THREE.DirectionalLight(0xfff1d6, 1); sunL.castShadow = true;
    sunL.shadow.mapSize.set(2048, 2048);
    Object.assign(sunL.shadow.camera, { left: -R * 1.06, right: R * 1.06, top: R * 1.06, bottom: -R * 1.06, near: 10 * K, far: R * 5 });
    sunL.shadow.bias = -0.0008; scene.add(sunL); scene.add(sunL.target);
    const v = (az, alt, r = R) => { const a = rad(az), h = rad(alt); return new THREE.Vector3(r * Math.sin(a) * Math.cos(h), r * Math.sin(h), -r * Math.cos(a) * Math.cos(h)); };

    // terrain (true scale, metres, y = level above the lowest ground), turned so true north is -z
    const site = new THREE.Group(); site.rotation.y = rad(NORTH); scene.add(site);
    const pos = new Float32Array(GW * GH * 3), idx = [];
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
      const h = at(i, j), k = (i * GW + j) * 3;
      pos[k] = j * CS - C0[0]; pos[k + 1] = h === h ? h - LO : 0; pos[k + 2] = -(i * CS - C0[1]);
    }
    const ok = new Uint8Array(GW * GH);                    // trim the survey edge (interpolation spikes)
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
      let good = 1;
      for (let di = -2; di <= 2 && good; di++) for (let dj = -2; dj <= 2; dj++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GH || jj >= GW || at(ii, jj) !== at(ii, jj)) { good = 0; break; } }
      ok[i * GW + j] = good;
    }
    for (let i = 0; i < GH - 1; i++) for (let j = 0; j < GW - 1; j++) {
      const a = i * GW + j, b = a + 1, c = a + GW, d = c + 1;
      if (!(ok[a] && ok[b] && ok[c] && ok[d])) continue;
      idx.push(a, b, c, b, d, c);
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
    const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x8f9a7d, roughness: 0.95 }));
    terrain.castShadow = terrain.receiveShadow = true; site.add(terrain);
    // ground disc + horizon ring + compass
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ color: 0xc9cbbf, roughness: 1 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = -0.3 * K; disc.receiveShadow = true; scene.add(disc);
    const ringPts = []; for (let a = 0; a <= 360; a += 2) ringPts.push(v(a, 0));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x4a4f4a })));
    function sprite(text, opts = {}) {
      const c = document.createElement('canvas'), g = c.getContext('2d'), fs = opts.fs || 44;
      g.font = `${opts.weight || 600} ${fs}px "IBM Plex Mono", monospace`;
      const w = Math.ceil(g.measureText(text).width) + 24; c.width = w; c.height = fs + 22;
      g.font = `${opts.weight || 600} ${fs}px "IBM Plex Mono", monospace`;
      if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, c.width, c.height); }
      g.fillStyle = opts.color || '#1d2120'; g.textBaseline = 'middle'; g.fillText(text, 12, c.height / 2 + 2);
      const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      const k = (opts.size || 14) / c.height; s.scale.set(c.width * k, c.height * k, 1); s.renderOrder = 10; return s;
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { const s = sprite(t, { size: 40 * K, color: '#1d2120', bg: 'rgba(255,255,255,.8)' }); s.position.copy(v(a, 0, R + 30 * K)); scene.add(s); });
    for (let a = 0; a < 360; a += 15) { const p1 = v(a, 0), p2 = v(a, 0, R + (a % 90 ? 6 : 12) * K); scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), new THREE.LineBasicMaterial({ color: 0x4a4f4a }))); }
    // altitude rings (30°, 60°) as faint guides
    [30, 60].forEach(al => { const p = []; for (let a = 0; a <= 360; a += 3) p.push(v(a, al)); scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: 0x8090a0, transparent: true, opacity: 0.35 }))); });
    // main feature marker
    const fb = G.focusF ? G.bbox(G.focusF) : [0, 0, 175, 175], fw = Math.max(8, (fb[2] - fb[0]) * 0.2), fd = Math.max(8, (fb[3] - fb[1]) * 0.2);
    const mill = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.6 * K, fd), new THREE.MeshBasicMaterial({ color: 0xd99a1e, transparent: true, opacity: 0.55 }));
    mill.position.set(0, FH + 0.5, 0); site.add(mill);
    const ml = sprite(G.focusF ? (G.focusF.name || 'Main feature') : 'Centre', { size: 16 * K, color: '#fff', bg: 'rgba(29,33,32,.85)' }); ml.position.set(0, FH + 14 * K, 0); site.add(ml);

    function dayCurve(y, m, d) {
      const pts = [];
      for (let h = 0; h <= 24; h += 1 / 12) { const s = solar(localToUTC(y, m, d, h)); if (s.alt > -0.5) pts.push({ h, p: v(s.az, Math.max(0, s.alt)) }); }
      return pts;
    }
    function tube(pts, color, r, opacity = 1) {
      if (pts.length < 2) return new THREE.Group();
      const curve = new THREE.CatmullRomCurve3(pts.map(o => o.p));
      return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(20, pts.length * 2), r, 6, false),
        new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
    }
    [[5, 21, '21 Jun'], [2, 20, 'Equinox'], [11, 21, '21 Dec']].forEach(([m, d, t]) => {
      const pts = dayCurve(YEAR, m, d); scene.add(tube(pts, 0x6b7a8a, 0.9 * K, 0.55));
      let top = pts[0]; pts.forEach(o => { if (o.p.y > top.p.y) top = o; });
      const s = sprite(t, { size: 20 * K, color: '#2a3036', bg: 'rgba(255,255,255,.75)' }); s.position.copy(top.p).add(new THREE.Vector3(0, 16 * K, 0)); scene.add(s);
    });
    const dayGroup = new THREE.Group(); scene.add(dayGroup);
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(12 * K, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffc23a }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(22 * K, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.25 }));
    sunBall.add(glow); scene.add(sunBall);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const beam = new THREE.Line(beamGeo, new THREE.LineDashedMaterial({ color: 0xd99a1e, dashSize: 6 * K, gapSize: 4 * K })); scene.add(beam);
    let lastDay = null;
    function buildDay(n) {
      if (n === lastDay) return; lastDay = n;
      dayGroup.children.slice().forEach(c => { dayGroup.remove(c); c.geometry && c.geometry.dispose(); });
      const [y, m, d] = dOY(n), pts = dayCurve(y, m, d), rs = riseSet(y, m, d);
      dayGroup.add(tube(pts, 0xc0432a, 1.6 * K));
      for (let h = Math.ceil(rs.rise ?? 0); h <= Math.floor(rs.set ?? 24); h += 1) {
        const s = solar(localToUTC(y, m, d, h)); if (s.alt <= 0) continue;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(2.2 * K, 12, 8), new THREE.MeshBasicMaterial({ color: 0xc0432a })); dot.position.copy(v(s.az, s.alt)); dayGroup.add(dot);
        if (h % 2 === 0) { const t = sprite(String(h).padStart(2, '0') + ':00', { size: 17 * K, color: '#c0432a', bg: 'rgba(255,255,255,.8)' }); t.position.copy(v(s.az, s.alt, R + 24 * K)); dayGroup.add(t); }
      }
      [[rs.rise, 'Sunrise'], [rs.set, 'Sunset']].forEach(([h, t]) => {
        if (h == null) return; const s = solar(localToUTC(y, m, d, h)); const p = v(s.az, 0);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * K, 1.6 * K, 30 * K, 8), new THREE.MeshBasicMaterial({ color: 0xc0432a })); post.position.copy(p).setY(15 * K); dayGroup.add(post);
        const lab = sprite(`${t} ${hhmm(h)}`, { size: 22 * K, color: '#fff', bg: 'rgba(192,67,42,.92)' }); lab.position.copy(p).setY(48 * K); dayGroup.add(lab);
      });
    }
    const DAY = new THREE.Color(0xbcd3e6), DUSK = new THREE.Color(0xf0b98a), NIGHT = new THREE.Color(0x1b2433);
    function set(n, t, s) {
      buildDay(n);
      const alt = s.alt, p = v(s.az, Math.max(alt, -6));
      sunBall.position.copy(p); sunBall.visible = alt > -3;
      beamGeo.setFromPoints([new THREE.Vector3(0, FH, 0), p]); beam.computeLineDistances(); beam.visible = alt > 0 && !groundMode;
      const up = Math.max(0, Math.min(1, alt / 12));
      sunL.position.copy(v(s.az, Math.max(alt, 0.5), R * 2)); sunL.intensity = alt > 0 ? 0.25 + 0.85 * up : 0;
      hemi.intensity = 0.18 + 0.45 * Math.max(0, Math.min(1, (alt + 6) / 18));
      const bg = alt < -6 ? NIGHT.clone() : alt < 0 ? NIGHT.clone().lerp(DUSK, (alt + 6) / 6) : alt < 8 ? DUSK.clone().lerp(DAY, alt / 8) : DAY.clone();
      scene.background = bg; stage.style.background = '#' + bg.getHexString();
      $('skyClock').innerHTML = `<b>${hhmm(t)}</b>${label(n)}<br>${alt > 0 ? `Sun ${alt.toFixed(0)}° high, bearing ${s.az.toFixed(0)}°` : 'Sun below the horizon'}`;
    }
    const views = { se: [v(335, 24, R * 3.06), new THREE.Vector3(0, R * 0.28, 0)], ground: [new THREE.Vector3(0, FH + 1.7, -0.5), null], top: [new THREE.Vector3(0, R * 3.3, 1), new THREE.Vector3(0, 0, 0)] };
    let moved = false, groundMode = false; ctl.addEventListener('start', () => moved = true);
    function view(k) {
      const [p, tg2] = views[k]; cam.position.copy(p); if (tg2) ctl.target.copy(tg2);
      if (k === 'ground') { ctl.target.copy(cam.position).add(new THREE.Vector3(0, 0.42, 1)); ctl.minDistance = 0.1; ctl.maxPolarAngle = Math.PI * 0.62; }
      else { ctl.minDistance = 20 * K; ctl.maxPolarAngle = Math.PI * 0.495; }
      mill.visible = ml.visible = beam.visible = k !== 'ground'; groundMode = k === 'ground'; fit(); ctl.update(); document.querySelectorAll('[data-cam]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cam === k));
    }
    document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => { moved = false; view(b.dataset.cam); });
    function fit() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.fov = groundMode ? 75 : (cam.aspect < 0.9 ? 60 : 40); cam.updateProjectionMatrix(); }
    new ResizeObserver(fit).observe(stage); fit(); view('se');
    (function loop() { ctl.update(); renderer.render(scene, cam); requestAnimationFrame(loop); })();
    return { set };
  })();

  // ---------- update
  let raf = 0;
  function update(full) {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const n = +dateIn.value, t = +timeIn.value, [y, m, d] = dOY(n);
      const rs = riseSet(y, m, d), s = solar(localToUTC(y, m, d, t)); cur = s;
      $('dTxt').textContent = label(n); $('tTxt').textContent = hhmm(t);
      $('rRise').textContent = hhmm(rs.rise); $('rSet').textContent = hhmm(rs.set);
      $('rLen').textContent = rs.rise != null ? `${Math.floor(rs.set - rs.rise)} h ${Math.round(((rs.set - rs.rise) % 1) * 60)} min` : '—';
      $('rNoon').textContent = `${hhmm(rs.noon)} · ${rs.maxAlt.toFixed(1)}°`;
      $('rAlt').textContent = s.alt > 0 ? `${s.alt.toFixed(1)}°` : 'below horizon';
      $('rAz').textContent = s.alt > 0 ? `${s.az.toFixed(0)}° (${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(s.az / 45) % 8]})` : '—';
      const shadowLen = s.alt > 0.5 ? (1 / Math.tan(rad(s.alt))) : null;
      $('rShadow').textContent = shadowLen ? `${shadowLen < 20 ? shadowLen.toFixed(1) : Math.round(shadowLen)} m` : '—';
      if (mode === 'shadow') paintShadow(s.alt, s.az);
      else if (mode === 'hours') paintHours(n);
      else paintAspect();
      $('legend').innerHTML = legend();
      P.draw(); sunPath(n, s); if (sky) sky.set(n, t, s);
    });
  }
  function legend() {
    if (mode === 'shadow') return `<span><i style="background:rgba(20,28,45,.5)"></i>In shadow of the ground</span><span><i style="background:var(--gold)"></i>Sun direction</span>`;
    if (mode === 'hours') return `<span><i style="background:rgb(38,52,80)"></i>Little direct sun</span><span><i style="background:rgb(242,177,52)"></i>Sun all day</span><span class="small">Hours counted from the ground model only</span>`;
    return `<span><i style="background:rgb(235,170,60)"></i>Faces south</span><span><i style="background:rgb(200,120,90)"></i>West</span><span><i style="background:rgb(140,170,120)"></i>East</span><span><i style="background:rgb(70,110,160)"></i>North</span><span><i style="background:rgb(200,200,195)"></i>Near level (flatter than 1:20)</span>`;
  }
  dateIn.addEventListener('input', () => update());
  timeIn.addEventListener('input', () => update());
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    const [m, d] = b.dataset.day.split('-').map(Number); dateIn.value = doy(m - 1, d); update();
  });
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (mode === 'hours') { $('legend').innerHTML = '<span>Calculating hours of sun…</span>'; setTimeout(update, 30); } else update();
    timeIn.disabled = mode !== 'shadow';
  });
  let timer = null;
  $('playDay').onclick = e => {
    if (timer) { clearInterval(timer); timer = null; e.target.textContent = 'Play the day'; return; }
    if (mode !== 'shadow') document.querySelector('[data-mode="shadow"]').click();
    const [y, m, d] = dOY(+dateIn.value), rs = riseSet(y, m, d);
    let t = Math.floor((rs.rise ?? 6) * 4) / 4; e.target.textContent = 'Stop';
    timer = setInterval(() => { t += 0.25; if (t > (rs.set ?? 20)) { clearInterval(timer); timer = null; e.target.textContent = 'Play the day'; return; } timeIn.value = t; update(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : 160);
  };

  const redraw = () => { P.size(); update(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(redraw, 80); }).observe(document.querySelector('main'));
  redraw();
})();
