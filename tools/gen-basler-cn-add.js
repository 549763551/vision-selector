// 把 baslerweb.cn 抓到的规格（tmp/basler-cn-spec.json）转换成 basler-catalog.js 的字段口径，
// 输出可并入 tools/_cache/basler_cams_add.json / basler_linescan.json 的数组。
// 用法：node tools/gen-basler-cn-add.js [--write]
//   不带 --write 只打统计与样例；带 --write 追加进 _cache（按 model 去重，不覆盖已有条目）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEC = path.join(ROOT, 'tmp', 'basler-cn-spec.json');
const ITEMS = path.join(ROOT, 'tmp', 'basler-cn-items.json');
const ADD_CAMS = path.join(ROOT, 'tools', '_cache', 'basler_cams_add.json');
const LINESCAN = path.join(ROOT, 'tools', '_cache', 'basler_linescan.json');
const WRITE = process.argv.includes('--write');

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const items = JSON.parse(fs.readFileSync(ITEMS, 'utf8'));
const urlKeyOf = new Map(items.map(i => [String(i.model).replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim(), i.url_key]));
const itemOf = new Map(items.map(i => [String(i.model).replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim(), i]));

function normIface(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/CoaXPress/i.test(s)) return 'CoaXPress';
  if (/Camera\s*Link/i.test(s)) return 'CameraLink';
  if (/USB\s*3/i.test(s)) return 'USB3';
  if (/10\s*GigE/i.test(s)) return '10GigE';
  if (/5\s*GigE/i.test(s)) return '5GigE';
  if (/2\.5\s*GigE/i.test(s)) return '2.5GigE';
  if (/GMSL2/i.test(s)) return 'GMSL2';
  if (/BCON/i.test(s)) return 'BCON';
  if (/GigE/i.test(s)) return 'GigE';
  return s;
}

function normMount(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^CS[\s-]?mount/i.test(s)) return 'CS';
  if (/^C[\s-]?mount/i.test(s)) return 'C';
  if (/^S[\s-]?mount/i.test(s)) return 'S';
  if (/^F[\s-]?mount/i.test(s)) return 'F';
  const m = s.match(/M\s?(\d+)/i);
  if (m) return 'M' + m[1];
  if (/no[\s-]?mount/i.test(s)) return '无';   // dart 板级相机，镜头座选配
  if (/integrated/i.test(s)) return '集成镜头';
  return s;
}

// "1 µs - 10 s" / "10 µs ... " → [minUs, maxUs]
function parseExpo(v) {
  if (!v) return [null, null];
  const unitUs = u => (/ms/i.test(u) ? 1000 : (/s/i.test(u) && !/µs|us/i.test(u) ? 1e6 : 1));
  const parts = String(v).match(/([\d.]+)\s*(µs|us|ms|s)/gi);
  if (!parts || !parts.length) return [null, null];
  const vals = parts.map(p => {
    const m = p.match(/([\d.]+)\s*(µs|us|ms|s)/i);
    return parseFloat(m[1]) * unitUs(m[2]);
  });
  return [vals[0], vals.length > 1 ? vals[vals.length - 1] : null];
}

