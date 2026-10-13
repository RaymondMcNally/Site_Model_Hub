/* Geometry core for "Your site model": DEM window → contour loops → laser sheets (SVG/DXF) and 1:100 plan data.
   Pure functions, no DOM, so it can be tested in Node. Real-world units are metres; model units are mm. */
(function (root) {
  'use strict';
  // model scale: K = model mm per real metre (5 at 1:200); grid nodes are 2 mm apart on the model, so STEP (m) follows the scale
  let K = 5, STEP = 0.4;
  const setScale = sc => { K = 1000 / (sc || 200); STEP = 2 / K; };
  const NO = -1e4;                          // value used for "outside"

  // D is any object with sample(x, y) → level (m) or NaN, in metres from the site's south-west corner

  // padded window: sel = {x0, y0, size} in metres (SW corner), returns grid incl. 1-cell outside border
  // Survey edges are smoothed: a blurred "inside the survey" field E crosses zero half a node outside the last
  // measured point, and levels are carried a couple of nodes past the edge so outlines don't follow the grid in steps.
  // The square's own edges stay crisp: there the padded border is simply "outside".
  function windowGrid(D, sel) {
    const n = Math.round(sel.size / STEP), j0 = Math.round(sel.x0 / STEP), i0 = Math.round(sel.y0 / STEP);
    const N = n + 1, P = N + 2, V = new Float32Array(P * P).fill(NO), E = new Float32Array(P * P);
    const Q = P + 6, M = new Float32Array(Q * Q);                      // validity, 3 extra nodes each side
    for (let r = 0; r < Q; r++) for (let c = 0; c < Q; c++) { const z = D.sample((j0 + c - 4) * STEP, (i0 + r - 4) * STEP); M[r * Q + c] = z === z ? 1 : 0; }
    const blur = (A, w) => { const B = new Float32Array(A.length); for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) { let s = 0, k = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < w && cc < w) { s += A[rr * w + cc]; k++; } } B[r * w + c] = s / k; } return B; };
    const Mb = blur(blur(M, Q), Q);
    let lo = Infinity, hi = -Infinity, valid = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const z = D.sample((j0 + c) * STEP, (i0 + r) * STEP);
      if (z === z) { V[(r + 1) * P + c + 1] = z; if (z < lo) lo = z; if (z > hi) hi = z; valid++; }
    }
    for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) E[r * P + c] = (Mb[(r + 3) * Q + c + 3] - 0.5) * 2;
    for (let pass = 0; pass < 2; pass++) {                              // carry levels past the survey edge
      const add = [];
      for (let r = 1; r < P - 1; r++) for (let c = 1; c < P - 1; c++) {
        const k = r * P + c; if (V[k] > NO) continue;
        let s = 0, m = 0; for (const d of [-1, 1, -P, P, -P - 1, -P + 1, P - 1, P + 1]) if (V[k + d] > NO) { s += V[k + d]; m++; }
        if (m) add.push(k, s / m);
      }
      for (let i = 0; i < add.length; i += 2) V[add[i]] = add[i + 1];
    }
    for (let k = 0; k < P * P; k++) if (V[k] <= NO) E[k] = Math.min(E[k], -1);
    const U = (k, L) => V[k] <= NO ? NO : Math.min(V[k] - L, E[k]);  // > 0 inside the region above L
    return { V, E, U, P, N, n, x0: j0 * STEP, y0: i0 * STEP, size: n * STEP, lo, hi, coverage: valid / (N * N) };
  }
  const gx = (G, c) => G.x0 + (c - 1) * STEP, gy = (G, r) => G.y0 + (r - 1) * STEP;   // padded index → metres

  // closed loops of the region V >= L (metres)
  function loops(G, L, field) {
    if (!field && G.U) { field = new Float32Array(G.P * G.P); for (let k = 0; k < field.length; k++) field[k] = G.U(k, L); L = 0; }
    const V = field || G.V, P = G.P, at = (r, c) => V[r * P + c];
    const pos = new Map(), adj = new Map();
    const key = (t, r, c) => (t === 'h' ? 0 : 1) * 1e8 + r * 1e4 + c;
    function edgePoint(t, r, c) {
      const k = key(t, r, c); if (pos.has(k)) return k;
      let a, b, x, y;
      if (t === 'h') { a = at(r, c); b = at(r, c + 1); const tt = Math.max(0, Math.min(1, (L - a) / (b - a))); x = gx(G, c + tt); y = gy(G, r); }
      else { a = at(r, c); b = at(r + 1, c); const tt = Math.max(0, Math.min(1, (L - a) / (b - a))); x = gx(G, c); y = gy(G, r + tt); }
      pos.set(k, [x, y]); return k;
    }
    const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
    for (let r = 0; r < P - 1; r++) for (let c = 0; c < P - 1; c++) {
      const v00 = at(r, c), v10 = at(r, c + 1), v11 = at(r + 1, c + 1), v01 = at(r + 1, c);
      const k = (v00 >= L) | (v10 >= L) << 1 | (v11 >= L) << 2 | (v01 >= L) << 3;
      if (k === 0 || k === 15) continue;
      const B = () => edgePoint('h', r, c), T = () => edgePoint('h', r + 1, c), Lf = () => edgePoint('v', r, c), R = () => edgePoint('v', r, c + 1);
      const cen = (v00 + v10 + v11 + v01) / 4 >= L;
      switch (k) {
        case 1: case 14: link(B(), Lf()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(Lf(), R()); break;
        case 4: case 11: link(R(), T()); break;
        case 6: case 9: link(B(), T()); break;
        case 7: case 8: link(Lf(), T()); break;
        case 5: if (cen) { link(B(), R()); link(Lf(), T()); } else { link(B(), Lf()); link(R(), T()); } break;
        case 10: if (cen) { link(B(), Lf()); link(R(), T()); } else { link(B(), R()); link(Lf(), T()); } break;
      }
    }
    const seen = new Set(), out = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = []; let prev = null, cur = start;
      for (let guard = 0; guard < 1e6; guard++) {
        seen.add(cur); loop.push(pos.get(cur));
        const nb = adj.get(cur); const nxt = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = nxt;
        if (cur === start || cur == null || seen.has(cur)) break;
      }
      if (loop.length >= 3) out.push(loop);
    }
    return out;
  }

  function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return -a / 2; }
  function inside(pt, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > pt[1]) !== (p[j][1] > pt[1]) && pt[0] < (p[j][0] - p[i][0]) * (pt[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }
  function simplify(pts, tol) {               // Douglas–Peucker on a closed ring
    if (pts.length < 8) return pts;
    const dp = (a, b) => {
      let md = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1e-12;
      for (let i = a + 1; i < b; i++) { const t = Math.max(0, Math.min(1, ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / L2)); const d = Math.hypot(pts[i][0] - x1 - t * dx, pts[i][1] - y1 - t * dy); if (d > md) { md = d; mi = i; } }
      return md > tol ? [...dp(a, mi).slice(0, -1), ...dp(mi, b)] : [pts[a], pts[b]];
    };
    const half = Math.floor(pts.length / 2);
    const r = [...dp(0, half).slice(0, -1), ...dp(half, pts.length - 1)];
    return r.length >= 3 ? r : pts;
  }
  // group loops into polygons with holes (even-odd nesting)
  function polygons(ls) {
    const items = ls.map(p => ({ p, a: Math.abs(area(p)), depth: 0, parent: -1 })).sort((u, v) => v.a - u.a);
    items.forEach((it, i) => { for (let j = i - 1; j >= 0; j--) if (inside(it.p[0], items[j].p)) { it.parent = j; it.depth = items[j].depth + 1; break; } });
    const polys = []; const idx = new Map();
    items.forEach((it, i) => { if (it.depth % 2 === 0) { idx.set(i, polys.length); polys.push({ outer: it.p, holes: [] }); } });
    items.forEach(it => { if (it.depth % 2 === 1 && idx.has(it.parent)) polys[idx.get(it.parent)].holes.push(it.p); });
    return polys;
  }

  // label anchor: deepest point of region V >= Lh (cells), returns metres + clearance (m)
  function distIn(G, test) {                 // chamfer distance (cells) to the nearest cell outside the mask
    const P = G.P, D = new Float32Array(P * P);
    for (let k = 0; k < P * P; k++) D[k] = test(k) ? 1e9 : 0;
    for (let r = 1; r < P; r++) for (let c = 1; c < P - 1; c++) { const k = r * P + c; D[k] = Math.min(D[k], D[k - P] + 1, D[k - 1] + 1, D[k - P - 1] + 1.414, D[k - P + 1] + 1.414); }
    for (let r = P - 2; r >= 0; r--) for (let c = P - 2; c >= 1; c--) { const k = r * P + c; D[k] = Math.min(D[k], D[k + P] + 1, D[k + 1] + 1, D[k + P + 1] + 1.414, D[k + P - 1] + 1.414); }
    return D;
  }
  function labelSpot(G, test) {
    const P = G.P, D = new Float32Array(P * P);
    for (let k = 0; k < P * P; k++) D[k] = test(k) ? 1e9 : 0;
    for (let r = 1; r < P; r++) for (let c = 1; c < P - 1; c++) { const k = r * P + c; D[k] = Math.min(D[k], D[k - P] + 1, D[k - 1] + 1, D[k - P - 1] + 1.414, D[k - P + 1] + 1.414); }
    for (let r = P - 2; r >= 0; r--) for (let c = P - 2; c >= 1; c--) { const k = r * P + c; D[k] = Math.min(D[k], D[k + P] + 1, D[k + 1] + 1, D[k + P + 1] + 1.414, D[k + P - 1] + 1.414); }
    let best = 0, br = 0, bc = 0;
    for (let r = 1; r < P - 1; r++) for (let c = 1; c < P - 1; c++) { const d = D[r * P + c]; if (d > best) { best = d; br = r; bc = c; } }
    return { x: gx(G, bc), y: gy(G, br), clear: best * STEP };
  }

  // seven-segment stroke text, height h (mm), returns polylines in mm with origin at text centre
  const SEG = { 'A': 'abcefg', 'B': 'cdefg', 'C': 'adef', 'D': 'bcdeg', 'E': 'adefg', 'F': 'aefg', 'G': 'acdef', 'H': 'bcefg', 'J': 'bcde', 'L': 'def', '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g' };
  function strokeText(s, h) {
    const w = h * 0.55, gap = h * 0.32, lines = []; let x = 0;
    for (const ch of s) {
      if (ch === ' ') { x += w * 0.8; continue; }
      if (ch === '.') { lines.push([[x, 0], [x + h * 0.08, 0]]); x += h * 0.25; continue; }
      const segs = SEG[ch] || '';
      const P = { a: [[0, h], [w, h]], b: [[w, h], [w, h / 2]], c: [[w, h / 2], [w, 0]], d: [[0, 0], [w, 0]], e: [[0, h / 2], [0, 0]], f: [[0, h], [0, h / 2]], g: [[0, h / 2], [w, h / 2]] };
      for (const sg of segs) lines.push(P[sg].map(([px, py]) => [px + x, py]));
      x += w + gap;
    }
    const tw = x - gap;
    return { lines: lines.map(l => l.map(([px, py]) => [px - tw / 2, py - h / 2])), w: tw, h };
  }

  // build the whole model: layers at true scale for a board thickness (mm) at 1:200.
  // opts.hollow: keep only a rim (mm) under the next layer up, so offcuts can hold other layers.
  function buildModel(D, sel, board, opts = {}) {
    const G = windowGrid(D, sel), P = G.P, V = G.V;
    setScale(opts.scale); const interval = board / K;            // m per layer (true scale)
    const rim = opts.rim ?? 15, hollow = opts.hollow !== false;
    if (!(G.hi > G.lo)) return { G, layers: [], interval, S: G.size * K };
    const base = opts.base ?? Math.floor(G.lo / interval) * interval;
    const toMM = ([x, y]) => [(x - G.x0) * K, (y - G.y0) * K];
    const levels = [];
    for (let k = 1; base + k * interval <= G.hi + 1e-9; k++) levels.push(+(base + k * interval).toFixed(3));
    const S = G.size * K, layers = [];
    levels.forEach(L => {
      const outline = loops(G, L).map(l => simplify(l, 0.03)).filter(l => Math.abs(area(l)) * K * K > 2).map(l => l.map(toMM));
      if (outline.length) layers.push({ L, outline });
    });
    layers.forEach((ly, i) => {
      ly.k = Math.round((ly.L - base) / interval);
      const nxt = layers[i + 1];
      // piece field: solid region above L, optionally hollowed beneath the next layer
      const F = new Float32Array(P * P);
      let Dn = null;
      if (hollow && nxt) Dn = distIn(G, k => G.U(k, nxt.L) >= 0);
      for (let k = 0; k < P * P; k++) {
        const h = V[k]; if (h <= NO) { F[k] = NO; continue; }
        let f = Math.min(h - ly.L, G.E[k]);
        if (Dn && Dn[k] > 0) f = Math.min(f, (rim - Dn[k] * 2) * 0.05);
        F[k] = f;
      }
      ly.F = F;
      ly.loops = loops(G, 0, F).map(l => simplify(l, 0.03)).filter(l => Math.abs(area(l)) * K * K > 2).map(l => l.map(toMM));
      ly.polys = polygons(ly.outline);
      // engraving: the next layer's outline, without the parts that run along the square edge
      const eng = [];
      if (nxt) nxt.outline.forEach(l => {
        const onEdge = ([x, y]) => x < 0.6 || y < 0.6 || x > S - 0.6 || y > S - 0.6;
        let run = [];
        for (let q = 1; q <= l.length; q++) {
          const pa = l[q - 1], pb = l[q % l.length];
          if (onEdge(pa) && onEdge(pb)) { if (run.length > 1) eng.push(run); run = []; }
          else { if (!run.length) run.push(pa); run.push(pb); }
        }
        if (run.length > 1) eng.push(run);
      });
      ly.engrave = eng;
      // label: inside the strip the next layer covers if it fits, otherwise anywhere on the piece
      const lv = ly.L.toFixed(Math.abs(ly.L % 1) > 1e-6 ? 1 : 0).replace(/^-/, '-');
      const txt = (opts.prefix != null ? opts.prefix + '-' : '') + String(ly.k).padStart(2, '0') + (opts.prefix != null ? '' : ' ' + lv);
      const need = h => strokeText(txt, h).w / 2 / K + 0.3;
      let spot = nxt ? labelSpot(G, k => F[k] >= 0 && G.U(k, nxt.L) >= 0) : null;
      let h = 3.6;
      if (!spot || spot.clear < need(2.4)) { const s2 = labelSpot(G, k => F[k] >= 0); if (!spot || s2.clear > spot.clear) spot = s2; }
      while (h > 1.6 && spot.clear < need(h)) h -= 0.4;
      ly.label = spot.clear >= need(h) ? { text: txt, at: toMM([spot.x, spot.y]), h } : null;
      // nesting mask: grid nodes inside the piece, one 2 mm cell per node
      let cmin = 1e9, cmax = -1, rmin = 1e9, rmax = -1;
      for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) if (F[r * P + c] >= 0) { if (c < cmin) cmin = c; if (c > cmax) cmax = c; if (r < rmin) rmin = r; if (r > rmax) rmax = r; }
      if (cmax < 0) { ly.mask = null; return; }
      const wc = cmax - cmin + 1, hc = rmax - rmin + 1, m = new Uint8Array(wc * hc);
      for (let r = rmin; r <= rmax; r++) for (let c = cmin; c <= cmax; c++) if (F[r * P + c] >= 0) m[(r - rmin) * wc + (c - cmin)] = 1;
      ly.mask = { m, wc, hc, ox: (cmin - 1) * 2 - 1, oy: (rmin - 1) * 2 - 1 };
    });
    layers.forEach(ly => { delete ly.F; });
    return { G, layers: layers.filter(l => l.mask), interval, base, S, hollow, rim };
  }

  // whole site as one model: each layer is hollowed against the next, then cut into pieces along a tile grid.
  // Tile joints shift by half a tile on alternate layers so they never stack. Returns layers[{L,k,outline,pieces[]}].
  async function buildSite(D, widthM, depthM, board, opts = {}, progress) {
    setScale(opts.scale); const tileM = (opts.tileMM || 400) / K, rim = opts.rim ?? 15;
    const G = windowGrid(D, { x0: 0, y0: 0, size: Math.max(widthM, depthM) }), P = G.P, V = G.V;
    const interval = board / K, base = opts.base ?? Math.floor(G.lo / interval) * interval;
    const levels = []; for (let k = 1; base + k * interval <= G.hi + 1e-9; k++) levels.push(+(base + k * interval).toFixed(3));
    const toMM = ([x, y]) => [x * K, y * K];
    const out = levels.map(L => ({ L, k: Math.round((L - base) / interval), outline: loops(G, L).map(l => simplify(l, 0.03)).filter(l => Math.abs(area(l)) * K * K > 2).map(l => l.map(toMM)) })).filter(l => l.outline.length);
    const nodeX = c => G.x0 + (c - 1) * STEP, nodeY = r => G.y0 + (r - 1) * STEP;
    const rows = 'ABCDEFGHJL';
    for (let li = 0; li < out.length; li++) {
      if (progress) { progress(li / out.length); await new Promise(r => setTimeout(r, 0)); }
      const ly = out[li], nxt = out[li + 1];
      const F = new Float32Array(P * P), Dn = nxt ? distIn(G, k => G.U(k, nxt.L) >= 0) : null;
      for (let k = 0; k < P * P; k++) { const h = V[k]; if (h <= NO) { F[k] = NO; continue; } let f = Math.min(h - ly.L, G.E[k]); if (Dn && Dn[k] > 0) f = Math.min(f, (rim - Dn[k] * 2) * 0.05); F[k] = f; }
      const off = ly.k % 2 ? 0 : tileM / 2;
      const nc = Math.ceil((widthM + off) / tileM), nr = Math.ceil((depthM + off) / tileM);
      ly.pieces = [];
      for (let tr = 0; tr < nr; tr++) for (let tc = 0; tc < nc; tc++) {
        const X0 = tc * tileM - off, X1 = X0 + tileM, Y0 = tr * tileM - off, Y1 = Y0 + tileM;
        const c0 = Math.max(0, Math.floor((X0 - G.x0) / STEP)), c1 = Math.min(P - 1, Math.ceil((X1 - G.x0) / STEP) + 2);
        const r0 = Math.max(0, Math.floor((Y0 - G.y0) / STEP)), r1 = Math.min(P - 1, Math.ceil((Y1 - G.y0) / STEP) + 2);
        const Ps = Math.max(c1 - c0, r1 - r0) + 3, Fs = new Float32Array(Ps * Ps).fill(-1);
        let any = false;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const f = F[r * P + c]; if (f <= NO) continue;
          const x = nodeX(c), y = nodeY(r), sd = Math.min(x - X0, X1 - x, y - Y0, Y1 - y);
          const v = Math.min(f, sd); Fs[(r - r0 + 1) * Ps + (c - c0 + 1)] = v; if (v >= 0) any = true;
        }
        if (!any) continue;
        const Gs = { P: Ps, x0: G.x0 + (c0 - 1) * STEP, y0: G.y0 + (r0 - 1) * STEP };   // sub index 1 ↔ global index c0
        // connected parts (8-neighbour)
        const lab = new Int32Array(Ps * Ps), parts = [];
        for (let k = 0; k < Ps * Ps; k++) {
          if (lab[k] || Fs[k] < 0) continue;
          const id = parts.length + 1, stack = [k]; lab[k] = id; let n = 0;
          while (stack.length) { const q = stack.pop(); n++; const qr = Math.floor(q / Ps), qc = q % Ps;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = qr + dr, cc = qc + dc; if (rr < 0 || cc < 0 || rr >= Ps || cc >= Ps) continue; const q2 = rr * Ps + cc; if (!lab[q2] && Fs[q2] >= 0) { lab[q2] = id; stack.push(q2); } } }
          parts.push({ id, n });
        }
        const keep = parts.filter(p => p.n >= 4);
        keep.forEach((pt, pi) => {
          const Fp = new Float32Array(Ps * Ps);
          for (let k = 0; k < Ps * Ps; k++) Fp[k] = lab[k] === pt.id ? Fs[k] : Math.min(-0.01, -Math.abs(Fs[k]));
          const lp = loops(Gs, 0, Fp).map(l => simplify(l, 0.03)).filter(l => Math.abs(area(l)) * K * K > 2).map(l => l.map(toMM));
          if (!lp.length) return;
          const id = `${String(ly.k).padStart(2, '0')}${rows[tr] || 'Z'}${tc + 1}` + (keep.length > 1 ? `.${pi + 1}` : '');
          // engraving: next layer's outline where it crosses this piece (not along the survey edge)
          const inside = ([x, y]) => { const c = Math.round((x / K - Gs.x0) / STEP) + 1, r = Math.round((y / K - Gs.y0) / STEP) + 1; return r >= 0 && c >= 0 && r < Ps && c < Ps && lab[r * Ps + c] === pt.id && Fs[r * Ps + c] > 0.02; };
          const edge = ([x, y]) => { const c = Math.round(x / K / STEP) + 1, r = Math.round(y / K / STEP) + 1; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const e = G.E[(r + dr) * P + c + dc]; if (!(e > 0.15)) return true; } return false; };
          const eng = [];
          if (nxt) nxt.outline.forEach(l => { let run = []; for (let q = 0; q <= l.length; q++) { const pa = l[q % l.length]; if (inside(pa) && !edge(pa)) run.push(pa); else { if (run.length > 1) eng.push(run); run = []; } } if (run.length > 1) eng.push(run); });
          // label in the strip the next layer covers if it fits, otherwise anywhere on the piece
          const txt = id;
          const need = h => strokeText(txt, h).w / 2 / K + 0.3;
          let spot = nxt ? labelSpot(Gs, k => lab[k] === pt.id && Fs[k] >= 0 && (() => { const r = Math.floor(k / Ps) - 1 + r0, c = k % Ps - 1 + c0; return r >= 0 && c >= 0 && r < P && c < P && G.U(r * P + c, nxt.L) >= 0; })()) : null;
          if (!spot || spot.clear < need(2.4)) { const s2 = labelSpot(Gs, k => lab[k] === pt.id && Fs[k] >= 0); if (!spot || s2.clear > spot.clear) spot = s2; }
          let h = 3.6; while (h > 1.6 && spot.clear < need(h)) h -= 0.4;
          const label = spot.clear >= need(h) ? { text: txt, at: toMM([spot.x, spot.y]), h } : null;
          let cmin = 1e9, cmax = -1, rmin = 1e9, rmax = -1;
          for (let r = 0; r < Ps; r++) for (let c = 0; c < Ps; c++) if (lab[r * Ps + c] === pt.id && Fs[r * Ps + c] >= 0) { if (c < cmin) cmin = c; if (c > cmax) cmax = c; if (r < rmin) rmin = r; if (r > rmax) rmax = r; }
          const wc = cmax - cmin + 1, hc = rmax - rmin + 1, m = new Uint8Array(wc * hc);
          for (let r = rmin; r <= rmax; r++) for (let c = cmin; c <= cmax; c++) if (lab[r * Ps + c] === pt.id && Fs[r * Ps + c] >= 0) m[(r - rmin) * wc + (c - cmin)] = 1;
          const mask = { m, wc, hc, ox: (Gs.x0 + (cmin - 1) * STEP) * K - 1, oy: (Gs.y0 + (rmin - 1) * STEP) * K - 1 };
          ly.pieces.push({ id, k: ly.k, L: ly.L, loops: lp, polys: polygons(lp), engrave: eng, label, mask });
        });
      }
    }
    if (progress) progress(1);
    return { G, layers: out, interval, base, widthM, depthM, W: widthM * K, H: depthM * K };
  }

  // raster nesting on a 2 mm grid: bottom-left fill, 4 rotations; holes in rings are used for smaller layers
  async function nestAsync(layers, sheetW, sheetH, progress, margin = 8, gapMM = 3) { return nest(layers, sheetW, sheetH, margin, gapMM, progress); }
  function nest(layers, sheetW, sheetH, margin = 8, gapMM = 3, progress) {
    const RES = 2, g = Math.ceil(gapMM / 2 / RES) + 1;
    const CW = Math.floor((sheetW - 2 * margin) / RES), CH = Math.floor((sheetH - 2 * margin) / RES);
    function rotMask(mk, rot) {
      const { m, wc, hc } = mk, W2 = rot % 2 ? hc : wc, H2 = rot % 2 ? wc : hc, o = new Uint8Array(W2 * H2);
      for (let b = 0; b < hc; b++) for (let a = 0; a < wc; a++) if (m[b * wc + a]) {
        const [a2, b2] = rot === 0 ? [a, b] : rot === 1 ? [hc - 1 - b, a] : rot === 2 ? [wc - 1 - a, hc - 1 - b] : [b, wc - 1 - a];
        o[b2 * W2 + a2] = 1;
      }
      return { m: o, wc: W2, hc: H2 };
    }
    function dilate(mk) {                       // grow by g cells (square), padding the mask
      const W2 = mk.wc + 2 * g, H2 = mk.hc + 2 * g, o = new Uint8Array(W2 * H2);
      for (let b = 0; b < mk.hc; b++) for (let a = 0; a < mk.wc; a++) if (mk.m[b * mk.wc + a])
        for (let db = 0; db <= 2 * g; db++) o.fill(1, (b + db) * W2 + a, (b + db) * W2 + a + 2 * g + 1);
      const runs = [];
      for (let b = 0; b < H2; b++) { let a = 0; while (a < W2) { if (o[b * W2 + a]) { const s = a; while (a < W2 && o[b * W2 + a]) a++; runs.push(b, s, a - 1); } else a++; } }
      return { wc: W2, hc: H2, runs, area: runs.length };
    }
    const sheets = [], placed = [];
    const newSheet = () => { const occ = new Uint8Array(CW * CH), pre = new Int32Array(CH * (CW + 1)); sheets.push({ occ, pre, free: CW * CH, top: 0 }); return sheets.length - 1; };
    const free = (S, x, y, mk) => {
      if (x + mk.wc > CW || y + mk.hc > CH) return false;
      const R = mk.runs;
      for (let i = 0; i < R.length; i += 3) { const row = (y + R[i]) * (CW + 1); if (S.pre[row + x + R[i + 2] + 1] - S.pre[row + x + R[i + 1]] > 0) return false; }
      return true;
    };
    const mark = (S, x, y, mk) => {
      const R = mk.runs, rows = new Set();
      for (let i = 0; i < R.length; i += 3) { const yy = y + R[i]; S.occ.fill(1, yy * CW + x + R[i + 1], yy * CW + x + R[i + 2] + 1); rows.add(yy); S.free -= R[i + 2] - R[i + 1] + 1; }
      rows.forEach(yy => { let acc = 0; const base = yy * (CW + 1); S.pre[base] = 0; for (let xx = 0; xx < CW; xx++) { acc += S.occ[yy * CW + xx]; S.pre[base + xx + 1] = acc; } });
    };
    const order = layers.slice().sort((a, b) => b.mask.wc * b.mask.hc - a.mask.wc * a.mask.hc);
    let done = 0;
    for (const ly of order) {
      if (progress && done++ % 10 === 0) progress(done / order.length);
      let cells = 0; for (const v of ly.mask.m) cells += v;
      const vars = [0, 1, 2, 3].map(rot => ({ rot, mk: dilate(rotMask(ly.mask, rot)) }));
      if (vars.every(v => v.mk.wc > CW || v.mk.hc > CH)) return { error: `${ly.id ? "Piece " + ly.id : "A layer"} is bigger than the sheet. Choose a bigger sheet or a smaller model.` };
      let best = null;
      for (let si = 0; si <= sheets.length && !best; si++) {
        if (si === sheets.length) newSheet();
        const S = sheets[si];
        if (S.free < cells) continue;
        for (const v of vars) {
          for (let y = 0; y + v.mk.hc <= CH; y++) {
            if (best && y > best.y) break;
            let hit = -1;
            for (let x = 0; x + v.mk.wc <= CW; x++) if (free(S, x, y, v.mk)) { hit = x; break; }
            if (hit >= 0) { if (!best || y < best.y || (y === best.y && hit < best.x)) best = { si, x: hit, y, v }; break; }
          }
        }
      }
      mark(sheets[best.si], best.x, best.y, best.v.mk);
      placed.push({ layer: ly, sheet: best.si, cx: best.x, cy: best.y, rot: best.v.rot });
    }
    return { count: sheets.length, placed, sheetW, sheetH, margin, g, RES };
  }
  // map a model-mm point of a layer into sheet coordinates (mm, y up)
  function placer(pr, pl) {
    const mk = pl.layer.mask, Wm = mk.wc * 2, Hm = mk.hc * 2, off = pr.g * pr.RES;
    return ([x, y]) => {
      const u = x - mk.ox, v = y - mk.oy;
      const [u2, v2] = pl.rot === 0 ? [u, v] : pl.rot === 1 ? [Hm - v, u] : pl.rot === 2 ? [Wm - u, Hm - v] : [v, Wm - u];
      return [pr.margin + pl.cx * pr.RES + off + u2, pr.margin + pl.cy * pr.RES + off + v2];
    };
  }
  function sheetPaths(packRes, si) {
    const cut = [], eng = [];
    packRes.placed.filter(p => p.sheet === si).forEach(pl => {
      const T = placer(packRes, pl);
      pl.layer.loops.forEach(l => cut.push({ pts: l.map(T), closed: true }));
      pl.layer.engrave.forEach(l => eng.push({ pts: l.map(T), closed: false }));
      if (pl.layer.label) {
        const st = strokeText(pl.layer.label.text, pl.layer.label.h), [ax, ay] = pl.layer.label.at;
        st.lines.forEach(l => eng.push({ pts: l.map(([x, y]) => T([ax + x, ay + y])), closed: false }));
      }
    });
    return { cut, eng };
  }
  function toSVG(packRes, si, title) {
    const W = packRes.sheetW, H = packRes.sheetH, { cut, eng } = sheetPaths(packRes, si);
    const d = p => 'M' + p.pts.map(([x, y]) => `${x.toFixed(2)},${(H - y).toFixed(2)}`).join(' L') + (p.closed ? ' Z' : '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<title>${title}</title>\n` +
      `<g id="ENGRAVE" fill="none" stroke="#0000ff" stroke-width="0.1">${eng.map(p => `<path d="${d(p)}"/>`).join('')}</g>\n` +
      `<g id="CUT" fill="none" stroke="#ff0000" stroke-width="0.1">${cut.map(p => `<path d="${d(p)}"/>`).join('')}</g>\n</svg>\n`;
  }
  function toDXF(packRes, si) {
    const { cut, eng } = sheetPaths(packRes, si), o = ['0', 'SECTION', '2', 'ENTITIES'];
    const poly = (p, layer, col) => {
      o.push('0', 'POLYLINE', '8', layer, '62', col, '66', '1', '70', p.closed ? '1' : '0');
      p.pts.forEach(([x, y]) => o.push('0', 'VERTEX', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3), '30', '0'));
      o.push('0', 'SEQEND', '8', layer);
    };
    eng.forEach(p => poly(p, 'ENGRAVE', '5')); cut.forEach(p => poly(p, 'CUT', '1'));
    o.push('0', 'ENDSEC', '0', 'EOF');
    return o.join('\n') + '\n';
  }

  // 1:100 plan: contour segments (metres) for levels on a 0.5 m interval
  function planSegments(G, step) {
    const out = [], { V, P } = G, at = (r, c) => V[r * P + c];
    const start = Math.ceil(G.lo / step) * step;
    for (let L = start; L <= G.hi; L = +(L + step).toFixed(3)) {
      const segs = [];
      for (let r = 1; r < P - 2; r++) for (let c = 1; c < P - 2; c++) {
        const a = at(r, c), b = at(r, c + 1), cc = at(r + 1, c + 1), d = at(r + 1, c);
        if (a <= NO || b <= NO || cc <= NO || d <= NO) continue;
        if (G.E && (G.E[r * P + c] < 0 || G.E[r * P + c + 1] < 0 || G.E[(r + 1) * P + c] < 0 || G.E[(r + 1) * P + c + 1] < 0)) continue;
        const k = (a >= L) | (b >= L) << 1 | (cc >= L) << 2 | (d >= L) << 3;
        if (k === 0 || k === 15) continue;
        const li = (p, q) => (L - p) / (q - p);
        const Bp = [gx(G, c + li(a, b)), gy(G, r)], Tp = [gx(G, c + li(d, cc)), gy(G, r + 1)], Lp = [gx(G, c), gy(G, r + li(a, d))], Rp = [gx(G, c + 1), gy(G, r + li(b, cc))];
        const s = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
        switch (k) { case 1: case 14: s(Bp, Lp); break; case 2: case 13: s(Bp, Rp); break; case 3: case 12: s(Lp, Rp); break; case 4: case 11: s(Rp, Tp); break; case 6: case 9: s(Bp, Tp); break; case 7: case 8: s(Lp, Tp); break; case 5: s(Bp, Lp); s(Rp, Tp); break; case 10: s(Bp, Rp); s(Lp, Tp); break; }
      }
      out.push({ L, segs });
    }
    return out;
  }
  function heightAt(G, x, y) {
    const c = (x - G.x0) / STEP + 1, r = (y - G.y0) / STEP + 1, c0 = Math.floor(c), r0 = Math.floor(r), tx = c - c0, ty = r - r0, { V, P } = G;
    const v = [V[r0 * P + c0], V[r0 * P + c0 + 1], V[(r0 + 1) * P + c0], V[(r0 + 1) * P + c0 + 1]];
    if (v.some(z => z <= NO)) return NaN;
    return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
  }

  // ---------- 3D print: the same square as a closed, watertight solid (mm), ready for a slicer.
  // One vertex per grid node (2 mm on the model) on top and on the underside, joined by four walls.
  // opts: base (mm slab under the lowest ground), vex (vertical exaggeration), arrow (north arrow
  // recessed 1 mm into the underside), offset (mm from the bed's front-left corner, number or [x, y]).
  function buildPrint(D, sel, opts = {}) {
    setScale(opts.scale);
    const G = windowGrid(D, sel), P = G.P, N = G.N, sp = STEP * K;          // node spacing in model mm (2 mm)
    const base = opts.base ?? 3, vex = opts.vex ?? 1, arrow = opts.arrow !== false, lo = Math.min(opts.datum ?? G.lo, G.lo);
    const off = Array.isArray(opts.offset) ? opts.offset : [opts.offset ?? 0, opts.offset ?? 0];
    if (!(G.hi > G.lo)) return { G, error: 'outside' };
    const S = (N - 1) * sp, NN = N * N, pos = new Float32Array(NN * 2 * 3);
    // recessed north arrow on the underside: symmetric about the N axis, so it reads the same from below
    const cx = S / 2, cy = S / 2, k = S / 250;
    const head = [[cx, cy + 26 * k], [cx - 13 * k, cy + 6 * k], [cx + 13 * k, cy + 6 * k]];
    const inArrow = (x, y) => arrow && ((Math.abs(x - cx) <= 4.5 * k && y >= cy - 20 * k && y <= cy + 6 * k) || inside([x, y], head));
    const recess = Math.min(1, Math.max(0, base - 1.2));
    let zTop = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = D.sample(G.x0 + c * STEP, G.y0 + r * STEP), h = v === v ? v : lo;  // raw survey (same in every tile); outside: base level
      const x = c * sp, y = r * sp, i = r * N + c, z = base + (h - lo) * K * vex;
      if (z > zTop) zTop = z;
      pos.set([x + off[0], y + off[1], z], i * 3);
      pos.set([x + off[0], y + off[1], inArrow(x, y) ? recess : 0], (NN + i) * 3);
    }
    const T = (c, r) => r * N + c, B = (c, r) => NN + r * N + c;
    const idx = new Uint32Array(((N - 1) * (N - 1) * 2 * 2 + (N - 1) * 4 * 2) * 3); let o = 0;
    const tri = (a, b, c) => { idx[o++] = a; idx[o++] = b; idx[o++] = c; };
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
      tri(T(c, r), T(c + 1, r), T(c + 1, r + 1)); tri(T(c, r), T(c + 1, r + 1), T(c, r + 1));     // top, faces up
      tri(B(c, r), B(c + 1, r + 1), B(c + 1, r)); tri(B(c, r), B(c, r + 1), B(c + 1, r + 1));     // underside, faces down
    }
    for (let c = 0; c < N - 1; c++) {
      tri(T(c, 0), B(c, 0), B(c + 1, 0)); tri(T(c, 0), B(c + 1, 0), T(c + 1, 0));                 // south wall
      const n = N - 1; tri(T(c, n), B(c + 1, n), B(c, n)); tri(T(c, n), T(c + 1, n), B(c + 1, n)); // north wall
    }
    for (let r = 0; r < N - 1; r++) {
      tri(T(0, r), B(0, r + 1), B(0, r)); tri(T(0, r), T(0, r + 1), B(0, r + 1));                 // west wall
      const n = N - 1; tri(T(n, r), B(n, r), B(n, r + 1)); tri(T(n, r), B(n, r + 1), T(n, r + 1)); // east wall
    }
    return { G, positions: pos, indices: idx, size: S, height: zTop, base, vex, arrow };
  }

  // ---------- plaster casting mould: an open box whose floor is the terrain turned upside down.
  // The cast is poured into it face down, so the floor is mirrored east–west; once the cast is lifted
  // out and turned over it reads the right way round with north at the back. The rim sits at the pour
  // line, so filling to the brim and striking off across the rim gives the cast a flat, level base.
  // Inner walls taper from (wall + flare) mm thick at the floor edge to wall mm at the rim, to release.
  // opts: vex, castBase (mm of plaster under the lowest ground), floor (mm under the deepest point),
  // wall, flare (mm), offset (mm, number or [x, y]).
  function buildMould(D, sel, opts = {}) {
    setScale(opts.scale);
    const G = windowGrid(D, sel), P = G.P, N = G.N, sp = STEP * K;
    const vex = opts.vex ?? 1, B = opts.castBase ?? 10, F = opts.floor ?? 2, wall = opts.wall ?? 3, flare = opts.flare ?? 7;
    const lo = Math.min(opts.datum ?? G.lo, G.lo);                           // class tiles share one site datum
    const off = Array.isArray(opts.offset) ? opts.offset : [opts.offset ?? 0, opts.offset ?? 0];
    if (!(G.hi > G.lo)) return { G, error: 'outside' };
    const S = (N - 1) * sp, inset = wall + flare, outer = S + 2 * inset, NN = N * N;
    const t = new Float32Array(NN);                                         // terrain height above lowest ground, mm
    let Tm = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = D.sample(G.x0 + c * STEP, G.y0 + r * STEP), h = v === v ? v : lo, z = (h - lo) * K * vex;
      t[r * N + c] = z; if (z > Tm) Tm = z;
    }
    const rim = F + Tm + B;                                                  // pour line = top of the walls
    const M = 4 * (N - 1), nV = NN + 3 * M + 1, pos = new Float32Array(nV * 3);
    const X0 = off[0] + inset, Y0 = off[1] + inset, cx = X0 + S / 2, cy = Y0 + S / 2;
    // floor: node (c, r) holds the terrain at the mirrored column, turned upside down
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c; pos.set([X0 + c * sp, Y0 + r * sp, F + Tm - t[r * N + (N - 1 - c)]], i * 3);
    }
    // boundary ring of the floor, anticlockwise from the south-west corner
    const ring = [];
    for (let c = 0; c < N - 1; c++) ring.push(c);
    for (let r = 0; r < N - 1; r++) ring.push(r * N + N - 1);
    for (let c = N - 1; c > 0; c--) ring.push((N - 1) * N + c);
    for (let r = N - 1; r > 0; r--) ring.push(r * N);
    // rings: inner top (rim, inner edge), outer top, outer bottom; each a scaled copy of the floor ring
    const ringAt = (k, half, z, base) => {
      const p = ring[k] * 3, x = pos[p], y = pos[p + 1], s = half / (S / 2);
      pos.set([cx + (x - cx) * s, cy + (y - cy) * s, z], (base + k) * 3);
    };
    const IT = NN, OT = NN + M, OB = NN + 2 * M, CEN = NN + 3 * M;
    for (let k = 0; k < M; k++) { ringAt(k, S / 2 + flare, rim, IT); ringAt(k, outer / 2, rim, OT); ringAt(k, outer / 2, 0, OB); }
    pos.set([cx, cy, 0], CEN * 3);
    // explicit winding (anticlockwise seen from outside); the rings run anticlockwise seen from above
    const idx = [], tri = (a, b, c) => idx.push(a, b, c);
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {      // floor faces up into the cavity
      const a = r * N + c, b = a + 1, d = a + N, e = d + 1;
      tri(a, b, e); tri(a, e, d);
    }
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M, f0 = ring[k], f1 = ring[k2];
      tri(IT + k, f1, f0); tri(IT + k, IT + k2, f1);                         // tapered inner wall, faces the cavity
      tri(IT + k, OT + k, OT + k2); tri(IT + k, OT + k2, IT + k2);           // rim, faces up
      tri(OT + k, OB + k, OB + k2); tri(OT + k, OB + k2, OT + k2);           // outer wall, faces out
      tri(OB + k, CEN, OB + k2);                                             // underside, faces down
    }
    // plaster: cavity volume up to the rim (floor cells as prisms, plus the tapered strip round the edge)
    let vol = 0;
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
      const z = (pos[(r * N + c) * 3 + 2] + pos[(r * N + c + 1) * 3 + 2] + pos[((r + 1) * N + c) * 3 + 2] + pos[((r + 1) * N + c + 1) * 3 + 2]) / 4;
      vol += (rim - z) * sp * sp;
    }
    let edgeDepth = 0, minDraft = 90;
    for (let k = 0; k < M; k++) { const d = rim - pos[ring[k] * 3 + 2]; edgeDepth += d; minDraft = Math.min(minDraft, Math.atan(flare / d) * 180 / Math.PI); }
    vol += (edgeDepth / M) * (S * 4) * flare / 2;
    return { G, positions: pos, indices: Uint32Array.from(idx), grid: N, size: outer, inset, cast: S, height: rim,
      castHeight: Tm + B, volume: vol / 1e6, draft: minDraft, vex, mould: true };
  }

  // ---------- CNC carving: the square as a solid block for VCarve Pro (import as a 3D model, rough + finish).
  // Top surface = ground, flat underside, vertical sides; origin at the south-west bottom corner, mm, Z up.
  // opts: base (mm of uncut material under the lowest ground), stock (mm material thickness),
  // fit ('true' keeps 1:200 heights; 'stock' flattens them, never exaggerates, so the model fits the stock),
  // maxCells (grid cells across before the mesh uses every 2nd/3rd… node, to keep the STL a sensible size).
  function buildCarve(D, sel, opts = {}) {
    setScale(opts.scale);
    const G = windowGrid(D, sel), P = G.P, base = opts.base ?? 6, stock = opts.stock ?? 100;
    if (!(G.hi > G.lo)) return { G, error: 'outside' };
    const n = G.N - 1, stride = Math.max(1, Math.ceil(n / (opts.maxCells || 320)));
    const cells = Math.floor(n / stride), N = cells + 1, sp = STEP * K * stride, S = cells * sp;
    const lo = Math.min(opts.datum ?? G.lo, G.lo), reliefMM = (G.hi - lo) * K, trueH = base + reliefMM;
    const fitMM = (opts.span ?? G.hi - lo) * K;                             // relief the fit is worked out from
    const vex = opts.fit === 'stock' && base + fitMM > stock - 0.5 ? Math.max(0.05, (stock - 0.5 - base) / Math.max(1e-6, fitMM)) : 1;
    const NN = N * N, M = 4 * (N - 1), pos = new Float32Array((NN + M + 1) * 3);
    let zTop = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = D.sample(G.x0 + c * stride * STEP, G.y0 + r * stride * STEP), h = v === v ? v : lo, z = base + (h - lo) * K * vex;
      if (z > zTop) zTop = z;
      pos.set([c * sp, r * sp, z], (r * N + c) * 3);
    }
    const ring = [];
    for (let c = 0; c < N - 1; c++) ring.push(c);
    for (let r = 0; r < N - 1; r++) ring.push(r * N + N - 1);
    for (let c = N - 1; c > 0; c--) ring.push((N - 1) * N + c);
    for (let r = N - 1; r > 0; r--) ring.push(r * N);
    const BOT = NN, CEN = NN + M;
    ring.forEach((t, k) => pos.set([pos[t * 3], pos[t * 3 + 1], 0], (BOT + k) * 3));
    pos.set([S / 2, S / 2, 0], CEN * 3);
    const idx = new Uint32Array(((N - 1) * (N - 1) * 2 + M * 3) * 3); let o = 0;
    const tri = (a, b, c) => { idx[o++] = a; idx[o++] = b; idx[o++] = c; };
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {      // ground, faces up
      const a = r * N + c, b = a + 1, d = a + N, e = d + 1; tri(a, b, e); tri(a, e, d);
    }
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M, t0 = ring[k], t1 = ring[k2];
      tri(t0, BOT + k, BOT + k2); tri(t0, BOT + k2, t1);                    // sides, face out
      tri(BOT + k, CEN, BOT + k2);                                           // underside, faces down
    }
    return { G, positions: pos, indices: idx, grid: N, size: S, height: zTop, base, stock, vex, trueH, stride, spacing: sp, carve: true };
  }

  // ---------- waffle (egg-crate) model: interlocking section pieces cut from board.
  // A pieces run west–east at fixed y (A1 = south), slotted from the bottom; B pieces run south–north at fixed x
  // (B1 = west), slotted from the top. Each slot is half the height at the crossing, so the tops meet flush.
  // Piece coordinates: s along the piece (mm, 0 = west end for A, south end for B), z up from the base board.
  // opts: board (mm), spacing (mm between sections), base (mm of solid strip under the lowest ground), datum (m).
  function buildWaffle(D, sel, opts = {}) {
    setScale(opts.scale);
    const G = windowGrid(D, sel), t = opts.board ?? 3, gap = opts.spacing ?? 20, base = opts.base ?? 10;
    if (!(G.hi > G.lo)) return { G, error: 'outside' };
    const lo = Math.min(opts.datum ?? G.lo, G.lo), S = G.size * K;
    const cl = v => Math.min(Math.max(v, 0), S * (1 - 1e-9));            // stay just inside the far edge of the square
    const z = (x, y) => { const h = D.sample(G.x0 + cl(x) / K, G.y0 + cl(y) / K); return base + ((h === h ? h : lo) - lo) * K; };
    const n = Math.max(2, Math.round((S - t) / gap)), pos = [];
    for (let i = 0; i <= n; i++) pos.push(t / 2 + i * (S - t) / n);
    // each piece's top is a polyline: a sample every 1 mm plus a point at every slot edge. Slot heights are
    // tested against that same polyline, so what is cut and what is checked are identical.
    const edges = pos.flatMap(v => [Math.max(0, v - t / 2), Math.min(S, v + t / 2)]);
    const poly = f => { const ss = new Set(); for (let k = 0; k <= Math.ceil(S); k++) ss.add(Math.min(S, k)); edges.forEach(e => ss.add(+e.toFixed(6))); return [...ss].sort((a, b) => a - b).map(s => [s, f(s)]); };
    const at = (pl, s) => { let k = 1; while (k < pl.length - 1 && pl[k][0] < s) k++; const a = pl[k - 1], b = pl[k]; return b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]); };
    const low = (pl, a, b) => { let m = Math.min(at(pl, a), at(pl, b)); pl.forEach(([s, v]) => { if (s >= a && s <= b) m = Math.min(m, v); }); return m; };
    const PA = pos.map(q => poly(s => z(s, q))), PB = pos.map(p => poly(s => z(p, s)));
    // one slot height per crossing, shared by both pieces: half the lowest top across the slot on either piece,
    // so a slot never breaks through where the ground drops away (survey edges, steep banks)
    const HX = pos.map((q, jj) => pos.map((p, ii) => Math.min(low(PA[jj], p - t / 2, p + t / 2), low(PB[ii], q - t / 2, q + t / 2)) / 2));
    const pieces = [];
    const label = (txt, s0) => { const st = strokeText(txt, 3.6); return st.lines.map(l => l.map(([x, y]) => [s0 + x, 5 + y])); };
    const arrow = s0 => [[[s0 - 2.2, 3.4], [s0 + 2.2, 5], [s0 - 2.2, 6.6], [s0 - 2.2, 3.4]]];
    const mids = pos.slice(0, -1).map((p, k) => (p + pos[k + 1]) / 2), mid = mids[Math.floor(mids.length / 2)], end = mids[mids.length - 1];
    const dedupe = o => o.filter((pt, k) => k === 0 || Math.hypot(pt[0] - o[k - 1][0], pt[1] - o[k - 1][1]) > 1e-6);
    // A pieces: along x at y = q, slots from the bottom where B pieces cross
    pos.forEach((q, jj) => {
      const out = [], slots = pos.map((p, ii) => ({ a: Math.max(0, p - t / 2), b: Math.min(S, p + t / 2), h: HX[jj][ii] }));
      const first = slots[0], last = slots[slots.length - 1];
      out.push(first.a <= 1e-6 ? [0, first.h] : [0, 0]);
      slots.forEach((sl, k) => {
        if (k === 0 && sl.a <= 1e-6) { out.push([sl.b, sl.h], [sl.b, 0]); return; }
        if (k === slots.length - 1 && sl.b >= S - 1e-6) { out.push([sl.a, 0], [sl.a, sl.h], [S, sl.h]); return; }
        out.push([sl.a, 0], [sl.a, sl.h], [sl.b, sl.h], [sl.b, 0]);
      });
      if (!(last.b >= S - 1e-6)) out.push([S, 0]);
      PA[jj].slice().reverse().forEach(pt => out.push(pt));
      const o = dedupe(out);
      pieces.push({ id: 'A' + (jj + 1), dir: 'A', at: q, outline: o, height: Math.max(...o.map(pt => pt[1])), engrave: [...label('A' + (jj + 1), mid), ...arrow(end)] });
    });
    // B pieces: along y at x = p, slots from the top where A pieces cross
    pos.forEach((p, ii) => {
      const slots = pos.map((q, jj) => ({ a: Math.max(0, q - t / 2), b: Math.min(S, q + t / 2), h: HX[jj][ii] })), out = [[0, 0], [S, 0]];
      const near = (x, y) => Math.abs(x - y) < 1e-6;
      for (const [s, v] of PB[ii].slice().reverse()) {
        const sb = slots.find(sl => near(s, sl.b)), sa = slots.find(sl => near(s, sl.a));
        if (sb) { if (sb.b < S - 1e-6) out.push([s, v]); out.push([sb.b, sb.h], [sb.a, sb.h]); continue; }
        if (sa) { if (sa.a > 1e-6) out.push([s, v]); continue; }
        if (slots.some(sl => s > sl.a && s < sl.b)) continue;
        out.push([s, v]);
      }
      const o = dedupe(out);
      pieces.push({ id: 'B' + (ii + 1), dir: 'B', at: p, outline: o, height: Math.max(...o.map(pt => pt[1])), engrave: [...label('B' + (ii + 1), mid), ...arrow(end)] });
    });
    return { G, pieces, pos, board: t, spacing: (S - t) / n, base, size: S, height: Math.max(...pieces.map(p => p.height)), lo, waffle: true };
  }

  // shelf packing for long thin parts (no rotation): rows across the sheet, tallest first
  function packShelves(pieces, sheetW, sheetH, margin = 8, gap = 4) {
    const order = pieces.slice().sort((a, b) => b.height - a.height), placed = [];
    let sheet = 0, x = margin, y = margin, row = 0;
    for (const pc of order) {
      const w = Math.max(...pc.outline.map(p => p[0])), h = pc.height;
      if (w > sheetW - 2 * margin || h > sheetH - 2 * margin) return { error: `Piece ${pc.id} is bigger than the sheet. Choose a bigger sheet or a smaller model.` };
      if (x + w > sheetW - margin) { x = margin; y += row + gap; row = 0; }
      if (y + h > sheetH - margin) { sheet++; x = margin; y = margin; row = 0; }
      placed.push({ piece: pc, sheet, x, y }); x += w + gap; row = Math.max(row, h);
    }
    return { count: sheet + 1, placed, sheetW, sheetH };
  }
  function shelfPaths(pk, si) {
    const cut = [], eng = [];
    pk.placed.filter(p => p.sheet === si).forEach(({ piece, x, y }) => {
      const T = ([s, z]) => [x + s, y + z];
      cut.push({ pts: piece.outline.map(T), closed: true });
      piece.engrave.forEach(l => eng.push({ pts: l.map(T), closed: false }));
    });
    return { cut, eng };
  }
  function pathsSVG(W, H, cut, eng, title) {
    const d = p => 'M' + p.pts.map(([x, y]) => `${x.toFixed(2)},${(H - y).toFixed(2)}`).join(' L') + (p.closed ? ' Z' : '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<title>${title}</title>\n` +
      `<g id="ENGRAVE" fill="none" stroke="#0000ff" stroke-width="0.1">${eng.map(p => `<path d="${d(p)}"/>`).join('')}</g>\n` +
      `<g id="CUT" fill="none" stroke="#ff0000" stroke-width="0.1">${cut.map(p => `<path d="${d(p)}"/>`).join('')}</g>\n</svg>\n`;
  }
  function pathsDXF(cut, eng) {
    const o = ['0', 'SECTION', '2', 'ENTITIES'];
    const poly = (p, layer, col) => { o.push('0', 'POLYLINE', '8', layer, '62', col, '66', '1', '70', p.closed ? '1' : '0'); p.pts.forEach(([x, y]) => o.push('0', 'VERTEX', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3), '30', '0')); o.push('0', 'SEQEND', '8', layer); };
    eng.forEach(p => poly(p, 'ENGRAVE', '5')); cut.forEach(p => poly(p, 'CUT', '1'));
    o.push('0', 'ENDSEC', '0', 'EOF'); return o.join('\n') + '\n';
  }

  // engraved relief: heights on a fine pixel grid (row 0 = north, for an image), metres; NaN outside the survey
  function reliefGrid(D, sel, px) {
    const G = windowGrid(D, sel), out = new Float32Array(px * px);
    for (let r = 0; r < px; r++) { const y = G.y0 + (1 - (r + 0.5) / px) * G.size; for (let c = 0; c < px; c++) out[r * px + c] = D.sample(G.x0 + (c + 0.5) / px * G.size, y); }
    return { G, h: out, px };
  }

  function printSTL(m, name = 'site') {                                  // binary STL, mm
    const n = m.indices.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), p = m.positions;
    const hdr = ('Site model ' + name).slice(0, 79); for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 127);
    dv.setUint32(80, n, true); let o = 84;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, p[v], true); dv.setFloat32(o + 4, p[v + 1], true); dv.setFloat32(o + 8, p[v + 2], true); o += 12; }
      o += 2;
    }
    return buf;
  }

  // 3MF package parts (path → text). Zip them with any zipper; the model is in millimetres.
  function print3MFParts(m, meta = {}) {
    const p = m.positions, I = m.indices, v = [], t = [];
    for (let i = 0; i < p.length; i += 3) v.push(`<vertex x="${p[i].toFixed(3)}" y="${p[i + 1].toFixed(3)}" z="${p[i + 2].toFixed(3)}"/>`);
    for (let i = 0; i < I.length; i += 3) t.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const md = Object.entries(meta).map(([k, s]) => `<metadata name="${esc(k)}">${esc(s)}</metadata>`).join('');
    const x = '<?xml version="1.0" encoding="UTF-8"?>\n';
    return {
      '[Content_Types].xml': x + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      '_rels/.rels': x + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      '3D/3dmodel.model': x + `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">${md}<resources><object id="1" type="model" name="${esc(meta.Title || 'Site model')}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
    };
  }

  const api = { get STEP() { return STEP; }, setScale, buildSite, nestAsync, windowGrid, loops, polygons, buildModel, nest, toSVG, toDXF, sheetPaths, planSegments, heightAt, strokeText, area, buildPrint, buildMould, buildCarve, buildWaffle, packShelves, shelfPaths, pathsSVG, pathsDXF, reliefGrid, printSTL, print3MFParts };
  if (typeof module !== 'undefined') module.exports = api; else root.MyModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
