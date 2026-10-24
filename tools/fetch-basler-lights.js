/*
 * 抓取 Basler 官方文档站的光源规格页（一页含多个颜色变体，转置表解析）。
 * 用法：node tools/fetch-basler-lights.js > tools/_cache/basler-lights.json
 * 之后用 tools/gen-basler-light-catalog.py 合成 basler-light-catalog.js。
 */
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36', 'Accept': 'text/html' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ code: r.statusCode, body: d }));
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => h
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ').replace(/&plusmn;/g, '±').replace(/&ndash;/g, '–').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/gi, ' ');

const TYPE_MAP = {
  ring: 'ring', backlight: 'backlight', back: 'backlight', bar: 'bar', flood: 'flood',
  'flat dome': 'flat_shadowless', dome: 'dome', 'dark field': 'darkfield',
  spot: 'point', coaxial: 'coaxial', line: 'line', 'coaxial light': 'coaxial'
};
function typeFromModel(model) {
  const m = model.match(/^Basler (?:Camera )?Light ([A-Za-z ]+?)-?\d/);
  if (!m) return null;
  const t = m[1].trim().toLowerCase();
  return TYPE_MAP[t] || TYPE_MAP[t.split(' ')[0]] || t.replace(/\s+/g, '_');
}
const COLOR_KEY = { red: 'red', white: 'white', blue: 'blue', green: 'green', infrared: 'ir', ir: 'ir', uv: 'uv', cyan: 'cyan', yellow: 'yellow' };

function parseLightPage(slug, body) {
  const text = strip(body);
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  // 取最后一处 General Specifications（前面是导航）
  const occ = [];
  lines.forEach((l, k) => { if (/^General Specifications$/.test(l)) occ.push(k); });
  if (!occ.length) return [];
  const start = occ[occ.length - 1];
  const seg = lines.slice(start + 1, start + 80);
  if (seg[0] !== '#') return [];
  const models = [];
  let k = 1;
  while (k < seg.length && /^Basler (Camera )?Light /.test(seg[k])) { models.push(seg[k]); k++; }
  if (!models.length) return [];
  const cols = models.length;
  const rows = {};   // label -> [values…]
  let label = null, buf = [];
  function flush() {
    if (label && buf.length) rows[label] = buf;
    label = null; buf = [];
  }
  for (; k < seg.length; k++) {
    const l = seg[k];
    if (/^(Electrical Specifications|Mechanical Specifications|LED Specifications|Risk Class|Environmental|Performance|Connector|Pin|Spectrum|Uniformity|\d+ \d+|Dimensions|Unit)/.test(l)) { flush(); label = null; continue; }
    const isLabel = buf.length >= cols || /^[A-Z][A-Za-z /()%(),\-–—0-9]+$/.test(l) && !/^[-\d.]/.test(l) && buf.length >= cols;
    // 判定新标签：当前 buf 已满列数 或 明显是文字标签
    if (buf.length >= cols && cols > 0) { flush(); label = l; buf = []; continue; }
    if (label === null) { label = l; buf = []; continue; }
    buf.push(l === '-' ? null : l);
  }
  flush();

  function pick(re) {
    for (const key of Object.keys(rows)) if (re.test(key)) return rows[key];
    return null;
  }
  const ledColors = pick(/LED Color/i);
  const waves = pick(/Peak Wavelength/i);
  const areas = pick(/Luminous Area/i);
  const powers = pick(/Power Consumption/i) || pick(/Power/i);
  const out = [];
  for (let c = 0; c < cols; c++) {
    const model = models[c];
    const colorTxt = (ledColors && ledColors[c] || '').toLowerCase();
    const colorKey = Object.keys(COLOR_KEY).find(k => colorTxt.indexOf(k) >= 0);
    const wave = waves && waves[c] && waves[c] !== '-' ? waves[c] : null;
    const area = areas && areas[c] && areas[c] !== '-' ? areas[c] : null;
    const powerRaw = powers && powers[c];
    const power = powerRaw ? parseFloat(String(powerRaw).match(/([\d.]+)/)?.[1]) : null;
    const size = area ? area.match(/([\d.]+)\s*[–-]\s*([\d.]+)/) ? [parseFloat(area.match(/([\d.]+)/)[1]), parseFloat(area.match(/[–-]\s*([\d.]+)/)[1])] : [parseFloat(area)] : null;
    out.push({
      model: model,
      type: typeFromModel(model) || 'ring',
      color: colorKey || 'white',
      wavelength: wave,
      size: size,
      power: power && !isNaN(power) ? power : null,
      source: 'docs.baslerweb.com/' + slug
    });
  }
  return out;
}

(async () => {
  const s = await get('https://docs.baslerweb.com/sitemap.xml');
  const locs = [...s.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace('https://docs.baslerweb.com/', ''));
  const slugs = locs.filter(u => /^basler-(camera-)?light-/i.test(u))
    .filter(u => !/^(basler-camera-lights|basler-lights)$/.test(u));
  console.error('light pages: ' + slugs.length);
  const out = [];
  for (const slug of slugs) {
    try {
      const r = await get('https://docs.baslerweb.com/' + slug);
      if (r.code !== 200) { console.error('skip ' + slug + ' ' + r.code); continue; }
      const recs = parseLightPage(slug, r.body);
      if (recs.length) { out.push(...recs); console.error('ok ' + slug + ' -> ' + recs.length); }
      else console.error('no table ' + slug);
    } catch (e) { console.error('ERR ' + slug + ' ' + e.message); }
    await sleep(220);
  }
  console.log(JSON.stringify(out, null, 1));
})();
