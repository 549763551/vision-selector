// 把 tools/_cache/hk_eol_models.json 写回 js/retired-catalog.js 的 hikrobot 段。
// 只替换 hikrobot 品牌块，其余品牌原样保留；META 的数量与更新时间同步。
'use strict';
const fs = require('fs');

const FILE = 'js/retired-catalog.js';
const models = JSON.parse(fs.readFileSync('tools/_cache/hk_eol_models.json', 'utf8'));

// 输出字段顺序与在售型录一致，缺的字段不写
const ORDER = ['model', 'kind', 'cat', 'w', 'h', 'pxUm', 'size', 'fps', 'lineRate', 'taps',
  'shutter', 'iface', 'color', 'mount', 'series', 'sensor', 'eol', 'status', 'eolDoc', 'replacedBy'];

function cat4(m) {
  if (/^MV-CL/.test(m)) return 'line';
  if (/^MV-(DS|DB|DL)/.test(m)) return 'prof';
  return 'cam';
}

const lines = models.map((e) => {
  const o = Object.assign({}, e);
  o.cat = o.cat || cat4(e.model);
  o.status = o.status || '停产';
  const ordered = {};
  ORDER.forEach((k) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') ordered[k] = o[k]; });
  Object.keys(o).forEach((k) => { if (!(k in ordered) && o[k] !== null && o[k] !== '') ordered[k] = o[k]; });
  return '          ' + JSON.stringify(ordered) + ',';
});

const block = [
  '      hikrobot: {',
  "        name: '海康机器人 HIKROBOT',",
  "        doc: '产品停产通知（PCN）2021-03 至 2026-03 共 21 份，官网「停产通知」栏目',",
  "        note: '按官网「停产通知」逐条收录，覆盖 CE / CA 第一代面阵、CH 10GigE 早期型号、" +
    "CL 线扫 4K / 8K、CS / CU 少量早期型号与双目 / 线激光 3D。年份为该型号的最后接单年。',",
  '        CAMERAS: [',
].concat(lines).concat([
  '        ]',
  '      },',
]).join('\n');

const txt = fs.readFileSync(FILE, 'utf8');
const start = txt.indexOf('      hikrobot: {');
const end = txt.indexOf('      basler: {');
if (start < 0 || end < 0 || end < start) throw new Error('找不到品牌块边界');

let out = txt.slice(0, start) + block + '\n' + txt.slice(end);

// META：数量按各品牌实际条目数重算
const countOf = (key) => {
  const s = out.indexOf(key + ': {');
  const e = out.indexOf('CAMERAS: [', s);
  const close = out.indexOf('\n        ]', e);
  return out.slice(e, close).split('\n').filter((l) => l.trim().startsWith('{')).length;
};
const hk = countOf('hikrobot');
const bs = countOf('basler');
const dh = countOf('daheng');
const total = hk + bs + dh;

out = out.replace(/"count":\d+/, '"count":' + total);
out = out.replace(/"updated":"[0-9-]+"/, '"updated":"2026-11-18"');
out = out.replace(/"version":"[0-9.]+"/, '"version":"1.1"');
out = out.replace(/"scope":"[^"]*"/,
  '"scope":"2020 年后官方公告停产 / 官网标注停产的工业相机（含面阵、线阵、3D）"');

fs.writeFileSync(FILE, out, 'utf8');
console.log('hikrobot', hk, '| basler', bs, '| daheng', dh, '| total', total);
