/* Home-page splash. Plays once per browser session over index.html, drawing whichever site is open.
   Each visit picks one of two openings at random:
     laser  — a laser head traces the site's contours on the bed (2D canvas, no libraries)
     sweep  — a scan line passes over a point cloud of the site (three.js, loaded only when picked)
   Replay with ?intro, or force one with ?intro=laser / ?intro=sweep.
   The gate that hides the page before it paints is the small inline script in index.html's <head>. */
(async function () {
  'use strict';
  const doc = document.documentElement;
  if (!doc.classList.contains('intro-pending')) return;
  window.__introStarted = true;

  const css = n => getComputedStyle(doc).getPropertyValue(n).trim();
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = new URLSearchParams(location.search).get('intro');
  const markSeen = () => { try { sessionStorage.setItem('sitekit-intro', '1'); } catch (e) { } };
  const bail = () => { doc.classList.remove('intro-pending', 'intro-open'); markSeen(); };

  // ---------- the open site, as a light grid (≤ ~220 cells across)
  let pack;
  try { pack = (await SiteKit.activePack()).pack; } catch (e) { pack = null; }
  if (!pack) return bail();
  const g = SiteKit.decodeGrid(pack.grid), OFF = +pack.levelOffset || 0;
  const k = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 220));
  const W = Math.floor((g.w - 1) / k) + 1, H = Math.floor((g.h - 1) / k) + 1, ST = g.step * k;
  const Z = new Float32Array(W * H);
  let LO = Infinity, HI = -Infinity, valid = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const v = g.Z[(r * k) * g.w + c * k] + OFF; Z[r * W + c] = v;
    if (v === v) { valid++; if (v < LO) LO = v; if (v > HI) HI = v; }
  }
  if (!valid) return bail();
  const WM = (W - 1) * ST, HM = (H - 1) * ST, SPAN = Math.max(WM, HM), RELIEF = Math.max(0.5, HI - LO);
  const CI = +pack.contourInterval || (RELIEF <= 60 ? 1 : RELIEF <= 150 ? 2 : RELIEF <= 300 ? 5 : 10);
  const EXT = `${Math.round((g.w - 1) * g.step)} × ${Math.round((g.h - 1) * g.step)} m`;

  // ---------- which opening
  let mode = q === 'laser' || q === 'sweep' ? q : Math.random() < 0.5 ? 'laser' : 'sweep';
  if (mode === 'sweep') {
    const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } })();
    if (!gl) mode = 'laser';
    else if (!window.THREE) {
      try { await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/three.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
      catch (e) { mode = 'laser'; }
    }
  }

  // ---------- overlay (a website can set window.SPLASH = { title, lede, label } before this script)
  const SP = window.SPLASH || {}, TITLE = SP.title || 'Site Model <em>Kit</em>', LEDE = SP.lede || 'Any site, layer by layer.';
  const read = mode === 'laser'
    ? `<b>${esc(pack.name)}</b><br>${EXT} · contours every ${CI} m`
    : `<b>${esc(pack.name)}</b><br>${EXT} · ${valid.toLocaleString('en-IE')} survey points`;
  const box = document.createElement('div');
  box.id = 'intro'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', SP.label || 'Site Model Kit');
  box.innerHTML = `<canvas id="intro-cv" aria-hidden="true"></canvas>
    <div class="ov">
      <div class="ov-top"><p class="ov-eb"><b>ATU Sligo</b> · Department of Architecture</p><button class="skip" type="button">Skip</button></div>
      <div class="ov-bot">
        <div><h1 class="ov-title">${TITLE}</h1><p class="ov-lede">${esc(LEDE)}</p></div>
        <div class="ov-cta"><p class="ov-read">${read}</p><button class="enter" type="button">Enter</button></div>
      </div>
    </div>`;
  document.body.appendChild(box);
  doc.classList.add('intro-open'); doc.classList.remove('intro-pending');
  const cv = box.querySelector('#intro-cv');

  // ---------- contour helpers (metres, row 0 = south)
  function segsAt(L) {
    const out = [];
    for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
      const a = Z[r * W + c], b = Z[r * W + c + 1], cc = Z[(r + 1) * W + c + 1], d = Z[(r + 1) * W + c];
      if (!(a === a && b === b && cc === cc && d === d)) continue;
      const kk = (a >= L) | (b >= L) << 1 | (cc >= L) << 2 | (d >= L) << 3; if (kk === 0 || kk === 15) continue;
      const li = (p, q2) => (L - p) / (q2 - p);
      const B = [c + li(a, b), r], T = [c + li(d, cc), r + 1], Lf = [c, r + li(a, d)], R = [c + 1, r + li(b, cc)];
      const s = (p, q2) => out.push([p[0] * ST, p[1] * ST, q2[0] * ST, q2[1] * ST]);
      switch (kk) { case 1: case 14: s(B, Lf); break; case 2: case 13: s(B, R); break; case 3: case 12: s(Lf, R); break; case 4: case 11: s(R, T); break; case 6: case 9: s(B, T); break; case 7: case 8: s(Lf, T); break; case 5: s(B, Lf); s(R, T); break; case 10: s(B, R); s(Lf, T); break; }
    }
    return out;
  }
  function chain(segs) {
    const key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100), ends = new Map(), used = new Uint8Array(segs.length), lines = [];
    segs.forEach((s, i) => { for (const e of [key(s[0], s[1]), key(s[2], s[3])]) (ends.get(e) || ends.set(e, []).get(e)).push(i); });
    const next = kk => (ends.get(kk) || []).find(j => !used[j]);
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const s = segs[i], line = [[s[0], s[1]], [s[2], s[3]]];
      for (const fwd of [true, false]) for (let n = 0; n < 1e5; n++) {
        const end = fwd ? line[line.length - 1] : line[0], j = next(key(end[0], end[1]));
        if (j === undefined) break; used[j] = 1; const t = segs[j];
        const p = key(t[0], t[1]) === key(end[0], end[1]) ? [t[2], t[3]] : [t[0], t[1]];
        if (fwd) line.push(p); else line.unshift(p);
      }
      lines.push(line);
    }
    return lines;
  }
  const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const isIndex = L => Math.abs(L / (5 * CI) - Math.round(L / (5 * CI))) < 1e-6;

  // ---------- opening 1: laser bed
  function laser() {
    const ctx = cv.getContext('2d'), acc = document.createElement('canvas'), actx = acc.getContext('2d');
    const path = []; let total = 0;
    for (let L = Math.ceil(LO / CI) * CI; L < HI; L = +(L + CI).toFixed(6)) {
      if (L <= LO) continue;
      const five = isIndex(L);
      chain(segsAt(L)).forEach(line => {
        let len = 0; for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        if (len < ST * 2) return; path.push({ line, len, five, at: total }); total += len;
      });
    }
    let w = 0, h = 0, s = 1, ox = 0, oy = 0, dpr = 1, drawn = 0;
    const X = x => ox + x * s, Y = y => oy + (HM - y) * s;
    function stroke(it, from, to) {
      actx.strokeStyle = it.five ? css('--cut') : css('--engrave'); actx.lineWidth = (it.five ? 1.7 : 0.95) * dpr; actx.globalAlpha = it.five ? 1 : .8;
      actx.beginPath(); let d = 0, started = false, head = null;
      for (let i = 1; i < it.line.length; i++) {
        const a = it.line[i - 1], b = it.line[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d + l < from) { d += l; continue; }
        const t0 = Math.max(0, (from - d) / l), t1 = Math.min(1, (to - d) / l);
        const pa = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], pb = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        if (!started) { actx.moveTo(X(pa[0]), Y(pa[1])); started = true; } actx.lineTo(X(pb[0]), Y(pb[1])); head = pb;
        d += l; if (d >= to) break;
      }
      actx.stroke(); actx.globalAlpha = 1; return head;
    }
    function advance(to) {
      let head = null;
      for (const it of path) { if (it.at + it.len <= drawn || it.at >= to) continue; head = stroke(it, Math.max(0, drawn - it.at), Math.min(it.len, to - it.at)) || head; }
      drawn = to; return head;
    }
    function bed() {
      ctx.fillStyle = css('--stage'); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = css('--rule'); const gp = 14 * dpr;
      for (let y = gp / 2; y < h; y += gp) for (let x = (Math.round(y / gp) % 2 ? gp / 2 : 0) + gp / 4; x < w; x += gp) ctx.fillRect(x, y, 1.2 * dpr, 1.2 * dpr);
    }
    function resize() {
      dpr = Math.min(devicePixelRatio, 2); w = cv.width = acc.width = Math.round(innerWidth * dpr); h = cv.height = acc.height = Math.round(innerHeight * dpr);
      s = Math.min(w * 0.84 / WM, h * 0.72 / HM); ox = (w - WM * s) / 2; oy = (h - HM * s) / 2 - h * 0.03;
      actx.clearRect(0, 0, w, h); const keep = drawn; drawn = 0; advance(keep);
    }
    const DUR = 4.4;
    return {
      DUR, resize,
      frame(t) {
        const p = Math.min(1, t / DUR), target = total * (p < 1 ? p * p * (3 - 2 * p) * 0.4 + p * 0.6 : 1);
        const head = advance(Math.max(drawn, target));
        bed(); ctx.drawImage(acc, 0, 0);
        if (head && p < 1) {
          const hx = X(head[0]), hy = Y(head[1]), gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, 26 * dpr);
          gr.addColorStop(0, 'rgba(255,240,220,.95)'); gr.addColorStop(.18, 'rgba(255,120,70,.55)'); gr.addColorStop(1, 'rgba(255,90,40,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(hx, hy, 26 * dpr, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 2.2 * dpr, 0, 7); ctx.fill();
          ctx.strokeStyle = css('--muted'); ctx.globalAlpha = .35; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.moveTo(0, hy); ctx.lineTo(w, hy); ctx.stroke(); ctx.globalAlpha = 1;
        }
      },
      dispose() { }
    };
  }

  // ---------- opening 2: survey sweep
  function sweep() {
    const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); R.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1.6, SPAN / 500, SPAN * 20);
    const VEX = Math.min(1.6, Math.max(1, 0.3 * SPAN / RELIEF)), pts = [], hs = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const v = Z[r * W + c]; if (v === v) { pts.push(c * ST - WM / 2, (v - LO) * VEX, -(r * ST - HM / 2)); hs.push(v); } }
    const n = hs.length, geo = new THREE.BufferGeometry(), col = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: ST * 1.4, vertexColors: true, sizeAttenuation: true })));
    const scanM = new THREE.MeshBasicMaterial({ transparent: true, opacity: .07, depthWrite: false, side: THREE.DoubleSide });
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scanM); scan.scale.set(HM * 1.04, RELIEF * VEX * 1.3 + SPAN * 0.03, 1); scan.rotation.y = Math.PI / 2; scene.add(scan);
    const hex = v => new THREE.Color(css(v) || '#888'), white = new THREE.Color(1, 1, 1), tmp = new THREE.Color();
    let bg, ink, eng, cut, grey;
    const paint = () => { bg = hex('--stage'); ink = hex('--ink'); eng = hex('--engrave'); cut = hex('--cut'); grey = hex('--rule').lerp(hex('--muted'), .5); scene.background = bg; scanM.color = eng; };
    paint();
    const BAND = SPAN * 0.08, SETTLE = SPAN * 0.18, DUR = 4.2;
    return {
      DUR, paint,
      resize() { R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / Math.max(1, innerHeight); cam.updateProjectionMatrix(); },
      frame(t) {
        const p = ease(t / DUR), sx = -WM / 2 - BAND + (WM + BAND * 2) * p;
        for (let i = 0; i < n; i++) {
          const d = sx - pts[i * 3];
          if (d < 0) tmp.copy(bg);
          else if (d < BAND) tmp.copy(eng).lerp(ink, .15).lerp(white, (1 - d / BAND) * .55);
          else {
            const hh = hs[i], settle = Math.min(1, (d - BAND) / SETTLE), band = (((hh - LO) / CI) % 1 + 1) % 1;
            tmp.copy(grey).lerp(ink, (hh - LO) / RELIEF * .55);
            if (Math.abs(hh / (5 * CI) - Math.round(hh / (5 * CI))) < 0.06) tmp.lerp(cut, .85 * settle);
            else if (band < .12) tmp.lerp(eng, .45 * settle);
          }
          col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        }
        geo.attributes.color.needsUpdate = true;
        scan.position.set(sx, RELIEF * VEX * 0.55, 0); scan.visible = p < 1;
        const ang = 0.55 + t * 0.06, rad = SPAN * 1.5;
        cam.position.set(Math.sin(ang) * rad, rad * 0.55, Math.cos(ang) * rad); cam.lookAt(0, -SPAN * 0.08, 0);
        R.render(scene, cam);
      },
      dispose() { geo.dispose(); R.dispose(); }
    };
  }

  // ---------- run
  let run;
  try { run = mode === 'sweep' ? sweep() : laser(); }
  catch (e) { try { run = laser(); mode = 'laser'; } catch (e2) { box.remove(); return bail(); } }
  box.dataset.mode = mode;
  run.resize(); addEventListener('resize', run.resize);
  const dark = matchMedia('(prefers-color-scheme: dark)'), onTheme = () => run.paint && run.paint();
  dark.addEventListener('change', onTheme);

  let t0 = performance.now(), phase = 0, raf = 0, done = false;
  if (reduce) t0 -= run.DUR * 1000 + 1000;
  const enterBtn = box.querySelector('.enter');
  function tick(now) {
    const t = (now - t0) / 1000;
    run.frame(t);
    if (phase === 0 && t > run.DUR - 0.7) { phase = 1; box.classList.add('titled'); }
    if (phase === 1 && t > run.DUR + 0.3) { phase = 2; box.classList.add('ready'); }
    if (!done) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function leave() {
    if (done) return; done = true; markSeen();
    box.classList.add('leaving');
    setTimeout(() => {
      cancelAnimationFrame(raf); removeEventListener('resize', run.resize); dark.removeEventListener('change', onTheme);
      try { run.dispose(); } catch (e) { }
      box.remove(); doc.classList.remove('intro-open');
      if (new URLSearchParams(location.search).has('intro')) { const u = new URL(location.href); u.searchParams.delete('intro'); history.replaceState(null, '', u); }
    }, 700);
  }
  box.querySelector('.skip').onclick = leave;
  enterBtn.onclick = leave;
  addEventListener('keydown', function key(e) {
    if (done) { removeEventListener('keydown', key); return; }
    if (e.key === 'Escape' || (e.key === 'Enter' && phase === 2)) { e.preventDefault(); leave(); }
  });
})();
