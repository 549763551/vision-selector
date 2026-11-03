/**
 * 生成海康机器人 CI 系列工业红外相机库（hikrobot-ir-catalog.js）
 *
 * 数据来源：官网产品数据接口（与 tools/audit-hikrobot-web.js 同一套端点）
 *   Cameras?seriesName=CI系列红外相机            → 10 个已发布型号 + id
 *   VisionProductConfig?id=<id>                  → 每个型号的全参数表
 *   快照：tools/_cache/hikrobot_ir_official.json（联网抓取的原始结果，本脚本只读它）
 *   《机器视觉标准产品手册-2026.Q3》第 25~27 页仅用于补充官网未给出的「响应波段」，
 *   手册的技术参数表存在合并单元格串台（短波行被写成 640×512@50fps），因此不采信手册数值。
 *
 * 用法：
 *   node tools/fetch-hikrobot-ir.js          # 先联网刷新快照（另写脚本）
 *   node tools/parse-hikrobot-ir.js          # 由快照生成目录
 *
 * 手册里另有 MV-CI003-GL-T5、MV-CI050-US-TF 两款标为新品（型号后带 *），官网无产品页、
 * 参数不全，本轮不入库，见 tools/_cache/hikrobot_ir_review.txt。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'tools/_cache/hikrobot_ir_official.json');
const OUT = path.join(ROOT, 'hikrobot-ir-catalog.js');
const REVIEW = path.join(ROOT, 'tools/_cache/hikrobot_ir_review.txt');

// 手册补充：响应波段（官网参数表无此项）；键为型号前缀
const BAND = {
  'MV-CI003': { band: '长波（LWIR）', wave: '8 ~ 14 µm' },
  'MV-CI010': { band: '短波（SWIR）', wave: '0.9 ~ 1.7 µm' },
  'MV-CI013': { band: '短波（SWIR）', wave: '0.4 ~ 1.7 µm' },
  'MV-CI050': { band: '短波（SWIR）', wave: '0.4 ~ 1.7 µm' }
};
// 手册标为新品、官网未发布的型号：只记复核清单，不入库
const NOT_INCLUDED = [
  ['MV-CI003-GL-T5', '手册（26Q3）列为新品*，官网无产品页；分辨率等参数在手册合并单元格里，焦距未知'],
  ['MV-CI050-US-TF', '手册（26Q3）列为新品*，官网无产品页；手册给 2560×2048@75fps（与已发布的 CXP 版 2592×2056@120fps 不同档），未经官网确认']
];

const num = (s) => { const m = String(s == null ? '' : s).match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
const txt = (s) => (s == null || String(s).trim() === '' || String(s).trim() === '-' ? null : String(s).replace(/\s*\n\s*/g, ' / ').trim());

function ifaceOf(f) {
  const d = txt(f['数据接口']) || '';
  if (/CoaXPress/i.test(d)) return /CXP-12|1link/i.test(String(f['名称']) + d) ? 'CoaXPress' : 'CoaXPress';
  if (/XoFLink|光纤/i.test(d)) return 'XoFLink';
  if (/USB\s*3/i.test(d)) return 'USB3';
  if (/10\s*G|万兆/i.test(d)) return '10GigE';
  if (/Gigabit|GigE|千兆/i.test(d)) return 'GigE';
  return null;
}
function mountOf(f) {
  const m = txt(f['镜头接口']);
  if (!m) return null;
  if (/^C-?Mount/i.test(m)) return 'C';
  const d = m.match(/^M(\d+)/i);
  return d ? 'M' + d[1] : m;
}

