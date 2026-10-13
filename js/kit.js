(async function () {
  'use strict';
  const G = await window.loadSite('kit.html'); if (!G) return;
  const { css, $, esc, pack } = G, PW = G.W, PH = G.H;   // PW, PH: plan units (1:200 mm)
  const MM = window.MyModel, SITE = SiteKit.slug(pack.name), pad = n => String(n).padStart(2, '0');
  fillSite(G);
  if (pack.notes) $('siteNotes').textContent = pack.notes;
  if (pack.embed) { $('embedWrap').hidden = false; $('embed').src = pack.embed; $('embedLink').href = pack.embed.replace('/embed', ''); }
  const status = (t, s = '') => { $('kStatus').textContent = t; $('kStatus').dataset.state = s; };
  // model scale: the largest of 1:100, 1:200, 1:500, 1:1000 that keeps the model within about 2.5 m (1:100 only for small sites)
  const longM = Math.max(G.widthM, G.depthM), autoScale = longM * 10 <= 2500 ? 100 : longM * 5 <= 2500 ? 200 : longM * 2 <= 2500 ? 500 : 1000;
  const opt = { board: 5, sheet: [841, 594], tile: 400, scale: autoScale };
  try { Object.assign(opt, JSON.parse(localStorage.getItem('sitekit-kitopts') || '{}')); } catch (e) { }
  try { const sc = JSON.parse(localStorage.getItem('sitekit-kitscale-' + pack.id) || 'null'); opt.scale = sc || autoScale; } catch (e) { opt.scale = autoScale; }
  let KS = 5, W = PW, H = PH, baseMM = [0, 0];               // KS: model mm per metre; W, H: model footprint (mm)
  function applyScale() {
    KS = 1000 / opt.scale; W = G.widthM * KS; H = G.depthM * KS;
    baseMM = [Math.ceil((W + 40) / 10) * 10, Math.ceil((H + 40) / 10) * 10];
    $('kFoot').textContent = `${Math.round(W)} × ${Math.round(H)} mm`; $('kBase').textContent = `${baseMM[0]} × ${baseMM[1]} mm`;
    document.querySelectorAll('[data-kscale]').forEach(el => el.textContent = '1:' + opt.scale);
    const b = $('kBoardSel'), v = b.value || opt.board;
    b.innerHTML = [2, 3, 5].map(t => `<option value="${t}">${t} mm (${+(t / KS).toFixed(2)} m per layer)</option>`).join(''); b.value = v;
    const big = Math.max(W, H) > 2600;
    $('kScaleNote').textContent = `At 1:${opt.scale} the model is ${(W / 1000).toFixed(2)} × ${(H / 1000).toFixed(2)} m.` + (big ? ' That is very large: it needs a lot of board and may take a few minutes to work out. A smaller scale may suit better.' : '');
    $('kScaleNote').dataset.state = big ? 'warn' : '';
  }
  $('kScale').value = String(opt.scale);
  $('kBoardSel').value = opt.board; $('kSheet').value = opt.sheet.join('x'); $('kTile').value = opt.tile;
  const readOpt = () => {
    opt.board = +$('kBoardSel').value; opt.sheet = $('kSheet').value.split('x').map(Number); opt.tile = +$('kTile').value; opt.scale = +$('kScale').value;
    try { localStorage.setItem('sitekit-kitopts', JSON.stringify({ board: opt.board, sheet: opt.sheet, tile: opt.tile })); localStorage.setItem('sitekit-kitscale-' + pack.id, String(opt.scale)); } catch (e) { }
    applyScale();
  };
  applyScale(); $('kBoardSel').value = opt.board;

  // ---------- plan with tile grid
  const P = G.Plan($('kitPlan'));
  P.draw = () => {
    P.base({ contourAlpha: 0.8 }); P.features({ alpha: 0.8, tags: 'focus' });
    const c = P.ctx, t = opt.tile * 5 / KS, ink = css('--engrave');
    [[0, []], [t / 2, [5, 4]]].forEach(([off, dash]) => {
      c.strokeStyle = ink; c.lineWidth = 1; c.setLineDash(dash); c.globalAlpha = 0.7; c.beginPath();
      for (let x = -off; x <= PW; x += t) if (x > 0) { c.moveTo(P.X(x), P.Y(0)); c.lineTo(P.X(x), P.Y(PH)); }
      for (let y = -off; y <= PH; y += t) if (y > 0) { c.moveTo(P.X(0), P.Y(y)); c.lineTo(P.X(PW), P.Y(y)); }
      c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    });
    c.font = '600 11px "IBM Plex Mono", monospace'; c.fillStyle = ink; c.textAlign = 'center';
    const rows = 'ABCDEFGHJL';
    for (let r = 0; r * t < PH; r++) for (let q = 0; q * t < PW; q++) c.fillText(`${rows[r] || 'Z'}${q + 1}`, P.X(q * t + 18 / P.s), P.Y(r * t) - 6);
    P.north(); P.scalebar();
  };

  // ---------- make the kit
  let K = null, packed = null, sheetIx = 0, pieces = [];
  const prog = p => { $('kProg').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; };
  function nestInWorker(items, sw, sh, onp) {
    return new Promise((res, rej) => {
      let w; try { w = new Worker('js/nest-worker.js'); } catch (e) { rej(e); return; }
      w.onmessage = e => { const d = e.data; if (d.progress != null) onp(d.progress); else if (d.error) { w.terminate(); res({ error: d.error }); } else if (d.done) { w.terminate(); res(d); } };
      w.onerror = e => { w.terminate(); rej(e); };
      w.postMessage({ masks: items.map(p => p.mask), sheetW: sw, sheetH: sh });
    });
  }
  const cacheKey = () => `sitekit-nest|${pack.id}|${pack.updated || pack.created || ''}|${opt.scale}|${opt.board}|${opt.sheet.join('x')}|${opt.tile}`;
  async function make() {
    readOpt(); P.draw();
    if (Math.max(W, H) > 2600 && !localStorage.getItem(cacheKey()) && !confirm(`At 1:${opt.scale} this model is ${(W / 1000).toFixed(1)} × ${(H / 1000).toFixed(1)} m and may take many minutes to work out. Continue?`)) return;
    $('kGo').disabled = true; $('kProg').hidden = false; ['dlZip', 'dlGuide', 'dlDXF'].forEach(id => $(id).disabled = true);
    try {
      status('Slicing the layers…'); prog(0);
      K = await MM.buildSite(G.DEM, G.widthM, G.depthM, opt.board, { tileMM: opt.tile, rim: 15, scale: opt.scale }, p => prog(p * 0.3));
      pieces = K.layers.flatMap(l => l.pieces);
      if (!pieces.length) { status('This site is too flat for any layers at this board thickness.', 'err'); return; }
      status(`Fitting ${pieces.length} pieces onto ${opt.sheet[0]} × ${opt.sheet[1]} mm sheets…`);
      let res = null, key = cacheKey();
      try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && c.n === pieces.length) res = c.r; } catch (e) { }
      if (!res) {
        try { res = await nestInWorker(pieces, opt.sheet[0], opt.sheet[1], p => prog(0.3 + p * 0.7)); }
        catch (e) {                                        // no workers (opened from a file): do it here
          await new Promise(r => setTimeout(r, 30));
          const r2 = MM.nest(pieces.map((p, i) => ({ i, mask: p.mask })), opt.sheet[0], opt.sheet[1]);
          res = r2.error ? { error: r2.error } : { count: r2.count, g: r2.g, RES: r2.RES, margin: r2.margin, placed: r2.placed.map(p => [p.layer.i, p.sheet, p.cx, p.cy, p.rot]) };
        }
        if (!res.error) try { localStorage.setItem(key, JSON.stringify({ n: pieces.length, r: res })); } catch (e) { }
      }
      if (res.error) { status(res.error.replace('Layer undefined', 'A piece') + ' Choose a bigger sheet or smaller tiles.', 'err'); return; }
      packed = { count: res.count, g: res.g, RES: res.RES, margin: res.margin, sheetW: opt.sheet[0], sheetH: opt.sheet[1], placed: res.placed.map(([i, sheet, cx, cy, rot]) => ({ layer: pieces[i], sheet, cx, cy, rot })) };
      packed.placed.forEach(pl => pl.layer.sheet = pl.sheet + 1);
      prog(1);
      const NL = K.layers.length, top = K.layers[NL - 1];
      $('kInt').textContent = `${opt.board} mm = ${+(opt.board / KS).toFixed(2)} m`;
      const dp = Number.isInteger(+(opt.board / KS).toFixed(3)) ? 0 : 1;
      $('kLayers').textContent = `${NL} · ${G.fmt(K.layers[0].L, dp)} to ${G.fmt(top.L, dp)} m`;
      $('kPieces').textContent = pieces.length; $('kHeight').textContent = `${NL * opt.board} mm + base`;
      $('kBoard').textContent = `${packed.count} × ${opt.sheet[0] === 841 ? 'A1' : opt.sheet[0] === 594 ? 'A2' : opt.sheet.join('×')}, ${opt.board} mm`;
      $('materials').innerHTML = [
        `${packed.count} sheets of ${opt.board} mm greyboard at ${opt.sheet[0]} × ${opt.sheet[1]} mm, plus offcuts for test cuts`,
        `Baseboard ${baseMM[0]} × ${baseMM[1]} mm, 12 mm MDF or ply`,
        'PVA wood glue, a fine spreader, pins, and weights (books work)',
        `${NL} envelopes or zip bags, one per layer, marked 01–${pad(NL)}`
      ].map(t => `<li>${esc(t)}</li>`).join('');
      status(`Ready: ${NL} layers, ${pieces.length} pieces on ${packed.count} sheet${packed.count === 1 ? '' : 's'}.` + (pieces.filter(p => !p.label).length ? ` ${pieces.filter(p => !p.label).length} very small pieces have no room for an ID.` : ''), 'ok');
      ['dlZip', 'dlGuide', 'dlDXF'].forEach(id => $(id).disabled = false);
      sheetIx = 0; drawSheet(); viewer.load();
    } catch (e) { console.error(e); status('Could not make the kit: ' + e.message, 'err'); }
    finally { $('kGo').disabled = false; setTimeout(() => $('kProg').hidden = true, 400); }
  }
  $('kGo').onclick = make;
  // make it straight away when the page asks for it (window.KIT_AUTOMAKE) or when these settings were worked out before
  setTimeout(() => { readOpt(); let cached = false; try { cached = !!localStorage.getItem(cacheKey()); } catch (e) { } if ((window.KIT_AUTOMAKE && Math.max(W, H) <= 2600) || cached) make(); }, 0);
  ['kBoardSel', 'kSheet', 'kTile', 'kScale'].forEach(id => $(id).onchange = () => { readOpt(); P.draw(); status('Settings changed: press Make the kit.'); });

  function drawSheet() {
    if (!packed) return;
    $('sheetLbl').textContent = `Laser sheet ${sheetIx + 1} of ${packed.count} · ${opt.sheet[0]} × ${opt.sheet[1]} mm`;
    $('sheetView').innerHTML = MM.toSVG(packed, sheetIx, 'sheet').replace(/^<\?xml[^>]*>\s*/, '');
  }
  $('sPrev').onclick = () => { if (!packed) return; sheetIx = (sheetIx - 1 + packed.count) % packed.count; drawSheet(); };
  $('sNext').onclick = () => { if (!packed) return; sheetIx = (sheetIx + 1) % packed.count; drawSheet(); };

  // ---------- downloads
  const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  async function busy(btn, fn) { const b = $(btn), t = b.textContent; b.disabled = true; b.textContent = 'Making…'; try { await fn(); } catch (e) { console.error(e); status('Could not make the file: ' + e.message, 'err'); } b.textContent = t; b.disabled = false; }
  function sheetsPDF() {
    const { jsPDF } = window.jspdf, [SW, SH] = opt.sheet, o = SW > SH ? 'landscape' : 'portrait';
    const doc = new jsPDF({ orientation: o, unit: 'mm', format: [SW, SH] });
    for (let i = 0; i < packed.count; i++) {
      if (i) doc.addPage([SW, SH], o);
      const { cut, eng } = MM.sheetPaths(packed, i); doc.setLineWidth(0.05);
      const draw = (p, col) => { doc.setDrawColor(...col); const pts = p.pts.concat(p.closed ? [p.pts[0]] : []); for (let k = 1; k < pts.length; k++) doc.line(pts[k - 1][0], SH - pts[k - 1][1], pts[k][0], SH - pts[k][1]); };
      eng.forEach(p => draw(p, [0, 0, 255])); cut.forEach(p => draw(p, [255, 0, 0]));
    }
    return doc.output('blob');
  }
  $('dlZip').onclick = () => busy('dlZip', async () => {
    const zip = new JSZip(), dir = zip.folder(`${SITE}_laser_sheets`);
    for (let i = 0; i < packed.count; i++) { const n = pad(i + 1); dir.file(`sheet_${n}.svg`, MM.toSVG(packed, i, `${pack.name} sheet ${n}`)); dir.file(`sheet_${n}.dxf`, MM.toDXF(packed, i)); }
    dir.file('all_sheets.pdf', sheetsPDF());
    dir.file('README.txt', [`${pack.name} · site model kit`, `1:${opt.scale}, ${opt.board} mm board (${+(opt.board / KS).toFixed(2)} m per layer), ${K.layers.length} layers, ${pieces.length} pieces, ${packed.count} sheets of ${opt.sheet[0]} x ${opt.sheet[1]} mm.`, 'Red (CUT layer) = cut. Blue (ENGRAVE layer) = light score: where the next layer goes, and the piece ID.', 'Engrave first, then cut. Test settings on an offcut.', `Piece IDs: layer, tile row (A from the south) and column (1 from the west), part number. E.g. 14B2.1.`, `Baseboard ${baseMM[0]} x ${baseMM[1]} mm.`, pack.survey ? `Survey: ${pack.survey}.` : ''].join('\r\n'));
    download(await zip.generateAsync({ type: 'blob' }), `${SITE}_laser_sheets.zip`);
  });
  $('dlDXF').onclick = () => busy('dlDXF', async () => {
    const o = ['0', 'SECTION', '2', 'ENTITIES'];
    const IDX = Math.max(5, Math.round(5 * opt.board / KS));
    K.layers.forEach(ly => {
      const idx = Math.abs(ly.L / IDX - Math.round(ly.L / IDX)) < 1e-6, layer = idx ? 'CONTOUR_INDEX' : 'CONTOUR';
      ly.outline.forEach(l => {
        o.push('0', 'POLYLINE', '8', layer, '62', idx ? '1' : '8', '66', '1', '70', '1', '10', '0', '20', '0', '30', ly.L.toFixed(2));
        l.forEach(([x, y]) => o.push('0', 'VERTEX', '8', layer, '10', x.toFixed(2), '20', y.toFixed(2), '30', ly.L.toFixed(2)));
        o.push('0', 'SEQEND', '8', layer);
      });
    });
    o.push('0', 'ENDSEC', '0', 'EOF');
    download(new Blob([o.join('\n') + '\n'], { type: 'application/dxf' }), `${SITE}_contours_1-${opt.scale}.dxf`);
  });
  $('dlGuide').onclick = () => busy('dlGuide', async () => {
    const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const PW = 420, PH = 297, NL = K.layers.length;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(`${pack.name} · site model assembly guide`.slice(0, 80), 15, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    [`${[pack.place, pack.year].filter(Boolean).join(' · ')}    Made ${today()}`, `1:${opt.scale} · ${opt.board} mm board = ${+(opt.board / KS).toFixed(2)} m per layer · ${NL} layers from ${G.fmt(K.layers[0].L)} to ${G.fmt(K.layers[NL - 1].L)} m · ${pieces.length} pieces on ${packed.count} sheets of ${opt.sheet[0]} × ${opt.sheet[1]} mm`,
      `Footprint ${Math.round(W)} × ${Math.round(H)} mm · baseboard ${baseMM[0]} × ${baseMM[1]} mm · height ${NL * opt.board} mm + base`,
      G.relative ? 'Levels relative: 0 m is the lowest ground of the survey.' : 'Levels as given for the site.', pack.survey ? `Survey: ${pack.survey}` : ''].filter(Boolean).forEach((t, i) => doc.text(t, 15, 30 + i * 5.5));
    // overview: outline of every layer + tile grid labels
    const fit = (bx, by, bw, bh) => { const k = Math.min(bw / W, bh / H); return { k, X: x => bx + x * k, Y: y => by + bh - y * k }; };
    const T = fit(15, 62, PW - 30, PH - 80);
    K.layers.forEach((ly, i) => { doc.setDrawColor(i % 5 === 4 ? 40 : 150); doc.setLineWidth(i % 5 === 4 ? 0.3 : 0.12); ly.outline.forEach(l => { for (let q = 0; q < l.length; q++) { const a = l[q], b = l[(q + 1) % l.length]; doc.line(T.X(a[0]), T.Y(a[1]), T.X(b[0]), T.Y(b[1])); } }); });
    doc.setDrawColor(58, 95, 174); doc.setLineWidth(0.2); doc.setFontSize(8); doc.setTextColor(58, 95, 174);
    const rows = 'ABCDEFGHJL';
    for (let x = opt.tile; x < W; x += opt.tile) doc.line(T.X(x), T.Y(0), T.X(x), T.Y(H));
    for (let y = opt.tile; y < H; y += opt.tile) doc.line(T.X(0), T.Y(y), T.X(W), T.Y(y));
    for (let r = 0; r * opt.tile < H; r++) for (let q = 0; q * opt.tile < W; q++) doc.text(`${rows[r] || 'Z'}${q + 1}`, T.X(q * opt.tile) + 2, T.Y(r * opt.tile) - 2);
    doc.setTextColor(0); doc.setFontSize(8); doc.text('Odd layers use this tile grid. Even layers shift it by half a tile in both directions, so joints never stack.', 15, PH - 10);
    // layer pages: 6 per page
    const per = 6, cw = (PW - 40) / 3, ch = (PH - 45) / 2;
    K.layers.forEach((ly, i) => {
      if (i % per === 0) { doc.addPage('a3', 'landscape'); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Layer by layer (north up). Coloured: this layer, with piece ID and sheet. Grey: the layer below.', 15, 15); doc.setFont('helvetica', 'normal'); }
      const j = i % per, bx = 15 + (j % 3) * (cw + 5), by = 22 + Math.floor(j / 3) * (ch + 8), F = fit(bx, by + 6, cw, ch - 8);
      doc.setFontSize(10); doc.setTextColor(0); doc.text(`Layer ${pad(ly.k)} · ${G.fmt(ly.L)} m · ${ly.pieces.length} pieces`, bx, by + 3);
      if (i) { doc.setDrawColor(185); doc.setLineWidth(0.15); K.layers[i - 1].outline.forEach(l => { for (let q = 0; q < l.length; q++) { const a = l[q], b = l[(q + 1) % l.length]; doc.line(F.X(a[0]), F.Y(a[1]), F.X(b[0]), F.Y(b[1])); } }); }
      doc.setDrawColor(192, 67, 42); doc.setLineWidth(0.3);
      ly.pieces.forEach(pc => pc.loops.forEach(l => { for (let q = 0; q < l.length; q++) { const a = l[q], b = l[(q + 1) % l.length]; doc.line(F.X(a[0]), F.Y(a[1]), F.X(b[0]), F.Y(b[1])); } }));
      doc.setFontSize(4.2); doc.setTextColor(40);
      ly.pieces.forEach(pc => { const a = pc.label ? pc.label.at : pc.loops[0][0]; doc.text(`${pc.id} s${pc.sheet}`, F.X(a[0]), F.Y(a[1]), { align: 'center' }); });
    });
    download(doc.output('blob'), `${SITE}_assembly_guide.pdf`);
  });

  // ---------- 3D assembly viewer
  const viewer = (function () {
    const stage = $('stage'), canvas = $('c'), tip = $('tip');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(); let R = Math.max(W, H);
    const cam = new THREE.PerspectiveCamera(32, 1, R / 200, R * 30);
    const ctl = new THREE.OrbitControls(cam, canvas); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.495;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f88, 0.6));
    const sun = new THREE.DirectionalLight(0xfff6ea, 0.75); sun.position.set(-R * 0.55, R * 0.85, R * 0.4); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(R * 0.5, R * 0.3, -R * 0.5); scene.add(fill);
    const model = new THREE.Group(); scene.add(model);
    const C = { cap: new THREE.Color(0xa2a49f), side: new THREE.Color(0x7d7f7a), now: new THREE.Color(0xc0432a), hi: new THREE.Color(0xf2b134) };
    const mat = c => new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.95 });
    let meshes = [], NL = 0, T = 5, cur = 1, finished = false, hover = null, picked = null, board = null;
    function load() {
      meshes.forEach(m => { model.remove(m); m.geometry.dispose(); }); meshes = [];
      if (board) { model.remove(board); board.geometry.dispose(); }
      T = opt.board; NL = K.layers.length; R = Math.max(W, H); model.position.set(-W / 2, 0, H / 2);
      cam.near = R / 200; cam.far = R * 30; cam.updateProjectionMatrix(); sun.position.set(-R * 0.55, R * 0.85, R * 0.4); fill.position.set(R * 0.5, R * 0.3, -R * 0.5);
      board = new THREE.Mesh(new THREE.BoxGeometry(baseMM[0], 12, baseMM[1]), new THREE.MeshStandardMaterial({ color: 0xa98d6c, roughness: 0.9 }));
      board.position.set(W / 2, -6, -H / 2); model.add(board);
      K.layers.forEach((ly, li) => ly.pieces.forEach(pc => {
        const shapes = pc.polys.map(p => { const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y))); p.holes.forEach(h => s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))); return s; });
        const g = new THREE.ExtrudeGeometry(shapes, { depth: T, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-Math.PI / 2); g.translate(0, li * T, 0);
        const m = new THREE.Mesh(g, [mat(C.cap), mat(C.side)]); m.userData = { pc, li: li + 1 }; model.add(m); meshes.push(m);
      }));
      $('lay').max = NL; $('stageHint').textContent = 'Drag to orbit · scroll to zoom · right-drag to pan';
      cur = 1; finished = false; apply(); setView('aerial');
    }
    function paint(m) { const isNow = !finished && m.userData.li === cur, isHi = m === hover || m === picked, c = isHi ? C.hi : isNow ? C.now : C.cap; m.material[0].color.copy(c); m.material[1].color.copy(isHi || isNow ? c.clone().multiplyScalar(0.75) : C.side); }
    function apply() {
      if (!K) return;
      const top = finished ? NL : cur;
      meshes.forEach(m => { m.visible = m.userData.li <= top; paint(m); });
      $('layNum').firstChild.nodeValue = finished ? 'All' : pad(cur);
      $('layM').textContent = finished ? `${NL} layers` : `${G.fmt(K.layers[cur - 1].L)} m`;
      $('ht').textContent = `${top * T} mm`; $('lay').value = cur;
      const list = finished ? [] : meshes.filter(m => m.userData.li === cur).sort((a, b) => a.userData.pc.sheet - b.userData.pc.sheet || a.userData.pc.id.localeCompare(b.userData.pc.id));
      $('pcount').textContent = finished ? 'Model complete' : `${list.length} pieces on layer ${pad(cur)}`;
      $('plist').innerHTML = list.map(m => `<li data-i="${meshes.indexOf(m)}" class="${m === picked ? 'on' : ''}" tabindex="0"><span>${m.userData.pc.id}</span><span>sheet ${pad(m.userData.pc.sheet)}</span></li>`).join('');
      $('all').setAttribute('aria-pressed', finished);
    }
    const go = n => { finished = false; picked = null; cur = Math.max(1, Math.min(NL, n)); apply(); };
    $('lay').addEventListener('input', e => go(+e.target.value));
    $('prev').onclick = () => go(cur - 1); $('next').onclick = () => go(cur + 1);
    $('all').onclick = () => { if (!K) return; finished = !finished; picked = null; apply(); };
    const pickList = li => { if (!li) return; picked = meshes[+li.dataset.i]; apply(); };
    $('plist').addEventListener('click', e => pickList(e.target.closest('li')));
    $('plist').addEventListener('keydown', e => { if (e.key === 'Enter') pickList(e.target.closest('li')); });
    let timer = null;
    $('play').onclick = e => {
      if (!K) return;
      if (timer) { clearInterval(timer); timer = null; e.target.textContent = 'Play build'; return; }
      go(1); e.target.textContent = 'Stop';
      timer = setInterval(() => { if (cur >= NL) { clearInterval(timer); timer = null; e.target.textContent = 'Play build'; finished = true; apply(); return; } go(cur + 1); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 260);
    };
    const views = { aerial: [[-0.55, 0.62, 0.56], 1.0, 32], plan: [[0, 1, 0.0001], 0.92, 6], low: [[-0.78, 0.17, 0.6], 0.85, 32] };
    let view = 'aerial', userMoved = false;
    function setView(v) {
      view = v; const [d, f, fov] = views[v], ty = K ? K.layers.length * T * 0.3 : 0;
      cam.fov = fov; cam.updateProjectionMatrix();
      const vf = THREE.MathUtils.degToRad(fov) / 2, hf = Math.atan(Math.tan(vf) * cam.aspect);
      const dist = f * R * 0.62 / Math.sin(Math.min(vf, hf)) * 1.05;
      cam.position.copy(new THREE.Vector3(...d).normalize().multiplyScalar(dist)).add(new THREE.Vector3(0, ty, 0));
      ctl.target.set(0, ty, 0); ctl.update();
      document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
    }
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { userMoved = false; setView(b.dataset.view); });
    ctl.addEventListener('start', () => userMoved = true);
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const hit = ev => { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(meshes.filter(m => m.visible), false)[0]; return h ? h.object : null; };
    canvas.addEventListener('pointermove', ev => {
      if (!K) return;
      const m = hit(ev); if (m !== hover) { const old = hover; hover = m; if (old) paint(old); if (m) paint(m); }
      if (m) { const p = m.userData.pc, r = stage.getBoundingClientRect(); tip.textContent = `${p.id} · layer ${pad(p.k)} (${G.fmt(p.L)} m) · sheet ${pad(p.sheet)}`; tip.style.left = Math.min(ev.clientX - r.left + 12, r.width - 260) + 'px'; tip.style.top = (ev.clientY - r.top + 12) + 'px'; tip.hidden = false; }
      else tip.hidden = true;
    });
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (hover) { const o = hover; hover = null; paint(o); } });
    canvas.addEventListener('click', ev => { const m = hit(ev); if (m && !finished) { go(m.userData.li); picked = m; apply(); } });
    const bg = () => { scene.background = new THREE.Color(css('--stage') || '#dfe2dc'); C.now.set(css('--cut') || '#c0432a'); apply(); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bg);
    new MutationObserver(bg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    function resize() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(r.height, 1); cam.updateProjectionMatrix(); if (!userMoved) setView(view); }
    new ResizeObserver(resize).observe(stage); bg(); resize();
    (function loop() { ctl.update(); renderer.render(scene, cam); requestAnimationFrame(loop); })();
    return { load };
  })();

  const redraw = () => { P.size(); P.draw(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(redraw, 80); }).observe(document.querySelector('main'));
  redraw();
  // build straight away if this site and these settings were nested before (fast), otherwise wait for the button
  try { if (localStorage.getItem(cacheKey())) make(); } catch (e) { }
})();
