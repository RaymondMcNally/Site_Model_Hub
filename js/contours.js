(async function () {
  'use strict';
  const G = await window.loadSite('contours.html'); if (!G) return;
  const { css, $, esc, W, H, M2R, GW, GH, ST, at, height, contour, Plan, pack, levels, CI, fmt, feats, KINDS } = G;
  fillSite(G);
  const plans = [];
  const redrawAll = () => plans.forEach(p => { p.size(); p.draw(); });

  // ================= 01 LAYERS =================
  // The hill built from sheets of board, one per contour, like the student model. The slider sets the top sheet;
  // its edge is the contour at that level.
  const lvl = $('lvl');
  lvl.min = levels[0]; lvl.max = levels[levels.length - 1]; lvl.step = CI;
  lvl.value = levels[Math.floor(levels.length * 0.35)];
  const L0 = levels[0] - CI;                                            // the baseboard: below the first contour
  const kOf = L => Math.round((L - L0) / CI);                           // sheet number of a level
  const qOf = (h, L) => Math.min(L0 + Math.floor((h - L0) / CI + 1e-6) * CI, L);   // level of the sheet a point sits on
  const tone = (q, L) => q >= L - 1e-9 ? css('--sheet-top') : (kOf(q) % 2 ? css('--sheet-a') : css('--sheet-b'));
  const slicePlan = Plan($('slicePlan'));
  slicePlan.draw = () => {
    const L = +lvl.value, P = slicePlan, c = P.ctx;
    P.base({ contourAlpha: 0, labels: false });
    const cs = P.s * ST + 0.6;
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
      const h = at(i, j); if (h !== h) continue;
      c.fillStyle = tone(qOf(h, L), L);
      c.fillRect(P.X(j * ST) - P.s * ST / 2, P.Y(i * ST) - P.s * ST / 2, cs, cs);
    }
    levels.filter(v => v < L - 1e-9).forEach(v => { const ix = G.IDX && Math.abs(v / G.IDX - Math.round(v / G.IDX)) < 1e-6; P.segs(contour(v), css('--ink'), ix ? 1.1 : 0.6, ix ? 0.6 : 0.35); });
    P.segs(contour(L), css('--cut'), 2.6, 1);
    P.features({ alpha: 0.7, tags: 'focus' }); P.north();
  };
  plans.push(slicePlan);

  const stage = $('sliceStage'), glc = $('sliceGL');
  let render3d = () => {};
  if (window.THREE) {
    const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), R = Math.max(W, H);
    const cam = new THREE.PerspectiveCamera(30, 1, R / 100, R * 30);
    const ctl = new THREE.OrbitControls(cam, glc); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x80857f, 0.6));
    const sun = new THREE.DirectionalLight(0xfff4e6, 0.75); sun.position.set(-R * 0.5, R * 0.7, -R * 0.35); scene.add(sun);
    const Yof = h => (h - L0) * 5;
    // ghost of the real ground
    const pos = new Float32Array(GW * GH * 3), idx = [];
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) { const h = at(i, j), k = (i * GW + j) * 3; pos[k] = j * ST - W / 2; pos[k + 1] = h === h ? Yof(h) : 0; pos[k + 2] = -(i * ST - H / 2); }
    for (let i = 0; i < GH - 1; i++) for (let j = 0; j < GW - 1; j++) {
      const a = i * GW + j, b = a + 1, c = a + GW, d = c + 1;
      if (at(i, j) !== at(i, j) || at(i, j + 1) !== at(i, j + 1) || at(i + 1, j) !== at(i + 1, j) || at(i + 1, j + 1) !== at(i + 1, j + 1)) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const ghost = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x7d827c, roughness: 0.95, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    ghost.renderOrder = 2; scene.add(ghost);
    // stepped sheets on a grid of at most ~260 cells across, so the stack rebuilds quickly
    const sd = Math.max(1, Math.ceil(Math.max(GW, GH) / 260)), SW = Math.floor((GW - 1) / sd) + 1, SH = Math.floor((GH - 1) / sd) + 1, SS = ST * sd;
    const hs = new Float32Array(SW * SH); for (let i = 0; i < SH; i++) for (let j = 0; j < SW; j++) hs[i * SW + j] = at(i * sd, j * sd);
    const stepMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    let steps = null; const col = new THREE.Color();
    const buildSteps = L => {
      const Pp = [], C = [], half = SS / 2, ok = (i, j) => i >= 0 && j >= 0 && i < SH && j < SW && hs[i * SW + j] === hs[i * SW + j];
      const quad = (a, b, c, d, cl) => { Pp.push(...a, ...b, ...c, ...a, ...c, ...d); for (let n = 0; n < 6; n++) C.push(cl.r, cl.g, cl.b); };
      const shade = (q, k) => { col.set(tone(q, L)); return col.clone().multiplyScalar(k); };
      for (let i = 0; i < SH; i++) for (let j = 0; j < SW; j++) {
        if (!ok(i, j)) continue;
        const q = qOf(hs[i * SW + j], L), y = Yof(q), x = j * SS - W / 2, z = -(i * SS - H / 2);
        quad([x - half, y, z + half], [x + half, y, z + half], [x + half, y, z - half], [x - half, y, z - half], shade(q, 1));
        for (const [di, dj] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const ni = i + di, nj = j + dj, nq = ok(ni, nj) ? qOf(hs[ni * SW + nj], L) : L0 - CI;
          if (nq >= q) continue;
          const y0 = Yof(Math.max(nq, L0 - CI)), cl = shade(q, 0.72);
          if (dj === 1) quad([x + half, y0, z + half], [x + half, y0, z - half], [x + half, y, z - half], [x + half, y, z + half], cl);
          if (dj === -1) quad([x - half, y0, z - half], [x - half, y0, z + half], [x - half, y, z + half], [x - half, y, z - half], cl);
          if (di === 1) quad([x + half, y0, z - half], [x - half, y0, z - half], [x - half, y, z - half], [x + half, y, z - half], cl);
          if (di === -1) quad([x - half, y0, z + half], [x + half, y0, z + half], [x + half, y, z + half], [x - half, y, z + half], cl);
        }
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); sg.computeVertexNormals();
      return new THREE.Mesh(sg, stepMat);
    };
    const lineMat = new THREE.LineBasicMaterial({ color: 0xc0432a });
    let lines = null;
    const setLevel = L => {
      if (steps) { scene.remove(steps); steps.geometry.dispose(); }
      steps = buildSteps(L); scene.add(steps);
      if (lines) { scene.remove(lines); lines.geometry.dispose(); }
      const sg = contour(L), p = new Float32Array(sg.length / 2 * 3);
      for (let k = 0, m = 0; k < sg.length; k += 2, m += 3) { p[m] = sg[k] - W / 2; p[m + 1] = Yof(L) + R / 2000; p[m + 2] = -(sg[k + 1] - H / 2); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      lines = new THREE.LineSegments(lg, lineMat); lines.renderOrder = 3; scene.add(lines);
    };
    let moved = false; ctl.addEventListener('start', () => moved = true);
    const fit = () => {
      const r = stage.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix();
      if (!moved) {
        const vf = THREE.MathUtils.degToRad(cam.fov) / 2, hf = Math.atan(Math.tan(vf) * cam.aspect);
        const d = Math.hypot(W, H) * 0.48 / Math.sin(Math.min(vf, hf));       // the whole site in view, whatever its shape
        cam.position.copy(new THREE.Vector3(-0.45, 0.62, 0.64).normalize().multiplyScalar(d)); ctl.target.set(0, (G.hi - L0) * 2, 0); ctl.update();
      }
    };
    render3d = () => { scene.background = new THREE.Color(css('--stage')); lineMat.color.set(css('--cut')); setLevel(+lvl.value); };
    new ResizeObserver(fit).observe(stage); fit(); render3d();
    lvl.addEventListener('input', () => setLevel(+lvl.value));
    (function loop() { ctl.update(); renderer.render(scene, cam); requestAnimationFrame(loop); })();
  }
  const lvlTxt = () => { $('lvlTxt').textContent = fmt(+lvl.value, CI < 1 ? 1 : 0); const n = kOf(+lvl.value), e = $('lvlSheets'); if (e) e.textContent = n === 1 ? '1 sheet' : n + ' sheets'; };
  lvl.addEventListener('input', () => { lvlTxt(); slicePlan.draw(); }); lvlTxt();
  // build it up one sheet at a time
  const playB = $('lvlPlay'); let playT = null;
  if (playB) playB.onclick = () => {
    if (playT) { clearInterval(playT); playT = null; playB.textContent = 'Stack the sheets'; return; }
    lvl.value = lvl.min; lvl.dispatchEvent(new Event('input')); playB.textContent = 'Stop';
    const dt = Math.max(120, Math.min(450, 14000 / levels.length));
    playT = setInterval(() => {
      if (+lvl.value >= +lvl.max - 1e-9) { clearInterval(playT); playT = null; playB.textContent = 'Stack the sheets'; return; }
      lvl.value = Math.min(+lvl.max, +lvl.value + CI); lvl.dispatchEvent(new Event('input'));
    }, dt);
  };

  // ================= 03 READER =================
  const readable = feats.filter(f => f.note && f.note.trim()).length ? feats.filter(f => f.note && f.note.trim()) : feats.filter(f => f.name);
  const readPlan = Plan($('readPlan'));
  let feat = readable[0] ? readable[0].id : null;
  readPlan.draw = () => { const P = readPlan; P.base({ contourAlpha: 0.8 }); P.features({ hi: feat, alpha: 0.75 }); P.north(); P.scalebar(); };
  plans.push(readPlan);
  const fl = $('feat');
  if (!readable.length) { $('readIntro').textContent = 'No features have been traced for this site yet. Look for the six patterns above on the plan, then label them on your own drawing.'; }
  const split = n => { const m = String(n || '').match(/^([^.]{2,60})\.\s+([\s\S]*)$/); return m ? [m[1], m[2]] : [null, n || '']; };
  fl.innerHTML = readable.map((f, i) => { const [head, body] = split(f.note); return `<li data-k="${esc(f.id)}" tabindex="0" class="${f.id === feat ? 'on' : ''}"><span class="k">${i + 1}</span><div><b>${esc(f.name)}${head ? ' · ' + esc(head.toLowerCase()) : ''}</b><span>${esc(body || KINDS[f.kind]?.label || '')}</span></div></li>`; }).join('');
  const pickFeat = li => { if (!li) return; feat = li.dataset.k; fl.querySelectorAll('li').forEach(x => x.classList.toggle('on', x === li)); readPlan.draw(); };
  fl.addEventListener('click', e => pickFeat(e.target.closest('li')));
  fl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFeat(e.target.closest('li')); } });

  // ================= 04 MEASURE =================
  // presets: across the middle, lowest → highest ground, through the main feature
  let loP = null, hiP = null;
  for (let i = 3; i < GH - 3; i++) for (let j = 3; j < GW - 3; j++) { const h = at(i, j); if (h !== h) continue; if (!loP || h < loP[2]) loP = [j * ST, i * ST, h]; if (!hiP || h > hiP[2]) hiP = [j * ST, i * ST, h]; }
  const inset = (y, x0, x1) => { let a = null, b = null; for (let x = x0; x <= x1; x += ST) { if (height(x, y) === height(x, y)) { if (a == null) a = x; b = x; } } return [a, b]; };
  const PRE = {};
  { const [a, b] = inset(H / 2, 0, W); PRE.we = [[a + 10, H / 2], [b - 10, H / 2]]; }
  { let a = null, b = null; for (let y = 0; y <= H; y += ST) if (height(W / 2, y) === height(W / 2, y)) { if (a == null) a = y; b = y; } PRE.sn = [[W / 2, a + 10], [W / 2, b - 10]]; }
  PRE.lohi = [loP.slice(0, 2), hiP.slice(0, 2)];
  if (G.focusF) { $('presetFocus').hidden = false; $('presetFocus').textContent = 'Through ' + (G.focusF.name || 'the main feature'); const [cx, cy] = G.focus, r = Math.max(60, (G.bbox(G.focusF)[2] - G.bbox(G.focusF)[0])); PRE.focus = [[Math.max(8, cx - r * 1.8), cy], [Math.min(W - 8, cx + r * 1.8), cy]]; }
  let [A, B] = (PRE.focus || PRE.we).map(p => p.slice()), ex = 1, drag = null;
  const mp = Plan($('measurePlan'));
  mp.draw = () => {
    const P = mp, c = P.ctx;
    P.base({ contourAlpha: 0.85 }); P.features({ alpha: 0.7, tags: 'focus' });
    c.strokeStyle = css('--ink'); c.lineWidth = 2.5; c.beginPath(); c.moveTo(P.X(A[0]), P.Y(A[1])); c.lineTo(P.X(B[0]), P.Y(B[1])); c.stroke();
    [[A, 'A'], [B, 'B']].forEach(([p, t]) => {
      c.fillStyle = css('--accent'); c.beginPath(); c.arc(P.X(p[0]), P.Y(p[1]), 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.font = '600 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, P.X(p[0]), P.Y(p[1]) + 0.5);
    });
    P.north(); P.scalebar();
  };
  plans.push(mp);
  const cv = $('measurePlan');
  const evPos = e => { const r = cv.getBoundingClientRect(); return mp.inv(e.clientX - r.left, e.clientY - r.top); };
  const clamp = p => [Math.max(2, Math.min(W - 2, p[0])), Math.max(2, Math.min(H - 2, p[1]))];
  cv.addEventListener('pointerdown', e => {
    const p = evPos(e), dA = Math.hypot(p[0] - A[0], p[1] - A[1]), dB = Math.hypot(p[0] - B[0], p[1] - B[1]), near = 26 / mp.s;
    if (dA < near && dA <= dB) drag = 'A'; else if (dB < near) drag = 'B'; else { A = clamp(p); B = clamp(p); drag = 'B'; }
    cv.setPointerCapture(e.pointerId); update();
  });
  cv.addEventListener('pointermove', e => { if (!drag) return; const p = clamp(evPos(e)); if (drag === 'A') A = p; else B = p; update(); });
  cv.addEventListener('pointerup', () => drag = null);
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { if (!PRE[b.dataset.preset]) return; [A, B] = PRE[b.dataset.preset].map(p => p.slice()); update(); });
  document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { ex = +b.dataset.ex; document.querySelectorAll('[data-ex]').forEach(x => x.setAttribute('aria-pressed', x === b)); section(); });

  const fmtRatio = g => g < 1e-4 ? 'level' : `1:${(1 / g) >= 100 ? Math.round(1 / g) : (1 / g).toFixed(1)}`;
  function samples() {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) * M2R, n = Math.max(2, Math.min(1500, Math.round(len)));
    const s = []; for (let k = 0; k <= n; k++) { const t = k / n, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t; s.push({ d: len * t, h: height(x, y), x, y }); }
    return { len, s };
  }
  function verdict(g) {
    if (g <= 1 / 50) return ['level', 'Level', 'TGD M treats 1:50 or flatter as level: an accessible route needs no ramp features.'];
    if (g <= 1 / 20) return ['gentle', 'Gently sloped', 'Between 1:50 and 1:20: an accessible path without handrails or landings as a ramp.'];
    if (g <= 1 / 12) return ['ramp', 'Ramp territory', 'Steeper than 1:20: needs ramp flights with landings. 1:20 for up to 10 m, 1:15 for up to 5 m, 1:12 for no more than 2 m.'];
    if (g <= 1 / 2) return ['steep', 'Too steep for a ramp', 'Steeper than 1:12: use steps, or wind the route across the slope to make it shallower.'];
    return ['scramble', 'Bank or cliff', 'Steeper than 1:2: a channel side or embankment. Building here means retaining walls.'];
  }
  function update() {
    mp.draw();
    const { len, s } = samples(), ok = s.filter(p => p.h === p.h);
    if (len < 2 || ok.length < 2) {
      ['mLen', 'mRise', 'mGrad', 'mPct', 'mMax', 'mEnds'].forEach(id => $(id).textContent = '—');
      $('verdict').dataset.k = ''; $('verdict').innerHTML = '<b>Drag out a longer line</b><span>Pull the ends at least a few metres apart, inside the survey.</span>';
      section(); return;
    }
    const h0 = ok[0].h, h1 = ok[ok.length - 1].h, rise = h1 - h0, g = Math.abs(rise) / len;
    let mx = 0; for (let k = 5; k < s.length; k++) { const a = s[k - 5].h, b = s[k].h; if (a === a && b === b) mx = Math.max(mx, Math.abs(b - a) / (s[k].d - s[k - 5].d)); }
    $('mLen').textContent = `${len.toFixed(1)} m`;
    $('mRise').textContent = `${rise >= 0 ? '+' : '−'}${Math.abs(rise).toFixed(1)} m`;
    $('mGrad').textContent = fmtRatio(g);
    $('mPct').textContent = `${(g * 100).toFixed(1)}% · ${(Math.atan(g) * 180 / Math.PI).toFixed(1)}°`;
    $('mMax').textContent = mx ? fmtRatio(mx) : '—';
    $('mEnds').textContent = `${fmt(h0)} → ${fmt(h1)}`;
    const [k, t, d] = verdict(g);
    $('verdict').dataset.k = k; $('verdict').innerHTML = `<b>${t}</b><span>${d}${mx > g * 1.6 && mx > 1 / 12 ? ` The steepest 5 m along the line is ${fmtRatio(mx)}, so the route is not even.` : ''}</span>`;
    section();
  }
  function nearLine(poly, s) {
    for (const p of s) for (let k = 1; k < poly.length; k++) {
      const [x1, y1] = poly[k - 1], [x2, y2] = poly[k], dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy)) < 8) return p;
    }
    return null;
  }
  const inPoly = (pt, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > pt[1]) !== (P[j][1] > pt[1]) && pt[0] < (P[j][0] - P[i][0]) * (pt[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  function section() {
    const svg = $('sectionSvg');
    const { len, s } = samples(), ok = s.filter(p => p.h === p.h);
    if (len < 2 || ok.length < 2) { svg.setAttribute('viewBox', '0 0 900 120'); svg.innerHTML = `<text x="450" y="60" text-anchor="middle" fill="${css('--muted')}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="13">Draw a line on the plan to see its section</text>`; return; }
    let lo = Math.min(...ok.map(p => p.h)), hi = Math.max(...ok.map(p => p.h));
    lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
    const ml = 48, mr = 16, mt = 18, mb = 34, VW = 900;
    let sx = (VW - ml - mr) / len, sy = sx * ex, ph = (hi - lo) * sy;
    if (ph > 420) { sy = 420 / (hi - lo); sx = sy / ex; ph = 420; }
    if (ph < 90) { const extra = (90 - ph) / sy / 2; lo -= extra; hi += extra; ph = 90; }
    const VH = Math.round(ph + mt + mb), pw = len * sx, X = d => ml + d * sx, Y = h => mt + (hi - h) * sy;
    const ink = css('--ink'), mut = css('--muted'), rule = css('--rule'), cut = css('--cut'), board = css('--board');
    let o = '';
    const yStep = [1, 2, 5, 10, 20, 50, 100].find(v => v * sy >= 14) || 200;
    for (let h = Math.ceil(lo / yStep) * yStep; h <= hi; h += yStep) {
      o += `<line x1="${ml}" x2="${ml + pw}" y1="${Y(h)}" y2="${Y(h)}" stroke="${rule}" stroke-width="${h % (yStep * 5) ? 0.5 : 1}"/>`;
      o += `<text x="${ml - 6}" y="${Y(h) + 3.5}" text-anchor="end" font-size="10" fill="${mut}" font-family="IBM Plex Mono, ui-monospace, monospace">${h}</text>`;
    }
    const xStep = len > 1000 ? 200 : len > 500 ? 100 : len > 250 ? 50 : len > 100 ? 20 : len > 40 ? 10 : 5;
    for (let d = 0; d <= len + 0.01; d += xStep) o += `<line x1="${X(d)}" x2="${X(d)}" y1="${mt + ph}" y2="${mt + ph + 5}" stroke="${mut}"/><text x="${X(d)}" y="${mt + ph + 17}" text-anchor="middle" font-size="10" fill="${mut}" font-family="IBM Plex Mono, ui-monospace, monospace">${d} m</text>`;
    let path = '', first = true;
    s.forEach(p => { if (p.h !== p.h) { first = true; return; } path += `${first ? 'M' : 'L'}${X(p.d).toFixed(1)},${Y(p.h).toFixed(1)} `; first = false; });
    const fill = `M${X(ok[0].d)},${mt + ph} ` + ok.map(p => `L${X(p.d).toFixed(1)},${Y(p.h).toFixed(1)}`).join(' ') + ` L${X(ok[ok.length - 1].d)},${mt + ph} Z`;
    o += `<path d="${fill}" fill="${board}" opacity=".35"/><path d="${path}" fill="none" stroke="${ink}" stroke-width="2"/>`;
    const mk = (p, text, col) => p && p.h === p.h ? `<line x1="${X(p.d)}" x2="${X(p.d)}" y1="${Y(p.h) - 4}" y2="${Y(p.h) - 22}" stroke="${col}" stroke-width="1.5"/><text x="${X(p.d) + 4}" y="${Y(p.h) - 24}" font-size="10.5" font-weight="600" fill="${col}" font-family="IBM Plex Mono, ui-monospace, monospace">${esc(text)}</text>` : '';
    feats.forEach(f => {
      if (f.kind === 'water' || f.kind === 'road' || f.kind === 'path') o += mk(nearLine(f.P, s), f.name || KINDS[f.kind].label, f.kind === 'water' ? css('--water') : mut);
      else if (f.kind === 'building') {
        const inn = s.filter(p => p.h === p.h && inPoly([p.x, p.y], f.P)); if (!inn.length) return;
        const a = inn[0], b = inn[inn.length - 1];
        o += `<rect x="${X(a.d)}" y="${mt}" width="${Math.max(2, X(b.d) - X(a.d))}" height="${ph}" fill="${css('--gold')}" opacity=".12"/>` + mk(inn[Math.floor(inn.length / 2)], f.name || 'Building', ink);
      }
    });
    o += `<text x="${ml}" y="${mt - 5}" font-size="11" font-weight="600" fill="${cut}" font-family="IBM Plex Mono, ui-monospace, monospace">A</text><text x="${ml + pw}" y="${mt - 5}" text-anchor="end" font-size="11" font-weight="600" fill="${cut}" font-family="IBM Plex Mono, ui-monospace, monospace">B</text>`;
    o += `<text x="${ml + pw}" y="${VH - 2}" text-anchor="end" font-size="10" fill="${mut}" font-family="IBM Plex Mono, ui-monospace, monospace">${ex === 1 ? 'true scale' : 'vertical ×' + ex} · levels in m</text>`;
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`); svg.innerHTML = o;
  }

  // ================= 05 WATER =================
  const wp = Plan($('waterPlan'));
  wp.draw = () => {
    const P = wp, c = P.ctx;
    P.base({ contourAlpha: 0.55, labels: false, shadeAlpha: 0.6 });
    P.features({ alpha: 1, tags: false });
    c.strokeStyle = css('--water'); c.fillStyle = css('--water'); c.lineWidth = 1.3;
    const step = 34 / P.s, e = Math.max(5, ST);
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const h = height(x, y), hx = height(x + e, y) - height(x - e, y), hy = height(x, y + e) - height(x, y - e);
      if (!(h === h && hx === hx && hy === hy)) continue;
      const gx = -hx / (2 * e * M2R), gy = -hy / (2 * e * M2R), m = Math.hypot(gx, gy);
      if (m < 0.01) continue;
      const L = Math.min(1, m / 0.35) * 22 + 5, ux = gx / m, uy = gy / m;
      const x0 = P.X(x) - ux * L / 2, y0 = P.Y(y) + uy * L / 2, x1 = P.X(x) + ux * L / 2, y1 = P.Y(y) - uy * L / 2;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0); c.beginPath(); c.moveTo(x1, y1);
      c.lineTo(x1 - 5 * Math.cos(a - 0.5), y1 - 5 * Math.sin(a - 0.5)); c.lineTo(x1 - 5 * Math.cos(a + 0.5), y1 - 5 * Math.sin(a + 0.5)); c.closePath(); c.fill();
    }
    P.north(); P.scalebar();
  };
  plans.push(wp);

  // ================= 07 QUIZ =================
  const Q = [
    { q: 'On a contour plan, the lines either side of a stream nearly touch. What does that tell you?', o: ['A steep-sided channel or gorge', 'A level terrace', 'A ridge running along the stream'], a: 0, w: 'Close lines mean steep ground. Close lines on both sides of a stream mean a gorge.' },
    { q: 'Where a contour crosses a valley, which way does its V point?', o: ['Downhill, the way the water flows', 'Uphill, upstream', 'It depends on the drawing scale'], a: 1, w: 'In a valley the V points upstream. On a spur or ridge it points downhill.' },
    { q: 'A 1:200 drawing has 1 m contours. Two neighbouring lines are 60 mm apart. What is the gradient?', o: ['1:60', '1:6', '1:12'], a: 2, w: '60 mm at 1:200 is 12 m on the ground. Rising 1 m over 12 m is 1:12, the steepest a short ramp can be.' },
    { q: 'You draw a new level platform on your site plan. How do you show the ground as it was?', o: ['Existing contours dashed, proposed contours solid', 'Delete the old contours under the building', 'Colour the old contours red'], a: 0, w: 'Both stay on the drawing so anyone can read what was cut and filled.' },
    { q: 'Rain falls on an open hillside. Which way does it run?', o: ['Along the contours', 'Square to the contours, downhill', 'Towards the nearest building'], a: 1, w: 'Water takes the steepest route down, which always crosses contours at right angles.' },
  ];
  const quiz = $('quiz'); let score = 0, answered = 0;
  quiz.innerHTML = Q.map((x, i) => `<div class="q" data-i="${i}"><p>${i + 1}. ${x.q}</p><div class="opts">${x.o.map((t, j) => `<button type="button" data-j="${j}">${t}</button>`).join('')}</div><div class="why" hidden></div></div>`).join('');
  quiz.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const box = b.closest('.q'); if (box.dataset.done) return;
    const x = Q[+box.dataset.i], j = +b.dataset.j; box.dataset.done = 1; answered++;
    box.querySelectorAll('button').forEach(btn => { const k = +btn.dataset.j; if (k === x.a) btn.dataset.r = 'right'; else if (k === j) btn.dataset.r = 'wrong'; });
    if (j === x.a) score++;
    const why = box.querySelector('.why'); why.textContent = (j === x.a ? 'Correct. ' : 'Not quite. ') + x.w; why.hidden = false;
    $('score').textContent = `${score} of ${answered} correct so far.`;
  });

  const onTheme = () => { render3d(); redrawAll(); section(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(redrawAll, 80); }).observe(document.querySelector('main'));
  if (document.fonts) document.fonts.ready.then(redrawAll);
  redrawAll(); update();
})();

