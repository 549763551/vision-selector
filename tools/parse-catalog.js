/**
 * 从海康机器人《机器视觉标准产品手册-2026.Q3》抽取完整型号库，
 * 光源型号取自官网产品列表（手册不含光源章节）。
 *
 * 用法：
 *   pdftotext -enc UTF-8 -raw "机器视觉标准产品手册-2026.Q3.pdf" stdraw.txt
 *   node tools/fetch-lights.js > lights.json
 *   node tools/parse-catalog.js stdraw.txt webref.json lights.json > hikrobot-catalog.js
 *
 * webref.json：型号 -> {color, iface}，来自官网产品列表，用于校正手册排版串行。
 */
'use strict';
const fs = require('fs');

const textPath = process.argv[2];
const refPath = process.argv[3];
const lightPath = process.argv[4];
const specPath = process.argv[5];
if (!textPath) {
  console.error('用法: node tools/parse-catalog.js <stdraw.txt> <webref.json> <lights.json> <specs.json>');
  process.exit(1);
}

const lines = fs.readFileSync(textPath, 'utf8').split(/\r?\n/).map((s) => s.trim());
const webRef = refPath && fs.existsSync(refPath) ? JSON.parse(fs.readFileSync(refPath, 'utf8')) : {};
const LIGHTS_RAW = lightPath && fs.existsSync(lightPath) ? JSON.parse(fs.readFileSync(lightPath, 'utf8')) : [];
const SPECS = specPath && fs.existsSync(specPath)
  ? JSON.parse(fs.readFileSync(specPath, 'utf8'))
  : { cameras: {}, linescan: {}, lights: {}, controllers: {} };

/** 官网镜头接口字段 -> 统一卡口代号 */
function normalizeMount(s) {
  const t = String(s || '');
  if (/C-Mount/i.test(t)) return 'C';
  if (/CS-Mount/i.test(t)) return 'CS';
  if (/F-Mount/i.test(t)) return 'F';
  if (/M72/i.test(t)) return 'M72';
  if (/M58/i.test(t)) return 'M58';
  if (/M42/i.test(t)) return 'M42';
  if (/M12|S-Mount/i.test(t)) return 'M12';
  return null;
}

/* ============================== 通用 ============================== */

const IFACE = [
  ['XoCLink', 'XoCLink'],
  ['XoFLink', 'XoFLink'],
  ['Camera Link', 'CameraLink'],
  ['CoaXPress', 'CoaXPress'],
  ['万兆网', '10GigE'],
  ['GigE', 'GigE'],
  ['USB3.0', 'USB3']
];
const ifaceOf = (s) => {
  for (const [k, v] of IFACE) if (s.includes(k)) return v;
  return null;
};
const num1 = (s, d) => (s == null ? d : +s);

/** 从型号尾段推断黑白/彩色：去掉 -W/(POE)/-OCT、板级的 -B/-C/-S，再去掉尾部数字 */
function colorFromModel(model, kind) {
  let t = model.replace(/\(.*\)$/, '').replace(/-W$/, '').replace(/-OCT$/, '');
  if (kind === 'board') t = t.replace(/-[BCS]$/, '');
  t = t.replace(/\d+$/, '');
  if (/C$/.test(t)) return '彩色';
  if (/M$/.test(t)) return '黑白';
  return null;
}

/* ============================== 面阵 / 板级相机 ============================== */

const AREA_SEC = /^(CS|CU|CT|CH) 系列.{0,14}工业面阵相机$/;
const BOARD_SEC = /^CB 系列.{0,14}板级相机$/;

const cams = new Map();

