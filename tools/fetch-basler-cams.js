/*
 * 抓取 Basler 官方文档站（docs.baslerweb.com）的相机规格页，产出：
 *   tools/_cache/basler_linescan.json  —— 线扫（r2Line / racer 2 L·S）型号
 *   tools/_cache/basler_cams_add.json  —— 面阵补充（ace / ace 2 / boost 中 parse-basler.py BASE 表未覆盖的分辨率档）
 *   tools/_cache/basler_web_report.txt —— URL 命中清单 + 型号→URL 映射 + 失败原因
 * 命名规律（实测）：型号页 = https://docs.baslerweb.com/<小写型号>.html
 *   例：r2l2048-29gc.html（线扫 racer 2）、a2a2048-37gmbas.html（ace 2 GigE）
 * 用法：node tools/fetch-basler-cams.js [--limit N] [--dry]
 * 限速：串行请求，间隔 >=300ms；总量由过滤条件 + --limit 控制。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'tools', '_cache');
const BASE_URL = 'https://docs.baslerweb.com/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/html'
};
const DELAY_MS = 330;

let requestCount = 0;
function getOnce(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? require('http') : https;
    requestCount++;
    const req = mod.get(url, { headers: HEADERS }, r => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => resolve({ code: r.statusCode, body: d, loc: r.headers.location }));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
  });
}
// docs 站对 "<slug>.html" 与 https->http 均返回 301，需跟随
async function get(url, depth) {
  let r = await getOnce(url);
  let n = depth || 0;
  while ((r.code === 301 || r.code === 302 || r.code === 307 || r.code === 308) && r.loc && n < 3) {
    const next = r.loc.startsWith('http') ? r.loc : BASE_URL + r.loc.replace(/^\.?\//, '');
    r = await getOnce(next); n++;
  }
  return r;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- HTML -> 行/单元格 ---------- */
