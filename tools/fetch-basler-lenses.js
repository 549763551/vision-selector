/*
 * 抓取 Basler 官方文档站（docs.baslerweb.com）的镜头规格页，生成镜头 JSON。
 * 用法：node tools/fetch-basler-lenses.js > tools/_cache/basler-lenses.json
 * 数据再经 tools/gen-basler-lens-catalog.py 合成 basler-lens-catalog.js。
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
  .replace(/&nbsp;/g, ' ').replace(/&plusmn;/g, '±').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/gi, ' ');
const num = s => { const m = String(s).match(/([\d.]+)/); return m ? parseFloat(m[1]) : null; };

function parseLensPage(slug, body) {
  const text = strip(body);
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const oi = lines.findIndex(l => /^Order Number$/i.test(l));
  const model = oi > 0 ? lines[oi - 1] : slug.toUpperCase();
  function after(label, n) {
    const i = lines.findIndex(l => new RegExp('^' + label, 'i').test(l));
    if (i < 0) return null;
    return lines.slice(i + 1, i + 1 + (n || 2)).join(' ').trim();
  }
  const isTele = /^c[0-9]+t/i.test(slug);
  const icRaw = after('Image Circle');
  const fmtM = icRaw ? (icRaw.match(/(\d+\/\d+"|\d+(?:\.\d+)?")/) || [])[1] : null;
  const ic = icRaw ? num(icRaw) : null;
  const mountM = (after('Camera Mount') || 'C-mount').match(/C-mount|F-mount|M12/i);
  const mount = /^f-/i.test(slug) ? 'F' : (mountM ? mountM[0].replace('-mount', '').toUpperCase() : 'C');

  if (isTele) {
    const mag = num(after('Magnification'));
    const wd = num(after('Working Distance WD'));
    return {
      model: model, slug: slug, tele: true,
      mag: mag, wd: wd, mount: mount, ic: ic,
      fmt: fmtM ? fmtM.replace(/\\"/, '"') : null,
      source: 'docs.baslerweb.com/' + slug
    };
  }

  const focalRaw = after('Focal Length');
  const apRaw = after('Aperture Range');
  const frRaw = after('Focus Range');
  if (!focalRaw) return null;
  let fmin = null, fmax = null;
  if (apRaw) {
    const fs = apRaw.match(/F([\d.]+)\s*[–\-—]\s*F([\d.]+)/);
    if (fs) { fmin = parseFloat(fs[1]); fmax = parseFloat(fs[2]); }
    else { const f1 = apRaw.match(/F([\d.]+)/); if (f1) fmin = fmax = parseFloat(f1[1]); }
  }
  const mpM = model.match(/-(\d{1,2})M(?:-[A-Z]+)*$/i) || model.match(/-(\d{1,2})M-/i);
  const minDist = frRaw ? num(frRaw.split(/to|~/)[0]) : null;
  return {
    model: model, slug: slug, tele: false,
    focal: focalRaw ? num(focalRaw) : null,
    fmin: fmin, fmax: fmax, mount: mount,
    ic: ic, fmt: fmtM ? fmtM.replace(/\\"/, '"') : null,
    mp: mpM ? parseInt(mpM[1], 10) : null,
    minDist: minDist,
    source: 'docs.baslerweb.com/' + slug
  };
}

(async () => {
  const s = await get('https://docs.baslerweb.com/sitemap.xml');
  const locs = [...s.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace('https://docs.baslerweb.com/', ''));
  const slugs = locs.filter(u => /^c[0-9]/i.test(u) || /^f-s/i.test(u) || /^m12-/i.test(u) || /^s-mount/i.test(u));
  console.error('lens pages: ' + slugs.length);
  const out = [];
  for (let i = 0; i < slugs.length; i++) {
    try {
      const r = await get('https://docs.baslerweb.com/' + slugs[i]);
      if (r.code !== 200) { console.error('skip ' + slugs[i] + ' http ' + r.code); continue; }
      const rec = parseLensPage(slugs[i], r.body);
      if (rec) { out.push(rec); console.error('ok ' + slugs[i]); }
      else console.error('non-spec page ' + slugs[i]);
    } catch (e) { console.error('ERR ' + slugs[i] + ' ' + e.message); }
    await sleep(250);
  }
  console.log(JSON.stringify(out, null, 1));
})();
