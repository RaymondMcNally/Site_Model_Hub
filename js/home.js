(async function () {
  'use strict';
  const $ = id => document.getElementById(id), esc = SiteView.esc;
  const G = await window.loadSite('index.html', { allowEmpty: true });
  const q = G ? `?site=${encodeURIComponent(G.pack.id)}` : '';
  document.querySelectorAll('#pageCards a').forEach(a => a.href = a.dataset.page + q);

  if (G) {
    const p = G.pack;
    $('sName').textContent = p.name; $('sYear').textContent = p.year || '—';
    $('sSize').textContent = `${G.widthM.toFixed(0)} × ${G.depthM.toFixed(0)} m`;
    $('sLevels').textContent = `${G.fmt(G.lo)} to ${G.fmt(G.hi)} m`;
    $('sLoc').textContent = `${Math.abs(p.lat).toFixed(3)}° ${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(3)}° ${p.lon >= 0 ? 'E' : 'W'}`;
    $('sFeat').textContent = G.feats.length ? `${G.feats.length} traced` : 'none yet';
  }

  async function render() {
    const all = await SiteKit.list();
    const cards = all.map(s => {
      const on = G && s.id === G.pack.id;
      const size = s.w ? `${Math.round(s.w)} × ${Math.round(s.h)} m` : '';
      return `<article class="sitecard${on ? ' on' : ''}" data-id="${esc(s.id)}">
        ${on ? '<canvas class="thumb"></canvas>' : ''}
        <div class="where">${s.where === 'local' ? 'On this computer' : 'Published'}${on ? ' · open now' : ''}</div>
        <h3>${esc(s.name)}</h3>
        <p class="facts">${[s.place, s.year, size].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="row">
          ${on ? '' : `<button type="button" class="primary" data-act="open">Open</button>`}
          <a class="btnlink" href="setup.html?edit=${encodeURIComponent(s.id)}">${s.where === 'local' ? 'Edit' : 'Edit a copy'}</a>
          ${s.where === 'local' ? `<button type="button" data-act="dl">Download pack</button><button type="button" class="danger" data-act="del">Delete</button>` : ''}
        </div></article>`;
    }).join('');
    $('siteGrid').innerHTML = cards + `<a class="sitecard add" href="setup.html"><strong>+ Add a site</strong><span class="small">From a terrain STL file</span></a>`;
    const th = document.querySelector('.thumb');
    if (th && G) { th.width = G.hill.width; th.height = G.hill.height; th.getContext('2d').drawImage(G.hill, 0, 0); }
  }
  $('siteGrid').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.sitecard').dataset.id;
    if (b.dataset.act === 'open') { SiteKit.setActive(id); location.href = 'index.html?site=' + encodeURIComponent(id); }
    if (b.dataset.act === 'dl') { const p = await SiteKit.local.get(id); download(SiteKit.packBlob(p), `${SiteKit.slug(p.name)}-${p.year || ''}.json`.replace('-.json', '.json')); }
    if (b.dataset.act === 'del') {
      const p = await SiteKit.local.get(id);
      if (!confirm(`Delete "${p.name}" from this computer? Download it first if you want to keep it.`)) return;
      await SiteKit.local.del(id); if (G && G.pack.id === id) { try { localStorage.removeItem('sitekit-active'); } catch (er) { } location.href = 'index.html'; } else render();
    }
  });
  $('importPack').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const p = SiteKit.checkPack(JSON.parse(await f.text()));
      if (!p.id.startsWith('local-')) p.id = 'local-' + p.id;
      await SiteKit.local.put(p); SiteKit.setActive(p.id);
      location.href = 'index.html?site=' + encodeURIComponent(p.id);
    } catch (er) { $('importMsg').textContent = er.message; }
  };
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  render();
})();