const ENT = { '&nbsp;': ' ', '&plusmn;': '+-', '&ndash;': '-', '&mdash;': '-', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&times;': '×', '&sup2;': '2', '&deg;': '°', '&micro;': 'µ' };
function unesc(s) {
  s = s.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));
  s = s.replace(/&#x([0-9a-f]+);/gi, (m, d) => String.fromCharCode(parseInt(d, 16)));
  Object.keys(ENT).forEach(k => { s = s.split(k).join(ENT[k]); });
  return s.replace(/&[a-z]+;/gi, ' ');
}
// 单元格内换行 -> " / "，行 -> \u0002，单元格 -> \u0001
function rows(htmlBody) {
  let a = htmlBody.indexOf('<article'), b = htmlBody.indexOf('</article>');
  if (a < 0) a = 0; if (b < 0) b = htmlBody.length;
  let s = htmlBody.slice(a, b);
  s = s.replace(/<(script|style|svg|noscript|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, ' / ');
  s = s.replace(/<\/t[dh]>/gi, '\u0001');
  s = s.replace(/<\/tr>/gi, '\u0002');
  s = s.replace(/<\/(p|div|li|h[1-6]|section|table)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = unesc(s);
  s = s.replace(/\u0001/g, ' \u0001 ').replace(/\u0002/g, '\n\u0002\n');
  return s.split('\n').map(l => l.trim()).filter(Boolean);
}
function cells(line) { return line.split('\u0001').map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean); }
// 取标签对应的值（同一行第二格起）
function field(rs, labelRe) {
  for (const line of rs) {
    const cs = cells(line);
    if (cs.length >= 2 && labelRe.test(cs[0])) return cs.slice(1).join(' / ');
  }
  return null;
}
const num = s => { const m = String(s).match(/(\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
function firstOf(re, s) { const m = String(s || '').match(re); return m || null; }

/* ---------- 字段解析 ---------- */
function mapIface(text) {
  const s = String(text || '');
  if (/CoaXPress/i.test(s)) return 'CoaXPress';
  if (/Camera\s*Link/i.test(s)) return 'CameraLink';
  if (/GMSL/i.test(s)) return 'GMSL';
  if (/USB\s*3/i.test(s)) return 'USB3';
  if (/10\s*Gigabit|10\s*GigE|10GigE/i.test(s)) return '10GigE';
  if (/5\s*Gigabit|5GigE|2\.5\s*Gigabit|2\.5GigE/i.test(s)) return /2\.5/.test(s) ? '2.5GigE' : '5GigE';
  if (/Gigabit Ethernet|Fast Ethernet|GigE/i.test(s)) return 'GigE';
  return null;
}
function mapMount(text) {
  const s = String(text || '');
  if (/C-mount/i.test(s)) return 'C';
  if (/F-mount/i.test(s) && !/C-mount/i.test(s)) return 'F';
  const m = /M(\d{2,3})(?:x[\d.]+)?-mount/i.exec(s) || /M(\d{2,3})\b/.exec(s);
  if (m) return 'M' + m[1];
  if (/M12/i.test(s)) return 'M12';
  return null;
}
const VENDORS = /^(Sony|onsemi|Gpixel|Aptina|e2v|Teledyne|Texas Instruments|STMicroelectronics|CMV|IS|Lince)\s+/i;
function parseSensor(val) {
  if (!val) return null;
  const parts = val.split('/').map(p => p.trim()).filter(Boolean);
  const bad = /progressive scan|global shutter|rolling shutter|area scan|linear|sCMOS|CMOS|Backside|stacked|delivered|output|pixel format/i;
  for (const p of parts) {
    const segs = p.split(',').map(x => x.trim()).filter(Boolean);
    for (const seg of segs) {
      if (bad.test(seg)) continue;
      if (!/\d/.test(seg)) continue;
      if (/^(Mono|Color|NIR|Visible)$/i.test(seg)) continue;
      let out = seg.replace(VENDORS, '').trim();
      if (/[A-Za-z]*\d[A-Za-z0-9\-]*/.test(out)) return out;
    }
  }
  return null;
}
function parseExpRange(val) {
  if (!val) return null;
  const m = /common exposure time mode:\s*([\d.]+)/i.exec(val);
  if (m) return parseFloat(m[1]);
  return num(val);
}
// 曝光时间总表（exposure-time.html）：model -> {min,max}
function buildExpMap(rs) {
  const map = {};
  for (const line of rs) {
    const cs = cells(line);
    if (cs.length < 3) continue;
    if (!/^(a2A|acA|boA|daA|dmA|puA|r2L|r2T|blaze)/i.test(cs[0])) continue;
    if (/^Overview$|^Model$/i.test(cs[0])) continue;
    const mn = parseExpRange(cs[1]);
    const mx = parseExpRange(cs[2]);
    if (mn == null) continue;
    map[cs[0].toLowerCase()] = { min: mn, max: mx, model: cs[0] };
  }
  return map;
}
function lookupExp(map, model) {
  const keys = [model, model.replace(/(bas|pro|ip67|swir|uv|med|nir)$/i, ''), model.replace(/(bas|pro|ip67|swir|uv|med|nir)$/i, '') + 's'];
  for (const k of keys) { const r = map[k.toLowerCase()]; if (r) return r; }
  return null;
}

/* ---------- 单页解析 ---------- */
// boost V 等页面写作 "2.5 µm x 2.5 µm" / "66 mm x 65 mm x 65 mm"，先去掉单位词再配对
function unitless(s) {
  return String(s || '').replace(/[µμ]m\b/g, ' ').replace(/\bmm\b/g, ' ').replace(/\s+/g, ' ');
}
function parseModelPage(url, body) {
  const rs = rows(body);
  const h1 = rs.length ? rs[0].replace(/#\s*$/, '').trim() : '';
  if (!/^[A-Za-z0-9\-\.]+$/.test(h1)) return { error: 'model-name-unrecognized' };
  const res = field(rs, /^Resolution \(H x V/i) || field(rs, /^Resolution$/i);
  const rm = res && /(\d{2,6})\s*[x×]\s*(\d{1,5})/.exec(unitless(res));
  // TDI 线扫（racer 2 XL）写作 "16416 pixels x 256 stages"
  const sm = res && /(\d{2,6})\s*(?:pixels?|px)?\s*[x×]\s*(\d{1,4})\s*stages?/i.exec(res);
  const px = field(rs, /^Pixel Size/i);
  const pm = px && /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(unitless(px));
  const pxSingle = pm ? null : (px ? num(unitless(px)) : null);
  const iface = mapIface(field(rs, /^Image Data Interface/i) || field(rs, /^Communication Interface/i));
  const family = field(rs, /^Product Family/i);
  const monoColor = field(rs, /^Mono\s*\/\s*Color/i);
  // 帧率：docs 各系列标签不一（Frame Rate / Frame Rate (at Default Settings) / Frame Rate @ 4x CXP-12 ...），统一取所有标称值里的最大值
  const frRows = rs.filter(l => /^Frame Rate/i.test(cells(l)[0] || '')).map(l => cells(l).slice(1).join(' / '));
  const fr = frRows.join(' / ');
  let frVals = (String(fr || '').match(/(\d+(?:\.\d+)?)\s*fps/g) || []).map(v => parseFloat(v));
  // boost 部分型号写作 "Frame Rate | See Frame Rates ."，实际数值在同页 Frame Rates 小节表格里 → 回退到全页 fps 取值
  let frAll = false;
  if (!frVals.length) {
    const all = rs.map(l => cells(l).join(' / ')).join(' / ');
    frVals = (String(all).match(/(\d+(?:\.\d+)?)\s*fps/g) || []).map(v => parseFloat(v));
    frAll = frVals.length > 0;
  }
  const power = field(rs, /^Camera Power Requirements/i);
  const pw = power ? num((/(\d+(?:\.\d+)?)\s*W/.exec(power) || [])[1]) : null;
  const dimsM = (() => { const v = field(rs, /^Size \(/i); return v ? /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(unitless(v)) : null; })();
  const conf = field(rs, /^Conformity/i) || '';
  return {
    model: h1.replace(/#+$/, '').trim(),
    url: url,
    w: rm ? +rm[1] : (sm ? +sm[1] : null),
    h: rm ? +rm[2] : null,
    stages: sm ? +sm[2] : null,
    maxLineRate: field(rs, /^Max\.\s*Line Rate/i) || field(rs, /^Line Rate/i),
    resRaw: res,
    pxUm: pm ? parseFloat(pm[1]) : (pxSingle != null ? pxSingle : null),
    pxVum: pm ? parseFloat(pm[2]) : (pxSingle != null ? pxSingle : null),
    size: field(rs, /^Sensor Format/i),
    sensor: parseSensor(field(rs, /^Sensor Type/i)),
    sensorRaw: field(rs, /^Sensor Type/i),
    shutter: /global shutter/i.test(field(rs, /^Sensor Type/i) || '') ? 'Global' : /rolling shutter/i.test(field(rs, /^Sensor Type/i) || '') ? 'Rolling' : null,
    fpsRaw: fr,
    fpsAll: frAll,
    fps: frVals.length ? Math.max.apply(null, frVals) : null,
    lineRates: (function () { const out = []; for (const line of rs) { const cs = cells(line); if (cs.length >= 2 && /via free run/i.test(cs[0])) out.push(cs.slice(1).join(' / ')); } return out; })(),
    iface, family,
    color: /mono/i.test(monoColor || '') ? '黑白' : /color/i.test(monoColor || '') ? '彩色' : null,
    mount: mapMount(field(rs, /^Lens Mount/i)),
    powerW: pw,
    dims: dimsM ? [parseFloat(dimsM[1]), parseFloat(dimsM[2]), parseFloat(dimsM[3])] : null,
    poe: /Power over Ethernet|802\.3af/i.test(power + ' ' + conf)
  };
}

/* ---------- 目标清单 ---------- */
function isLineScan(slug) { return /^(r2l\d+-\d+(gc|gm|cc|cm|g5c|g5m)|r2t\d+-\d+cm)$/.test(slug); }
function areaEligible(slug, existingTiers) {
  if (!/^(aca|a2a|boa)\d+-\d+/.test(slug)) return false;
  if (/(med|swir|uv|pro|ip67)$/i.test(slug)) return false;            // MED ace / 特殊光谱 / 同档位的 PRO·IP67 外壳变体
  if (/^a2a\d+-\d+(mg|m)?[cm]$/.test(slug) && /mg/.test(slug)) return false; // GMSL 接口不在本项目 iface 词表内
  if (/^a2a\d+-\d+g5/.test(slug)) return false;                        // 2.5GigE：本轮额度优先给 GigE/USB3/CXP
  if (/^a2a\d+-\d+g10/.test(slug)) return false;                       // 10GigE 六个档已在 BASE 表
  const t = tierOf(slug);
  return !!t && !existingTiers.has(t);
}
function tierOf(slug) { const m = /^(ac|a2|bo)[Aa](\d+)-(\d+)/.exec(slug); return m ? m[1].toLowerCase() + '|' + m[2] + '|' + m[3] : null; }

/* ---------- 主流程 ---------- */
(async () => {
  const argv = process.argv.slice(2);
  const limitArg = argv.indexOf('--limit');
  const LIMIT = limitArg >= 0 ? parseInt(argv[limitArg + 1], 10) : Infinity;
  const DRY = argv.indexOf('--dry') >= 0;
  const onlyArg = argv.indexOf('--only');
  // 增量补抓：node tools/fetch-basler-cams.js --only boa5120-150cc,acA2500-20gc （结果按 model 合并进已有 JSON）
  const ONLY = onlyArg >= 0 ? String(argv[onlyArg + 1]).split(/[, ]+/).map(s => s.trim().toLowerCase().replace(/\.html$/, '')).filter(Boolean) : null;

  // 已有 86 台（用于按分辨率档去重）
  const cat = require(path.join(ROOT, 'basler-catalog.js'));
  const existing = new Set((cat.CAMERAS || []).map(c => c.model.toLowerCase()));
  const existingTiers = new Set((cat.CAMERAS || []).map(c => tierOf(c.model.toLowerCase())).filter(Boolean));

  const sm = await get(BASE_URL + 'sitemap.xml');
  // sitemap loc 形如 https://docs.baslerweb.com/r2l2048-29gc （无 .html），slug 可能带 %28/%29
  const rawLocs = (sm.body.match(/<loc>([^<]+)<\/loc>/g) || []).map(s => s.slice(5, -6));
  const items = rawLocs.filter(u => u.startsWith(BASE_URL)).map(u => ({
    url: u, slug: decodeURIComponent(u.slice(BASE_URL.length)).replace(/\.html$/, '')
  }));
  const lsItems = items.filter(it => isLineScan(it.slug));
  const areaItems = items.filter(it => areaEligible(it.slug, existingTiers));
  const order = s => (s.startsWith('boa') ? 0 : s.startsWith('a2a') ? 1 : 2);
  areaItems.sort((a, b) => order(a.slug) - order(b.slug) || a.slug.localeCompare(b.slug));
  const all = lsItems.concat(areaItems);
  let skipped = [];
  let queue;
  if (ONLY) {
    // 增量补抓：只取指定 slug，结果按 model 合并进已有 JSON，报告以追加段形式保留原内容
    const want = new Set(ONLY);
    queue = all.filter(it => want.has(it.slug));
    skipped = [];
    console.error('incremental mode: asked=' + ONLY.length + ' matched=' + queue.length);
  } else {
    const take = Math.min(LIMIT, all.length);
    queue = DRY ? [] : all.slice(0, take);
    skipped = all.slice(take).map(i => i.slug);
  }

  console.error('sitemap urls=' + items.length + ' linescan=' + lsItems.length + ' areaNew=' + areaItems.length + ' toFetch=' + queue.length);
  if (DRY) { console.log(JSON.stringify({ ls: lsItems.map(i => i.slug), area: areaItems.map(i => i.slug) }, null, 1)); return; }

  // 曝光时间总表（1 个请求覆盖全部型号）
  let expMap = {};
  try {
    const expUrl = (rawLocs.find(u => /\/exposure-time$/.test(u)) || BASE_URL + 'exposure-time');
    const r = await get(expUrl);
    if (r.code === 200) expMap = buildExpMap(rows(r.body));
    console.error('exposure rows: ' + Object.keys(expMap).length);
  } catch (e) { console.error('exposure-time ERR ' + e.message); }
  await sleep(DELAY_MS);

  const linescan = [], areaAdd = [], unresolved = [], urlMap = [], fbModels = [];
  let done = 0;
  for (const it of queue) {
    const url = it.url, slug = it.slug;
    let rec = null;
    try {
      const r = await get(url);
      if (r.code !== 200) { unresolved.push({ model: slug, url, reason: 'HTTP ' + r.code }); await sleep(DELAY_MS); continue; }
      rec = parseModelPage(url, r.body);
    } catch (e) { unresolved.push({ model: slug, url, reason: 'fetch-error: ' + e.message }); await sleep(DELAY_MS); continue; }
    if (!rec || rec.error) { unresolved.push({ model: slug, url, reason: (rec && rec.error) || 'empty-page' }); await sleep(DELAY_MS); continue; }
    if (!rec.w) { unresolved.push({ model: rec.model || slug, url, reason: 'table-structure-unrecognized (no numeric Resolution row)' }); await sleep(DELAY_MS); continue; }
    const exp = lookupExp(expMap, rec.model);
    urlMap.push({ model: rec.model, url: rec.url, linescan: isLineScan(slug) });
    if (isLineScan(slug)) {
      const nums = [];
      rec.lineRates.forEach(t => (t.match(/(\d+(?:\.\d+)?)/g) || []).forEach(v => nums.push(parseFloat(v))));
      const nameRate = parseFloat((/-\d+/.exec(slug) || [''])[0].slice(1));
      const linesM = /,\s*(\d+)\s+lines/i.exec(rec.sensorRaw || '');
      // iface 词表限定 GigE/USB3/CameraLink/CoaXPress；2.5GigE 等速率档归入 GigE，细节留在 series
      const rawIface = rec.iface;
      const iface = /GigE|Ethernet/i.test(rawIface || '') ? 'GigE' : rawIface;
      const o = {
        model: rec.model, w: rec.w, pxH: rec.pxUm, pxV: rec.pxVum,
        lineRate: nums.indexOf(nameRate) >= 0 ? nameRate : (nums.length ? Math.max.apply(null, nums) : (num(rec.maxLineRate || '') != null ? Math.round(num(rec.maxLineRate) * 10) / 10 : null)),
        color: rec.color, iface: iface, series: (rec.family || 'racer 2') + ' (' + (rawIface || 'GigE') + ')',
        mount: rec.mount, powerW: rec.powerW, sensor: rec.sensor,
        expMinUs: exp ? exp.min : null, stages: rec.stages, brand: 'Basler', src: rec.url
      };
      // taps：docs 站型号页与线扫配置页均无 tap 位数记载（CXP 以 lane 描述），故省略该 key。
      // 传感器同时曝光的线数（彩色 3-line 等）仅用于说明，不写入记录。
      if (linesM) console.error('note: ' + rec.model + ' sensor has ' + linesM[1] + ' lines');
      Object.keys(o).forEach(k => { if (o[k] == null) delete o[k]; });
      linescan.push(o);
    } else {
      const o = {
        model: rec.model, w: rec.w, h: rec.h, pxUm: rec.pxUm,
        sw: rec.pxUm && rec.w ? +(rec.w * rec.pxUm / 1000).toFixed(3) : null,
        sh: rec.pxUm && rec.h ? +(rec.h * rec.pxUm / 1000).toFixed(3) : null,
        size: rec.size, fps: rec.fps, shutter: rec.shutter, iface: rec.iface, mount: rec.mount,
        series: (rec.family || '') + ' (' + rec.iface + ')', sensor: rec.sensor, dims: rec.dims,
        expMinUs: exp ? exp.min : null, expMaxUs: exp ? exp.max : null,
        poe: rec.poe, powerW: rec.powerW, color: rec.color, kind: 'area', brand: 'Basler', src: rec.url
      };
      Object.keys(o).forEach(k => { if (o[k] == null) delete o[k]; });
      if (rec.fpsAll) fbModels.push(rec.model);
      areaAdd.push(o);
    }
    if (++done % 20 === 0) console.error('... ' + done + '/' + queue.length + ' requests=' + requestCount);
    await sleep(DELAY_MS);
  }

  const addFile = path.join(CACHE, 'basler_cams_add.json');
  const lsFile = path.join(CACHE, 'basler_linescan.json');
  const repFile = path.join(CACHE, 'basler_web_report.txt');
  const merge = (prevArr, newArr) => {
    const byModel = new Map(prevArr.map(o => [o.model.toLowerCase(), o]));
    newArr.forEach(o => byModel.set(o.model.toLowerCase(), o));
    return [...byModel.values()];
  };
  if (ONLY) {
    const pLs = fs.existsSync(lsFile) ? JSON.parse(fs.readFileSync(lsFile, 'utf8')) : [];
    const pAdd = fs.existsSync(addFile) ? JSON.parse(fs.readFileSync(addFile, 'utf8')) : [];
    const mLs = merge(pLs, linescan), mAdd = merge(pAdd, areaAdd);
    fs.writeFileSync(lsFile, JSON.stringify(mLs, null, 1));
    fs.writeFileSync(addFile, JSON.stringify(mAdd, null, 1));
    console.log(JSON.stringify({ linescan: mLs.length, areaAdd: mAdd.length, refetched: linescan.length + areaAdd.length, unresolved: unresolved.length }));
  } else {
    fs.writeFileSync(lsFile, JSON.stringify(linescan, null, 1));
    fs.writeFileSync(addFile, JSON.stringify(areaAdd, null, 1));
  }

  const fam = arr => arr.reduce((a, x) => (a[x.series] = (a[x.series] || 0) + 1, a), {});
  const rep = [];
  if (ONLY) {
    // 增量补抓：保留原报告，追加本轮小节
    rep.push('');
    rep.push('===== 增量补抓 (--only) ' + new Date().toISOString() + ' =====');
    rep.push('本轮 HTTP 请求数: ' + requestCount + ' (含 sitemap 1 + 曝光总表 1)；串行限速 ' + DELAY_MS + 'ms/请求');
    rep.push('本轮重解析并合并入库: 线扫 ' + linescan.length + ' 条 / 面阵 ' + areaAdd.length + ' 条；unresolved ' + unresolved.length + ' 条');
    if (fbModels.length) rep.push('fps 取自同页 Frame Rates 小节表格（型号页 Frame Rate 行仅写 "See Frame Rates"）: ' + fbModels.join(', '));
    urlMap.forEach(x => rep.push(x.model + '\t' + x.url));
    unresolved.forEach(x => rep.push(x.model + '\t' + x.url + '\t' + x.reason));
    fs.appendFileSync(repFile, rep.join('\n') + '\n');
    console.error('DONE(only) refetched=' + urlMap.length + ' unresolved=' + unresolved.length + ' requests=' + requestCount);
    return;
  }
  rep.push('Basler 相机联网取数报告  (tools/fetch-basler-cams.js)');
  rep.push('生成时间: ' + new Date().toISOString());
  rep.push('总 HTTP 请求数: ' + requestCount + ' (含 sitemap 1 + 曝光总表 1)；串行限速 ' + DELAY_MS + 'ms/请求');
  rep.push('');
  rep.push('== URL 命名规律 (docs.baslerweb.com，实测可用) ==');
  rep.push('型号规格页 = https://docs.baslerweb.com/<型号小写>   （sitemap 的 loc 不带 .html；<slug>.html 会 301 到 <slug>）');
  rep.push('  线扫例: https://docs.baslerweb.com/r2l2048-29gc  ;  https://docs.baslerweb.com/r2l8192-240cm');
  rep.push('  面阵例: https://docs.baslerweb.com/a2a2048-37gmbas  ;  https://docs.baslerweb.com/boa1936-400cm');
  rep.push('sitemap: https://docs.baslerweb.com/sitemap.xml (共 ' + items.length + ' 个 loc，含全部型号页；sitemap.xml 可达，www.baslerweb.com 403 未使用)');
  rep.push('曝光上下限总表: https://docs.baslerweb.com/exposure-time (解析出 ' + Object.keys(expMap).length + ' 个型号行，覆盖 ace/ace 2/boost/dart/pulse/racer 2)');
  rep.push('系列总览页(仅型号清单,无数值表): cameras / area-and-line-scan-cameras / basler-ace / basler-ace-2 / basler-boost / basler-racer-2');
  rep.push('带括注的特性页命名: <feature>-%28<family>%29 ，例 exposure-time-%28stereo-ace%29');
  rep.push('');
  rep.push('== 线扫 (basler_linescan.json) ==  共 ' + linescan.length + ' 条');
  rep.push('系列分布: ' + JSON.stringify(fam(linescan), null, 1));
  rep.push('sitemap 命中线扫 slug 全清单(' + lsItems.length + '): ' + lsItems.map(i => i.slug).join(', '));
  rep.push('');
  rep.push('== 面阵补充 (basler_cams_add.json) ==  共 ' + areaAdd.length + ' 条');
  rep.push('系列分布: ' + JSON.stringify(fam(areaAdd), null, 1));
  rep.push('');
  rep.push('== 型号 → 来源 URL 映射 (全 ' + urlMap.length + ' 条，逐条含 src 字段) ==');
  urlMap.forEach(x => rep.push(x.model + '\t' + x.url));
  rep.push('');
  rep.push('== 未收录 / unresolved ==  共 ' + unresolved.length + ' 条');
  unresolved.forEach(x => rep.push(x.model + '\t' + x.url + '\t' + x.reason));
  rep.push('');
  rep.push('== 已知边界与判定 ==');
  rep.push('1) docs.baslerweb.com 全站无 runner 型号页（sitemap 关键词 runner=0、r2line=0；line-scan 相关只有配置类主题），现役线扫 = racer 2 系列 r2L*/r2T*（17 个型号页）。');
  rep.push('2) blaze-101/101s/102/102s/112/112s 经核实为 3D ToF 相机（Sony IMX556 DepthSense, Area Scan CMOS），不属于线扫，未写入 linescan。');
  rep.push('3) taps（抽头数）在型号规格页与 GigE/CXP 线扫配置页均无记载，CXP 机型以 lane 数描述，故 linescan 记录省略 taps 字段。');
  rep.push('4) lineRate 取型号页 Line Rates 表 free-run 行中与型号命名数字一致的值（默认 ROI 设置下的行频，即 Basler 标称值），未采用 footnote a 的最大值。');
  rep.push('5) pxV 为像素垂直尺寸(µm)，与海康库 linescan 字段语义一致；彩色 r2L 为 3-line 传感器（Sensor Type 明示），黑白为 1-line。');
  rep.push('6) 面阵过滤：排除 PRO/IP67 外壳变体、ace 2 GMSL(mg) 与 2.5GigE(g5) 档、MED ace、SWIR/UV 特殊光谱，以及与 BASE 表同分辨率档（86 台）重复项。');
  rep.push('7) 本轮受请求额度限制（--limit ' + LIMIT + '）未抓取的型号页 ' + skipped.length + ' 个，slug 见下，可再次运行本脚本补齐：');
  if (skipped.length) rep.push('   未抓取: ' + skipped.join(', '));
  rep.push('8) docs 站确有逐型号数值表（General Specifications），非仅概览页；PDF 数据手册仅作为图形/尺寸补充，未使用。');
  fs.writeFileSync(path.join(CACHE, 'basler_web_report.txt'), rep.join('\n') + '\n');
  console.error('DONE linescan=' + linescan.length + ' areaAdd=' + areaAdd.length + ' unresolved=' + unresolved.length + ' requests=' + requestCount);
})();
