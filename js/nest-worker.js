/* Nests laser pieces off the main thread so the page stays responsive. */
importScripts('model-core.js');
onmessage = e => {
  const { masks, sheetW, sheetH } = e.data;
  const items = masks.map((mask, i) => ({ i, mask }));
  const res = self.MyModel.nest(items, sheetW, sheetH, 8, 3, p => postMessage({ progress: p }));
  if (res.error) { postMessage({ error: res.error }); return; }
  postMessage({ done: true, count: res.count, g: res.g, RES: res.RES, margin: res.margin, placed: res.placed.map(p => [p.layer.i, p.sheet, p.cx, p.cy, p.rot]) });
};
