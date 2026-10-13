/* Site Model Kit core: STL → height grid → "site pack", plus where packs are kept.
   A site pack is one JSON file holding the ground levels, the site's details and its features.
   Packs published with the website live in sites/ and are listed in sites/index.json.
   Packs made in the browser are kept on that computer (IndexedDB) until downloaded. */
(function (root) {
  'use strict';
  const FORMAT = 'sitekit-pack', VERSION = 1;

  // ---------------------------------------------------------------- STL
  // returns { tris: Float32Array [x0,y0,z0,x1,y1,z1,x2,y2,z2,...], n, min:[x,y,z], max:[x,y,z] } in STL units
  function parseSTL(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let binary = true;
    if (u8.length >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 !== u8.length) {
        const head = new TextDecoder().decode(u8.subarray(0, Math.min(1024, u8.length))).trim().toLowerCase();
        if (head.startsWith('solid') && head.includes('facet')) binary = false;
        else if (84 + n * 50 > u8.length) throw new Error('This STL file looks incomplete or damaged.');
      }
    } else binary = false;
    let tris, n;
    if (binary) {
      n = dv.getUint32(80, true); tris = new Float32Array(n * 9);
      for (let t = 0, o = 84; t < n; t++, o += 50) for (let k = 0; k < 9; k++) tris[t * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
    } else {
      const txt = new TextDecoder().decode(u8), re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g, v = [];
      let m; while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
      n = Math.floor(v.length / 9); tris = Float32Array.from(v.slice(0, n * 9));
    }
    if (!n) throw new Error('No triangles found. Is this an STL file?');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { const a = tris[i + k]; if (a < min[k]) min[k] = a; if (a > max[k]) max[k] = a; }
    return { tris, n, min, max, binary };
  }

  // Top surface of the mesh sampled on a regular grid (metres). opts: unitM (metres per STL unit), zFactor (vertical exaggeration in the STL), step (m)
  // Returns { w, h, step, Z (Float32, NaN = no ground), lo, hi, widthM, depthM }
  async function rasterise(stl, opts = {}, progress) {
    const unit = opts.unitM || 0.2, zf = opts.zFactor || 1;
    const widthM = (stl.max[0] - stl.min[0]) * unit, depthM = (stl.max[1] - stl.min[1]) * unit;
    const step = opts.step || autoStep(widthM, depthM);
    const w = Math.floor(widthM / step + 1e-6) + 1, h = Math.floor(depthM / step + 1e-6) + 1;
    const Z = new Float32Array(w * h).fill(-Infinity);
    const T = stl.tris, x0 = stl.min[0], y0 = stl.min[1], z0 = stl.min[2], N = stl.n, CH = 20000;
    // a closed solid (terrain on a base) has as much plan area facing down as up: then only the up-facing skin is ground
    let up = 0, down = 0;
    const nz = o => (T[o + 3] - T[o]) * (T[o + 7] - T[o + 1]) - (T[o + 4] - T[o + 1]) * (T[o + 6] - T[o]);
    for (let o = 0; o < T.length; o += 9) { const a = nz(o); if (a > 0) up += a; else down -= a; }
    const solid = Math.min(up, down) > 0.25 * Math.max(up, down), upSign = up >= down ? 1 : -1;
    for (let t = 0; t < N; t++) {
      if (t % CH === 0 && progress) { progress(t / N); await new Promise(r => setTimeout(r, 0)); }
      const o = t * 9;
      if (solid && nz(o) * upSign <= 0) continue;               // base or underside
      const ax = (T[o] - x0) * unit / step, ay = (T[o + 1] - y0) * unit / step, az = (T[o + 2] - z0) * unit / zf;
      const bx = (T[o + 3] - x0) * unit / step, by = (T[o + 4] - y0) * unit / step, bz = (T[o + 5] - z0) * unit / zf;
      const cx = (T[o + 6] - x0) * unit / step, cy = (T[o + 7] - y0) * unit / step, cz = (T[o + 8] - z0) * unit / zf;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;                        // vertical wall or sliver
      { const ux = bx - ax, uy = by - ay, uz = (bz - az) / step, vx = cx - ax, vy = cy - ay, vz = (cz - az) / step;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
        if (Math.abs(nzz) < 0.08 * Math.hypot(nx, ny, nzz)) continue; }   // steeper than ~85°: a skirt or wall, not ground
      const j0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6)), j1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6));
      const i0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 1e-6)), i1 = Math.min(h - 1, Math.floor(Math.max(ay, by, cy) + 1e-6));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const l1 = ((by - cy) * (j - cx) + (cx - bx) * (i - cy)) / den, l2 = ((cy - ay) * (j - cx) + (ax - cx) * (i - cy)) / den, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const z = l1 * az + l2 * bz + l3 * cz, k = i * w + j;
        if (z > Z[k]) Z[k] = z;
      }
    }
    if (progress) progress(1);
    for (let k = 0; k < Z.length; k++) if (Z[k] === -Infinity) Z[k] = NaN;
    // fill single missing nodes (seams between triangles)
    for (let i = 1; i < h - 1; i++) for (let j = 1; j < w - 1; j++) {
      const k = i * w + j; if (Z[k] === Z[k]) continue;
      let s = 0, c = 0; for (const d of [-1, 1, -w, w]) { const v = Z[k + d]; if (v === v) { s += v; c++; } }
      if (c >= 3) Z[k] = s / c;
    }
    // the mesh's flat base sits below the ground: keep only the top surface, and drop nodes that are on the base itself (walls only)
    let lo = Infinity, hi = -Infinity;
    for (const v of Z) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) throw new Error('The mesh has no ground surface that could be read.');
    for (let k = 0; k < Z.length; k++) if (Z[k] === Z[k]) Z[k] -= lo;   // 0 = lowest ground
    return { w, h, step, Z, lo: 0, hi: hi - lo, widthM: (w - 1) * step, depthM: (h - 1) * step, groundAboveMin: lo };   // groundAboveMin: lowest ground above the mesh's lowest point (m)
  }
  function autoStep(wm, hm) { const s = Math.sqrt(wm * hm / 2.2e6); return s <= 0.4 ? 0.4 : Math.ceil(s * 10) / 10; }

  // ---------------------------------------------------------------- pack encode / decode
  function b64encode(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64decode(s) {
    if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8;
  }
  function encodeGrid(g) {
    let hi = 0; for (const v of g.Z) if (v === v && v > hi) hi = v;
    const scale = Math.max(0.01, Math.ceil(hi / 65000 * 100) / 100);
    const u = new Uint16Array(g.w * g.h);
    for (let k = 0; k < u.length; k++) { const v = g.Z[k]; u[k] = v === v ? Math.min(65535, Math.round(v / scale) + 1) : 0; }
    return { w: g.w, h: g.h, step: g.step, scale, enc: 'u16-b64', data: b64encode(new Uint8Array(u.buffer)) };
  }
  function decodeGrid(gr) {
    const raw = b64decode(gr.data), copy = new Uint8Array(raw.length); copy.set(raw);
    const u = new Uint16Array(copy.buffer), Z = new Float32Array(gr.w * gr.h);
    for (let k = 0; k < Z.length; k++) Z[k] = u[k] === 0 ? NaN : (u[k] - 1) * gr.scale;
    return { w: gr.w, h: gr.h, step: gr.step, Z };
  }
  function slug(s) { return String(s || 'site').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site'; }
  function newPack(fields, grid) {
    return Object.assign({
      format: FORMAT, version: VERSION, id: 'local-' + slug(fields.name) + '-' + Date.now().toString(36),
      name: 'New site', place: '', year: String(new Date().getFullYear()), survey: '', notes: '',
      lat: 53.35, lon: -7.0, tz: 'Europe/Dublin', north: 0, levelOffset: 0, contourInterval: 0,
      embed: '', focus: null, features: [], source: {}
    }, fields, { grid: encodeGrid(grid), created: new Date().toISOString() });
  }
  function checkPack(p) {
    if (!p || p.format !== FORMAT || !p.grid || !p.grid.data) throw new Error('This is not a Site Model Kit site pack.');
    if (p.version > VERSION) throw new Error('This site pack was made by a newer version of the website.');
    p.features = p.features || []; return p;
  }
  const meta = p => ({ id: p.id, name: p.name, place: p.place, year: p.year, w: (p.grid.w - 1) * p.grid.step, h: (p.grid.h - 1) * p.grid.step, created: p.created });

  // ---------------------------------------------------------------- storage (browser only)
  const DB = 'sitekit', STORE = 'packs';
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  }
  const local = {
    all: async () => { try { return (await tx('readonly', s => s.getAll())) || []; } catch (e) { return []; } },
    get: async id => { try { return await tx('readonly', s => s.get(id)); } catch (e) { return null; } },
    put: async p => tx('readwrite', s => s.put(p)),
    del: async id => tx('readwrite', s => s.delete(id))
  };
  let published = null;
  async function publishedList() {
    if (published) return published;
    try { const r = await fetch('sites/index.json', { cache: 'no-cache' }); published = r.ok ? (await r.json()).sites || [] : []; }
    catch (e) { published = []; }
    return published;
  }
  async function list() {
    const pub = (await publishedList()).map(s => Object.assign({ where: 'published' }, s));
    const loc = (await local.all()).map(p => Object.assign({ where: 'local' }, meta(p)));
    return pub.concat(loc);
  }
  async function getPack(id) {
    if (!id) return null;
    if (id.startsWith('local-')) return await local.get(id);
    const s = (await publishedList()).find(x => x.id === id); if (!s) return null;
    const r = await fetch(s.file); if (!r.ok) throw new Error('Could not load ' + s.file);
    return checkPack(await r.json());
  }
  const KEY = 'sitekit-active';
  function activeId() {
    let id = null;
    try { id = new URLSearchParams(location.search).get('site'); } catch (e) { }
    if (id) { try { localStorage.setItem(KEY, id); } catch (e) { } return id; }
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setActive(id) { try { localStorage.setItem(KEY, id); } catch (e) { } }
  async function activePack() {
    let id = activeId(), p = null, note = '';
    try { p = await getPack(id); } catch (e) { p = null; }
    if (!p) {
      if (id) note = 'That site is not on this computer, so the first published site is shown instead.';
      const all = await list(); if (all.length) { p = await getPack(all[0].id); if (p) setActive(p.id); }
    }
    return { pack: p, note };
  }
  function packBlob(p) { return new Blob([JSON.stringify(p)], { type: 'application/json' }); }

  const api = { FORMAT, VERSION, parseSTL, rasterise, autoStep, encodeGrid, decodeGrid, newPack, checkPack, meta, slug, local, list, publishedList, getPack, activeId, setActive, activePack, packBlob };
  if (typeof module !== 'undefined') module.exports = api; else root.SiteKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
