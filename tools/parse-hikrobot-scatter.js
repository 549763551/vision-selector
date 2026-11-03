/**
 * 补齐《机器视觉标准产品手册-2026.Q3》里 tools/parse-hikrobot-gaps.py 推到「需官网二次核对」的零散型号。
 *
 * 上一轮为什么不敢写：这些型号的接口/颜色字母不在旧词表里（-GN/-UN/-TN/-XN 的 N、-UP 的 P），
 * 或者手册表格缺帧率。本轮用官网 VisionProductConfig（tools/_cache/hikrobot_official_raw.json，
 * 由 tools/_cache/_hikfull.js 抓取 CS/CU/CT/CH/CB/CL 六个系列 562 条）逐个核对后定论：
 *   型号尾段倒数第二个字母 = 接口：G=GigE、U/V=USB3、N=2.5GigE、T=万兆网、C=Camera Link、
 *                                    X=CXP-6、Y=CXP-12（两者官网都写 CoaXPress）、F=XoFLink、A=XoCLink、Q=XoFLink
 *   最后一个字母 = 感光：M=黑白、C=彩色、N=近红外增强、P=偏振（IMX250MZR/IMX264MZR）
 * 官网有单品 → 参数取官网；官网只有带后缀的全 SKU（裸板式/前盖/风扇形态）→ 按主库既有口径存裸名，
 * 数值取该全 SKU 页面；官网查不到、但手册表格字段齐全 → 取手册并在报告里标注来源。
 *
 * 不入库（官网查不到且规格存疑，理由见输出报告）：
 *   MV-CB016-10GM-M-W / MV-CB060-10GM-M —— 手册 p23 板级只承诺「裸板式/C/M12」三种镜头接口，
 *     -M / -M-W 后缀不在其中，官网 CB 列表也只有 -C 形态，卡口无法判定（板级卡口直接影响镜头比选）。
 *
 * 用法：
 *   node tools/parse-hikrobot-scatter.js            # 生成 tools/_cache/hikrobot_add_scatter.json + 报告
 * 之后：
 *   python tools/merge-catalog-add.py hikrobot-catalog.js tools/_cache/hikrobot_add_scatter.json \
 *       --map cameras=CAMERAS:cameras --map linescan=LINESCAN:linescan --drop brand
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const RAW = 'tools/_cache/hikrobot_official_raw.json';
const OUT = 'tools/_cache/hikrobot_add_scatter.json';
const REPORT = 'tools/_cache/hikrobot_add_scatter_report.txt';

if (!fs.existsSync(RAW)) {
  console.error('缺少 ' + RAW + '，先跑 node tools/_cache/_hikfull.js 抓官网参数');
  process.exit(1);
}
const official = JSON.parse(fs.readFileSync(RAW, 'utf8'));
vm.runInThisContext(fs.readFileSync('hikrobot-catalog.js', 'utf8'), { filename: 'hikrobot-catalog.js' });
const inLib = new Set(global.HikrobotCatalog.CAMERAS.concat(global.HikrobotCatalog.LINESCAN).map((x) => norm(x.model)));

function norm(m) { return String(m || '').toUpperCase().replace(/\s+/g, ''); }

/* ---------- 官网字段 → 主库字段 ---------- */
const num = (s) => { const m = String(s == null ? '' : s).match(/[\d.]+/); return m ? +m[0] : null; };
function offIface(f) {
  const t = String(f['数据接口'] || '');
  if (/2\.5\s*Gigabit/i.test(t)) return '2.5GigE';
  if (/10\s*Gigabit/i.test(t)) return '10GigE';
  if (/USB\s*3/i.test(t)) return 'USB3';
  if (/X\s*over\s*Fiber/i.test(t)) return 'XoFLink';
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
  return null;
}
const offColor = (f) => ({ '近红外': '近红外', '偏振': '偏振' }[String(f['黑白/彩色'] || '')]
  || (/彩色/.test(String(f['黑白/彩色'] || '')) ? '彩色' : /黑白/.test(String(f['黑白/彩色'] || '')) ? '黑白' : null));
