/**
 * 主库 vs 官网参数对账（只读，不改文件）。
 *
 * 为什么要对账：主库相机行来自《机器视觉标准产品手册》的压缩表格，
 * 手册只印接口小节标题（以太网家族 GigE/2.5G/万兆 合并在一节）、颜色靠型号尾字母，
 * 于是出现过 iface 标低一档（2.5G 写成 GigE）、Camera Link/CoaXPress 混排串台、
 * 传感器列串到"1."这类脏值。官网 VisionProductConfig 有逐项字段，可作为核对基准。
 *
 * 用法：node tools/audit-hikrobot-web.js            # 摘要
 *       node tools/audit-hikrobot-web.js --detail   # 逐条差异（写 tools/_cache/hikrobot_web_diff.txt）
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const CAT = 'hikrobot-catalog.js';
const RAW = 'tools/_cache/hikrobot_official_raw.json';

vm.runInThisContext(fs.readFileSync(CAT, 'utf8'), { filename: CAT });
const C = global.HikrobotCatalog;
const official = JSON.parse(fs.readFileSync(RAW, 'utf8'));

const norm = (m) => String(m || '').toUpperCase().replace(/\s+/g, '').replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'));

const OFF = new Map();
Object.keys(official).forEach((k) => OFF.set(norm(k), official[k]));

/** 手册裸名 → 官网全 SKU：先精确，再「裸名 + 后缀/版本」唯一命中 */
function match(model) {
  const n = norm(model);
  if (OFF.has(n)) return { rec: OFF.get(n), how: 'exact' };
  const cands = [];
  Object.keys(official).forEach((k) => {
    const o = norm(k);
    if (o.length > n.length && o.startsWith(n) && /^[-V0-9(|]/.test(o[n.length])) cands.push(official[k]);
  });
  if (cands.length === 1) return { rec: cands[0], how: 'prefix1' };
  if (cands.length > 1) return { rec: cands[0], how: 'prefix' + cands.length };
  return null;
}

const num = (s) => { const m = String(s || '').match(/[\d.]+/); return m ? +m[0] : null; };

function offIface(f) {
  const t = String(f['数据接口'] || '') + ' ' + String(f['协议/标准'] || '');
  if (/2\.5\s*Gigabit/i.test(t)) return '2.5GigE';
  if (/10\s*Gigabit|万兆/i.test(t)) return '10GigE';
  if (/USB\s*3/i.test(t)) return 'USB3';
  if (/X\s*over\s*Fiber|XoFLink/i.test(t)) return 'XoFLink';
  if (/XoCLink/i.test(t)) return 'XoCLink';
  if (/Camera\s*Link/i.test(t)) return 'CameraLink';
  if (/CoaXPress/i.test(t)) return 'CoaXPress';
  if (/Gigabit Ethernet/i.test(t)) return 'GigE';
  return null;
}
function offMount(f) {
  const t = String(f['镜头接口'] || '');
  if (/M12/i.test(t)) return 'M12';
  if (/M58/i.test(t)) return 'M58';
  if (/M72/i.test(t)) return 'M72';
  if (/M42/i.test(t)) return 'M42/F';
  if (/F[- ]?MOUNT/i.test(t)) return 'F';
  if (/C[- ]?MOUNT/i.test(t)) return 'C';
  if (/裸板|板级|BOARD/i.test(t)) return 'Bare';
  return null;
}
function offRes(f) {
  const m = String(f['分辨率'] || '').match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/i);
  return m ? [ +m[1], +m[2] ] : null;
}
const offPx = (f) => { const m = String(f['像元尺寸'] || '').match(/([\d.]+)\s*[μu]/); return m ? +m[1] : null; };
const offFps = (f) => { const m = String(f['最大帧率'] || '').match(/([\d.]+)\s*fps/i); return m ? +m[1] : null; };
const offLine = (f) => { const m = String(f['最大行频'] || f['行频'] || '').match(/([\d.]+)\s*kHz/i); return m ? +m[1] : null; };
function offShutter(f) {
  const t = String(f['传感器类型'] || '');
  if (/全局/i.test(t)) return 'Global';
  if (/卷帘/i.test(t)) return 'Rolling';
  return null;
}
function offColor(f) {
  const t = String(f['黑白/彩色'] || '');
  if (/近红外|NIR/i.test(t)) return '近红外';
  if (/偏振/i.test(t)) return '偏振';
  if (/彩色/i.test(t)) return '彩色';
  if (/黑白|mono/i.test(t)) return '黑白';
  return null;
}

const rows = [];
const stat = {};
function walk(list, kind) {
  list.forEach((c) => {
    const m = match(c.model);
    if (!m) { stat['官网无此型号'] = (stat['官网无此型号'] || 0) + 1; return; }
    const f = m.rec;
    const diffs = [];
    const push = (k, a, b) => { if (a != null && b != null && String(a) !== String(b)) diffs.push(k + ': 库=' + a + ' → 官网=' + b); };
    push('iface', c.iface, offIface(f));
    push('color', c.color, offColor(f));
    push('mount', c.mount, offMount(f));
    push('shutter', c.shutter, offShutter(f));
    const res = offRes(f);
    if (res && kind === 'area' && (c.w !== res[0] || c.h !== res[1])) diffs.push('分辨率: 库=' + c.w + '×' + c.h + ' → 官网=' + res.join('×'));
    if (res && kind === 'line' && c.w !== res[0]) diffs.push('行宽: 库=' + c.w + ' → 官网=' + res[0]);
    push('pxUm', c.pxUm, offPx(f));
    const fps = kind === 'line' ? offLine(f) : offFps(f);
    if (fps != null && c.fps != null && Math.abs(c.fps - fps) / fps > 0.03) diffs.push('帧率: 库=' + c.fps + ' → 官网=' + fps);
    push('sensor', (c.sensor || '').replace(/[^A-Za-z0-9]/g, '').length <= 2 ? null : (c.sensor || '').replace(/^Gpixel |^Sony /, ''),
      (String(f['传感器型号'] || '').replace(/^Gpixel |^Sony /, '') || null));
    if (diffs.length) {
      rows.push(kind.padEnd(5) + c.model.padEnd(26) + '[' + m.how + '] ' + diffs.join(' | '));
      diffs.forEach((d) => { const k = d.split(':')[0]; stat[k] = (stat[k] || 0) + 1; });
    }
    stat['matched_' + m.how.replace(/\d+$/, 'N')] = (stat['matched_' + m.how.replace(/\d+$/, 'N')] || 0) + 1;
  });
}
walk(C.CAMERAS.filter((x) => x.kind !== 'board'), 'area');
walk(C.CAMERAS.filter((x) => x.kind === 'board'), 'board');
walk(C.LINESCAN, 'line');

console.log('主库面阵 ' + C.CAMERAS.filter((x) => x.kind !== 'board').length +
  ' / 板级 ' + C.CAMERAS.filter((x) => x.kind === 'board').length +
  ' / 线扫 ' + C.LINESCAN.length + '，官网 ' + Object.keys(official).length + ' 条');
console.log('差异字段计数', JSON.stringify(stat, null, 0));
console.log('有差异的型号条数', rows.length);
if (process.argv.indexOf('--detail') >= 0) {
  fs.writeFileSync('tools/_cache/hikrobot_web_diff.txt', rows.join('\n'));
  console.log('明细 -> tools/_cache/hikrobot_web_diff.txt');
} else {
  rows.slice(0, 40).forEach((r) => console.log('  ' + r));
}
