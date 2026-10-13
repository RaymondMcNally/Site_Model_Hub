/* Loads the active site pack and provides plan drawing helpers shared by every page.
   Plan units are model millimetres at 1:200 (1 m = 5 mm), origin at the south-west corner, y north. */
(function () {
  'use strict';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAGES = [['index.html', 'Sites'], ['contours.html', 'Contours'], ['sun.html', 'Sun &amp; climate'], ['kit.html', 'Model kit'], ['model.html', 'Your model'], ['advanced.html', 'Advanced']];
  const ADVANCED = ['sections.html', 'project.html', 'setup.html'];       // reached from the Advanced page, not the menu
  const KINDS = {
    water: { label: 'Watercourse', closed: false }, road: { label: 'Road', closed: false }, path: { label: 'Path or track', closed: false },
    building: { label: 'Building or ruin', closed: true }, boundary: { label: 'Site boundary', closed: true }, area: { label: 'Area to point out', closed: true }, point: { label: 'Point', closed: false }
  };

  // ---------- header with page links and a site switcher
  async function chrome(page, pack) {
    const top = $('top'); if (!top) return;
    const q = pack ? `?site=${encodeURIComponent(pack.id)}` : '';
    let opts = '';
    try {
      const all = await SiteKit.list();
      opts = all.map(s => `<option value="${esc(s.id)}" ${pack && s.id === pack.id ? 'selected' : ''}>${esc(s.name)}${s.year ? ' · ' + esc(s.year) : ''}${s.where === 'local' ? ' (this computer)' : ''}</option>`).join('');
    } catch (e) { }
    top.innerHTML = `<div class="wrap"><a class="brand" href="index.html${q}">Site Model Kit <span>${esc(pack ? pack.name : 'No site')}</span></a>
      <div class="navrow"><nav aria-label="Pages">${PAGES.map(([h, t]) => `<a href="${h}${q}"${h === page ? ' class="nav-current" aria-current="page"' : h === 'advanced.html' && ADVANCED.includes(page) ? ' class="nav-current"' : ''}>${t}</a>`).join('')}</nav>
      ${opts ? `<label class="switch"><span class="sr">Site</span><select id="siteSwitch" aria-label="Choose site">${opts}</select></label>` : ''}</div></div>`;
    const sw = $('siteSwitch');
    if (sw) sw.onchange = () => { SiteKit.setActive(sw.value); const u = new URL(location.href); u.searchParams.set('site', sw.value); location.href = u.toString(); };
  }

  // ---------- load
  window.loadSite = async function (page, opts = {}) {
    let res;
    try { res = await SiteKit.activePack(); } catch (e) { res = { pack: null, note: '' }; }
    const pack = res.pack;
    await chrome(page, pack);
    if (!pack) {
      const m = document.querySelector('main');
      if (m && !opts.allowEmpty) m.insertAdjacentHTML('afterbegin', `<div class="wrap nosite"><h1>No site yet.</h1><p class="lede">This page needs a site. <a href="setup.html">Add one from an STL file</a>, or open the site through a web server so the published sites can load.</p></div>`);
      return null;
    }
    if (res.note) document.querySelector('main')?.insertAdjacentHTML('afterbegin', `<div class="wrap"><p class="notice">${esc(res.note)}</p></div>`);
    return build(pack);
  };
  window.SiteView = { build: p => build(p), chrome, KINDS, esc, css };

  function build(pack) {
    const g = SiteKit.decodeGrid(pack.grid), OFF = +pack.levelOffset || 0;
    if (OFF) for (let k = 0; k < g.Z.length; k++) g.Z[k] += OFF;
    const FW = g.w, FH = g.h, FS = g.step, FZ = g.Z;
    const widthM = (FW - 1) * FS, depthM = (FH - 1) * FS;
    const M2R = 0.2, W = widthM * 5, H = depthM * 5;
    let lo = Infinity, hi = -Infinity; for (const v of FZ) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    // real-metre sampler on the fine grid
    function sample(x, y) {
      const fx = x / FS, fy = y / FS, j = Math.floor(fx), i = Math.floor(fy);
      if (i < 0 || j < 0 || i > FH - 1 || j > FW - 1) return NaN;
      const j1 = Math.min(j + 1, FW - 1), i1 = Math.min(i + 1, FH - 1), tx = fx - j, ty = fy - i;
      const a = FZ[i * FW + j], b = FZ[i * FW + j1], c = FZ[i1 * FW + j], d = FZ[i1 * FW + j1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    // coarse grid for plan contours, shadows and 3D (≤ ~700 nodes across)
    const cs = Math.max(1, Math.ceil(Math.max(widthM, depthM) / 700));
    const GW = Math.floor(widthM / cs) + 1, GH = Math.floor(depthM / cs) + 1, ST = cs * 5;
    const Hm = new Float32Array(GW * GH);
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) Hm[i * GW + j] = sample(j * cs, i * cs);
    const at = (i, j) => Hm[i * GW + j];
    const height = (x, y) => sample(x * M2R, y * M2R);                        // plan mm → level (m)

    // contour interval and labelled (index) lines
    const relief = hi - lo;
    const CI = +pack.contourInterval || (relief <= 60 ? 1 : relief <= 150 ? 2 : relief <= 300 ? 5 : 10);
    const IDX = CI * 5;
    const levels = []; for (let L = Math.floor(lo / CI) * CI + CI; L <= hi + 1e-9; L = +(L + CI).toFixed(3)) levels.push(L);
    const relative = !OFF;
    const fmt = (v, dp = 1) => (relative && v > 0 ? '+' : '') + (+v).toFixed(dp);

    // hillshade
    const hill = document.createElement('canvas');
    {
      const k = Math.max(1, Math.ceil(FW / 1400)), w = Math.floor((FW - 1) / k) + 1, h = Math.floor((FH - 1) / k) + 1;
      hill.width = w; hill.height = h;
      const x = hill.getContext('2d'), img = x.createImageData(w, h), D = img.data, cell = FS * k;
            const zat = (i, j) => FZ[Math.min(FH - 1, Math.max(0, i * k)) * FW + Math.min(FW - 1, Math.max(0, j * k))];
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        const z = zat(i, j), o = ((h - 1 - i) * w + j) * 4;
        if (z !== z) continue;
        let dzdx = (zat(i, j + 1) - zat(i, j - 1)) / (2 * cell), dzdy = (zat(i + 1, j) - zat(i - 1, j)) / (2 * cell);
        if (dzdx !== dzdx) dzdx = 0; if (dzdy !== dzdy) dzdy = 0;
        const nl = Math.hypot(dzdx, dzdy, 1), v = Math.max(0, (dzdx * 0.5 - dzdy * 0.5 + 0.7071) / nl);   // light from the north-west, 45° up
        const c = 120 + 135 * v; D[o] = c; D[o + 1] = c; D[o + 2] = c - 4; D[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    }

    // marching squares on the coarse grid (segments, plan mm)
    const segCache = {};
    function contour(L) {
      if (segCache[L]) return segCache[L];
      const out = [], lerp = (p, q, vp, vq) => p + (q - p) * ((L - vp) / (vq - vp));
      for (let i = 0; i < GH - 1; i++) for (let j = 0; j < GW - 1; j++) {
        const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), d = at(i + 1, j);
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const k = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x = j * ST, y = i * ST;
        const T = [lerp(x, x + ST, a, b), y], R = [x + ST, lerp(y, y + ST, b, c)], B = [lerp(x, x + ST, d, c), y + ST], Lf = [x, lerp(y, y + ST, a, d)];
        const s = (p, q) => out.push(p[0], p[1], q[0], q[1]);
        switch (k) {
          case 1: case 14: s(Lf, B); break; case 2: case 13: s(B, R); break; case 3: case 12: s(Lf, R); break; case 4: case 11: s(T, R); break;
          case 5: s(Lf, T); s(B, R); break; case 6: case 9: s(T, B); break; case 7: case 8: s(Lf, T); break; case 10: s(T, R); s(Lf, B); break;
        }
      }
      return (segCache[L] = new Float32Array(out));
    }

    // features in plan mm
    const feats = (pack.features || []).map(f => Object.assign({}, f, { P: (f.pts || []).map(([x, y]) => [x * 5, y * 5]) })).filter(f => f.P.length);
    const centroid = f => { let x = 0, y = 0; f.P.forEach(p => { x += p[0]; y += p[1]; }); return [x / f.P.length, y / f.P.length]; };
    const bbox = f => { const xs = f.P.map(p => p[0]), ys = f.P.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const focusF = feats.find(f => f.id === pack.focus) || null;
    const focus = focusF ? centroid(focusF) : [W / 2, H / 2];
    const north = +pack.north || 0;                                   // degrees: true north measured clockwise from plan up

    function isDark() { const m = css('--paper').match(/#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i); return m ? (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 < 100 : false; }
    const niceLen = m => [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(v => v >= m) || 1000;

    // ---------- plan view helper
    function Plan(canvas) {
      const ctx = canvas.getContext('2d');
      const P = { canvas, ctx, pad: 10, s: 1, dpr: 1, draw: null };
      P.size = () => {
        const w = canvas.parentElement.clientWidth || 600;
        P.dpr = Math.min(devicePixelRatio || 1, 2);
        P.s = (w - 2 * P.pad) / W;
        let h = Math.round(H * P.s + 2 * P.pad);
        const maxH = Math.max(320, innerHeight * 0.8);
        if (h > maxH) { P.s = (maxH - 2 * P.pad) / H; h = Math.round(maxH); }
        P.ox = (w - W * P.s) / 2;
        canvas.width = Math.round(w * P.dpr); canvas.height = Math.round(h * P.dpr);
        canvas.style.height = h + 'px';
      };
      P.X = x => P.ox + x * P.s;
      P.Y = y => P.pad + (H - y) * P.s;
      P.inv = (px, py) => [(px - P.ox) / P.s, H - (py - P.pad) / P.s];
      P.base = (o = {}) => {
        const c = ctx; c.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.fillStyle = css('--paper'); c.fillRect(0, 0, canvas.width, canvas.height);
        c.globalAlpha = (o.shadeAlpha ?? 0.85) * (isDark() ? 0.45 : 1); c.drawImage(hill, P.X(0), P.Y(H), W * P.s, H * P.s); c.globalAlpha = 1;
        const ink = css('--ink'), cut = css('--cut');
        const every = P.s * CI * 5 < 1.6 ? 5 : 1;                     // thin out when the lines would merge
        levels.forEach((L, n) => {
          const idx = Math.abs(L / IDX - Math.round(L / IDX)) < 1e-6;
          if (!idx && every > 1) return;
          P.segs(contour(L), idx ? cut : ink, idx ? 1.1 : 0.45, (o.contourAlpha ?? 1) * (idx ? 0.9 : 0.45));
        });
        if (o.labels !== false) P.labels();
      };
      P.segs = (sg, col, lw, alpha = 1) => {
        const c = ctx; c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha = alpha; c.beginPath();
        for (let k = 0; k < sg.length; k += 4) { c.moveTo(P.X(sg[k]), P.Y(sg[k + 1])); c.lineTo(P.X(sg[k + 2]), P.Y(sg[k + 3])); }
        c.stroke(); c.globalAlpha = 1;
      };
      P.labels = () => {
        const c = ctx, fs = 9.5;
        c.font = `500 ${fs}px "IBM Plex Mono", monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const placed = [], spacing = 150 / P.s, near = 70 / P.s, apart = 110 / P.s;
        levels.filter(L => Math.abs(L / IDX - Math.round(L / IDX)) < 1e-6).forEach(L => {
          const sg = contour(L);
          for (let ax = spacing / 2; ax < W; ax += spacing) for (let ay = spacing / 2; ay < H; ay += spacing) {
            let best = -1, bd = near * near;
            for (let k = 0; k < sg.length; k += 4) { const mx = (sg[k] + sg[k + 2]) / 2, my = (sg[k + 1] + sg[k + 3]) / 2, d = (mx - ax) ** 2 + (my - ay) ** 2; if (d < bd) { bd = d; best = k; } }
            if (best < 0) continue;
            const mx = (sg[best] + sg[best + 2]) / 2, my = (sg[best + 1] + sg[best + 3]) / 2;
            if (placed.some(p => (p[0] - mx) ** 2 + (p[1] - my) ** 2 < apart * apart)) continue;
            placed.push([mx, my]);
            let ang = Math.atan2(-(sg[best + 3] - sg[best + 1]), sg[best + 2] - sg[best]);
            if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
            const t = String(+L.toFixed(1));
            c.save(); c.translate(P.X(mx), P.Y(my)); c.rotate(ang);
            const tw = c.measureText(t).width + 6;
            c.fillStyle = css('--paper'); c.fillRect(-tw / 2, -fs / 2 - 1, tw, fs + 2);
            c.fillStyle = css('--cut'); c.fillText(t, 0, 0.5); c.restore();
          }
        });
      };
      P.line = (pts, col, lw, dash, close) => {
        const c = ctx; c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.lineJoin = 'round'; c.lineCap = 'round';
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(P.X(p[0]), P.Y(p[1])) : c.moveTo(P.X(p[0]), P.Y(p[1]))); if (close) c.closePath(); c.stroke(); c.setLineDash([]);
      };
      P.tag = (x, y, text, bg, fg) => {
        const c = ctx; c.font = '600 11px "IBM Plex Mono", monospace'; c.textBaseline = 'middle'; c.textAlign = 'left';
        const tw = c.measureText(text).width + 10; let px = P.X(x), py = P.Y(y);
        px = Math.min(px, canvas.width / P.dpr - tw - 4); py = Math.max(12, py);
        c.fillStyle = bg; c.fillRect(px, py - 9, tw, 18); c.fillStyle = fg; c.fillText(text, px + 5, py + 0.5);
      };
      P.north = () => {
        const c = ctx, x = P.X(W) - 26, y = P.Y(H) + 34, a = north * Math.PI / 180;
        c.save(); c.translate(x, y); c.rotate(a);
        c.fillStyle = css('--ink'); c.beginPath(); c.moveTo(0, -18); c.lineTo(7, 4); c.lineTo(0, -1); c.lineTo(-7, 4); c.closePath(); c.fill(); c.restore();
        c.font = '600 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillStyle = css('--ink');
        c.fillText('N', x + Math.sin(a) * 30, y - Math.cos(a) * 30 + 4 + (Math.cos(a) > 0.5 ? 46 : 0));
      };
      P.scalebar = () => {
        const m = niceLen(W * M2R / 8), len = m * 5 * P.s, c = ctx, x = P.X(0) + 30, y = P.Y(0) - 30;
        c.fillStyle = css('--ink'); c.fillRect(x, y - 3, len / 2, 4); c.strokeStyle = css('--ink'); c.lineWidth = 1; c.strokeRect(x, y - 3, len, 4);
        c.font = '500 10px "IBM Plex Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(`${m} m`, x + len + 6, y - 1);
      };
      // draw site features; hi = id of one to highlight
      P.features = (o = {}) => {
        const c = ctx, gold = css('--gold') || '#d99a1e', water = css('--water') || '#3a7fae', ink = css('--ink'), paper = css('--paper');
        const a0 = o.alpha ?? 0.9;
        feats.forEach(f => {
          const on = o.hi === f.id; if (f.kind === 'area' && !on && !o.areas) return;
          c.globalAlpha = on ? 1 : a0;
          const cl = KINDS[f.kind]?.closed || f.closed;
          if (f.kind === 'water') P.line(f.P, water, f.width || 2.6);
          else if (f.kind === 'road') { P.line(f.P, isDark() ? '#8d9492' : '#5b625f', 4.5); P.line(f.P, paper, 2.2); }
          else if (f.kind === 'path') P.line(f.P, isDark() ? '#b9a98f' : '#7a6a52', 1.6, [5, 3]);
          else if (f.kind === 'building') { c.fillStyle = ink; c.globalAlpha = (on ? 0.25 : 0.12); c.beginPath(); f.P.forEach((p, i) => i ? c.lineTo(P.X(p[0]), P.Y(p[1])) : c.moveTo(P.X(p[0]), P.Y(p[1]))); c.closePath(); c.fill(); c.globalAlpha = on ? 1 : a0; P.line(f.P, ink, 1.5, [4, 3], true); }
          else if (f.kind === 'boundary') P.line(f.P, css('--accent'), 2, [10, 4, 2, 4], true);
          else if (f.kind === 'area') P.line(f.P, gold, 2.5, [6, 4], true);
          else if (f.kind === 'point') { const [x, y] = f.P[0]; c.fillStyle = ink; c.beginPath(); c.arc(P.X(x), P.Y(y), 4, 0, Math.PI * 2); c.fill(); }
          if (on) P.line(f.P, gold, f.kind === 'water' || f.kind === 'road' ? 6 : 3.5, null, cl);
          c.globalAlpha = 1;
        });
        if (o.tags !== false) feats.forEach(f => {
          if (f.kind === 'area' && o.hi !== f.id) return;
          if (!f.name || (o.tags === 'focus' && f.id !== pack.focus && o.hi !== f.id)) return;
          const on = o.hi === f.id, p = f.kind === 'water' || f.kind === 'road' || f.kind === 'path' ? f.P[Math.floor(f.P.length / 2)] : (() => { const b = bbox(f); return [b[0], b[3] + 6 / P.s + 12 / P.s]; })();
          const bg = on ? gold : f.kind === 'water' ? water : ink, fg = on ? '#1d2120' : f.kind === 'water' ? '#fff' : paper;
          if (f.kind === 'road' && !on) return;
          P.tag(p[0], p[1], f.name, bg, fg);
        });
      };
      return P;
    }

    // sampler object for the model maker (metres, south-west origin)
    const DEM = { sample, widthM, depthM, lo, hi };
    return { pack, css, $, esc, W, H, M2R, GW, GH, ST, cs, Hm, at, height, sample, contour, levels, CI, IDX, lo, hi, relief, fmt, relative, Plan, feats, focus, focusF, north, isDark, hill, DEM, widthM, depthM, KINDS, centroid, bbox, niceLen };
  }
  window.fillSite = function(G) {
  const p = G.pack, set = (k, v, html) => document.querySelectorAll(`[data-site="${k}"]`).forEach(el => { if (html) el.innerHTML = v; else el.textContent = v; });
  set('name', p.name); set('place', p.place || '—');
  set('ll', `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(4)}° ${p.lon >= 0 ? 'E' : 'W'}`);
  set('size', `${G.widthM.toFixed(0)} × ${G.depthM.toFixed(0)} m`);
  set('levels', `${G.fmt(G.lo, 0)} to ${G.fmt(G.hi, 0)} m`);
  set('ci', `${G.CI} m`);
  set('datum', G.relative
    ? `On this site, <strong>0 m is the lowest ground in the survey</strong>. A spot height of ${G.fmt(G.relief / 3)} means ${(G.relief / 3).toFixed(1)} m above that point. It makes levels easy to compare, but they are not heights above sea level.`
    : `On this site, levels are given as entered by your tutor: the lowest ground is <strong>${G.lo.toFixed(1)} m</strong>. Check the drawing's title block for which datum that is.`, true);
  set('survey', G.esc(p.survey ? `Survey: ${p.survey}. Levels on these pages come from the terrain model, so treat them as close, not exact.` : 'Levels on these pages come from the terrain model, so treat them as close, not exact.'));
  document.querySelectorAll('[data-sitelink]').forEach(a => a.href = a.getAttribute('href').split('?')[0] + '?site=' + encodeURIComponent(p.id));
};
})();