function parseCameraLine(text, model, iface, kind, series) {
  const res = text.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/);
  const px = text.match(/([\d.]+)\s*(?:μ|µ|u)m/);
  const fps = text.match(/([\d.]+)\s*fps/i);
  const shut = /Global/i.test(text) ? 'Global' : /Rolling/i.test(text) ? 'Rolling' : null;
  if (!res || !px || !fps || !shut) return null;

  const w = +res[1];
  const h = +res[2];
  const p = +px[1];
  if (w < 320 || h < 240 || p < 0.8 || p > 30) return null;

  const sm = text.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*["”″]/);
  const mountM = text.match(/(C-Mount|CS-Mount|M42|M58|F-Mount|M72|M12)/i);

  // 板级相机用型号后缀表示接口：-B 裸板 / -C C口 / -S M12(S-Mount)
  let mount = mountM ? mountM[1].replace(/-Mount/i, '').toUpperCase() : null;
  if (!mount) {
    const bare = model.replace(/[-_](?:W|POE|OCT|RB|R|B|C|S)(?:\(.*\))?$/g, '');
    if (kind === 'board') {
      if (/-S(?:\b|-)/.test(model.replace(/\(.*\)/, ''))) mount = 'M12';
      else if (/-C(?:\b|-)/.test(model.replace(/\(.*\)/, ''))) mount = 'C';
      else if (/-B(?:\b|-)/.test(model.replace(/\(.*\)/, ''))) mount = 'Bare';
      else mount = 'Bare';
      void bare;
    } else {
      mount = w * p / 1000 <= 17.6 ? 'C' : 'M42/F';
    }
  }

  const ref = webRef[model] || {};
  let color = ref.color || colorFromModel(model, kind);
  if (!color) return null;

  const sw = +(w * p / 1000).toFixed(3);
  const sh = +(h * p / 1000).toFixed(3);

  return {
    model,
    kind,
    w,
    h,
    pxUm: p,
    sw,
    sh,
    size: sm ? sm[1] + '"' : null,
    fps: +fps[1],
    shutter: shut,
    iface: ref.iface || iface,
    color,
    mount,
    series
  };
}

let areaSec = null;
let boardSec = null;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];

  if (AREA_SEC.test(l) && /(GigE|USB3\.0|Camera Link|CoaXPress|万兆网|XoCLink|XoFLink)/.test(l)) {
    areaSec = l;
    boardSec = null;
    continue;
  }
  if (BOARD_SEC.test(l) && /(GigE|USB3\.0)/.test(l)) {
    boardSec = l;
    areaSec = null;
    continue;
  }
  if (/^工业线阵相机$/.test(l) || /^(CS|CU|CT|CH|CB) 系列(二代产品|通用型|三代产品|高端型)$/.test(l)) {
    areaSec = null;
    boardSec = null;
    continue;
  }
  if (!areaSec && !boardSec) continue;
  if (!/^MV-C(S|U|T|H|B)/.test(l)) continue;

  const mm = l.match(/^(MV-[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9()]+)*)/);
  if (!mm) continue;
  const model = mm[1];

  let text = l;
  for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
    const nx = lines[j];
    if (!nx || /^MV-/.test(nx) || /^(技术参数|产品型号)$/.test(nx)) break;
    text += ' ' + nx;
  }

  const isBoard = !!boardSec;
  const parsed = parseCameraLine(
    text,
    model,
    ifaceOf(boardSec || areaSec),
    isBoard ? 'board' : 'area',
    (boardSec || areaSec).replace(/\s*(工业面阵相机|板级相机)/, '')
  );
  if (parsed) cams.set(model, parsed);
}

const CAMERAS = [...cams.values()].sort((a, b) => a.w * a.h - b.w * b.h);

/* ============================== 线扫相机 ============================== */

const LINE_SEC = /^CL 系列.{0,14}工业线阵相机$/;
const LINESCAN = [];
const seenLine = new Set();
let lineSec = null;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (LINE_SEC.test(l) && /(GigE|USB3\.0|Camera Link|CoaXPress|XoFLink)/.test(l)) {
    lineSec = l;
    continue;
  }
  if (/^板级相机$|^(CS|CU|CT|CH) 系列|^工业红外相机$/.test(l)) {
    lineSec = null;
    continue;
  }
  if (!lineSec || !/^MV-CL/.test(l)) continue;

  const mm = l.match(/^(MV-CL[A-Z0-9]+-[A-Z0-9]+)/);
  if (!mm || seenLine.has(mm[1])) continue;
  const model = mm[1];

  let text = l;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    const nx = lines[j];
    if (!nx || /^MV-/.test(nx)) break;
    text += ' ' + nx;
  }

  // 像元：10µm × 180µm（水平像元 × 行高）
  const px = text.match(/([\d.]+)\s*(?:μ|µ|u)m\s*[×x]\s*([\d.]+)\s*(?:μ|µ|u)m/);
  // 分辨率：2048 × 1（像素数 × 行数/通道数），第二个数很小
  const res = text.match(/(\d{3,5})\s*[×x]\s*(\d{1,2})\b/);
  const rate = text.match(/([\d.]+)\s*kHz/i);
  if (!px || !res || !rate) continue;

  const w = +res[1];
  const taps = +res[2];
  if (w < 1000 || w > 40000) continue;

  const color = /黑\s*白/.test(text) ? '黑白' : /彩\s*色/.test(text) ? '彩色' : /C$/.test(model) ? '彩色' : '黑白';

  LINESCAN.push({
    model,
    w,
    taps,
    pxH: +px[1],
    pxV: +px[2],
    lineRate: +rate[1],
    color,
    iface: ifaceOf(lineSec),
    series: lineSec.replace(/\s*工业线阵相机/, ''),
    mount: 'M42/F'
  });
  seenLine.add(model);
}
LINESCAN.sort((a, b) => a.w - b.w);

