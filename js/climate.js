/* Rainfall chart + wind rose from Met Éireann CSV files (monthly, daily or hourly), all in the browser. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON3 = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const SECT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  // Beaufort-aligned speed bands in knots
  const BANDS = [{ lo: 1, hi: 7, k: '1–6 kt', kmh: '2–11 km/h', bf: 'light (F1–2)' }, { lo: 7, hi: 11, k: '7–10 kt', kmh: '13–19 km/h', bf: 'gentle (F3)' },
    { lo: 11, hi: 17, k: '11–16 kt', kmh: '20–30 km/h', bf: 'moderate (F4)' }, { lo: 17, hi: 22, k: '17–21 kt', kmh: '31–39 km/h', bf: 'fresh (F5)' },
    { lo: 22, hi: 1e9, k: '22+ kt', kmh: '40+ km/h', bf: 'strong and above (F6+)' }];
  const RAMP = { light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'], dark: ['#184f95', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'] };
  const isDark = () => { const m = css('--paper').match(/#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i); return m ? (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 < 100 : false; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- parsing
  function parseDate(s) {
    s = s.trim();
    let m = s.match(/^(\d{1,2})-([a-z]{3})-(\d{4})/i);
    if (m && MON3[m[2].toLowerCase()] != null) return [+m[3], MON3[m[2].toLowerCase()], +m[1]];
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return [+m[1], +m[2] - 1, +m[3]];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return [+m[3], +m[2] - 1, +m[1]];
    return null;
  }
  function monthIndex(v) {
    v = String(v).trim().toLowerCase(); if (/^\d+$/.test(v)) { const n = +v; return n >= 1 && n <= 12 ? n - 1 : null; }
    const k = v.slice(0, 3); return MON3[k] ?? null;
  }
  function parse(text, fname) {
    const lines = text.split(/\r?\n/);
    let station = '', lat = '', lon = '';
    let hi = -1, cols = null;
    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      const L = lines[i];
      const sn = L.match(/^\s*station name\s*:\s*(.+)$/i); if (sn) station = sn[1].replace(/,+$/, '').trim();
      const la = L.match(/latitude\s*:\s*([-\d.]+)/i); if (la) lat = la[1];
      const lo = L.match(/longitude\s*:\s*([-\d.]+)/i); if (lo) lon = lo[1];
      const f = L.split(',').map(x => x.trim().toLowerCase().replace(/^"|"$/g, ''));
      if (f.length >= 2 && (f.includes('date') || f.includes('year') || f.includes('month') || f.includes('direction')) &&
          f.some(x => /^(rain|rainfall|wdsp|wddir|direction|speed|frequency|percent|rain_mm|mm)$/.test(x))) { hi = i; cols = f; break; }
    }
    if (hi < 0) throw new Error('Could not find a header row with rain or wind columns. Use a Met Éireann monthly, daily or hourly CSV, or one of the templates.');
    const col = name => cols.indexOf(name);
    const find = re => cols.findIndex(c => re.test(c));
    const iDate = col('date'), iYear = col('year'), iMonth = col('month');
    const iRain = find(/^(rain|rainfall|rain_mm|mm)$/), iDir = find(/^(wddir|direction|direction_deg|dir)$/), iSpd = find(/^(wdsp|speed|speed_knots|knots)$/);
    const iFreq = find(/^(frequency|percent|pct)$/);
    const kind = iDate >= 0 ? (lines[hi + 1] && /\d{1,2}:\d{2}/.test(lines[hi + 1]) ? 'hourly' : 'daily') : iYear >= 0 ? 'monthly' : iMonth >= 0 ? 'table' : iDir >= 0 ? 'windlist' : 'unknown';
    const rainRecs = [], wind = [], windTable = [];
    for (let i = hi + 1; i < lines.length; i++) {
      const L = lines[i]; if (!L || !L.trim()) continue;
      const f = L.split(',');
      let y = null, m = null;
      if (iDate >= 0) { const d = parseDate(f[iDate] || ''); if (!d) continue; y = d[0]; m = d[1]; }
      else if (iYear >= 0) { y = parseInt(f[iYear]); m = monthIndex(f[iMonth]); if (!(y > 0) || m == null) continue; }
      else if (iMonth >= 0) { m = monthIndex(f[iMonth]); if (m == null) continue; y = 0; }
      if (iRain >= 0) { const r = parseFloat(f[iRain]); if (isFinite(r) && r >= 0) rainRecs.push([y, m, r]); }
      if (iDir >= 0) {
        const dir = parseFloat(f[iDir]);
        if (iFreq >= 0) { const p = parseFloat(f[iFreq]); if (isFinite(dir) && isFinite(p)) windTable.push([dir, p, iSpd >= 0 ? parseFloat(f[iSpd]) : NaN]); }
        else if (iSpd >= 0) { const sp = parseFloat(f[iSpd]); if (isFinite(dir) && isFinite(sp)) wind.push([y, m, dir, sp]); }
      }
    }
    return { station: station || fname.replace(/\.csv$/i, ''), lat, lon, kind, rainRecs, wind, windTable, fname };
  }

  // ---------------- rainfall
  function rainSummary(D, y0, y1) {
    const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const ym = new Map();
    D.rainRecs.forEach(([y, m, r]) => { const k = y * 12 + m; const o = ym.get(k) || { y, m, sum: 0, n: 0 }; o.sum += r; o.n++; ym.set(k, o); });
    const per = MONTHS.map(() => []); let dropped = 0; const years = new Set();
    ym.forEach(o => {
      if (D.kind !== 'table' && (o.y < y0 || o.y > y1)) return;
      if (D.kind === 'hourly' || D.kind === 'daily') {
        const exp = daysIn(o.y, o.m) * (D.kind === 'hourly' ? 24 : 1);
        if (o.n < exp * 0.9) { dropped++; return; }
      }
      per[o.m].push(o.sum); years.add(o.y);
    });
    const mean = per.map(a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
    return { mean, min: per.map(a => a.length ? Math.min(...a) : NaN), max: per.map(a => a.length ? Math.max(...a) : NaN), n: per.map(a => a.length), dropped, years: [...years].sort() };
  }
  function yearsOf(D) { const s = new Set(); D.rainRecs.forEach(r => s.add(r[0])); D.wind.forEach(r => s.add(r[0])); return [...s].filter(y => y > 0).sort((a, b) => a - b); }

  function drawRain(D, S, example) {
    const svg = $('rainSvg'), W = 760, H = 380, ml = 54, mr = 16, mt = 58, mb = 46;
    const pw = W - ml - mr, ph = H - mt - mb;
    const ok = S.mean.filter(v => v === v);
    if (!ok.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${css('--muted')}" font-family="IBM Plex Mono, monospace" font-size="13">No rainfall in this file for the chosen years</text>`; return; }
    const top = Math.max(...S.max.filter(v => v === v), ...ok);
    const step = top > 300 ? 100 : top > 120 ? 50 : 20, ymax = Math.ceil(top / step) * step;
    const Y = v => mt + ph - v / ymax * ph, bw = pw / 12, barW = Math.min(36, bw - 10);
    const ink = css('--ink'), mut = css('--muted'), rule = css('--rule'), bar = isDark() ? '#5598e7' : '#2a78d6', paper = css('--paper');
    let o = `<rect x="0" y="0" width="${W}" height="${H}" fill="${paper}"/>`;
    const yrs = D.kind === 'table' ? '' : S.years.length ? (S.years[0] === S.years[S.years.length - 1] ? ` ${S.years[0]}` : ` ${S.years[0]}–${S.years[S.years.length - 1]}`) : '';
    const title = `${S.years.length > 1 ? 'Average monthly' : 'Monthly'} rainfall · ${esc(D.station)}${yrs}`;
    o += `<text x="${ml}" y="24" font-family="Archivo, system-ui, sans-serif" font-size="17" font-weight="700" fill="${ink}">${title}</text>`;
    const annual = ok.length === 12 ? S.mean.reduce((a, b) => a + b, 0) : null;
    o += `<text x="${ml}" y="43" font-family="IBM Plex Mono, monospace" font-size="11" fill="${mut}">mm per month${annual ? ` · about ${Math.round(annual).toLocaleString('en-IE')} mm a year` : ''}${S.years.length > 1 ? ' · whiskers show driest and wettest year' : ''}</text>`;
    for (let v = 0; v <= ymax; v += step) {
      o += `<line x1="${ml}" x2="${ml + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${rule}" stroke-width="${v ? 0.6 : 1}"/>`;
      o += `<text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="${mut}">${v}</text>`;
    }
    const wet = S.mean.indexOf(Math.max(...ok)), dry = S.mean.indexOf(Math.min(...ok));
    S.mean.forEach((v, i) => {
      const cx = ml + bw * i + bw / 2;
      o += `<text x="${cx}" y="${mt + ph + 18}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="${mut}">${MONTHS[i]}</text>`;
      if (v !== v) return;
      const y = Y(v), h = mt + ph - y, r = Math.min(4, barW / 2, h);
      o += `<path d="M${cx - barW / 2},${mt + ph} V${y + r} Q${cx - barW / 2},${y} ${cx - barW / 2 + r},${y} H${cx + barW / 2 - r} Q${cx + barW / 2},${y} ${cx + barW / 2},${y + r} V${mt + ph} Z" fill="${bar}"/>`;
      if (S.n[i] > 1) o += `<line x1="${cx}" x2="${cx}" y1="${Y(S.min[i])}" y2="${Y(S.max[i])}" stroke="${ink}" stroke-width="1.2" opacity=".55"/><line x1="${cx - 5}" x2="${cx + 5}" y1="${Y(S.max[i])}" y2="${Y(S.max[i])}" stroke="${ink}" stroke-width="1.2" opacity=".55"/><line x1="${cx - 5}" x2="${cx + 5}" y1="${Y(S.min[i])}" y2="${Y(S.min[i])}" stroke="${ink}" stroke-width="1.2" opacity=".55"/>`;
      if (i === wet || i === dry) o += `<text x="${cx}" y="${(S.n[i] > 1 ? Y(S.max[i]) : y) - 7}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="600" fill="${ink}">${Math.round(v)}</text>`;
      o += `<rect class="hit" data-i="${i}" x="${cx - bw / 2}" y="${mt}" width="${bw}" height="${ph}" fill="transparent"/>`;
    });
    o += `<text x="${W - mr}" y="${H - 6}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="${mut}">${example ? 'EXAMPLE DATA, NOT MEASUREMENTS' : (D.kind === 'table' || D.kind === 'windlist') ? 'Data entered by hand: add the source' : 'Source: Met Éireann, CC BY 4.0'} · ${esc(D.fname)}</text>`;
    if (example) o += `<text x="${ml + pw / 2}" y="${mt + ph / 2}" text-anchor="middle" font-family="Archivo, system-ui, sans-serif" font-size="46" font-weight="800" fill="${ink}" opacity=".08" transform="rotate(-12 ${ml + pw / 2} ${mt + ph / 2})">EXAMPLE</text>`;
    svg.innerHTML = o;
    svg.onmousemove = e => { const r = e.target.closest('.hit'); if (!r) return hideTip(); const i = +r.dataset.i; showTip(e, `<b>${MONTHS[i]}</b> ${isFinite(S.mean[i]) ? Math.round(S.mean[i]) + ' mm' : 'no data'}${S.n[i] > 1 ? `<br>driest ${Math.round(S.min[i])} · wettest ${Math.round(S.max[i])} mm<br>${S.n[i]} years` : ''}`); };
    svg.onmouseleave = hideTip;
    $('rainTable').innerHTML = `<table><thead><tr><th>Month</th><th>Mean (mm)</th><th>Driest</th><th>Wettest</th><th>Years</th></tr></thead><tbody>${S.mean.map((v, i) => `<tr><td>${MONTHS[i]}</td><td class="num">${isFinite(v) ? v.toFixed(1) : '—'}</td><td class="num">${isFinite(S.min[i]) ? S.min[i].toFixed(1) : '—'}</td><td class="num">${isFinite(S.max[i]) ? S.max[i].toFixed(1) : '—'}</td><td class="num">${S.n[i]}</td></tr>`).join('')}</tbody></table>`;
    $('rainNote').textContent = (S.dropped ? `${S.dropped} incomplete month${S.dropped > 1 ? 's' : ''} (under 90% of readings) left out. ` : '') + (annual ? `Wettest month: ${MONTHS[wet]}. Driest: ${MONTHS[dry]}.` : '');
    lastRain = { D, S };
  }

  // ---------------- wind
  function windSummary(D, y0, y1, season) {
    const SEAS = { all: null, djf: [11, 0, 1], mam: [2, 3, 4], jja: [5, 6, 7], son: [8, 9, 10] }[season];
    const grid = SECT.map(() => BANDS.map(() => 0)); let calm = 0, n = 0, sumSp = 0;
    if (D.windTable.length) {
      D.windTable.forEach(([dir, p]) => { const s = Math.round(((dir % 360) + 360) % 360 / 22.5) % 16; grid[s][0] += p; n += p; });
      return { grid, calm: 0, n, mean: NaN, table: true };
    }
    D.wind.forEach(([y, m, dir, sp]) => {
      if (y && (y < y0 || y > y1)) return; if (SEAS && !SEAS.includes(m)) return;
      n++; sumSp += sp;
      if (sp < 1 || dir === 0) { calm++; return; }
      const s = Math.round((dir % 360) / 22.5) % 16; const b = BANDS.findIndex(B => sp >= B.lo && sp < B.hi);
      grid[s][b < 0 ? 0 : b]++;
    });
    return { grid, calm, n, mean: n ? sumSp / n : NaN, table: false };
  }
  function drawWind(D, S, example, labelYears, season) {
    const svg = $('windSvg'), W = 620, H = 600, cx = 250, cy = 300, R = 210;
    const ink = css('--ink'), mut = css('--muted'), rule = css('--rule'), paper = css('--paper');
    const ramp = RAMP[isDark() ? 'dark' : 'light'];
    let o = `<rect x="0" y="0" width="${W}" height="${H}" fill="${paper}"/>`;
    const seasonTxt = { all: 'all year', djf: 'winter (Dec–Feb)', mam: 'spring (Mar–May)', jja: 'summer (Jun–Aug)', son: 'autumn (Sep–Nov)' }[season];
    o += `<text x="20" y="28" font-family="Archivo, system-ui, sans-serif" font-size="17" font-weight="700" fill="${ink}">Wind rose · ${esc(D.station)}${labelYears}</text>`;
    o += `<text x="20" y="47" font-family="IBM Plex Mono, monospace" font-size="11" fill="${mut}">${S.table ? 'frequency from your table' : `${seasonTxt} · % of ${S.n.toLocaleString('en-IE')} hourly readings · direction the wind blows FROM`}</text>`;
    if (!S.n) { svg.innerHTML = o + `<text x="${cx}" y="${cy}" text-anchor="middle" fill="${mut}" font-family="IBM Plex Mono, monospace" font-size="13">No wind readings for this selection</text>`; return; }
    const pct = S.grid.map(r => r.map(v => v / S.n * 100)), tot = pct.map(r => r.reduce((a, b) => a + b, 0));
    const maxP = Math.max(...tot), ringStep = maxP > 20 ? 5 : maxP > 8 ? 2 : 1, rMax = Math.ceil(maxP / ringStep) * ringStep;
    const calmP = S.calm / S.n * 100, r0 = 18;
    const rad = p => r0 + p / rMax * (R - r0);
    for (let p = ringStep; p <= rMax; p += ringStep) {
      o += `<circle cx="${cx}" cy="${cy}" r="${rad(p)}" fill="none" stroke="${rule}" stroke-width="1"/>`;
      o += `<text x="${cx + 4}" y="${cy - rad(p) - 3}" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="${mut}">${p}%</text>`;
    }
    for (let s = 0; s < 16; s++) { const a = s * 22.5 * Math.PI / 180; o += `<line x1="${cx + r0 * Math.sin(a)}" y1="${cy - r0 * Math.cos(a)}" x2="${cx + R * Math.sin(a)}" y2="${cy - R * Math.cos(a)}" stroke="${rule}" stroke-width="${s % 4 ? 0.5 : 1}"/>`; }
    const half = 22.5 / 2 * 0.82 * Math.PI / 180;
    const wedge = (s, a1, a2) => {
      const a = s * 22.5 * Math.PI / 180, p = (r, t) => `${(cx + r * Math.sin(t)).toFixed(1)},${(cy - r * Math.cos(t)).toFixed(1)}`;
      return `M${p(a1, a - half)} L${p(a2, a - half)} A${a2},${a2} 0 0 1 ${p(a2, a + half)} L${p(a1, a + half)} A${a1},${a1} 0 0 0 ${p(a1, a - half)} Z`;
    };
    pct.forEach((row, s) => {
      let acc = 0;
      row.forEach((v, b) => { if (v <= 0) return; const a1 = rad(acc), a2 = rad(acc + v); o += `<path class="hit" data-s="${s}" data-b="${b}" d="${wedge(s, a1, Math.max(a2, a1 + 0.6))}" fill="${S.table ? ramp[2] : ramp[b]}" stroke="${paper}" stroke-width="1.5"/>`; acc += v; });
    });
    o += `<circle cx="${cx}" cy="${cy}" r="${r0}" fill="${paper}" stroke="${rule}"/>`;
    if (!S.table) o += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="${ink}">${calmP.toFixed(0)}%</text>`;
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, d]) => { const a = d * Math.PI / 180; o += `<text x="${cx + (R + 16) * Math.sin(a)}" y="${cy - (R + 16) * Math.cos(a) + 5}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="14" font-weight="600" fill="${ink}">${t}</text>`; });
    // legend
    const lx = 488; let ly = 110;
    if (!S.table) {
      o += `<text x="${lx}" y="${ly - 16}" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="600" fill="${ink}">Wind speed</text>`;
      BANDS.forEach((B, b) => { o += `<rect x="${lx}" y="${ly}" width="14" height="14" rx="2" fill="${ramp[b]}"/><text x="${lx + 20}" y="${ly + 11}" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="${ink}">${B.k}</text><text x="${lx + 20}" y="${ly + 24}" font-family="IBM Plex Mono, monospace" font-size="9" fill="${mut}">${B.kmh}</text>`; ly += 36; });
      o += `<text x="${lx}" y="${ly + 8}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${mut}">Centre: calm</text><text x="${lx}" y="${ly + 22}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${mut}">(${calmP.toFixed(1)}%)</text>`;
      if (isFinite(S.mean)) o += `<text x="${lx}" y="${ly + 48}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${mut}">Mean speed</text><text x="${lx}" y="${ly + 62}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${ink}">${S.mean.toFixed(1)} kt · ${(S.mean * 1.852).toFixed(0)} km/h</text>`;
    }
    const top = tot.indexOf(Math.max(...tot));
    o += `<text x="20" y="${H - 28}" font-family="IBM Plex Mono, monospace" font-size="11" fill="${ink}">Most frequent direction: ${SECT[top]} (${tot[top].toFixed(1)}% of the time)</text>`;
    o += `<text x="${W - 12}" y="${H - 8}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="${mut}">${example ? 'EXAMPLE DATA, NOT MEASUREMENTS' : (D.kind === 'table' || D.kind === 'windlist') ? 'Data entered by hand: add the source' : 'Source: Met Éireann, CC BY 4.0'} · ${esc(D.fname)}</text>`;
    if (example) o += `<text x="${cx}" y="${cy + 120}" text-anchor="middle" font-family="Archivo, system-ui, sans-serif" font-size="46" font-weight="800" fill="${ink}" opacity=".08">EXAMPLE</text>`;
    svg.innerHTML = o;
    svg.onmousemove = e => { const w = e.target.closest('.hit'); if (!w) return hideTip(); const s = +w.dataset.s, b = +w.dataset.b; showTip(e, `<b>From ${SECT[s]}</b> ${tot[s].toFixed(1)}% in total${S.table ? '' : `<br>${BANDS[b].k} (${BANDS[b].bf}): ${pct[s][b].toFixed(1)}%`}`); };
    svg.onmouseleave = hideTip;
    $('windTable').innerHTML = `<table><thead><tr><th>From</th>${S.table ? '<th>%</th>' : BANDS.map(B => `<th>${B.k}</th>`).join('') + '<th>All</th>'}</tr></thead><tbody>${pct.map((r, s) => `<tr><td>${SECT[s]}</td>${S.table ? `<td class="num">${tot[s].toFixed(1)}</td>` : r.map(v => `<td class="num">${v.toFixed(1)}</td>`).join('') + `<td class="num">${tot[s].toFixed(1)}</td>`}</tr>`).join('')}${S.table ? '' : `<tr><td>Calm</td><td class="num" colspan="${BANDS.length + 1}">${calmP.toFixed(1)}</td></tr>`}</tbody></table>`;
    lastWind = { D, S, pct, tot, calmP };
  }

  // ---------------- tooltip
  const tip = document.createElement('div'); tip.className = 'ctip'; tip.hidden = true; document.body.appendChild(tip);
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.hidden = true; }

  // ---------------- exports
  function savePNG(svg, name) {
    const vb = svg.viewBox.baseVal, s = 2, xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = vb.width * s; c.height = vb.height * s;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => dl(b, name + '.png'), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml.includes('xmlns=') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
  }
  function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function saveCSV(rows, name) { dl(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }), name + '.csv'); }

  // ---------------- example data (clearly marked; not measurements)
  function exampleData() {
    const rain = [140, 105, 110, 80, 75, 80, 90, 105, 110, 145, 140, 150];
    const recs = []; for (let y = 2001; y <= 2010; y++) rain.forEach((v, m) => recs.push([y, m, Math.max(10, v * (0.6 + ((y * 7 + m * 13) % 10) / 12))]));
    const wind = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const wts = [3, 2, 2, 2, 3, 3, 5, 7, 9, 11, 12, 10, 8, 6, 4, 3];
    const tw = wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 8760; i++) {
      let r = rnd() * tw, s = 0; while (r > wts[s]) { r -= wts[s]; s++; }
      const sp = rnd() < 0.04 ? 0 : Math.round(3 + rnd() * 10 + (s >= 8 && s <= 12 ? rnd() * 12 : 0));
      wind.push([2010, Math.floor(i / 730), s * 22.5 + (rnd() - 0.5) * 20, sp]);
    }
    return { station: 'Example station', kind: 'monthly', rainRecs: recs, wind: wind.map(w => [w[0], w[1], (w[2] + 360) % 360 || 360, w[3]]), windTable: [], fname: 'example' };
  }

  // ---------------- UI
  let data = null, example = true, lastRain = null, lastWind = null;
  const y0In = $('cYear0'), y1In = $('cYear1'), seasonIn = $('cSeason');
  function setData(D, isExample) {
    data = D; example = isExample;
    const ys = yearsOf(D);
    const opts = ys.map(y => `<option value="${y}">${y}</option>`).join('');
    y0In.innerHTML = opts; y1In.innerHTML = opts;
    if (ys.length) { y0In.value = ys[0]; y1In.value = ys[ys.length - 1]; }
    y0In.disabled = y1In.disabled = !ys.length;
    const hasRain = D.rainRecs.length > 0, hasWind = D.wind.length > 0 || D.windTable.length > 0;
    $('cStatus').innerHTML = isExample
      ? '<b>Showing example data.</b> Load a Met Éireann CSV to draw your own.'
      : `<b>${esc(D.station)}</b> · ${esc(D.fname)} · ${D.kind} data · ${ys.length ? `${ys[0]}–${ys[ys.length - 1]} · ` : ''}${hasRain ? 'rainfall ✓' : 'no rainfall'} · ${hasWind ? 'wind ✓' : 'no wind direction (use an hourly file for the wind rose)'}`;
    $('cStatus').dataset.state = isExample ? 'example' : 'ok';
    render();
  }
  function render() {
    if (!data) return;
    const y0 = +y0In.value || 0, y1 = +y1In.value || 9999, lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const yl = data.kind === 'table' || !yearsOf(data).length ? '' : lo === hi ? ` ${lo}` : ` ${lo}–${hi}`;
    if (data.rainRecs.length) drawRain(data, rainSummary(data, lo, hi), example);
    else { $('rainSvg').innerHTML = `<text x="380" y="190" text-anchor="middle" fill="${css('--muted')}" font-family="IBM Plex Mono, monospace" font-size="13">This file has no rainfall column</text>`; $('rainTable').innerHTML = ''; $('rainNote').textContent = ''; lastRain = null; }
    if (data.wind.length || data.windTable.length) drawWind(data, windSummary(data, lo, hi, seasonIn.value), example, yl, seasonIn.value);
    else { $('windSvg').innerHTML = `<text x="310" y="280" text-anchor="middle" fill="${css('--muted')}" font-family="IBM Plex Mono, monospace" font-size="13">No wind direction in this file. Load an hourly (hly) file.</text>`; $('windTable').innerHTML = ''; lastWind = null; }
  }
  function load(file) {
    if (!file) return;
    $('cStatus').innerHTML = `Reading ${esc(file.name)}…`; $('cStatus').dataset.state = '';
    const r = new FileReader();
    r.onload = () => { setTimeout(() => { try { setData(parse(String(r.result), file.name), false); } catch (err) { $('cStatus').innerHTML = `<b>Couldn't read that file.</b> ${esc(err.message)}`; $('cStatus').dataset.state = 'err'; } }, 20); };
    r.onerror = () => { $('cStatus').innerHTML = '<b>Couldn\'t open that file.</b> Try downloading it again.'; $('cStatus').dataset.state = 'err'; };
    r.readAsText(file);
  }
  $('cFile').addEventListener('change', e => load(e.target.files[0]));
  const drop = $('cDrop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));
  [y0In, y1In, seasonIn].forEach(el => el.addEventListener('change', render));
  $('cExample').onclick = () => setData(exampleData(), true);
  const base = () => (data && !example ? data.station.replace(/[^a-z0-9]+/gi, '_') : 'example');
  $('rainPNG').onclick = () => savePNG($('rainSvg'), base() + '_rainfall');
  $('windPNG').onclick = () => savePNG($('windSvg'), base() + '_wind_rose');
  $('rainCSV').onclick = () => lastRain && saveCSV([['month', 'mean_mm', 'driest_mm', 'wettest_mm', 'years'], ...lastRain.S.mean.map((v, i) => [MONTHS[i], v.toFixed(1), lastRain.S.min[i].toFixed(1), lastRain.S.max[i].toFixed(1), lastRain.S.n[i]])], base() + '_rainfall_summary');
  $('windCSV').onclick = () => lastWind && saveCSV([['from', ...(lastWind.S.table ? ['percent'] : BANDS.map(B => B.k.replace(/ /g, '')).concat('all'))], ...lastWind.pct.map((r, s) => [SECT[s], ...(lastWind.S.table ? [lastWind.tot[s].toFixed(2)] : r.map(v => v.toFixed(2)).concat(lastWind.tot[s].toFixed(2)))]), ...(lastWind.S.table ? [] : [['calm', lastWind.calmP.toFixed(2)]])], base() + '_wind_rose_table');
  document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const t = $(b.dataset.toggle); t.hidden = !t.hidden; b.setAttribute('aria-pressed', !t.hidden); b.textContent = t.hidden ? 'Show table' : 'Hide table'; });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.__climateParse = parse;
  setData(exampleData(), true);
})();
