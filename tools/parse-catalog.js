/**
 * 从海康机器人《机器视觉标准产品手册-2026.Q3》抽取相机与镜头型号表，
 * 生成 hikrobot-catalog.js。
 *
 * 用法：
 *   pdftotext -enc UTF-8 -raw "机器视觉标准产品手册-2026.Q3.pdf" stdraw.txt
 *   node tools/parse-catalog.js stdraw.txt webref.json > hikrobot-catalog.raw.json
 *
 * webref.json 为「型号 -> {color, iface}」对照（来自官网产品列表），
 * 用于校正手册排版中丢失/串行的黑白彩色与接口信息。
 */
'use strict';
const fs = require('fs');

const textPath = process.argv[2];
const colorPath = process.argv[3];
if (!textPath) {
  console.error('用法: node tools/parse-catalog.js <stdraw.txt> [webcolor.json]');
  process.exit(1);
}

const lines = fs.readFileSync(textPath, 'utf8').split(/\r?\n/).map((s) => s.trim());
const webRef = colorPath && fs.existsSync(colorPath) ? JSON.parse(fs.readFileSync(colorPath, 'utf8')) : {};

/* ============================== 相机 ============================== */

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
const isSection = (l) => /^(CS|CU|CT|CH) 系列.{0,14}工业面阵相机$/.test(l);
const isStop = (l) => isSection(l) || /^(技术参数|产品型号)$/.test(l) || /^(CS|CU|CT|CH) 系列/.test(l);

const cams = new Map();
let sec = null;
let inArea = false;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (isSection(l) && /(GigE|USB3\.0|Camera Link|CoaXPress|万兆网|XoCLink|XoFLink)/.test(l)) {
    sec = l;
    inArea = true;
    continue;
  }
  if (/^(CS|CU|CT|CH) 系列(二代产品|通用型|三代产品|高端型)$/.test(l) || /^工业线阵相机$/.test(l)) {
    inArea = false;
    sec = null;
    continue;
  }
  if (!inArea || !sec) continue;
  if (!/^MV-C(S|U|T|H)/.test(l)) continue;

  const mm = l.match(/^(MV-[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)/);
  if (!mm) continue;
  const model = mm[1];

  // 型号行可能被排版拆开：向后合并最多 7 行，直到遇到下一个型号/小节
  let text = l;
  for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
    const nx = lines[j];
    if (!nx || /^MV-/.test(nx) || isStop(nx)) break;
    text += ' ' + nx;
  }

  const res = text.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/);
  const px = text.match(/([\d.]+)\s*(?:μ|µ|u)m/);
  const fps = text.match(/([\d.]+)\s*fps/i);
  const shut = /Global/i.test(text) ? 'Global' : /Rolling/i.test(text) ? 'Rolling' : null;
  if (!res || !px || !fps || !shut) continue;

  const w = +res[1];
  const h = +res[2];
  const p = +px[1];
  if (w < 320 || h < 240 || p < 0.8 || p > 30) continue;

  const sm = text.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*["”″]/);
  const mountM = text.match(/(C-Mount|CS-Mount|M42|M58|F-Mount|M72|M12)/i);
  const ref = webRef[model] || {};
  const color =
    ref.color ||
    (/C(?:01)?$/.test(model) ? '彩色' : /M(?:01)?$/.test(model) ? '黑白' : null);
  if (!color) continue;

  const sw = +(w * p / 1000).toFixed(3);
  const sh = +(h * p / 1000).toFixed(3);
  cams.set(model, {
    model,
    w,
    h,
    pxUm: p,
    sw,
    sh,
    size: sm ? sm[1] + '"' : null,
    fps: +fps[1],
    shutter: shut,
    iface: ref.iface || ifaceOf(sec),
    color,
    mount: mountM ? mountM[1].replace(/-Mount/i, '').toUpperCase() : sw <= 17.6 ? 'C' : 'M42/F',
    series: sec.replace(/\s*工业面阵相机/, '')
  });
}

const CAMS = [...cams.values()].sort((a, b) => a.w * a.h - b.w * b.h);