/* ============================== FA + M12 镜头 ============================== */

const LENS_SERIES = [
  ['HF-E 系列', '1/1.8"', 6],
  ['HF-P 系列', '1/1.8"', 10],
  ['MF-E 系列', '2/3"', 5],
  ['MF-10MPE 系列', '2/3"', 10],
  ['MF-8MPS 系列', '2/3"', 8],
  ['MF 系列', '2/3"', 8],
  ['KF-E 系列', '1.1"', 12],
  ['KF-P 抗振系列', '1.2"', 25],
  ['KF-P 系列', '1.2"', 25],
  ['KF 系列', '1.1"', 12],
  ['AF 系列', '半画幅', null],
  ['LF 系列', '大靶面', null]
];

const lenses = [];
let cur = null;

for (const l of lines) {
  const hit = LENS_SERIES.find(([k]) => l.startsWith(k) && /（|\(/.test(l) && !/\d+\s*$/.test(l));
  if (hit) {
    cur = { series: hit[0], fmt: hit[1], mp: hit[2], mount: null };
    continue;
  }
  if (/^M12 系列$/.test(l)) {
    cur = { series: 'M12 系列', fmt: '1/2"', mp: 5, mount: 'M12' };
    continue;
  }
  if (/^(远心系列|镜头选型工具|线缆|工业面阵相机)/.test(l)) {
    cur = null;
    continue;
  }
  if (!cur) continue;

  // M12 镜头行：MVL-HF0328-05S 3.37 mm F2.8 <1% 100~850 mm 100° 86° 70° S-Mount A
  // FA 镜头行：MVL-HF0628M-6MPE 6 mm F2.8~F16 -0.103% 73.49° 63.11° 44.59° 0.1 m M37.5×P0.5 C-Mount A
  const m = l.match(/^(MVL-[A-Z0-9-]+)\s+([\d.]+)\s*mm\s+F([\d.]+)(?:~F?([\d.]+))?/);
  if (!m) continue;
  if (/-(05S|12S)$/.test(m[1])) continue; // M12 镜头单独解析（其表格在标题之前）

  const rest = l.slice(m[0].length);
  const ang = rest.match(/([\d.]+)°\s+([\d.]+)°\s+([\d.]+)°/);
  const minDist = rest.match(/([\d.]+)\s*m\b/);
  const dist = rest.match(/(-?[\d.]+)\s*%/);
  const focal = +m[2];

  let mount;
  if (cur.mount === 'M12') {
    mount = 'M12';
  } else if (/-M72/.test(m[1]) || /M72/.test(rest)) mount = 'M72';
  else if (/-M58/.test(m[1]) || /M58/.test(rest)) mount = 'M58';
  else if (/-M42/.test(m[1]) || /M42/.test(rest)) mount = 'M42';
  else if (/F-Mount/.test(rest)) mount = 'F';
  else if (/C-Mount/.test(rest)) mount = 'C';
  else if (cur.series === 'LF 系列') mount = 'M72';
  else if (cur.series === 'AF 系列') mount = 'M42';
  else mount = 'C';

  const ic = ang ? +(2 * focal * Math.tan((+ang[1] * Math.PI) / 360)).toFixed(2) : null;

  lenses.push({
    model: m[1],
    focal,
    fmin: +m[3],
    fmax: m[4] ? +m[4] : null,
    mount,
    dist: dist ? +dist[1] : null,
    minDist: minDist ? +minDist[1] : null,
    ic,
    fmt: cur.fmt,
    mp: cur.mp,
    series: cur.series
  });
}

/* ============================== M12 镜头（单独一遍：表格排在小节标题之前） ============================== */

for (const l of lines) {
  const m = l.match(/^(MVL-[A-Z0-9-]+-(?:05S|12S))\s+([\d.]+)\s*mm\s+F([\d.]+)(?:~F?([\d.]+))?\s+(.+)$/);
  if (!m) continue;
  if (lenses.some((x) => x.model === m[1])) continue;
  const rest = m[5];
  const ang = rest.match(/([\d.]+)°\s+([\d.]+)°\s+([\d.]+)°/);
  const focal = +m[2];
  const ic = ang ? +(2 * focal * Math.tan((+ang[1] * Math.PI) / 360)).toFixed(2) : null;
  lenses.push({
    model: m[1],
    focal,
    fmin: +m[3],
    fmax: m[4] ? +m[4] : null,
    mount: 'M12',
    dist: null,
    minDist: null,
    ic,
    fmt: '1/2"',
    mp: /-12S$/.test(m[1]) ? 12 : 5,
    series: 'M12 系列'
  });
}



const TELECENTRIC = [];
const seenTel = new Set();
for (const l of lines) {
  const m = l.match(/^(MVL-[A-Z]{1,3}T?)-xx-yy\s+([\d.]+)~([\d.]+)\s+(\d+)~(\d+)\s*mm\s+(\S+)\s+.*?(C-Mount|M42\/M58\/M72\/F-Mount)\s+(\S+)\s*$/);
  if (!m) continue;
  const key = m[1];
  if (seenTel.has(key)) continue;
  seenTel.add(key);
  TELECENTRIC.push({
    series: key,
    model: key + '-{倍率}-{工作距离}',
    magMin: +m[2],
    magMax: +m[3],
    wdMin: +m[4],
    wdMax: +m[5],
    fmt: m[6],
    mount: m[7].replace(/-Mount/, ''),
    coax: m[8] === '√',
    kind: /BT$/.test(m[1]) ? '双远心' : '远心'
  });
}

/* ============================== 光源 ============================== */

const LIGHTS = LIGHTS_RAW.map((x) => ({
  model: x.model,
  type: x.type,
  color: x.color,
  size: x.size,
  name: x.name
}));

/* ============================== 合并官网详细参数 ============================== */

// 官网型号与手册型号存在 " V5" 版本后缀、分隔符差异，用归一化 key 匹配
function specKey(m) {
  return String(m || '')
    .toUpperCase()
    .replace(/\s+V\d+$/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function indexSpecs(obj) {
  const idx = {};
  for (const k of Object.keys(obj || {})) {
    const key = specKey(k);
    if (!idx[key]) idx[key] = obj[k];
  }
  return idx;
}

const CAM_SPEC_IDX = indexSpecs(SPECS.cameras);
const LINE_SPEC_IDX = indexSpecs(SPECS.linescan);

function findSpec(idx, model) {
  const k = specKey(model);
  if (idx[k]) return idx[k];
  const k2 = k.replace(/[BCS]$/, ''); // 板级型号的 -B/-C/-S 卡口后缀
  if (idx[k2]) return idx[k2];
  // 官网可能带 -OCT / -PRO / -BASE 等后缀：唯一前缀匹配
  const hits = Object.keys(idx).filter((x) => x.indexOf(k) === 0);
  return hits.length === 1 ? idx[hits[0]] : null;
}

for (const c of CAMERAS) {
  const s = findSpec(CAM_SPEC_IDX, c.model);
  if (!s) continue;
  c.dr = s.dynamicRange;
  c.snr = s.snr;
  c.expMinUs = s.exposureMinUs;
  c.expMaxUs = s.exposureMaxUs;
  c.poe = !!s.poe;
  c.powerW = s.power;
  c.sensor = s.sensor;
  if (s.dims && s.dims.length === 3) c.dims = s.dims;
  const m = normalizeMount(s.mount);
  if (m) c.mount = m;
}

for (const c of LINESCAN) {
  const s = findSpec(LINE_SPEC_IDX, c.model);
  if (!s) continue;
  if (s.lineRateKHz) c.lineRate = s.lineRateKHz;
  const m = normalizeMount(s.mount);
  if (m) c.mount = m;
  c.powerW = s.power;
  c.sensor = s.sensor;
  c.expMinUs = s.exposureMinUs;
}

for (const l of LIGHTS) {
  const s = SPECS.lights[l.model];
  if (!s) continue;
  l.power = s.power;
  l.angle = s.angle;
}

const CONTROLLERS = Object.keys(SPECS.controllers || {})
  .map((model) => {
    const s = SPECS.controllers[model];
    return { model, channels: s.channels, mode: s.mode, strobe: !!s.strobe };
  })
  .sort((a, b) => (a.channels || 0) - (b.channels || 0) || a.model.localeCompare(b.model));

/* ============================== 输出 ============================== */

const META = {
  source: '机器视觉标准产品手册-2026.Q3 + 官网产品数据',
  brand: '海康机器人 HIKROBOT',
  generated: new Date().toISOString().slice(0, 10),
  cameras: CAMERAS.length,
  linescan: LINESCAN.length,
  lenses: lenses.length,
  telecentric: TELECENTRIC.length,
  lights: LIGHTS.length,
  controllers: CONTROLLERS.length
};

const body =
  '/**\n' +
  ' * 海康机器人（HIKROBOT）完整型号库\n' +
  ' * 相机/镜头/远心：《' + META.source + '》；光源：官网产品列表\n' +
  ' * 生成脚本：tools/parse-catalog.js    生成日期：' + META.generated + '\n' +
  ' * 面阵 ' + CAMERAS.length + ' / 线扫 ' + LINESCAN.length + ' / 镜头 ' + lenses.length +
  ' / 远心 ' + TELECENTRIC.length + ' / 光源 ' + LIGHTS.length + '。请勿手工编辑。\n' +
  ' */\n' +
  "(function (root, factory) {\n" +
  "  if (typeof module === 'object' && module.exports) module.exports = factory();\n" +
  '  else root.HikrobotCatalog = factory();\n' +
  "})(typeof self !== 'undefined' ? self : this, function () {\n" +
  "  'use strict';\n" +
  '  var META = ' + JSON.stringify(META) + ';\n' +
  '  var CAMERAS = [\n' + CAMERAS.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ];\n' +
  '  var LINESCAN = [\n' + LINESCAN.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ];\n' +
  '  var LENSES = [\n' + lenses.map((l) => '    ' + JSON.stringify(l)).join(',\n') + '\n  ];\n' +
  '  var TELECENTRIC = [\n' + TELECENTRIC.map((t) => '    ' + JSON.stringify(t)).join(',\n') + '\n  ];\n' +
  '  var LIGHTS = [\n' + LIGHTS.map((t) => '    ' + JSON.stringify(t)).join(',\n') + '\n  ];\n' +
  '  var CONTROLLERS = [\n' + CONTROLLERS.map((t) => '    ' + JSON.stringify(t)).join(',\n') + '\n  ];\n' +
  '  return { META: META, CAMERAS: CAMERAS, LINESCAN: LINESCAN, LENSES: LENSES, TELECENTRIC: TELECENTRIC, LIGHTS: LIGHTS, CONTROLLERS: CONTROLLERS };\n' +
  '});\n';

process.stdout.write(body);

const stat = {};
stat.cameras = CAMERAS.length;
stat.board = CAMERAS.filter((c) => c.kind === 'board').length;
stat.linescan = LINESCAN.length;
stat.lenses = lenses.length;
stat.m12 = lenses.filter((l) => l.series === 'M12 系列').length;
stat.telecentric = TELECENTRIC.length;
stat.lights = LIGHTS.length;
process.stderr.write(JSON.stringify(stat) + '\n');
const bi = {};
for (const c of CAMERAS) bi[c.iface] = (bi[c.iface] || 0) + 1;
process.stderr.write('面阵接口 ' + JSON.stringify(bi) + '\n');
const bc = {};
for (const c of CAMERAS) bc[c.color] = (bc[c.color] || 0) + 1;
process.stderr.write('面阵颜色 ' + JSON.stringify(bc) + '\n');
