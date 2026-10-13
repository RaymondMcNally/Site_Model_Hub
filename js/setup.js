(async function () {
  'use strict';
  const $ = id => document.getElementById(id), { esc, KINDS, css } = SiteView;
  const params = new URLSearchParams(location.search), editId = params.get('edit');
  try { const r = await SiteKit.activePack(); SiteView.chrome('setup.html', r.pack); } catch (e) { SiteView.chrome('setup.html', null); }

  let stl = null, stlName = '', pack = null, G = null, feats = [], sel = null, drawing = null;
  const kindOpts = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('fKind').innerHTML = kindOpts; $('pKind').innerHTML = kindOpts; $('iKind').innerHTML = kindOpts;
  $('dYear').value = String(new Date().getFullYear());
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz && !editId) $('dTZ').value = tz; } catch (e) { }
  const enable = on => ['detCard', 'featCard', 'saveCard'].forEach(id => $(id).setAttribute('aria-disabled', on ? 'false' : 'true'));
  const msg = (el, t, s = 'ok') => { $(el).hidden = !t; $(el).textContent = t; $(el).dataset.state = s; };

  // ---------------------------------------------------------------- 1 · STL
  const unitM = () => $('fScale').value === 'custom' ? +$('fUnit').value : +$('fScale').value;
  $('fScale').onchange = () => { $('customWrap').hidden = $('fScale').value !== 'custom'; describeSTL(); };
  $('fUnit').oninput = describeSTL; $('fZ').oninput = describeSTL;
  function describeSTL() {
    if (!stl) return;
    const u = unitM(), w = (stl.max[0] - stl.min[0]) * u, d = (stl.max[1] - stl.min[1]) * u, h = (stl.max[2] - stl.min[2]) * u / (+$('fZ').value || 1);
    const odd = w > 3000 || d > 3000 ? ' That is very large: check the scale.' : w < 20 && d < 20 ? ' That is very small: check the scale.' : '';
    msg('stlMsg', `${stlName}: ${stl.n.toLocaleString()} triangles. At this scale the survey is about ${w.toFixed(0)} × ${d.toFixed(0)} m, with up to ${h.toFixed(1)} m of height including any base.${odd}`, odd ? 'warn' : 'ok');
  }
  async function takeFile(f, all) {
    if (!f) return;
    const files = [...(all || [f])];
    if (files.some(x => /\.tiff?$/i.test(x.name))) return takeTiles(files.filter(x => /\.tiff?$/i.test(x.name)));
    tif = null; $('tifPanel').hidden = true; $('stlOpts').style.display = '';
    msg('stlMsg', 'Reading ' + f.name + '…');
    try { stl = SiteKit.parseSTL(await f.arrayBuffer()); stlName = f.name; $('readBtn').disabled = false; describeSTL(); if (!$('dName').value) $('dName').value = f.name.replace(/\.stl$/i, '').replace(/[_-]+/g, ' ').replace(/\b1 ?(?:to|-)? ?\d{2,4}\b/g, '').trim(); }
    catch (e) { stl = null; $('readBtn').disabled = true; msg('stlMsg', e.message, 'err'); }
  }
  $('stlFile').onchange = e => takeFile(e.target.files[0], e.target.files);
  const drop = $('stlDrop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => takeFile(e.dataTransfer.files[0], e.dataTransfer.files));
  // ---------------------------------------------------------------- 1b · GeoTIFF tiles
  let tif = null, box = null, tifImg = null, tifK = 1;
  async function takeTiles(files) {
    stl = null; $('readBtn').disabled = true; $('stlOpts').style.display = 'none';
    msg('stlMsg', `Reading ${files.length} tile${files.length > 1 ? 's' : ''}…`);
    try {
      const tiles = [];
      for (const f of files) { tiles.push(await DEMImport.readTile(f)); await new Promise(r => setTimeout(r, 0)); }
      tif = DEMImport.mosaic(tiles);
      const crs = DEMImport.crsOf(tif.epsg);
      box = Object.assign({}, tif.dataBox); shadeTiles(); $('tifPanel').hidden = false; drawTiles(); describeBox();
      const cover = tiles.reduce((s, t) => s + t.valid, 0) / tiles.reduce((s, t) => s + t.w * t.h, 0);
      msg('stlMsg', `${files.length} tile${files.length > 1 ? 's' : ''}, ${tif.res} m pixels, ${crs ? crs.name : 'EPSG ' + tif.epsg + ' (unknown to this page: the location will need typing in)'}. ${Math.round(cover * 100)}% of the area has ground data.` +
        (cover < 0.6 ? ' Lidar flown along roads or rivers covers only a strip: draw your box inside the shaded area.' : ''), cover < 0.6 || !crs ? 'warn' : 'ok');
      if (!$('dName').value) $('dName').value = 'New site';
      $('readBtn').disabled = false;
    } catch (e) { tif = null; $('tifPanel').hidden = true; msg('stlMsg', e.message, 'err'); }
  }
  // the mosaic as a shaded image (at most ~900 px across), drawn under the box
  function shadeTiles() {
    tifK = Math.max(1, Math.ceil(Math.max(tif.w, tif.h) / 900));
    const w = Math.ceil(tif.w / tifK), h = Math.ceil(tif.h / tifK), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), im = g.createImageData(w, h), at = (r, q) => tif.Z[Math.min(tif.h - 1, r * tifK) * tif.w + Math.min(tif.w - 1, q * tifK)];
    let lo = Infinity, hi = -Infinity; for (let k = 0; k < tif.Z.length; k += 7) { const v = tif.Z[k]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const sp = tif.res * tifK;
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      const v = at(r, q), k = (r * w + q) * 4;
      if (!(v === v)) { im.data[k] = im.data[k + 1] = im.data[k + 2] = 205; im.data[k + 3] = 255; continue; }
      const dx = ((at(r, q + 1) ?? v) - (at(r, q - 1) ?? v)) / (2 * sp) || 0, dy = ((at(r - 1, q) ?? v) - (at(r + 1, q) ?? v)) / (2 * sp) || 0;
      const sh = Math.max(0, Math.min(1, 0.72 + (-dx + dy) * 0.6)), t = (v - lo) / Math.max(1, hi - lo);
      im.data[k] = (170 + 70 * t) * sh; im.data[k + 1] = (175 + 55 * t) * sh; im.data[k + 2] = (160 + 40 * t) * sh; im.data[k + 3] = 255;
    }
    g.putImageData(im, 0, 0); tifImg = c;
  }
  const TM = $('tifMap');
  const tifScale = () => TM.width / tif.w;                      // canvas px per mosaic pixel
  function drawTiles() {
    if (!tif) return;
    const avail = TM.parentElement.clientWidth || 800, cw = Math.min(avail, 620 * tif.w / tif.h), dpr = Math.min(devicePixelRatio || 1, 2);
    TM.style.width = cw + 'px'; TM.style.margin = '0 auto';
    TM.width = Math.round(cw * dpr); TM.height = Math.round(cw * tif.h / tif.w * dpr); TM.style.height = (cw * tif.h / tif.w) + 'px';
    const g = TM.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(tifImg, 0, 0, TM.width, TM.height);
    const k = tifScale() / tif.res, X = E => (E - tif.E0) * k, Y = N => (tif.N1 - N) * k;
    g.fillStyle = 'rgba(192,67,42,.12)'; g.strokeStyle = '#c0432a'; g.lineWidth = 2 * dpr;
    g.fillRect(X(box.E0), Y(box.N1), (box.E1 - box.E0) * k, (box.N1 - box.N0) * k); g.strokeRect(X(box.E0), Y(box.N1), (box.E1 - box.E0) * k, (box.N1 - box.N0) * k);
  }
  function describeBox() {
    const w = box.E1 - box.E0, d = box.N1 - box.N0, st = +$('tifStep').value || Math.max(tif.res, SiteKit.autoStep(w, d));
    $('tifBox').textContent = `${w.toFixed(0)} × ${d.toFixed(0)} m · sampled every ${Math.max(st, tif.res)} m`;
    const big = Math.max(w, d) > 2500;
    $('tifBoxHint').textContent = big ? 'That is a large area: fine for 1:1000 models and context, but contours will be coarse.' : 'North is up. Grey: no data in the tiles.';
  }
  let tdrag = null;
  const tpos = e => { const r = TM.getBoundingClientRect(), k = (TM.width / r.width) / (tifScale() / tif.res); return [tif.E0 + (e.clientX - r.left) * k, tif.N1 - (e.clientY - r.top) * k]; };
  TM.addEventListener('pointerdown', e => { if (!tif) return; tdrag = tpos(e); TM.setPointerCapture(e.pointerId); });
  TM.addEventListener('pointermove', e => {
    if (!tdrag) return; const p = tpos(e), sn = v => Math.round(v / tif.res) * tif.res;
    const b = { E0: sn(Math.min(tdrag[0], p[0])), E1: sn(Math.max(tdrag[0], p[0])), N0: sn(Math.min(tdrag[1], p[1])), N1: sn(Math.max(tdrag[1], p[1])) };
    b.E0 = Math.max(b.E0, tif.E0); b.E1 = Math.min(b.E1, tif.E1); b.N0 = Math.max(b.N0, tif.N0); b.N1 = Math.min(b.N1, tif.N1);
    if (b.E1 - b.E0 >= 10 * tif.res && b.N1 - b.N0 >= 10 * tif.res) { box = b; drawTiles(); describeBox(); }
  });
  TM.addEventListener('pointerup', () => { tdrag = null; });
  $('tifAll').onclick = () => { if (!tif) return; box = Object.assign({}, tif.dataBox); drawTiles(); describeBox(); };
  $('tifStep').onchange = () => { if (tif) describeBox(); };
  async function readTiles() {
    const g = DEMImport.grid(tif, box, +$('tifStep').value || 0);
    const cE = (box.E0 + box.E1) / 2, cN = (box.N0 + box.N1) / 2, ll = DEMImport.inverse(tif.epsg, cE, cN);
    if (ll) $('dLL').value = `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
    $('dNorth').value = (DEMImport.convergence(tif.epsg, cE, cN) || 0).toFixed(2);
    $('dOff').value = g.groundLevel.toFixed(2);
    const cr = DEMImport.credit(tif); if (cr && !$('dSurvey').value.trim()) $('dSurvey').value = cr;
    $('dLL').dispatchEvent(new Event('input'));
    $('iE').value = box.E0.toFixed(1); $('iN').value = box.N0.toFixed(1);
    return { g, source: { type: 'geotiff', files: tif.names, epsg: tif.epsg, res: tif.res, origin: [box.E0, box.N0], box: [box.E0, box.N0, box.E1, box.N1] } };
  }
  $('readBtn').onclick = async () => {
    if (tif) {
      try {
        const { g, source } = await readTiles();
        const keep = pack ? { id: pack.id, features: pack.features, focus: pack.focus, created: pack.created } : {};
        pack = SiteKit.newPack(Object.assign(readDetails(), { source }), g);
        if (keep.id) Object.assign(pack, keep);
        feats = pack.features;
        msg('stlMsg', `Ground read: ${g.widthM.toFixed(0)} × ${g.depthM.toFixed(0)} m, sampled every ${g.step} m. Levels are real: the lowest ground is ${g.groundLevel.toFixed(1)} m and the highest ${(g.groundLevel + g.hi).toFixed(1)} m (above OD Malin for Irish lidar).` +
          (g.missing > 0.01 ? ` ${Math.round(g.missing * 100)}% of the box has no data and is left out.` : '') + ' Location, north and the survey credit have been filled in below: check them.', g.missing > 0.2 ? 'warn' : 'ok');
        rebuild(); enable(true);
      } catch (e) { msg('stlMsg', e.message, 'err'); }
      return;
    }
    $('readBtn').disabled = true; $('prog').hidden = false;
    try {
      const g = await SiteKit.rasterise(stl, { unitM: unitM(), zFactor: +$('fZ').value || 1 }, p => $('prog').firstElementChild.style.width = (p * 100).toFixed(0) + '%');
      const keep = pack ? { id: pack.id, features: pack.features, focus: pack.focus, created: pack.created } : {};
      pack = SiteKit.newPack(Object.assign(readDetails(), { source: { file: stlName, unitM: unitM(), zFactor: +$('fZ').value || 1, origin: stl.min } }), g);
      if (keep.id) Object.assign(pack, keep);
      feats = pack.features;
      msg('stlMsg', `Ground read: ${g.widthM.toFixed(0)} × ${g.depthM.toFixed(0)} m, ${g.hi.toFixed(1)} m from lowest to highest ground, sampled every ${g.step} m.`);
      rebuild(); enable(true);
    } catch (e) { msg('stlMsg', e.message, 'err'); }
    $('prog').hidden = true; $('readBtn').disabled = false;
  };

  // ---------------------------------------------------------------- 2 · details
  function parseLL(s) {
    s = String(s || '').trim(); if (!s) return null;
    const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi)];
    if (dms.length === 2) {
      const v = dms.map(m => { let d = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; if (/[SW]/i.test(m[4])) d = -d; return { d, ax: /[NS]/i.test(m[4]) ? 'lat' : 'lon' }; });
      const lat = v.find(x => x.ax === 'lat'), lon = v.find(x => x.ax === 'lon'); if (lat && lon) return [lat.d, lon.d];
    }
    const n = s.match(/-?\d+(?:\.\d+)?/g); if (n && n.length >= 2) { const a = +n[0], b = +n[1]; if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b]; }
    return null;
  }
  function readDetails() {
    const ll = parseLL($('dLL').value);
    return {
      name: $('dName').value.trim() || 'New site', place: $('dPlace').value.trim(), year: $('dYear').value.trim(), survey: $('dSurvey').value.trim(),
      notes: $('dNotes').value.trim(), lat: ll ? ll[0] : 53.35, lon: ll ? ll[1] : -7, tz: $('dTZ').value.trim() || 'Europe/Dublin',
      north: +$('dNorth').value || 0, levelOffset: +$('dOff').value || 0, contourInterval: +$('dCI').value || 0, embed: $('dEmbed').value.trim()
    };
  }
  function fillDetails(p) {
    $('dName').value = p.name || ''; $('dPlace').value = p.place || ''; $('dYear').value = p.year || ''; $('dSurvey').value = p.survey || '';
    $('dNotes').value = p.notes || ''; $('dLL').value = `${p.lat}, ${p.lon}`; $('dTZ').value = p.tz || 'Europe/Dublin';
    $('dNorth').value = p.north || 0; $('dOff').value = p.levelOffset || 0; $('dCI').value = String(p.contourInterval || 0); $('dEmbed').value = p.embed || '';
  }
  $('dLL').oninput = () => { const ll = parseLL($('dLL').value); $('llHint').textContent = ll ? `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}` : 'Decimal degrees, or 54°23′56″N 8°24′02″W. The centre of the survey.'; };
  document.querySelectorAll('#detCard input, #detCard select, #detCard textarea').forEach(el => el.addEventListener('change', () => {
    if (!pack) return; const before = [pack.levelOffset, pack.contourInterval, pack.north].join();
    Object.assign(pack, readDetails());
    if ([pack.levelOffset, pack.contourInterval, pack.north].join() !== before) rebuild(); else stats();
  }));

  // ---------------------------------------------------------------- 3 · features
  const P0 = $('fPlan');
  let Pl = null;
  function rebuild() {
    pack.features = feats;
    G = SiteView.build(pack);
    Pl = G.Plan(P0);
    Pl.draw = draw; Pl.size(); draw(); stats(); list();
  }
  function stats() {
    if (!G) return;
    $('oSize').textContent = `${G.widthM.toFixed(0)} × ${G.depthM.toFixed(0)} m`;
    $('oRelief').textContent = `${G.relief.toFixed(1)} m`;
    $('oGrid').textContent = `${pack.grid.step} m · ${pack.grid.w} × ${pack.grid.h}`;
    $('oLayers').textContent = `${Math.ceil(G.relief)} · ${Math.ceil(G.relief) * 5} mm high`;
  }
  const toM = ([x, y]) => [+(x / 5).toFixed(2), +(y / 5).toFixed(2)];
  function syncView() {                     // keep the plan helper's feature list in step with ours
    G.feats.length = 0;
    feats.forEach(f => G.feats.push(Object.assign({}, f, { P: f.pts.map(([x, y]) => [x * 5, y * 5]) })));
  }
  function draw() {
    if (!G) return;
    syncView(); pack.features = feats;
    Pl.base({ contourAlpha: 0.75 });
    Pl.features({ hi: sel, areas: true, tags: true });
    const c = Pl.ctx;
    const f = feats.find(x => x.id === sel);
    if (f) f.pts.forEach(([x, y]) => { c.fillStyle = css('--paper'); c.strokeStyle = css('--ink'); c.lineWidth = 1.5; c.beginPath(); c.arc(Pl.X(x * 5), Pl.Y(y * 5), 4.5, 0, Math.PI * 2); c.fill(); c.stroke(); });
    if (drawing && drawing.pts.length) {
      Pl.line(drawing.pts.map(([x, y]) => [x * 5, y * 5]), css('--accent'), 2.5, [6, 3], KINDS[drawing.kind].closed && drawing.pts.length > 2);
      drawing.pts.forEach(([x, y]) => { c.fillStyle = css('--accent'); c.beginPath(); c.arc(Pl.X(x * 5), Pl.Y(y * 5), 3.5, 0, Math.PI * 2); c.fill(); });
    }
    Pl.north(); Pl.scalebar();
  }
  function list() {
    $('fList').innerHTML = feats.length ? feats.map(f => `<li data-id="${esc(f.id)}" class="${f.id === sel ? 'on' : ''}" tabindex="0"><span class="sw" style="background:${swatch(f.kind)}"></span>${esc(f.name || '(no name)')}${pack.focus === f.id ? ' ★' : ''}<span class="k">${KINDS[f.kind]?.label || f.kind}</span></li>`).join('') : '<li style="cursor:default;color:var(--muted)">No features yet. Choose a type and press Draw new.</li>';
    const f = feats.find(x => x.id === sel);
    $('fProps').hidden = !f;
    if (f) { $('pName').value = f.name || ''; $('pKind').value = f.kind; $('pNote').value = f.note || ''; $('pFocus').checked = pack.focus === f.id; }
  }
  const swatch = k => ({ water: css('--water') || '#3a7fae', road: '#5b625f', path: '#7a6a52', building: css('--ink'), boundary: css('--accent'), area: css('--gold') || '#d99a1e', point: css('--ink') }[k]);
  $('fList').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) { sel = li.dataset.id; list(); draw(); } });
  $('fList').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.click(); });
  const cur = () => feats.find(x => x.id === sel);
  $('pName').oninput = () => { const f = cur(); if (f) { f.name = $('pName').value; draw(); listSoon(); } };
  $('pNote').oninput = () => { const f = cur(); if (f) f.note = $('pNote').value; };
  $('pKind').onchange = () => { const f = cur(); if (f) { f.kind = $('pKind').value; f.closed = KINDS[f.kind].closed; draw(); list(); } };
  $('pFocus').onchange = () => { const f = cur(); if (f) { pack.focus = $('pFocus').checked ? f.id : null; list(); } };
  $('pDel').onclick = () => { feats = feats.filter(x => x.id !== sel); if (pack.focus === sel) pack.focus = null; sel = null; pack.features = feats; list(); draw(); };
  let lt; const listSoon = () => { clearTimeout(lt); lt = setTimeout(() => { const a = document.activeElement; list(); a && a.focus && a.focus(); }, 400); };

  function startDraw() { drawing = { kind: $('fKind').value, pts: [] }; sel = null; $('fMode').hidden = false; $('fFinish').disabled = false; $('fUndo').disabled = false; $('fDraw').disabled = true; list(); draw(); }
  function finishDraw() {
    if (!drawing) return;
    const k = drawing.kind, need = k === 'point' ? 1 : KINDS[k].closed ? 3 : 2;
    if (drawing.pts.length >= need) {
      const id = 'f' + Date.now().toString(36);
      const n = feats.filter(f => f.kind === k).length + 1;
      feats.push({ id, kind: k, name: `${KINDS[k].label} ${n}`, note: '', pts: k === 'point' ? drawing.pts.slice(0, 1) : drawing.pts, closed: KINDS[k].closed });
      sel = id; if (!pack.focus && k === 'building') pack.focus = id;
    }
    drawing = null; $('fMode').hidden = true; $('fFinish').disabled = true; $('fUndo').disabled = true; $('fDraw').disabled = false;
    pack.features = feats; list(); draw(); if (sel) { $('pName').focus(); $('pName').select(); }
  }
  $('fDraw').onclick = startDraw; $('fFinish').onclick = finishDraw;
  $('fUndo').onclick = () => { if (drawing) { drawing.pts.pop(); draw(); } };
  addEventListener('keydown', e => { if (!drawing) return; if (e.key === 'Enter') finishDraw(); if (e.key === 'Escape') { drawing.pts = []; finishDraw(); } });

  let drag = null;
  const evPos = e => { const r = P0.getBoundingClientRect(); return Pl.inv(e.clientX - r.left, e.clientY - r.top); };
  const pxDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * Pl.s;
  P0.addEventListener('pointerdown', e => {
    if (!G) return;
    const p = evPos(e), m = toM(p);
    if (drawing) { drawing.pts.push(m); if (drawing.kind === 'point') finishDraw(); else draw(); return; }
    const f = cur();
    if (f) {                                                              // grab a vertex of the selected feature
      const i = f.pts.findIndex(q => pxDist([q[0] * 5, q[1] * 5], p) < 9);
      if (i >= 0) {
        if (e.shiftKey && f.pts.length > (f.kind === 'point' ? 1 : KINDS[f.kind].closed ? 3 : 2)) { f.pts.splice(i, 1); draw(); return; }
        drag = { f, i }; P0.setPointerCapture(e.pointerId); return;
      }
    }
    let best = null, bd = 10;                                             // otherwise pick the nearest feature
    feats.forEach(g => { const P = g.pts.map(([x, y]) => [x * 5, y * 5]); for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; if (k === P.length - 1 && !(KINDS[g.kind].closed)) { if (P.length === 1 && pxDist(a, p) < bd) { bd = pxDist(a, p); best = g; } break; } const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); const d = pxDist([a[0] + t * dx, a[1] + t * dy], p); if (d < bd) { bd = d; best = g; } } });
    sel = best ? best.id : null; list(); draw();
  });
  P0.addEventListener('pointermove', e => { if (!drag) return; drag.f.pts[drag.i] = toM(evPos(e)); draw(); });
  P0.addEventListener('pointerup', () => { drag = null; });
  P0.addEventListener('dblclick', e => { if (drawing) { e.preventDefault(); drawing.pts.pop(); finishDraw(); } });

  // ---------------------------------------------------------------- import GeoJSON / DXF
  let imp = null;
  $('iFile').onchange = async e => {
    const f = e.target.files[0]; imp = null; $('iGo').disabled = true; if (!f) return;
    try { const t = await f.text(); imp = /\.dxf$/i.test(f.name) ? readDXF(t) : readGeoJSON(JSON.parse(t)); $('iMsg').textContent = `${imp.length} line(s) or shape(s) found.`; $('iGo').disabled = !imp.length; }
    catch (er) { $('iMsg').textContent = 'Could not read that file: ' + er.message; }
  };
  const guessKind = s => { s = String(s || '').toLowerCase(); return /water|river|stream|brook|drain|canal|lake/.test(s) ? 'water' : /road|highway|street|lane/.test(s) ? 'road' : /path|track|trail|foot/.test(s) ? 'path' : /build|house|ruin|mill|structure/.test(s) ? 'building' : /bound|site|red ?line/.test(s) ? 'boundary' : null; };
  function readGeoJSON(j) {
    const out = [], fs = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ geometry: j, properties: {} }];
    fs.forEach(ft => {
      const g = ft.geometry, pr = ft.properties || {}; if (!g) return;
      const name = pr.name || pr.Name || pr.NAME || pr.label || '', kind = guessKind(Object.entries(pr).map(([k, v]) => k + ' ' + v).join(' '));
      const add = (pts, closed) => { if (pts.length) out.push({ name, kind, pts: pts.map(p => [p[0], p[1]]), closed }); };
      if (g.type === 'LineString') add(g.coordinates, false);
      else if (g.type === 'MultiLineString') g.coordinates.forEach(c => add(c, false));
      else if (g.type === 'Polygon') add(g.coordinates[0].slice(0, -1), true);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(c => add(c[0].slice(0, -1), true));
      else if (g.type === 'Point') add([g.coordinates], false);
    });
    return out;
  }
  function readDXF(t) {
    const L = t.split(/\r?\n/).map(s => s.trim()), out = []; let i = 0;
    const pairs = []; for (; i + 1 < L.length; i += 2) pairs.push([+L[i], L[i + 1]]);
    for (let k = 0; k < pairs.length; k++) {
      const [c, v] = pairs[k]; if (c !== 0) continue;
      if (v === 'LWPOLYLINE' || v === 'LINE' || v === 'POLYLINE') {
        let layer = '', closed = false, xs = [], ys = [], j = k + 1;
        const end = v === 'POLYLINE' ? 'SEQEND' : null;
        for (; j < pairs.length; j++) {
          const [cc, vv] = pairs[j];
          if (cc === 0 && (!end || vv === end)) break;
          if (cc === 8 && !layer) layer = vv; if (cc === 70 && v !== 'LINE' && (+vv & 1)) closed = true;
          if (cc === 10 || cc === 11) xs.push(+vv); if (cc === 20 || cc === 21) ys.push(+vv);
        }
        if (v === 'POLYLINE' && xs.length > 1) { xs.shift(); ys.shift(); }   // first 10/20 is the polyline's own base point
        const pts = xs.map((x, q) => [x, ys[q]]).filter(p => p[1] === p[1]);
        if (pts.length >= 2) out.push({ name: layer, kind: guessKind(layer), pts, closed });
        k = j - 1;
      }
    }
    return out;
  }
  $('iGo').onclick = () => {
    if (!imp || !pack) return;
    const all = imp.flatMap(f => f.pts), maxAbs = Math.max(...all.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    let mode = $('iCoords').value;
    if (mode === 'auto') mode = all.every(p => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) && maxAbs < 181 ? 'lonlat' : maxAbs > 5000 ? 'map' : 'stl';
    const dx = +$('iDX').value || 0, dy = +$('iDY').value || 0, src = pack.source || {};
    let conv;
    const geo = src.type === 'geotiff' && src.origin;
    if (geo && $('iE').value === '') { $('iE').value = src.origin[0]; $('iN').value = src.origin[1]; }
    if (mode === 'stl' && geo) mode = 'map';
    if (mode === 'stl') { const o = src.origin || [0, 0], u = src.unitM || 0.2; conv = ([x, y]) => [(x - o[0]) * u, (y - o[1]) * u]; }
    else if (mode === 'lonlat' && geo && DEMImport.crsOf(src.epsg)) conv = ([x, y]) => { const p = DEMImport.forward(src.epsg, y, x); return [p[0] - src.origin[0], p[1] - src.origin[1]]; };
    else if (mode === 'map') {
      const E = +$('iE').value, N = +$('iN').value;
      if (!(E === E && N === N) || $('iE').value === '' || $('iN').value === '') { $('iMsg').textContent = 'Map coordinates need the easting and northing of the survey\'s south-west corner.'; return; }
      conv = ([x, y]) => [x - E, y - N];
    } else {
      const lat0 = pack.lat, lon0 = pack.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
      conv = ([x, y]) => [G.widthM / 2 + (x - lon0) * kx, G.depthM / 2 + (y - lat0) * ky];
    }
    const kind0 = $('iKind').value; let n = 0, outside = 0;
    imp.forEach((f, q) => {
      const pts = f.pts.map(conv).map(([x, y]) => [+(x + dx).toFixed(2), +(y + dy).toFixed(2)]);
      if (pts.every(([x, y]) => x < -20 || y < -20 || x > G.widthM + 20 || y > G.depthM + 20)) { outside++; return; }
      const kind = f.kind || kind0;
      feats.push({ id: 'f' + Date.now().toString(36) + q, kind, name: f.name || `${KINDS[kind].label} ${feats.length + 1}`, note: '', pts: kind === 'point' ? pts.slice(0, 1) : pts, closed: f.closed || KINDS[kind].closed });
      n++;
    });
    $('iMsg').textContent = `Imported ${n} as ${mode === 'stl' ? 'STL units' : mode === 'map' ? 'map metres' : 'longitude/latitude'}.` + (outside ? ` ${outside} fell outside the survey and were skipped: check the coordinates option.` : '');
    pack.features = feats; list(); draw();
  };

  // ---------------------------------------------------------------- 4 · save
  $('sSave').onclick = async () => {
    if (!pack) return;
    Object.assign(pack, readDetails()); pack.features = feats; pack.updated = new Date().toISOString();
    if (!pack.id.startsWith('local-')) pack.id = 'local-' + pack.id;
    try { await SiteKit.local.put(pack); SiteKit.setActive(pack.id); msg('saveMsg', `Saved "${pack.name}" on this computer. It is now the open site on every page.`); $('sOpen').hidden = false; $('sOpen').href = 'index.html?site=' + encodeURIComponent(pack.id); }
    catch (e) { msg('saveMsg', 'Could not save in this browser (private window?). Download the site pack instead. ' + e.message, 'err'); }
  };
  $('sDl').onclick = () => {
    if (!pack) return;
    Object.assign(pack, readDetails()); pack.features = feats;
    const out = Object.assign({}, pack, { id: SiteKit.slug(pack.name + '-' + (pack.year || '')) });
    const a = document.createElement('a'); a.href = URL.createObjectURL(SiteKit.packBlob(out)); a.download = out.id + '.json'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg('saveMsg', `Downloaded ${out.id}.json. To publish it, add { "id": "${out.id}", "name": "${out.name}", "year": "${out.year}", "file": "sites/${out.id}.json" } to sites/index.json.`);
  };

  // ---------------------------------------------------------------- edit an existing site
  if (editId) {
    try {
      const p = await SiteKit.getPack(editId);
      if (p) {
        pack = JSON.parse(JSON.stringify(p));
        if (!pack.id.startsWith('local-')) { pack.id = 'local-' + pack.id + '-copy'; }
        feats = pack.features = pack.features || []; fillDetails(pack);
        if (pack.source && pack.source.type === 'geotiff' && pack.source.origin) { $('iE').value = pack.source.origin[0]; $('iN').value = pack.source.origin[1]; }
        $('hTitle').innerHTML = `Edit <em>${esc(pack.name)}</em>.`;
        msg('stlMsg', `Editing ${p.name}${editId.startsWith('local-') ? '' : ' (a copy on this computer: the published version is not changed)'}. Drop a new STL only if you want to replace the ground.`);
        $('stlMsg').hidden = false; rebuild(); enable(true);
      }
    } catch (e) { msg('stlMsg', 'Could not open that site: ' + e.message, 'err'); }
  }
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (Pl) { Pl.size(); draw(); } if (tif) drawTiles(); }, 80); }).observe(document.querySelector('main'));
  const redraw = () => { if (Pl) draw(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
})();