const offSize = (f) => { const t = String(f['靶面尺寸'] || '').replace(/[”″'']/g, '"'); return /^\d/.test(t) ? t : null; };
const offSensor = (f) => { const t = String(f['传感器型号'] || '').trim(); return t && t.length <= 20 ? t : null; };
const offShutter = (f) => /全局/.test(String(f['传感器类型'] || '')) ? 'Global' : /卷帘/.test(String(f['传感器类型'] || '')) ? 'Rolling' : null;
const offRes = (f) => { const m = String(f['分辨率'] || '').match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/i); return m ? [+m[1], +m[2]] : []; };
const offExpMin = (f) => {
  const s = String(f['曝光时间'] || '');
  const us = (s.match(/([\d.]+)\s*(?:μs|µs|us)\b/gi) || []).map((x) => parseFloat(x));
  const ms = (s.match(/([\d.]+)\s*ms\b/gi) || []).map((x) => parseFloat(x) * 1000);
  const sec = (s.match(/([\d.]+)\s*(?:sec|s)\b/gi) || []).map((x) => parseFloat(x) * 1e6).filter((v) => v <= 1e7);
  const all = us.concat(ms, sec);
  return all.length ? Math.min.apply(null, all) : null;
};
const offPower = (f) => num(f['典型功耗'] || f['功耗']);
const offDims = (f) => { const d = (String(f['外形尺寸'] || '').match(/[\d.]+/g) || []).map(Number); return d.length >= 3 ? d.slice(0, 3) : null; };
const SERIES_IFACE = { GigE: 'GigE', USB3: 'USB3.0', '10GigE': '万兆网', '2.5GigE': '2.5GigE', CameraLink: 'Camera Link', CoaXPress: 'CoaXPress', XoFLink: 'XoFLink', XoCLink: 'XoCLink' };
// 主库既有的万兆网系列名不带空格（"CH 系列万兆网"），沿用以免「同系列参数」分组被拆开
const seriesName = (fam, iface) => fam + (iface === '10GigE' ? ' 系列万兆网' : ' 系列 ' + SERIES_IFACE[iface]);

