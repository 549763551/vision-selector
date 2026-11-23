// 主页只需要 9 个分类计数与品牌 META，不必加载 2.5MB 型录明细。
// 生成 home-stats.js；型录有更新时重跑本脚本即可。
// 用法：node tools/build-home-stats.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const load = f => require(path.join(root, f));

const SRC = {
  hikrobot: 'hikrobot-catalog.js',
  huarui: 'huarui-catalog.js',
  basler: 'basler-catalog.js',
  daheng: 'daheng-catalog.js',
  opt: 'opt-catalog.js',
  cst: 'cst-catalog.js'
};
// 数组 → 类别必须逐个写明：海康 3D 库的 SMART 是 3D 相机，不能按名字算进「智能相机」
const EXTRA = [
  ['hikrobot-3d-catalog.js', 'hikrobot', { prof: ['PROFILERS', 'SMART'] }],
  ['hikrobot-ipc-catalog.js', 'hikrobot', { ipc: ['CHASSIS', 'BOARDS'] }],
  ['hikrobot-ir-catalog.js', 'hikrobot', { ir: ['IR'] }],
  ['basler-catalog.js', 'basler', { prof: ['THREE_D'] }],
  ['basler-lens-catalog.js', 'basler', { lens: ['LENSES'], tele: ['TELECENTRIC'] }],
  ['basler-light-catalog.js', 'basler', { light: ['LIGHTS'], ctrl: ['CONTROLLERS'] }],
  ['opt-lens-catalog.js', 'opt', { lens: ['LENSES'], tele: ['TELECENTRIC'] }],
  ['opt-light-catalog.js', 'opt', { light: ['LIGHTS'] }],
  ['opt-ctrl-catalog.js', 'opt', { ctrl: ['CONTROLLERS'], ipc: ['IPC'] }]
];
const FIELDS = { cam: 'CAMERAS', line: 'LINESCAN', lens: 'LENSES', tele: 'TELECENTRIC',
  light: 'LIGHTS', ctrl: 'CONTROLLERS' };

const n = { cam: 0, line: 0, lens: 0, tele: 0, light: 0, ctrl: 0, prof: 0, ipc: 0, ir: 0 };
const metas = {};
const allMetas = [];

Object.keys(SRC).forEach(bk => {
  const c = load(SRC[bk]);
  metas[bk] = c.META || {};
  if (c.META) allMetas.push({ brand: bk, meta: c.META });
  Object.keys(FIELDS).forEach(k => { n[k] += (c[FIELDS[k]] || []).length; });
});
EXTRA.forEach(([file, bk, map]) => {
  const c = load(file);
  if (c.META) allMetas.push({ brand: bk, meta: c.META });
  Object.keys(map).forEach(cat => map[cat].forEach(arr => { n[cat] += (c[arr] || []).length; }));
});
const total = Object.keys(n).reduce((s, k) => s + n[k], 0);

const out = '/* 由 tools/build-home-stats.js 从型录生成，勿手改。型录更新后重跑。 */\n' +
  'window.HOME_STATS = ' + JSON.stringify({ n, total, metas, allMetas }) + ';\n';
fs.writeFileSync(path.join(root, 'home-stats.js'), out, 'utf8');
console.log('home-stats.js 已生成：' + Buffer.byteLength(out) + ' 字节，总计 ' + total + ' 款');
console.log(JSON.stringify(n));