// 系列名对齐库内风格："Basler ace 2" + iface → "ace 2 (10GigE)"
function normSeries(series, iface) {
  if (!series) return null;
  let s = String(series).replace(/^Basler\s+/i, '').trim();
  if (/\bToF\b/i.test(s)) return 'ToF (3D)';
  if (/Stereo/i.test(s)) return 'Stereo (3D)';
  if (iface && !/\(/.test(s)) s += ' (' + iface + ')';
  return s;
}

const cams = [], lines = [], threeD = [], skipped = [];

spec.forEach(x => {
  if (!x.specFound && !x.w) { skipped.push(x); return; }
  const cat = x.cat || '';
  const isLine = /Line Scan/i.test(cat);
  const is3D = /3D/i.test(cat);
  const iface = normIface(x.iface);
  const [expMin, expMax] = parseExpo(x.expo);
  const dkey = urlKeyOf.get(x.model);

  if (is3D) {
    // 3D 相机看的是视场 / 工作范围 / 精度，不是像素尺寸（详见 library.html 的 prof 页签列定义）
    const it = itemOf.get(x.model) || {};
    const isToF = /ToF/i.test(x.series || '') || /^blaze/i.test(x.model);
    // STM 的帧率只在「深度图像分辨率与帧速率」里出现，形如 "1280 × 800 @ 30 fps848 x 480 @ 60 fps"
    const depthFps = x.depth ? (String(x.depth).match(/@\s*([\d.]+)\s*fps/i) || [])[1] : null;
    const rec = {
      model: String(x.model).replace(/^Stereo Camera\s+/i, ''),
      kind: isToF ? 'ToF 相机' : '双目立体相机',
      series: String(x.series || '').replace(/^Basler\s+/i, '') || null,
      res: x.w && x.h ? x.w + '×' + x.h : null,
      fps: x.fps ? x.fps + ' fps' : (depthFps ? depthFps + ' fps' : null),
      fov: x.fov || null,
      work: x.work || null,
      zacc: x.acc || null,
      wave: it.wl || null,
      iface: iface,
      dims: x.dims || null,
      weightG: x.weightG || null,
      sensor: x.sensor || null,
      brand: 'Basler',
      src: 'https://www.baslerweb.cn/zh-cn/shop/' + dkey + '/'
    };
    Object.keys(rec).forEach(k => { if (rec[k] === null || rec[k] === undefined) delete rec[k]; });
    threeD.push(rec);
    return;
  }

  if (isLine) {
    const rec = {
      model: x.model, w: x.w, pxH: x.pxUm, pxV: x.pxUm,
      lineRate: x.lineKHz || (x.fps || null),
      color: x.color, iface,
      // raL 是 racer 第一代（页面「相机系列」行没印），按型号前缀 + 接口补系列名
      series: normSeries(x.series, iface) || (/^raL/i.test(x.model) ? 'racer (' + iface + ')' : null),
      mount: normMount(x.mount),
      sensor: x.sensor, brand: 'Basler',
      src: 'https://www.baslerweb.cn/zh-cn/shop/' + dkey + '/'
    };
    if (expMin != null) rec.expMinUs = Math.round(expMin * 100) / 100;
    lines.push(rec);
    return;
  }

  // dart 是板级相机，官网规格表里没有「镜头接口」这一行（同型号按 No-Mount / CS / S 拆 SKU）。
  // 库里既有 dart 条目一律记「无」，这里保持一致，不要臆造 S 口。
  const mount = normMount(x.mount) || (/^daA/i.test(x.model) ? '无' : null);
  const rec = {
    model: x.model, w: x.w, h: x.h, pxUm: x.pxUm, sw: x.sw || null, sh: x.sh || null,
    size: x.size, fps: x.fps, shutter: x.shutter, iface,
    mount: mount, series: normSeries(x.series, iface), sensor: x.sensor,
    dims: x.dims, poe: x.poe === true, color: x.color, kind: 'area', brand: 'Basler',
    src: 'https://www.baslerweb.cn/zh-cn/shop/' + dkey + '/'
  };
  if (expMin != null) { rec.expMinUs = expMin; if (expMax != null) rec.expMaxUs = expMax; }
  Object.keys(rec).forEach(k => { if (rec[k] === null || rec[k] === undefined) delete rec[k]; });
  cams.push(rec);
});

// 关键字段缺失的单独列出，方便回看是不是解析漏了
const incomplete = cams.filter(c => !c.w || !c.h || !c.pxUm || !c.iface || !c.fps);

console.log('面阵', cams.length, '| 线阵', lines.length, '| 3D', threeD.length, '| 无规格跳过', skipped.length);
console.log('面阵缺关键字段', incomplete.length, incomplete.slice(0, 5).map(c => c.model + ' w=' + c.w + ' px=' + c.pxUm + ' ifc=' + c.iface));
const ifcStat = {};
cams.concat(lines).forEach(c => ifcStat[c.iface] = (ifcStat[c.iface] || 0) + 1);
console.log('接口分布', ifcStat);
const mntStat = {};
cams.concat(lines).forEach(c => mntStat[c.mount] = (mntStat[c.mount] || 0) + 1);
console.log('接口座分布', mntStat);
console.log('样例', JSON.stringify(cams[0], null, 1));
console.log('线阵样例', JSON.stringify(lines[0], null, 1));
console.log('3D 型号', threeD.map(d => d.model).join(', '));

if (WRITE) {
  const norm = s => String(s || '').toUpperCase().replace(/[\s\-_]/g, '');
  const upsert = (file, fresh, label) => {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    const idx = new Map(arr.map((a, i) => [norm(a.model), i]));
    let added = 0, updated = 0;
    fresh.forEach(c => {
      const k = norm(c.model);
      if (idx.has(k)) { arr[idx.get(k)] = c; updated++; }
      else { idx.set(k, arr.length); arr.push(c); added++; }
    });
    fs.writeFileSync(file, JSON.stringify(arr, null, 1) + '\n');
    console.log(label, '新增', added, '更新', updated, '→', path.relative(ROOT, file), '（现', arr.length, '条）');
  };
  upsert(ADD_CAMS, cams, '面阵');
  upsert(LINESCAN, lines, '线阵');

  fs.writeFileSync(path.join(ROOT, 'tools', '_cache', 'basler_3d.json'), JSON.stringify(threeD, null, 1) + '\n');
  console.log('写入 3D', threeD.length, '→ tools/_cache/basler_3d.json');
}