/** 官网精确型号（大小写/空格归一） */
function offExact(model) { return official[Object.keys(official).find((k) => norm(k) === norm(model)) || '\u0000'] || null; }
/** 官网只有带形态后缀的全 SKU 时按裸名找唯一命中（同 SKU 的 V2/硬件改版先排除） */
function offBare(model) {
  const n = norm(model);
  const hits = Object.keys(official).filter((k) => {
    const o = norm(k);
    return o.length > n.length && o.startsWith(n) && /^[-V0-9(|]/.test(o[n.length]) && !/V2|V5|EOL|PRO|BASE/i.test(o.slice(n.length));
  });
  return hits.length === 1 ? official[hits[0]] : null;
}

/* ---------- 记录构造 ---------- */
const cameras = [];
const linescan = [];
const report = [];
function addArea(model, src, over) {
  if (inLib.has(norm(model))) { report.push('跳过（主库已有） ' + model); return; }
  const f = src === 'manual' ? null : (offExact(model) || offBare(model));
  if (src !== 'manual' && !f) { report.push('!! 官网无 ' + model + '（改用 manual 行）'); return; }
  const d = Object.assign({}, f ? {
    w: (offRes(f)[0] || null), h: (offRes(f)[1] || null), pxUm: num(f['像元尺寸']),
    size: offSize(f), fps: num((String(f['最大帧率'] || '').match(/([\d.]+)\s*fps/i) || [])[1]),
    shutter: offShutter(f), iface: offIface(f), color: offColor(f), mount: offMount(f),
    sensor: offSensor(f), powerW: offPower(f), expMinUs: offExpMin(f),
    dr: num(f['动态范围']), snr: num(f['信噪比']), dims: offDims(f),
    poe: /PoE/i.test(String(f['供电'] || ''))
  } : {}, over || {});
  d.model = model;
  d.kind = 'area';
  if (d.w == null || d.h == null || d.pxUm == null || d.fps == null || !d.shutter || d.iface == null || d.color == null) {
    report.push('!! 字段不全，放弃入库 ' + model + ' → ' + JSON.stringify({ w: d.w, h: d.h, pxUm: d.pxUm, fps: d.fps, shutter: d.shutter, iface: d.iface, color: d.color }));
    return;
  }
  d.sw = Math.round(d.w * d.pxUm) / 1000;
  d.sh = Math.round(d.h * d.pxUm) / 1000;
  if (d.expMaxUs == null) d.expMaxUs = 10000000;
  const fam = model.slice(3, 5);
  d.series = d.series || seriesName(fam, d.iface);
  d.brand = '海康机器人 HIKROBOT';
  cameras.push(d);
  report.push('入库 ' + model + ' [' + (src === 'manual' ? '手册' : (offExact(model) ? '官网同名单品' : '官网全SKU')) + '] '
    + d.w + '×' + d.h + ' ' + d.pxUm + 'μm ' + d.iface + ' ' + d.color + ' ' + (d.fps || '-') + 'fps ' + (d.mount || '-'));
}
function addLine(model, over) {
  if (inLib.has(norm(model))) { report.push('跳过（主库已有） ' + model); return; }
  const d = Object.assign({ model: model }, over);
  d.brand = '海康机器人 HIKROBOT';
  linescan.push(d);
  report.push('入库(线扫) ' + model + ' [手册] ' + d.w + ' 行宽 ' + d.pxH + 'μm ' + d.iface + ' ' + d.color + ' ' + d.lineRate + 'kHz');
}

/* ---------- 1) 官网有单品的 ---------- */
['MV-CS013-60GN', 'MV-CS050-60GN', 'MV-CH250-90GN', 'MV-CH250-90UN',
  'MV-CH089-10GM', 'MV-CH089-10GC', 'MV-CH050-10UP'].forEach((m) => addArea(m, 'web'));

/* ---------- 2) 官网只列全 SKU、手册用裸名的 ---------- */
// MV-CH250-90TN → MV-CH250-90TN-M58S-NF（万兆网，M58）；MV-CH250-90XN → -C-NN（CXP-6，C 口）
['MV-CH250-90TN', 'MV-CH250-90XN', 'MV-CH650-90YC'].forEach((m) => addArea(m, 'web'));

/* ---------- 3) 官网查不到、手册表格字段齐全的（N=近红外 / P=偏振 由官网命名口径判定） ---------- */
addArea('MV-CS050-60UN', 'manual', {
  w: 2448, h: 2048, pxUm: 3.45, size: '2/3"', fps: 60, shutter: 'Global', iface: 'USB3',
  color: '近红外', mount: 'C', sensor: '堆栈式BSI', powerW: 1.5, expMinUs: 5, poe: false,
  series: 'CS 系列 USB3.0'
}); // p9 右半页；与官网 MV-CS050-60UM V5 同表格数值，仅近红外增强
addArea('MV-CH120-60GN', 'manual', {
  w: 4096, h: 3000, pxUm: 3.45, size: '1.1"', fps: 10, shutter: 'Global', iface: 'GigE',
  color: '近红外', mount: 'C', sensor: '堆栈式BSI', powerW: 1.7, expMinUs: 10, poe: true,
  series: 'CH 系列 GigE'
}); // p15 右半页
addArea('MV-CH120-60UN', 'manual', {
  w: 4096, h: 3000, pxUm: 3.45, size: '1.1"', fps: 31.3, shutter: 'Global', iface: 'USB3',
  color: '近红外', mount: 'C', sensor: '堆栈式BSI', powerW: 2, expMinUs: 20, poe: false,
  series: 'CH 系列 USB3.0'
}); // p16 左半页
addArea('MV-CH050-11UP', 'manual', {
  w: 2448, h: 2048, pxUm: 3.45, size: '2/3"', fps: 47, shutter: 'Global', iface: 'USB3',
  color: '偏振', mount: 'C', sensor: 'IMX264MZR', powerW: 3.3, expMinUs: 1, poe: false,
  series: 'CH 系列 USB3.0'
}); // p16 左半页，官网只列 10UP（IMX250MZR 74.1fps），11UP 为 IMX264MZR 版本
addArea('MV-CH089-60GM', 'manual', {
  w: 4096, h: 2160, pxUm: 3.45, size: '1"', shutter: 'Global', iface: 'GigE',
  color: '黑白', mount: 'C', sensor: '堆栈式BSI', powerW: 1.7, expMinUs: 20, poe: true, fps: 13.9,
  series: 'CH 系列 GigE'
}); // p15 左半页手册未印帧率，取官网同表 MV-CH089-60GM V5 的 13.9fps（主库 MV-CH089-60GC 同口径）

/* ---------- 4) 线扫：手册 p21「CL 系列 GigE」表实为以太网家族（含 2.5G/万兆） ---------- */
// 8192×1 @147kHz 单色 8bit ≈ 1.2 GB/s，千兆网（110 MB/s）与 2.5G（270 MB/s）都放不下，
// 型号尾字母 T=万兆网，与带宽自洽 → 按 10GigE 入库
addLine('MV-CL08K7-148TM', {
  w: 8192, taps: 1, pxH: 7.0, pxV: 7.0, lineRate: 147, color: '黑白', iface: '10GigE',
  series: 'CL 系列万兆网', mount: 'M42/F', powerW: 9.1, sensor: null
});

report.push('', '不入库：MV-CB016-10GM-M-W(p23)、MV-CB060-10GM-M(p23) —— 手册只承诺裸板/C/M12 三种板级卡口，'
  + '官网 CB 系列仅 -C 形态，-M/-M-W 卡口无法判定');

fs.writeFileSync(OUT, JSON.stringify({ cameras: cameras, linescan: linescan }, null, 1));
fs.writeFileSync(REPORT, report.join('\n') + '\n');
console.log('补库 cameras ' + cameras.length + ' / linescan ' + linescan.length + ' -> ' + OUT);
console.log(report.join('\n'));