/* ============================== 镜头 ============================== */

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
  const hit = LENS_SERIES.find(
    ([k]) => l.startsWith(k) && /（|\(/.test(l) && !/\d+\s*$/.test(l)
  );
  if (hit) {
    cur = { series: hit[0], fmt: hit[1], mp: hit[2] };
    continue;
  }
  if (/^(M12 系列|远心系列|镜头选型工具|线缆|工业面阵相机)/.test(l)) {
    cur = null;
    continue;
  }
  if (!cur) continue;

  const m = l.match(/^(MVL-[A-Z0-9-]+)\s+([\d.]+)\s*mm\s+F([\d.]+)(?:~F?([\d.]+))?/);
  if (!m) continue;

  const rest = l.slice(m[0].length);
  const ang = rest.match(/([\d.]+)°\s+([\d.]+)°\s+([\d.]+)°/);
  const minDist = rest.match(/([\d.]+)\s*m\b/);
  const dist = rest.match(/(-?[\d.]+)\s*%/);
  const focal = +m[2];

  // 卡口：优先看型号后缀（-M72 / -M58 / -M42），再看表格里的接口列
  const mount = /-M72/.test(m[1]) || /M72/.test(rest) ? 'M72'
    : /-M58/.test(m[1]) || /M58/.test(rest) ? 'M58'
    : /-M42/.test(m[1]) || /M42/.test(rest) ? 'M42'
    : /F-Mount/.test(rest) ? 'F'
    : /C-Mount/.test(rest) ? 'C'
    : cur.series === 'LF 系列' ? 'M72'
    : cur.series === 'AF 系列' ? 'M42'
    : 'C';

  // 由全视场角反推像面直径：IC = 2·f·tan(D/2)
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

/* ============================== 输出 ============================== */

const META = {
  source: '机器视觉标准产品手册-2026.Q3',
  brand: '海康机器人 HIKROBOT',
  generated: new Date().toISOString().slice(0, 10),
  cameras: CAMS.length,
  lenses: lenses.length
};

const body =
  '/**\n' +
  ' * 海康机器人（HIKROBOT）相机 / 镜头型号库\n' +
  ' * 数据来源：《' + META.source + '》\n' +
  ' * 生成脚本：tools/parse-catalog.js    生成日期：' + META.generated + '\n' +
  ' * 相机 ' + CAMS.length + ' 台、镜头 ' + lenses.length + ' 支。请勿手工编辑。\n' +
  ' */\n' +
  "(function (root, factory) {\n" +
  "  if (typeof module === 'object' && module.exports) module.exports = factory();\n" +
  '  else root.HikrobotCatalog = factory();\n' +
  "})(typeof self !== 'undefined' ? self : this, function () {\n" +
  "  'use strict';\n" +
  '  var META = ' + JSON.stringify(META) + ';\n' +
  '  var CAMERAS = [\n' +
  CAMS.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n' +
  '  ];\n' +
  '  var LENSES = [\n' +
  lenses.map((l) => '    ' + JSON.stringify(l)).join(',\n') + '\n' +
  '  ];\n' +
  '  return { META: META, CAMERAS: CAMERAS, LENSES: LENSES };\n' +
  '});\n';

process.stdout.write(body);

const bi = {};
const bc = {};
const bs = {};
for (const c of CAMS) {
  bi[c.iface] = (bi[c.iface] || 0) + 1;
  bc[c.color] = (bc[c.color] || 0) + 1;
  bs[c.size] = (bs[c.size] || 0) + 1;
}
process.stderr.write('相机 ' + CAMS.length + ' 台，接口 ' + JSON.stringify(bi) + '\n');
process.stderr.write('颜色 ' + JSON.stringify(bc) + '\n');
process.stderr.write('靶面 ' + JSON.stringify(Object.entries(bs).sort((a, b) => b[1] - a[1]).slice(0, 8)) + '\n');
process.stderr.write('镜头 ' + lenses.length + ' 支\n');
const byS = {};
for (const x of lenses) byS[x.series] = (byS[x.series] || 0) + 1;
process.stderr.write('镜头系列 ' + JSON.stringify(byS) + '\n');

