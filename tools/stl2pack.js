#!/usr/bin/env node
/* Optional command-line version of the setup page: turns an STL into a site pack.
   node tools/stl2pack.js site.stl out.json --name "Site name" --scale 200 --lat 54.4 --lon -8.4
   Options: --scale N (STL is in mm at 1:N; use --unit 1 for an STL in metres), --unit m-per-unit, --zfactor F,
            --place, --year, --tz, --north deg, --offset m (level of the lowest ground), --id */
const fs = require('fs'), path = require('path');
const SK = require(path.join(__dirname, '..', 'js', 'sitekit.js'));
const a = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i]; else pos.push(a[i]);
if (pos.length < 2) { console.log('usage: node tools/stl2pack.js site.stl out.json --name "Site" --scale 200 --lat 54.4 --lon -8.4'); process.exit(1); }
(async () => {
  const b = fs.readFileSync(pos[0]);
  const stl = SK.parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const unitM = opt.unit ? +opt.unit : (+opt.scale || 200) / 1000;
  const g = await SK.rasterise(stl, { unitM, zFactor: +opt.zfactor || 1 });
  const name = opt.name || path.basename(pos[0], '.stl');
  const p = SK.newPack({
    id: opt.id || SK.slug(name + '-' + (opt.year || new Date().getFullYear())), name, place: opt.place || '', year: opt.year || String(new Date().getFullYear()),
    lat: +(opt.lat ?? 53.35), lon: +(opt.lon ?? -7), tz: opt.tz || 'Europe/Dublin', north: +(opt.north || 0), levelOffset: +(opt.offset || 0),
    source: { file: path.basename(pos[0]), unitM, zFactor: +opt.zfactor || 1, origin: stl.min }
  }, g);
  fs.writeFileSync(pos[1], JSON.stringify(p));
  console.log(`${name}: ${g.widthM.toFixed(0)} × ${g.depthM.toFixed(0)} m, relief ${g.hi.toFixed(1)} m, grid ${g.w} × ${g.h} at ${g.step} m → ${pos[1]}`);
  console.log(`Add it to sites/index.json: { "id": "${p.id}", "name": "${name}", "year": "${p.year}", "file": "sites/${path.basename(pos[1])}" }`);
})().catch(e => { console.error(e.message); process.exit(1); });