function build(model, f) {
  const band = BAND[model.replace(/^(MV-CI\d+)/, '$1')] || BAND[Object.keys(BAND).find((k) => model.startsWith(k))] || {};
  const res = String(f['分辨率'] || '').match(/(\d+)\s*[×xX]\s*(\d+)/);
  const isLine = res ? Number(res[2]) === 1 : false;
  const px = String(f['像元尺寸'] || '').match(/([\d.]+)/);
  const dims = (String(f['外形尺寸'] || '').match(/([\d.]+)\s*mm/g) || []).map((x) => parseFloat(x));
  const supply = txt(f['供电']) || '';
  const rec = {
    model: model,
    name: txt(f['名称']),
    band: band.band || null,
    wave: band.wave || null,
    thermalType: /测温/.test(String(f['名称'] || '')) ? '测温型' : '观测型',
    shape: isLine ? '线阵' : '面阵',
    w: res ? Number(res[1]) : null,
    h: res && !isLine ? Number(res[2]) : null,
    pxUm: px ? parseFloat(px[1]) : null,
    size: txt(f['靶面尺寸']),
    sensor: txt(f['传感器类型']),
    sensorModel: txt(f['传感器型号']),
    shutter: /全局/.test(String(f['传感器类型'] || '')) ? 'Global' : (/全局|卷帘/.test(String(f['名称'] || '')) ? 'Global' : null),
    fps: isLine ? null : num(f['最大帧率']),
    lineKHz: isLine ? num(f['最大行频']) : null,
    dr: num(f['动态范围']),
    snr: num(f['信噪比']),
    netd: txt(f['热灵敏度']),
    tempRange: txt(f['测温范围']),
    tempAcc: txt(f['测温精度']),
    tempFar: txt(f['测温最远距离']),
    focal: txt(f['焦距']),
    fov: txt(f['视场角']),
    aperture: txt(f['光圈']),
    spatialRes: txt(f['空间分辨率']),
    minWork: txt(f['最近摄距'] || f['热成像近摄距']),
    response: txt(f['响应时间']),
    pixfmt: txt(f['像素格式']),
    palette: txt(f['伪彩模式']),
    isp: txt(f['图像处理']),
    trigger: txt(f['外触发模式']),
    iface: ifaceOf(f),
    mount: mountOf(f),
    io: txt(f['数字I/O']),
    poe: /PoE/i.test(supply) ? true : (/PoCXP/i.test(supply) ? 'PoCXP' : false),
    supply: supply.replace(/^,/, '') || null,
    powerW: num(f['典型功耗']),
    powerNote: /TEC/.test(String(f['典型功耗'] || '')) ? 'TEC 开启' : null,
    dims: dims.length === 3 ? dims : null,
    weightG: num(f['重量']),
    ip: txt(f['IP防护等级']),
    temp: txt(f['温度']),
    protocol: txt(f['协议/标准']),
    series: 'CI 系列红外',
    brand: '海康机器人 HIKROBOT',
    source: '海康机器人官网产品数据'
  };
  Object.keys(rec).forEach((k) => { if (rec[k] === null || rec[k] === undefined) delete rec[k]; });
  return rec;
}

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const models = Object.keys(snap).sort();
const records = models.map((m) => build(m, snap[m]));

// 排序：长波在前（观测→测温→按焦距），再短波（面阵按像素、线阵收尾）
records.sort((a, b) => {
  const order = (r) => (r.band && /长波/.test(r.band) ? 0 : 1);
  return order(a) - order(b) ||
    String(a.thermalType).localeCompare(String(b.thermalType)) ||
    (num(a.focal) || 0) - (num(b.focal) || 0) ||
    (b.w * (b.h || 1)) - (a.w * (a.h || 1)) ||
    String(a.model).localeCompare(String(b.model));
});

function line(o) {
  return '    ' + JSON.stringify(o).replace(/","/g, '", "') + ' ';
}

const header = [
  '/**',
  ' * 海康机器人 CI 系列工业红外相机库（长波热成像 + 短波 InGaAs）',
  ' * 来源：官网产品数据（VisionProductConfig）+《机器视觉标准产品手册-2026.Q3》响应波段',
  ' * 生成脚本：tools/parse-hikrobot-ir.js    生成日期：' + new Date().toISOString().slice(0, 10),
  ' * 红外 ' + records.length + ' 款（长波 ' + records.filter((r) => /长波/.test(r.band || '')).length +
  ' + 短波 ' + records.filter((r) => /短波/.test(r.band || '')).length + '）。仅产品库查询展示，不参与选型引擎比选。请勿手工编辑。',
  ' */',
  '(function (root, factory) {',
  '  if (typeof module === \'object\' && module.exports) module.exports = factory();',
  '  else root.HikrobotIrCatalog = factory();',
  '})(typeof self !== \'undefined\' ? self : this, function () {',
  '  \'use strict\';',
  '  var META = {"source":"海康机器人官网产品数据 + 机器视觉标准产品手册-2026.Q3","brand":"海康机器人 HIKROBOT",' +
    '"generated":"' + new Date().toISOString().slice(0, 10) + '","ir":' + records.length + '};',
  '',
  '  var IR = ['
].join('\n');

const body = records.map((r) => line(r).trimEnd()).join(',\n');
const tail = '\n  ];\n  return { META: META, IR: IR };\n});\n';
fs.writeFileSync(OUT, header + '\n' + body + tail, 'utf8');

fs.writeFileSync(REVIEW, [
  '海康 CI 系列红外相机 · 未入库型号与原因（' + new Date().toISOString().slice(0, 10) + '）',
  '官网 seriesName=CI系列红外相机 共 ' + models.length + ' 款，已全部入库；手册另有 ' + NOT_INCLUDED.length + ' 款：',
  ''
].concat(NOT_INCLUDED.map((x) => x[0] + '：' + x[1])).join('\n') + '\n', 'utf8');

console.log('生成 ' + path.relative(ROOT, OUT) + '：' + records.length + ' 款红外相机');
records.forEach((r) => console.log('  ' + r.model + ' | ' + r.band + ' | ' + (r.thermalType || '') + ' | ' +
  (r.w + '×' + (r.h != null ? r.h : '1')) + ' | ' + (r.fps ? r.fps + ' fps' : r.lineKHz + ' kHz') + ' | ' + r.iface + ' | ' + (r.mount || '固定镜头')));
