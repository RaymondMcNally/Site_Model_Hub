/* Sections: cut the site's Gaussian-splat scan along any vertical plane, with the surveyed ground drawn solid in the cut.
   World (three.js, metres): X = east, Y = level (same levels as every other page), Z = south. Survey plan: x east, y north, metres from the south-west corner.
   The scan's own frame is z-up; the site pack stores how it sits on the survey: { yaw (deg), x, y (m), z (m added to scan heights), scale }.
   Big screen and projector: sections.html?display is a full-screen view for a large monitor that follows this page's cut,
   and the projection page draws the same cut on the physical model. They share it through the BroadcastChannel
   'sitekit-link-<site>' (same browser, same computer): { t: 'cut', s: { A, B, look, depth, … }, cam, final, T }. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode } from '@sparkjsdev/spark';

window.__sxStarted = true;                                   // the modules loaded (see the watchdog in sections.html)
const G = await window.loadSite('sections.html');
if (G) main(G);

function main(G) {
  const { $, pack, sample, widthM: WM, depthM: DM } = G;
  const OFF = +pack.levelOffset || 0;
  const KEY = 'sitekit-sections-' + pack.id;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const compass = a => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((a % 360) + 360) % 360 / 45) % 8];

  // ------------------------------------------------------------------ state
  const S = { A: null, B: null, look: 1, depth: 201, above: 1000, poche: true, ground: false, scan: true, cut: true, cam: 'section', scale: 200, own: {}, keepHere: false };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
  const DISPLAY = document.documentElement.classList.contains('sx-display');   // the big-screen window
  const save = () => { if (DISPLAY) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };

  // ------------------------------------------------------------------ sharing the cut with the big screen and the projector
  const LINK = 'BroadcastChannel' in window ? new BroadcastChannel('sitekit-link-' + pack.id) : null;
  const lsend = m => { try { LINK && LINK.postMessage(m); } catch (e) { } };
  const CUTKEYS = ['A', 'B', 'look', 'depth', 'above', 'poche', 'ground', 'scan', 'cut'];
  const cutMsg = final => ({ t: 'cut', final: !!final, cam: S.cam, s: Object.fromEntries(CUTKEYS.map(k => [k, S[k]])), T, own: ownName });
  let lastSend = 0, sendT = 0;
  function shareCut(final) {                                // at most ~25 messages a second while dragging, always the last one
    if (DISPLAY || !S.A) return;
    clearTimeout(sendT);
    const now = performance.now();
    if (final || now - lastSend > 40) { lastSend = now; lsend(cutMsg(final)); }
    else sendT = setTimeout(() => { lastSend = performance.now(); lsend(cutMsg(false)); }, 40);
  }
  let bigOpen = false, lastHello = 0;                        // a big-screen window is connected (controller only)
  const PUB = pack.splat ? Object.assign({ yaw: 0, x: 0, y: 0, z: 0, scale: 1 }, pack.splat) : null;
  let T = PUB ? Object.assign({}, PUB) : { yaw: 0, x: WM / 2, y: DM / 2, z: 0, scale: 1 };
  let ownName = null;                                       // name of a scan loaded from this computer

  // ------------------------------------------------------------------ three.js
  const view = $('view'), cvs = $('gl');
  if (!cvs.getContext('webgl2')) { $('loadTxt').textContent = 'This browser or computer has no WebGL 2, which the 3D viewer needs. The section drawing below still works.'; $('load').classList.add('err'); return; }
  const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101312);
  const camera = new THREE.PerspectiveCamera(18, 1.6, 0.5, 5000);
  const controls = new OrbitControls(camera, cvs);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555048, 1.6));
  const sunL = new THREE.DirectionalLight(0xffffff, 1.6); sunL.position.set(-1, 1.4, -0.6); scene.add(sunL);

  // cut planes: Spark hides splats where a plane's local z < 0 (multiply opacity by 0)
  const edit = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, sdfSmooth: 0, softEdge: 0.04 });
  const mkPlane = () => { const p = new SplatEditSdf({ type: SplatEditSdfType.PLANE, opacity: 0, color: new THREE.Color(1, 1, 1) }); edit.add(p); return p; };
  const pCut = mkPlane(), pBack = mkPlane(), pTop = mkPlane();
  scene.add(edit);
  const clipCut = new THREE.Plane(), clipBack = new THREE.Plane(), clipTop = new THREE.Plane();   // same cuts for ordinary meshes
  const Z = new THREE.Vector3(0, 0, 1);
  const setPlane = (sdf, clip, at, keep) => {                // keep: the side that stays visible
    sdf.position.copy(at); sdf.quaternion.setFromUnitVectors(Z, keep); sdf.updateMatrixWorld();
    clip.setFromNormalAndCoplanarPoint(keep, at);            // three.js keeps the side the normal points to
  };

  let mesh = null, groundMesh = null, poche = null, pocheLine = null;
  let pts = null;                                            // scan sample: local x, y, z (Float32, stride 3)

  const w2 = (e, n, lev) => new THREE.Vector3(e, lev, -n);   // survey → world

  function scanMatrix() {
    const s = T.scale || 1, c = Math.cos(rad(T.yaw)), sn = Math.sin(rad(T.yaw));
    return new THREE.Matrix4().set(
      s * c, -s * sn, 0, T.x,
      0, 0, s, T.z + OFF,
      -s * sn, -s * c, 0, -T.y,
      0, 0, 0, 1);
  }
  const toSurvey = (x, y, z) => { const s = T.scale || 1, c = Math.cos(rad(T.yaw)), sn = Math.sin(rad(T.yaw)); return [s * (c * x - sn * y) + T.x, s * (sn * x + c * y) + T.y, s * z + T.z + OFF]; };
  function placeScan() { wake(3000); shareCut(false); if (!mesh) return; mesh.matrixAutoUpdate = false; mesh.matrix.copy(scanMatrix()); mesh.matrixWorldNeedsUpdate = true; footprint(); }

  // ------------------------------------------------------------------ loading
  const loadEl = $('load'), loadTxt = $('loadTxt'), loadBar = $('loadBar');
  const loading = (t, f) => { loadEl.classList.remove('done'); loadTxt.textContent = t; loadBar.style.width = `${Math.round((f || 0) * 100)}%`; };
  const loaded = () => loadEl.classList.add('done');

  async function fetchBytes(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('Could not load ' + url);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
    const rd = r.body.getReader(), out = new Uint8Array(total); let got = 0;
    for (; ;) { const { done, value } = await rd.read(); if (done) break; out.set(value, got); got += value.length; loading(`Loading the scan · ${(got / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB`, got / total); }
    return out;
  }
  function spzFromGlb(u8) {                                  // Cesium / LCC .glb with KHR_gaussian_splatting + SPZ compression
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== 0x46546C67) return null;
    let off = 12, json = null, bin = null;
    while (off + 8 <= u8.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), chunk = u8.subarray(off + 8, off + 8 + len);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk)); else if (type === 0x004E4942) bin = chunk;
      off += 8 + len;
    }
    if (!json || !bin) return null;
    for (const m of json.meshes || []) for (const p of m.primitives || []) {
      const x = p.extensions || {}, e = x.KHR_gaussian_splatting?.extensions?.KHR_gaussian_splatting_compression_spz_2 || x.KHR_gaussian_splatting_compression_spz_2 || x.KHR_spz_gaussian_splats_compression;
      if (e && json.bufferViews[e.bufferView]) { const bv = json.bufferViews[e.bufferView], o = bv.byteOffset || 0; return bin.slice(o, o + bv.byteLength); }
    }
    throw new Error('This .glb has no compressed Gaussian splats in it. Export it as .spz or .ply instead.');
  }
  async function loadScan(bytes, name) {
    let fileType;
    if (/\.glb$/i.test(name)) { bytes = spzFromGlb(bytes); fileType = 'spz'; }
    else { const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase(); fileType = { spz: 'spz', ply: 'ply', splat: 'splat', ksplat: 'ksplat', sog: 'pcsogszip', zip: 'pcsogszip' }[ext]; }
    loading('Preparing the scan…', 1);
    if (mesh) { scene.remove(mesh); mesh.dispose?.(); mesh = null; }
    const m = new SplatMesh({ fileBytes: bytes, fileType, fileName: name, editable: true });
    await Promise.race([m.initialized, new Promise((_, no) => setTimeout(() => no(new Error('The scan took too long to prepare. Reload the page; if it happens again, try another browser.')), 120000))]);
    mesh = m; scene.add(mesh); wake(4000);
    // a sample of the scan for the plan footprint and for fitting it to the survey
    const n = mesh.packedSplats?.numSplats || mesh.numSplats || 0, every = Math.max(1, Math.floor(n / 400000));
    const a = []; let i = 0;
    mesh.forEachSplat((k, c, sc, q, op) => { if (op > 0.35 && (i++ % every) === 0) a.push(c.x, c.y, c.z); });
    pts = new Float32Array(a);
    $('specScan').textContent = `${(n / 1e6).toFixed(n > 1e6 ? 1 : 2)} million splats`;
    placeScan(); applyCut(); loaded();
    return n;
  }

  // ------------------------------------------------------------------ the scan on the plan
  let foot = null;                                           // { gw, gh, cell, occ:Uint8Array, lo, hi } in survey metres
  function footprint() {
    if (!pts) return;
    const cell = 2, gw = Math.ceil(WM / cell) + 1, gh = Math.ceil(DM / cell) + 1, occ = new Uint8Array(gw * gh);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < pts.length; k += 3) {
      const [e, n, l] = toSurvey(pts[k], pts[k + 1], pts[k + 2]);
      if (l < lo) lo = l; if (l > hi) hi = l;
      const j = Math.floor(e / cell), i = Math.floor(n / cell);
      if (i >= 0 && j >= 0 && i < gh && j < gw && occ[i * gw + j] < 255) occ[i * gw + j]++;
    }
    foot = { gw, gh, cell, occ, lo, hi };
    drawPlan(); syncAbove();
  }

  // ------------------------------------------------------------------ section line
  function defaultLine() {
    let cx = WM / 2, cy = DM / 2, half = Math.min(WM, DM) * 0.4;
    if (foot) {                                              // across the scan, through the site's focus if it is on the scan
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < foot.gh; i++) for (let j = 0; j < foot.gw; j++) if (foot.occ[i * foot.gw + j] > 3) { x0 = Math.min(x0, j); x1 = Math.max(x1, j + 1); y0 = Math.min(y0, i); y1 = Math.max(y1, i + 1); }
      if (x1 > x0) { cx = (x0 + x1) / 2 * foot.cell; cy = (y0 + y1) / 2 * foot.cell; half = (x1 - x0) / 2 * foot.cell * 1.05; }
      const f = (pack.features || []).find(f => f.id === pack.focus);
      if (f && f.pts?.length) { const fx = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length, fy = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length; if (Math.abs(fx - cx) < half) cy = fy; }
    } else if (G.focusF) { const f = G.focusF; cx = f.P.reduce((s, p) => s + p[0], 0) / f.P.length / 5; cy = f.P.reduce((s, p) => s + p[1], 0) / f.P.length / 5; }
    S.A = [Math.max(0, cx - half), cy]; S.B = [Math.min(WM, cx + half), cy]; S.look = 1;
  }
  const geom = () => {
    const [ax, ay] = S.A, [bx, by] = S.B, L = Math.hypot(bx - ax, by - ay) || 1, u = [(bx - ax) / L, (by - ay) / L];
    const v = [-u[1] * S.look, u[0] * S.look];               // plan direction we are looking in
    return { L, u, v, ax, ay, bx, by };
  };
  function profile(step = 0.25) {
    const { L, u, ax, ay } = geom(), n = Math.max(2, Math.ceil(L / step) + 1), s = new Float32Array(n), g = new Float32Array(n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const t = i / (n - 1) * L; s[i] = t; const v = sample(ax + u[0] * t, ay + u[1] * t); g[i] = v; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    return { s, g, n, L, lo, hi };
  }

  // ------------------------------------------------------------------ cut, poché and ground
  function applyCut() {
    wake();
    const { u, v, ax, ay, L } = geom(), V = new THREE.Vector3(v[0], 0, -v[1]), A = w2(ax, ay, 0);
    const far = 1e5;
    setPlane(pCut, clipCut, S.cut ? A : A.clone().addScaledVector(V, -far), V);
    const d = S.depth > 200 ? far : S.depth;
    setPlane(pBack, clipBack, A.clone().addScaledVector(V, d), V.clone().negate());
    const top = aboveLevel();
    setPlane(pTop, clipTop, new THREE.Vector3(0, top === null ? far : top, 0), new THREE.Vector3(0, -1, 0));
    if (mesh) mesh.visible = S.scan;
    buildPoche(); buildGround();
    const P = profile();
    $('specLen').textContent = `${L.toFixed(0)} m`;
    $('specLook').textContent = compass(deg(Math.atan2(v[0], v[1])));
    $('specLev').textContent = P.lo === Infinity ? 'off the survey' : `${G.fmt(P.lo)} to ${G.fmt(P.hi)} m`;
    if (DISPLAY) caption(); else { drawSection(); shareCut(false); }
  }
  function buildPoche() {
    if (poche) { scene.remove(poche); poche.geometry.dispose(); poche = null; }
    if (pocheLine) { scene.remove(pocheLine); pocheLine.geometry.dispose(); pocheLine = null; }
    if (!S.poche || !S.cut) return;
    const { u, v, ax, ay } = geom(), P = profile(0.4), base = Math.floor((P.lo === Infinity ? 0 : P.lo) - 3);
    const toW = (t, lev) => w2(ax + u[0] * t - v[0] * 0.05, ay + u[1] * t - v[1] * 0.05, lev);   // a hair in front of the cut
    const pos = [], line = [];
    for (let i = 0; i < P.n - 1; i++) {
      const g0 = P.g[i], g1 = P.g[i + 1]; if (!(g0 === g0 && g1 === g1)) continue;
      const a = toW(P.s[i], g0), b = toW(P.s[i + 1], g1), c = toW(P.s[i + 1], base), d = toW(P.s[i], base);
      pos.push(a.x, a.y, a.z, d.x, d.y, d.z, b.x, b.y, b.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
      line.push(a.x, a.y + 0.03, a.z, b.x, b.y + 0.03, b.z);
    }
    if (!pos.length) return;
    const gq = new THREE.BufferGeometry(); gq.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    poche = new THREE.Mesh(gq, new THREE.MeshBasicMaterial({ color: 0x161816, side: THREE.DoubleSide, clippingPlanes: [clipTop] }));
    const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
    pocheLine = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: 0xe5533d }));
    scene.add(poche, pocheLine);
  }
  function buildGround() {
    if (!S.ground) { if (groundMesh) groundMesh.visible = false; return; }
    if (!groundMesh) {
      const st = Math.max(0.8, Math.sqrt(WM * DM / 80000)), nx = Math.floor(WM / st) + 1, ny = Math.floor(DM / st) + 1;
      const pos = new Float32Array(nx * ny * 3), idx = [], ok = new Uint8Array(nx * ny);
      for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) { const k = i * nx + j, z = sample(j * st, i * st); ok[k] = z === z ? 1 : 0; pos[k * 3] = j * st; pos[k * 3 + 1] = z === z ? z - 0.15 : 0; pos[k * 3 + 2] = -i * st; }
      for (let i = 0; i < ny - 1; i++) for (let j = 0; j < nx - 1; j++) {
        const a = i * nx + j, b = a + 1, c = a + nx, d = c + 1;
        if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      groundMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xc9c2b2, side: THREE.DoubleSide, clippingPlanes: [clipCut, clipBack, clipTop] }));
      scene.add(groundMesh);
    }
    groundMesh.visible = true;
  }

  // ------------------------------------------------------------------ heights for "hide above"
  function aboveLevel() {
    if (S.above >= 1000) return null;
    const lo = Math.min(G.lo, foot ? foot.lo : G.lo), hi = Math.max(G.hi, foot ? foot.hi : G.hi);
    return lo + S.above / 1000 * (hi - lo);
  }
  function syncAbove() { const a = aboveLevel(); $('oAbove').textContent = a === null ? 'nothing hidden' : `${G.fmt(a)} m`; }

  // ------------------------------------------------------------------ cameras
  let tween = null;
  function setCam(kind, instant) {
    S.cam = kind; save(); shareCut(true);
    document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === kind));
    const { L, u, v, ax, ay } = geom(), P = profile(1), mid = [ax + u[0] * L / 2, ay + u[1] * L / 2];
    const lev = P.lo === Infinity ? (G.lo + G.hi) / 2 : (P.lo + P.hi) / 2 + 4;
    const target = w2(mid[0], mid[1], lev), asp = Math.max(0.5, view.clientWidth / Math.max(1, view.clientHeight));
    let fov = 18, pos;
    if (kind === 'section') {
      const hf = 2 * Math.atan(Math.tan(rad(fov / 2)) * asp), d = Math.max(L * 0.56 / Math.tan(hf / 2), (P.hi - P.lo + 30) * 0.6 / Math.tan(rad(fov / 2)));
      pos = w2(mid[0] - v[0] * d, mid[1] - v[1] * d, lev + d * 0.03);
    } else if (kind === 'plan') {
      fov = 30; const span = Math.max(L, 40) * 0.9, d = span / 2 / Math.tan(rad(fov / 2)) / Math.min(1, asp);
      pos = w2(mid[0], mid[1] - 0.01, lev + d);
    } else {
      fov = 35; const d = Math.max(L, 60) * 1.25;
      pos = w2(mid[0] - v[0] * d * 0.75 - u[0] * d * 0.35, mid[1] - v[1] * d * 0.75 - u[1] * d * 0.35, lev + d * 0.55);
    }
    wake(2500);
    const from = { p: camera.position.clone(), t: controls.target.clone(), f: camera.fov };
    if (instant || !tween && from.p.lengthSq() === 0) { camera.position.copy(pos); controls.target.copy(target); camera.fov = fov; camera.updateProjectionMatrix(); return; }
    tween = { from, to: { p: pos, t: target, f: fov }, t0: performance.now() };
  }
  function stepTween(now) {
    if (!tween) return;
    const k = Math.min(1, (now - tween.t0) / 650), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.lerpVectors(tween.from.p, tween.to.p, e); controls.target.lerpVectors(tween.from.t, tween.to.t, e);
    camera.fov = tween.from.f + (tween.to.f - tween.from.f) * e; camera.updateProjectionMatrix();
    if (k >= 1) tween = null;
  }
  function resize() {
    const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); wake();
  }
  new ResizeObserver(resize).observe(view);
  // draw only while something is changing (the scan keeps re-sorting for a moment after each change)
  let awakeUntil = 0;
  const wake = (ms = 1500) => { awakeUntil = Math.max(awakeUntil, performance.now() + ms); };
  controls.addEventListener('change', () => wake());
  const pausedHere = () => !DISPLAY && bigOpen && !S.keepHere;   // the big screen draws the scan: save the graphics card
  renderer.setAnimationLoop(now => { stepTween(now); controls.update(); if ((tween || now < awakeUntil) && !pausedHere()) renderer.render(scene, camera); });
  window.__sx = { wake, scene, camera, renderer, get T() { return T; }, S };

  // ------------------------------------------------------------------ plan with the section line
  const planC = $('plan'), P = G.Plan(planC);
  let hillDone = false;
  function drawPlan() {
    if (DISPLAY) return;                                     // the big screen has no plan
    P.size(); P.base({ labels: false, contourAlpha: 0.6 });
    const c = P.ctx;
    if (foot) {                                              // the scan's footprint, as one soft image
      if (!foot.img) {
        const im = document.createElement('canvas'); im.width = foot.gw; im.height = foot.gh;
        const x = im.getContext('2d'), d = x.createImageData(foot.gw, foot.gh), col = (G.css('--accent') || '#c8553d').match(/[0-9a-f]{2}/gi)?.map(h => parseInt(h, 16)) || [200, 85, 61];
        for (let i = 0; i < foot.gh; i++) for (let j = 0; j < foot.gw; j++) if (foot.occ[i * foot.gw + j] > 3) { const o = ((foot.gh - 1 - i) * foot.gw + j) * 4; d.data[o] = col[0]; d.data[o + 1] = col[1]; d.data[o + 2] = col[2]; d.data[o + 3] = 255; }
        x.putImageData(d, 0, 0); foot.img = im;
      }
      c.save(); c.globalAlpha = 0.2; c.imageSmoothingEnabled = true;
      c.drawImage(foot.img, P.X(0), P.Y(foot.gh * foot.cell * 5), foot.gw * foot.cell * 5 * P.s, foot.gh * foot.cell * 5 * P.s);
      c.restore();
    }
    P.features({ tags: 'focus', alpha: 0.8 });
    if (!S.A) return;
    const { u, v, L, ax, ay, bx, by } = geom(), X = x => P.X(x * 5), Y = y => P.Y(y * 5), red = '#e5533d';
    c.strokeStyle = red; c.lineWidth = 2.5; c.setLineDash([12, 4, 3, 4]); c.beginPath(); c.moveTo(X(ax), Y(ay)); c.lineTo(X(bx), Y(by)); c.stroke(); c.setLineDash([]);
    // looking arrows
    [0, 1].forEach(e => {
      const [x, y] = e ? [bx, by] : [ax, ay], px = X(x), py = Y(y), dx = v[0], dy = -v[1], len = 22;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + dx * len, py + dy * len); c.stroke();
      c.beginPath(); c.moveTo(px + dx * (len + 9), py + dy * (len + 9)); c.lineTo(px + dx * len - dy * 6, py + dy * len + dx * 6); c.lineTo(px + dx * len + dy * 6, py + dy * len - dx * 6); c.closePath(); c.fillStyle = red; c.fill();
      c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.stroke(); c.lineWidth = 2.5;
      c.fillStyle = red; c.font = '700 12px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(e ? 'B' : 'A', px - u[0] * 16 * (e ? -1 : 1) - v[0] * 0, py + u[1] * 16 * (e ? -1 : 1));
    });
    P.north();
  }
  // dragging
  let drag = null;
  const evPlan = e => { const b = planC.getBoundingClientRect(); const [x, y] = P.inv(e.clientX - b.left, e.clientY - b.top); return [x / 5, y / 5, e.clientX - b.left, e.clientY - b.top]; };
  const clampPt = p => [Math.max(0, Math.min(WM, p[0])), Math.max(0, Math.min(DM, p[1]))];
  planC.addEventListener('pointerdown', e => {
    e.preventDefault();
    const [x, y, px, py] = evPlan(e), dA = Math.hypot(px - P.X(S.A[0] * 5), py - P.Y(S.A[1] * 5)), dB = Math.hypot(px - P.X(S.B[0] * 5), py - P.Y(S.B[1] * 5));
    planC.setPointerCapture(e.pointerId);
    if (dA < 14 || dB < 14) drag = { k: dA <= dB ? 'A' : 'B' };
    else {
      const { u, L, ax, ay } = geom(), t = (x - ax) * u[0] + (y - ay) * u[1], off = Math.abs((x - ax) * -u[1] + (y - ay) * u[0]) * 5 * P.s;
      if (t > 0 && t < L && off < 10) drag = { k: 'move', x, y, A: S.A.slice(), B: S.B.slice() };
      else { drag = { k: 'B', fresh: true }; S.A = clampPt([x, y]); S.B = S.A.slice(); }
    }
  });
  planC.addEventListener('pointermove', e => {
    if (!drag) { const [, , px, py] = evPlan(e); const near = S.A && [S.A, S.B].some(p => Math.hypot(px - P.X(p[0] * 5), py - P.Y(p[1] * 5)) < 14); planC.style.cursor = near ? 'grab' : 'crosshair'; return; }
    const [x, y] = evPlan(e);
    if (drag.k === 'move') { const dx = x - drag.x, dy = y - drag.y; S.A = clampPt([drag.A[0] + dx, drag.A[1] + dy]); S.B = clampPt([drag.B[0] + dx, drag.B[1] + dy]); }
    else {
      const other = drag.k === 'A' ? S.B : S.A; let p = clampPt([x, y]);
      if (e.shiftKey) { const a = Math.atan2(p[1] - other[1], p[0] - other[0]), r = Math.hypot(p[0] - other[0], p[1] - other[1]), q = Math.round(a / rad(15)) * rad(15); p = clampPt([other[0] + Math.cos(q) * r, other[1] + Math.sin(q) * r]); }
      S[drag.k] = p;
    }
    drawPlan(); liveCut();
  });
  const endDrag = () => {
    if (!drag) return;
    if (Math.hypot(S.B[0] - S.A[0], S.B[1] - S.A[1]) < 4) { if (drag.fresh) defaultLine(); }
    drag = null; save(); drawPlan(); applyCut(); setCam(S.cam);
  };
  planC.addEventListener('pointerup', endDrag); planC.addEventListener('pointercancel', endDrag);
  let liveT = 0; const liveCut = () => { cancelAnimationFrame(liveT); liveT = requestAnimationFrame(() => { if (Math.hypot(S.B[0] - S.A[0], S.B[1] - S.A[1]) >= 4) applyCut(); }); };
  addEventListener('resize', () => drawPlan());

  // ------------------------------------------------------------------ the section drawing (SVG + PDF from one list of marks)
  function sectionMarks(scale, ts = 1) {                       // ts: text size multiplier (screen preview only)
    const k = 1000 / scale, P2 = profile(0.25), { v } = geom(), marks = [];   // k: drawing mm per metre
    if (P2.lo === Infinity) return null;
    const step = [1, 2, 5, 10, 20].find(s => (P2.hi - P2.lo) / s <= 8) || 20;
    const base = Math.floor((P2.lo - 2) / step) * step, top = Math.ceil((P2.hi + 4) / step) * step;
    const ml = 26, mt = 22 + 6 * ts, w = P2.L * k, h = (top - base) * k, X = s => ml + s * k, Y = lev => mt + (top - lev) * k;
    // level scale, datum, ends
    for (let L = base; L <= top + 1e-6; L += step) {
      marks.push({ t: 'line', a: [ml - 4, Y(L)], b: [ml, Y(L)], w: 0.25 });
      marks.push({ t: 'line', a: [ml, Y(L)], b: [ml + w, Y(L)], w: 0.1, dash: [0.8, 1.6], col: '#999' });
      marks.push({ t: 'text', at: [ml - 5, Y(L) + 1], s: `${G.fmt(L, 0)}`, size: 2.4 * ts, anchor: 'end' });
    }
    // ground in the cut
    let run = [];
    const flush = () => { if (run.length > 1) marks.push({ t: 'poly', pts: [...run, [run[run.length - 1][0], Y(base)], [run[0][0], Y(base)]], fill: '#222' }); run = []; };
    for (let i = 0; i < P2.n; i++) { const g = P2.g[i]; if (g === g) run.push([X(P2.s[i]), Y(g)]); else flush(); }
    flush();
    marks.push({ t: 'line', a: [ml, Y(top)], b: [ml, Y(base)], w: 0.25 });
    marks.push({ t: 'text', at: [X(0), 14], s: 'A', size: 4.2 * Math.min(ts, 1.6), anchor: 'middle', bold: true, col: '#c8452e' });
    marks.push({ t: 'text', at: [X(P2.L), 14], s: 'B', size: 4.2 * Math.min(ts, 1.6), anchor: 'middle', bold: true, col: '#c8452e' });
    // spot levels at the ends, the high and the low point
    const spots = [];
    const first = P2.g.findIndex(g => g === g), last = P2.n - 1 - [...P2.g].reverse().findIndex(g => g === g);
    let ih = first, il = first; for (let i = first; i <= last; i++) if (P2.g[i] === P2.g[i]) { if (P2.g[i] > P2.g[ih]) ih = i; if (P2.g[i] < P2.g[il]) il = i; }
    [first, last, ih, il].forEach(i => { if (!spots.some(j => Math.abs(P2.s[j] - P2.s[i]) * k < 14)) spots.push(i); });
    spots.forEach(i => { const x = X(P2.s[i]), y = Y(P2.g[i]), an = x < ml + 8 ? 'start' : x > ml + w - 8 ? 'end' : 'middle'; marks.push({ t: 'line', a: [x, y - 1], b: [x, y - 6], w: 0.2 }); marks.push({ t: 'text', at: [x + (an === 'start' ? 0.8 : an === 'end' ? -0.8 : 0), y - 7.2], s: `${G.fmt(P2.g[i])}`, size: 2.3 * ts, anchor: an }); });
    // features the line crosses: one label per open feature crossing, one per closed outline; labels stack when they would touch
    const { ax, ay, bx, by, u } = geom(), hits = [];
    (pack.features || []).forEach(f => {
      const pts = f.pts || [], closed = G.KINDS[f.kind]?.closed, xs = [];
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], d = (bx - ax) * (q[1] - p[1]) - (by - ay) * (q[0] - p[0]); if (Math.abs(d) < 1e-9) continue;
        const t = ((p[0] - ax) * (q[1] - p[1]) - (p[1] - ay) * (q[0] - p[0])) / d, s2 = ((p[0] - ax) * (by - ay) - (p[1] - ay) * (bx - ax)) / d;
        if (t >= 0 && t <= 1 && s2 >= 0 && s2 <= 1) xs.push(t * P2.L);
      }
      if (!xs.length) return;
      xs.sort((p, q) => p - q);
      xs.forEach(sm => { const g = sample(ax + u[0] * sm, ay + u[1] * sm); if (g === g) marks.push({ t: 'line', a: [X(sm), Y(g) - 1], b: [X(sm), Y(top) + 1], w: 0.15, dash: [1, 1], col: '#3a7fae' }); });
      if (closed) hits.push({ x: X((xs[0] + xs[xs.length - 1]) / 2), s: f.name || f.kind, span: [X(xs[0]), X(xs[xs.length - 1])] });
      else xs.forEach(sm => hits.push({ x: X(sm), s: f.name || f.kind }));
    });
    const rows = [], fs = 2.2 * ts;
    hits.sort((p, q) => p.x - q.x).forEach(h => {
      const wdt = h.s.length * fs * 0.62 + 2; let r = 0;
      while (rows[r] !== undefined && rows[r] > h.x - wdt / 2) r++;
      rows[r] = h.x + wdt / 2;
      const y = Y(top) - 1 - r * (fs + 1.2);
      if (h.span && h.span[1] - h.span[0] > 1) marks.push({ t: 'line', a: [h.span[0], Y(top) + 1], b: [h.span[1], Y(top) + 1], w: 0.25, col: '#3a7fae' });
      marks.push({ t: 'text', at: [h.x, y], s: h.s, size: fs, anchor: 'middle', col: '#3a7fae' });
    });
    // scale bar and title
    const sb = [5, 10, 20, 50, 100].find(m => m * k >= 30) || 100, sy = Y(base) + 10;
    for (let i = 0; i < 4; i++) marks.push({ t: 'rect', x: ml + i * sb * k / 4, y: sy, w: sb * k / 4, h: 1.4, fill: i % 2 ? '#fff' : '#222' });
    marks.push({ t: 'text', at: [ml + sb * k + 2, sy + 1.6], s: `${sb} m`, size: 2.4 * ts, anchor: 'start' });
    const look = compass(deg(Math.atan2(v[0], v[1])));
    marks.push({ t: 'text', at: [ml, sy + 4 + 5 * ts], s: `${pack.name} · Section A–B looking ${look} · 1:${scale} · ${P2.L.toFixed(0)} m`, size: 3.2 * ts, anchor: 'start', bold: true });
    marks.push({ t: 'text', at: [ml, sy + 4 + 9.5 * ts], s: `Ground from the survey (${pack.survey ? pack.survey.split(',')[0] : 'terrain model'}). Levels in metres${G.relative ? ', 0 = lowest ground on the survey' : ''}.`, size: 2.3 * ts, anchor: 'start', col: '#555' });
    return { marks, w: ml + w + 12, h: sy + 6 + 12 * ts };
  }
  const svgOf = (M, pxPerMm) => {
    const e = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const body = M.marks.map(m => {
      if (m.t === 'poly') return `<path d="M${m.pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L')}Z" fill="${m.fill}"/>`;
      if (m.t === 'line') return `<line x1="${m.a[0].toFixed(2)}" y1="${m.a[1].toFixed(2)}" x2="${m.b[0].toFixed(2)}" y2="${m.b[1].toFixed(2)}" stroke="${m.col || '#222'}" stroke-width="${m.w}"${m.dash ? ` stroke-dasharray="${m.dash.join(' ')}"` : ''}/>`;
      if (m.t === 'rect') return `<rect x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}" width="${m.w.toFixed(2)}" height="${m.h}" fill="${m.fill}" stroke="#222" stroke-width="0.15"/>`;
      return `<text x="${m.at[0].toFixed(2)}" y="${m.at[1].toFixed(2)}" font-size="${m.size}" text-anchor="${m.anchor}" fill="${m.col || '#222'}" font-family="IBM Plex Mono, monospace"${m.bold ? ' font-weight="600"' : ''}>${e(m.s)}</text>`;
    }).join('');
    const size = pxPerMm ? `width="${(M.w * pxPerMm).toFixed(0)}" height="${(M.h * pxPerMm).toFixed(0)}"` : `width="${M.w.toFixed(1)}mm" height="${M.h.toFixed(1)}mm"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${M.w.toFixed(2)} ${M.h.toFixed(2)}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  };
  const SHEETS = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
  const sheetFor = M => SHEETS.find(([, w, h]) => M.w + 20 <= w && M.h + 20 <= h);
  function drawSection() {
    if (DISPLAY) return;
    let M = sectionMarks(S.scale), box = $('draw');
    if (!M) { box.innerHTML = '<p class="small" style="padding:16px">The section line is off the survey.</p>'; $('dlPdf').disabled = $('dlSvg').disabled = true; $('paper').textContent = '—'; return; }
    const fit = Math.max(1.2, Math.min(4, (box.clientWidth - 2) / M.w));
    box.innerHTML = svgOf(sectionMarks(S.scale, Math.max(1, 3.6 / fit)), fit);
    const sh = sheetFor(M);
    $('paper').textContent = sh ? `Prints on ${sh[0]} landscape at 1:${S.scale}` : `Too long for A0 at 1:${S.scale}: choose a smaller scale`;
    $('dlPdf').disabled = !sh; $('dlSvg').disabled = false;
    $('specScale').textContent = `1:${S.scale}`;
  }
  const fileBase = () => `${G.pack.id}_section_${Math.round(S.A[0])}-${Math.round(S.A[1])}_${Math.round(S.B[0])}-${Math.round(S.B[1])}`;
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
  $('dlSvg').onclick = () => { const M = sectionMarks(S.scale); if (M) download(new Blob([svgOf(M)], { type: 'image/svg+xml' }), fileBase() + `_1-${S.scale}.svg`); };
  $('dlPdf').onclick = () => {
    const M = sectionMarks(S.scale), sh = M && sheetFor(M); if (!sh) return;
    const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: sh[0].toLowerCase() });
    const ox = (sh[1] - M.w) / 2, oy = (sh[2] - M.h) / 2, hex = c => { let h = (c || '#222').slice(1); if (h.length === 3) h = h.replace(/./g, x => x + x); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    M.marks.forEach(m => {
      if (m.t === 'poly') { doc.setFillColor(...hex(m.fill)); const p0 = m.pts[0], d = m.pts.slice(1).map((p, i) => [p[0] - m.pts[i][0], p[1] - m.pts[i][1]]); doc.lines(d, ox + p0[0], oy + p0[1], [1, 1], 'F', true); }
      else if (m.t === 'line') { doc.setDrawColor(...hex(m.col)); doc.setLineWidth(m.w); doc.setLineDashPattern(m.dash || [], 0); doc.line(ox + m.a[0], oy + m.a[1], ox + m.b[0], oy + m.b[1]); doc.setLineDashPattern([], 0); }
      else if (m.t === 'rect') { doc.setFillColor(...hex(m.fill)); doc.setDrawColor(34, 34, 34); doc.setLineWidth(0.15); doc.rect(ox + m.x, oy + m.y, m.w, m.h, 'FD'); }
      else { doc.setTextColor(...hex(m.col)); doc.setFont('courier', m.bold ? 'bold' : 'normal'); doc.setFontSize(m.size / 0.3528); doc.text(m.s, ox + m.at[0], oy + m.at[1], { align: m.anchor === 'end' ? 'right' : m.anchor === 'middle' ? 'center' : 'left' }); }
    });
    doc.setFontSize(7); doc.setTextColor(120); doc.setFont('courier', 'normal');
    doc.text(`Site Model Kit · ATU Sligo · check the scale bar before measuring`, sh[1] - 10, sh[2] - 6, { align: 'right' });
    download(doc.output('blob'), fileBase() + `_1-${S.scale}.pdf`);
  };
  $('dScale').value = String(S.scale);
  $('dScale').onchange = e => { S.scale = +e.target.value; save(); drawSection(); };
  $('dlView').onclick = () => { renderer.render(scene, camera); cvs.toBlob(b => b && download(b, fileBase() + `_${S.cam}.png`), 'image/png'); };
  addEventListener('resize', () => drawSection());

  // ------------------------------------------------------------------ controls
  const bindCheck = (id, k) => { $(id).checked = !!S[k]; $(id).onchange = e => { S[k] = e.target.checked; save(); applyCut(); }; };
  bindCheck('cPoche', 'poche'); bindCheck('cGround', 'ground'); bindCheck('cScan', 'scan'); bindCheck('cCut', 'cut');
  const showDepth = () => $('oDepth').textContent = S.depth > 200 ? 'everything' : `${S.depth} m`;
  $('depth').value = S.depth; showDepth();
  $('depth').oninput = e => { S.depth = +e.target.value; showDepth(); applyCut(); save(); };
  $('above').value = S.above;
  $('above').oninput = e => { S.above = +e.target.value; syncAbove(); applyCut(); save(); };
  $('flip').onclick = () => { S.look = -S.look; save(); drawPlan(); applyCut(); setCam(S.cam); };
  document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => setCam(b.dataset.cam));
  addEventListener('keydown', e => { if (e.target.matches?.('input, select, textarea')) return; const k = { '1': 'section', '2': 'orbit', '3': 'plan' }[e.key]; if (k) setCam(k); });

  // ------------------------------------------------------------------ scan position
  const aIds = { aYaw: 'yaw', aX: 'x', aY: 'y', aZ: 'z' };
  $('aX').max = Math.ceil(WM); $('aY').max = Math.ceil(DM);
  function showAlign() {
    Object.entries(aIds).forEach(([id, k]) => { $(id).value = T[k]; });
    $('oYaw').textContent = `${(+T.yaw).toFixed(2)}°`; $('oX').textContent = `${(+T.x).toFixed(2)} m`; $('oY').textContent = `${(+T.y).toFixed(2)} m`; $('oZ').textContent = `${T.z >= 0 ? '+' : ''}${(+T.z).toFixed(2)} m`;
  }
  const keepOwn = () => { if (ownName) { S.own[ownName] = Object.assign({}, T); save(); } };
  Object.entries(aIds).forEach(([id, k]) => $(id).oninput = e => { T[k] = +e.target.value; showAlign(); placeScan(); keepOwn(); });
  $('aReset').onclick = () => { T = ownName ? (S.own[ownName] = undefined, { yaw: 0, x: WM / 2, y: DM / 2, z: 0, scale: 1 }) : Object.assign({}, PUB); showAlign(); placeScan(); keepOwn(); };
  $('aAuto').onclick = async () => {
    if (!pts) return;
    const b = $('aAuto'); b.disabled = true; b.textContent = 'Searching…';
    try { const r = await autoAlign(); $('alignNote').textContent = r; } finally { b.disabled = false; b.textContent = 'Find it on the survey'; }
  };
  $('aFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      loading(`Reading ${f.name}…`, 0);
      const bytes = new Uint8Array(await f.arrayBuffer());
      ownName = f.name;
      T = S.own[ownName] ? Object.assign({}, S.own[ownName]) : { yaw: 0, x: WM / 2, y: DM / 2, z: 0, scale: 1 };
      await loadScan(bytes, f.name);
      if (!S.own[ownName]) {                                 // first time: put the scan's centre on the survey's centre, ground near ground
        let sx = 0, sy = 0, zmin = Infinity, n = 0; for (let k = 0; k < pts.length; k += 3) { sx += pts[k]; sy += pts[k + 1]; n++; if (pts[k + 2] < zmin) zmin = pts[k + 2]; }
        const c = toSurvey(sx / n, sy / n, 0); T.x += WM / 2 - c[0]; T.y += DM / 2 - c[1]; T.z = G.lo - zmin - OFF;
        placeScan();
        $('alignNote').textContent = `${f.name} is loaded but not yet placed. Turn it until the roads and walls line up with the plan, then press Find it on the survey.`;
      } else $('alignNote').textContent = `${f.name}, in the position you last gave it.`;
      $('alignBox').open = true; showAlign(); keepOwn(); defaultLine(); drawPlan(); applyCut(); setCam('orbit');
    } catch (err) { loading(err.message || 'That scan could not be read.', 0); }
  };

  // fit: maximise the share of the scan's ground cells that sit within 0.5 m of the survey
  async function autoAlign() {
    const cell = 1, xs = [], ys = [], zs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < pts.length; k += 3) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]); }
    const gw = Math.floor((x1 - x0) / cell) + 1, gh = Math.floor((y1 - y0) / cell) + 1, mn = new Float32Array(gw * gh).fill(Infinity), cnt = new Uint16Array(gw * gh);
    for (let k = 0; k < pts.length; k += 3) { const j = Math.floor((pts[k] - x0) / cell), i = Math.floor((pts[k + 1] - y0) / cell), q = i * gw + j; if (pts[k + 2] < mn[q]) mn[q] = pts[k + 2]; if (cnt[q] < 65535) cnt[q]++; }
    for (let i = 0; i < gh; i++) for (let j = 0; j < gw; j++) {           // ground-like: the lowest cell among its neighbours
      const q = i * gw + j; if (cnt[q] < 3 || mn[q] === Infinity) continue; let lo = mn[q];
      for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < gh && jj < gw) lo = Math.min(lo, mn[ii * gw + jj]); }
      if (mn[q] - lo < 0.6) { xs.push(x0 + (j + 0.5) * cell); ys.push(y0 + (i + 0.5) * cell); zs.push(mn[q]); }
    }
    if (xs.length < 50) return 'Not enough open ground in the scan to fit it automatically. Place it by hand.';
    const pick = n => { const o = []; for (let i = 0; i < n; i++) o.push(Math.floor(i * xs.length / n)); return o; };
    const score = (idx, yaw, tx, ty, s) => {
      const c = Math.cos(rad(yaw)), sn = Math.sin(rad(yaw)), bins = new Uint16Array(400); let valid = 0;
      for (const i of idx) {
        const e = s * (c * xs[i] - sn * ys[i]) + tx, n = s * (sn * xs[i] + c * ys[i]) + ty, g = sample(e, n);
        if (g !== g) continue; valid++;
        const d = g - OFF - s * zs[i], b = Math.floor((d + 100) * 2); if (b >= 0 && b < 400) bins[b]++;
      }
      if (valid < idx.length * 0.6) return [0, 0];
      let best = 0, bi = 0; for (let b = 0; b < 398; b++) { const v = bins[b] + bins[b + 1] + bins[b + 2]; if (v > best) { best = v; bi = b; } }
      return [best / idx.length, bi / 2 - 100 + 0.75];
    };
    const coarse = pick(Math.min(700, xs.length)), fine = pick(Math.min(2500, xs.length));
    const yaw0 = T.yaw, sc = T.scale || 1;
    let best = [score(coarse, T.yaw, T.x, T.y, sc)[0], T.yaw, T.x, T.y];
    // coarse: turn ±10° around the current turn, slide over the whole survey
    for (let yaw = yaw0 - 10; yaw <= yaw0 + 10; yaw += 2) {
      for (let tx = -WM * 0.2; tx <= WM * 1.2; tx += 3) for (let ty = -DM * 0.2; ty <= DM * 1.2; ty += 3) {
        const r = score(coarse, yaw, tx, ty, sc)[0]; if (r > best[0]) best = [r, yaw, tx, ty];
      }
      loading(`Fitting the scan to the survey · ${Math.round((yaw - yaw0 + 10) / 20 * 70)}%`, (yaw - yaw0 + 10) / 20 * 0.7);
      await new Promise(r => setTimeout(r, 0));
    }
    // fine
    let [, yb, xb, yb2] = best, fb = [0];
    for (let yaw = yb - 2; yaw <= yb + 2 + 1e-9; yaw += 0.25) for (let tx = xb - 3; tx <= xb + 3 + 1e-9; tx += 0.25) for (let ty = yb2 - 3; ty <= yb2 + 3 + 1e-9; ty += 0.25) {
      const [r, z] = score(fine, yaw, tx, ty, sc); if (r > fb[0]) fb = [r, yaw, tx, ty, z];
    }
    loaded();
    if (fb[0] < 0.25) return `No good fit found (best ${Math.round(fb[0] * 100)}% of the ground matched). Turn the scan closer by eye and try again.`;
    T = { yaw: +fb[1].toFixed(3), x: +fb[2].toFixed(3), y: +fb[3].toFixed(3), z: +fb[4].toFixed(3), scale: sc };
    showAlign(); placeScan(); keepOwn(); applyCut();
    return `Fitted: ${Math.round(fb[0] * 100)}% of the open ground in the scan is within half a metre of the survey.${fb[0] < 0.5 ? ' That is a weak fit: check the roads and walls line up.' : ''}`;
  }

  // ------------------------------------------------------------------ big screen (controller) and display window
  function caption() {                                       // the big screen's title line
    const el = $('sxCap'); if (!el || !S.A) return;
    el.innerHTML = `<b>${G.esc(pack.name)}</b><span>Section A–B · looking ${$('specLook').textContent} · ${$('specLen').textContent} · ground ${$('specLev').textContent}</span>`;
  }
  function bigLink(on) {
    bigOpen = on;
    const l = $('bigLink'); if (l) { l.textContent = on ? 'Big screen connected' : 'No big screen yet'; l.dataset.on = on ? '1' : '0'; }
    const pv = $('sxPaused'); if (pv) pv.hidden = !pausedHere();
    if (!pausedHere()) wake(2000);
  }
  if (LINK) LINK.onmessage = ({ data: m }) => {
    if (DISPLAY) {
      if (m.t === 'cut' && m.s && m.s.A) {
        const camChanged = m.cam !== S.cam;
        Object.assign(S, m.s);
        if (m.T && !m.own && JSON.stringify(m.T) !== JSON.stringify(T)) { T = Object.assign({}, m.T); placeScan(); }
        const note = $('sxNote'); if (note) note.hidden = !m.own;
        CUTKEYS.forEach(k => { const id = { poche: 'cPoche', ground: 'cGround', scan: 'cScan', cut: 'cCut' }[k]; if (id) $(id).checked = !!S[k]; });
        applyCut(); if (m.final || camChanged) setCam(m.cam);
      } else if (m.t === 'display-ping') lsend({ t: 'display-hello' });
      return;
    }
    if (m.t === 'display-hello') { lastHello = performance.now(); if (!bigOpen) { bigLink(true); lsend(cutMsg(true)); } }
    else if (m.t === 'display-bye') bigLink(false);
    else if (m.t === 'cut-request') lsend(cutMsg(true));
  };
  if (DISPLAY) {
    // full screen with F; the mouse still orbits and zooms here, the cut comes from the controls window
    const hint = $('sxHint'); let quiet;
    const wakeHint = () => { if (!hint) return; hint.classList.remove('quiet'); clearTimeout(quiet); quiet = setTimeout(() => hint.classList.add('quiet'), 3000); };
    wakeHint(); addEventListener('pointermove', wakeHint);
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); (document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : Promise.reject()).catch(() => { }); }
      else if (k === 'r') setCam(S.cam);                    // back to the framed view after orbiting
    });
    addEventListener('pagehide', () => lsend({ t: 'display-bye' }));
    lsend({ t: 'display-hello' }); setInterval(() => lsend({ t: 'display-hello' }), 2000);   // heartbeat
  } else {
    $('openBig').onclick = () => { window.open('sections.html?display&site=' + encodeURIComponent(pack.id), 'sitekit-bigscreen', 'popup,width=1280,height=720'); };
    $('keepHere').checked = !!S.keepHere;
    $('keepHere').onchange = e => { S.keepHere = e.target.checked; save(); bigLink(bigOpen); };
    $('sxShowHere').onclick = () => { S.keepHere = true; $('keepHere').checked = true; save(); bigLink(bigOpen); };
    bigLink(false); lsend({ t: 'display-ping' });
    setInterval(() => { if (bigOpen && performance.now() - lastHello > 6000) bigLink(false); }, 2000);   // the big screen was closed
  }

  // ------------------------------------------------------------------ start
  showAlign();
  const hadLine = !!S.A;
  if (!S.A) defaultLine();
  drawPlan(); applyCut(); resize(); setCam(S.cam, true);
  if (PUB) {
    $('alignNote').textContent = pack.splat.note ? `${pack.splat.note}. Turned ${(+PUB.yaw).toFixed(2)}°, scale ${PUB.scale}.` : 'Position saved with the site.';
    // try the file named in the site pack, then any alternative names (set in data/site.json)
    const names = [PUB.file, ...(PUB.alt || [])];
    const fetchFirst = async () => { let last; for (const n of names) { try { return [await fetchBytes(n), n]; } catch (e) { last = e; } } throw last; };
    fetchFirst().then(([b, n]) => loadScan(b, n)).then(() => {
      if (!hadLine) defaultLine();
      drawPlan(); applyCut(); setCam(S.cam, true); save();
    }).catch(err => { loading(/Could not load/.test(err.message) ? `The scan file is missing: put it in the website folder as ${PUB.file}, or load it under Scan position below.` : (err.message || 'The scan could not be loaded.'), 0); $('alignBox').open = true; });
  } else {
    loading('This site has no scan yet. Load one under Scan position.', 0);
    $('specScan').textContent = 'none yet'; $('alignNote').textContent = 'Load a scan of this site to cut it here. The section drawing below works without one.';
    $('alignBox').open = true; S.ground = true; $('cGround').checked = true; applyCut();
  }
}
