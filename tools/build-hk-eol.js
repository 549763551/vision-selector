// 从海康官方 PCN 文本里解析退市型号，展开紧凑写法（MV-CA013-20GM/C/N 这类），
// 与现有 retired-catalog.js 合并（保留已有完整参数），输出 tools/_cache/hk_eol_models.json。
// 每份公告的「被停产型号」按原文逐条列出，替代型号不收录；affected 为 null 时才用前缀规则。
// 仅本地数据构建脚本。数据来源与复现方式：
//   1) 公告清单：GET https://www.hikrobotics.com/cn/Api/Foreground/Support/ProductChange?type=1&size=100&page=1
//      （官网「停产通知」栏目的接口，返回 21 条记录的标题 / 日期 / PDF 路径）
//   2) 逐份下载 PDF 到 tools/_cache/hk_pcn/（需 UA + Referer），用 tools/pdf-text.py 抽成 .txt
//   3) 跑本脚本 → tools/_cache/hk_eol_models.json，再跑 tools/write-hk-eol.js 写回 retired-catalog.js
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = 'tools/_cache/hk_pcn';
const SRC = 'retired-catalog.js';

const NOTICES = {
  '6_2021-06-01': {
    eol: 2021, doc: 'PCN-MV2021030101',
    affected: ['MV-CA003-50GM', 'MV-CE013-50GM/C', 'MV-CE013-50UM/C'],
  },
  '8_2021-06-01': {
    eol: 2021, doc: 'PCN-MV2021053101',
    affected: ['MV-CE100-30GM', 'MV-CE050-30GM'],
  },
  '9_2021-06-11': {
    eol: 2021, doc: 'PCN-MV20210609',
    affected: ['MV-DS135-06GM-L'],
  },
  '10_2021-08-30': {
    eol: 2022, doc: 'MV-2021082701',
    affected: ['MV-CL042-90GM/C'],
  },
  '12_2021-12-01': {
    eol: 2022, doc: 'PCN-MV2021120101',
    affected: ['MV-CH120-10TM/C', 'MV-CH250-20TC/21TM'],
  },
  '13_2021-12-01': {
    eol: 2022, doc: 'PCN-MV2021120102',
    affected: ['MV-CA050-10GC', 'MV-CA050-11UM/C'],
  },
  '15_2021-08-09': {
    eol: 2021, doc: 'PCN-MV2021080901',
    affected: ['MV-CE200-11GM', 'MV-CE200-10GC'],
  },
  '14_2022-03-31': {
    eol: 2022, doc: 'PCN-MV2022033101',
    affected: [
      'MV-CA003-20GM/C', 'MV-CA004-10GM/C', 'MV-CA005-20GM/C', 'MV-CA020-20GM/C',
      'MV-CA050-20GM/C/N', 'MV-CA003-21UM/C', 'MV-CA050-20UM/C', 'MV-CE003-20GM/C',
    ],
  },
  '17_2022-04-22': {
    eol: 2021, doc: 'PCN-MV20220420',
    affected: ['MV-DL2040-04H-H', 'MV-DL2025-04H-H', 'MV-DL2125-04H-H'],
  },
  '19_2022-05-31': {
    eol: 2022, doc: 'PCN-MV2022053001',
    affected: [
      'MV-CE020-10GC', 'MV-CE060-10UM/C', 'MV-CE120-10GM/C', 'MV-CE200-10GM',
      'MV-CA013-A0UM/C', 'MV-CA016-10GM/C', 'MV-CA050-10GM/12GC', 'MV-CA060-11GM/10GC',
    ],
  },
  // 2022-07-08 那份表格很大，且替代型号全为 CS/CU/CB，用前缀规则即可
  '21_2022-07-08': { eol: 2022, doc: 'PCN-MV2022070801', affected: null, prefix: ['MV-CA', 'MV-CE'] },
  '32_2024-01-18': {
    eol: 2024, doc: 'PCN-MV2024011101',
    affected: ['MV-CS020-21GM', 'MV-CS020-11GM', 'MV-CU050-60GM'],
  },
  '34_2024-06-03': {
    eol: 2024, doc: 'PCN-MV2024052201',
    affected: ['MV-CA032-10GM/C', 'MV-CS032-10GM/C', 'MV-CH089-10GM/C', 'MV-CH089-10UM/C'],
  },
  '39_2024-06-19': {
    eol: 2024, doc: 'PCN-MV2024061901',
    affected: ['MV-CL081-41CM', 'MV-CL161-41CM'],
  },
  '43_2025-09-12': {
    eol: 2026, doc: 'PCN-MV2025091101',
    affected: [
      'MV-CA003-20GM/C', 'MV-CA003-21UM/C', 'MV-CA003-50GM/C',
      'MV-CA004-10GM/C', 'MV-CA004-10UM/C', 'MV-CA005-20GM/C',
      'MV-CA013-20GM/C/N', 'MV-CA013-21UM/C', 'MV-CA013-70GM',
      'MV-CA013-A0GM/C', 'MV-CA013-A0UM/C',
      'MV-CA016-10GM/C', 'MV-CA016-10UM/C', 'MV-CA017-10GM/C',
      'MV-CA020-10GM/C', 'MV-CA020-10UM/C', 'MV-CA020-20GM/C',
      'MV-CA023-10/19GM/C', 'MV-CA023-10UM/C', 'MV-CA032-10GM/C',
      'MV-CA050-10/12/19GM/C', 'MV-CA050-11/12UM/C', 'MV-CA050-20GM/C/N', 'MV-CA050-20UM/C',
      'MV-CA060-10/11GM/C',
      'MV-CE003-20GM/C', 'MV-CE013-50/59GM/C', 'MV-CE013-50UM/C',
      'MV-CE013-80GM/C', 'MV-CE013-80UM', 'MV-CE020-10GC',
      'MV-CE050-31GM/C', 'MV-CE050-30UM/C', 'MV-CE060-10UM/C',
      'MV-CE100-30/31GM/C', 'MV-CE120-10GM/C', 'MV-CE120-10UM/C',
      'MV-CE200-10/11GM/C', 'MV-CE200-10/11UM/C',
    ],
  },
  '46_2026-03-18': {
    eol: 2026, doc: 'PCN-MV2026031701',
    affected: ['MV-CU050-90GC/UC', 'MV-CH050-90XC'],
  },
};

// MV-CA013-20GM/C/N → MV-CA013-20GM, MV-CA013-20GC, MV-CA013-20GN
// MV-CA023-10/19GM/C → 10GM,10GC,19GM,19GC（数字段 × 字母段）
function expand(token) {
  const m = /^(MV-[A-Z]{2}\d{3})-(.+)$/.exec(token);
  if (!m) return [token];
  const head = m[1];
  const segs = m[2].split('/').filter(Boolean);
  const pairs = [];
  const alts = [];
  segs.forEach((s) => {
    const d = /^([A-Z]?\d+)([A-Z]*)$/.exec(s);
    if (d) pairs.push([d[1], d[2] || null]);
    else if (/^[A-Z]+$/.test(s)) alts.push(s);
  });
  if (!pairs.length) return [token];
  const baseSuffix = [...pairs].reverse().find((p) => p[1]);
  const base = baseSuffix ? baseSuffix[1] : '';
  const suffixes = base ? [base] : [''];
  alts.forEach((a) => {
    if (!a || !base) return;
    const v = base.slice(0, -a.length) + a;      // GM + C → GC；UM + C → UC
    if (!suffixes.includes(v)) suffixes.push(v);
  });
  const out = [];
  pairs.forEach(([d, sfx]) => {
    const use = sfx ? [sfx].concat(suffixes.filter((x) => x && x !== base)) : suffixes;
    [...new Set(use)].forEach((s) => out.push(head + '-' + d + s));
  });
  return [...new Set(out)];
}

const IFACE = (model) => {
  const m = /([A-Z]{1,3})$/.exec(model);
  const c = m ? m[1][0] : '';
  if (/^MV-CL/.test(model)) {
    const i = /-(\d{2})([A-Z])/.exec(model);
    const k = i ? i[2] : '';
    return { G: 'GigE', U: 'USB3', C: 'Camera Link', X: 'CoaXPress' }[k] || '';
  }
  return { G: 'GigE', U: 'USB3', T: '10GigE', X: 'CoaXPress' }[c] || '';
};
const COLOR = (model) => {
  const m = /([A-Z]+)$/.exec(model);
  if (!m) return '';
  const s = m[1];
  // 线扫末两位是「接口 + 色型」：41CM = Camera Link 黑白，41CC = 彩色
  if (/^MV-CL/.test(model)) {
    if (/CC$/.test(model)) return '彩色';
    if (/CM$/.test(model)) return '黑白';
  }
  if (s.endsWith('N')) return '近红外';
  if (s.includes('C')) return '彩色';
  if (s.includes('M')) return '黑白';
  return '';
};
const SERIES = (model) => {
  const m = /^MV-([A-Z]{2})/.exec(model);
  const k = m ? m[1] : '';
  return {
    CA: 'CA 系列（第一代）', CE: 'CE 系列（第一代）', CS: 'CS 系列', CU: 'CU 系列',
    CH: 'CH 系列', CL: 'CL 系列', DS: '双目 3D 相机', DB: '3D 相机', DL: '线激光 3D 相机',
  }[k] || (k + ' 系列');
};
const KIND = (model) => {
  if (/^MV-DL/.test(model)) return '线激光 3D 相机';
  if (/^MV-(DS|DB)/.test(model)) return '双目 3D 相机';
  return 'area';
};

// 2025 公告是表格：一行 = 被停产型号 + CS/CU 替代 + 日期。按「≥2 个日期后遇到新型号」切行。
function rows2025(txt) {
  const toks = txt.match(/MV-[A-Z]{2}\d{3}-[A-Z0-9/]+|20\d{2}\.\d{1,2}(?:\.\d{1,2})?/g) || [];
  const rows = [];
  let cur = { models: [], repl: [], dates: 0 };
  toks.forEach((t) => {
    if (/^20\d{2}\./.test(t)) { cur.dates += 1; return; }
    if (cur.dates >= 2) { rows.push(cur); cur = { models: [], repl: [], dates: 0 }; }
    const clean = t.replace(/[),.;]+$/, '');
    if (/^MV-C[AE]/.test(clean)) cur.models.push(clean);
    else if (/^MV-C[SU]/.test(clean)) cur.repl.push(clean);
  });
  if (cur.models.length) rows.push(cur);
  return rows;
}

function replMap2025(txt) {
  const map = {};
  rows2025(txt).forEach((r) => {
    const repl = [];
    r.repl.forEach((t) => expand(t).forEach((m) => { if (!repl.includes(m)) repl.push(m); }));
    r.models.forEach((t) => expand(t).forEach((m) => { if (!map[m] && repl.length) map[m] = repl.slice(); }));
  });
  return map;
}

// 替代型号里优先留「同色型 + 同接口」的，没有同类才全留
function pickRepl(model, repl) {
  if (!repl || repl.length < 2) return repl || [];
  const same = repl.filter((m) => COLOR(m) === COLOR(model) && IFACE(m) === IFACE(model));
  return same.length ? same : repl;
}

function readExisting() {
  const txt = fs.readFileSync(SRC, 'utf8');
  const block = txt.slice(txt.indexOf('hikrobot: {'), txt.indexOf('basler: {'));
  const out = {};
  block.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t.startsWith('{')) return;
    try { const o = JSON.parse(t.replace(/,$/, '')); out[o.model] = o; } catch (e) { /* 跳过 */ }
  });
  return out;
}

// 分辨率按「系列代码 + 分辨率代码」从已有条目推断，只有单一取值才采用
function resMap(existing) {
  const by = {};
  Object.keys(existing).forEach((k) => {
    const o = existing[k];
    const m = /^MV-([A-Z]{2})(\d{3})-/.exec(o.model);
    if (!m || !o.w) return;
    const key = m[1] + m[2];
    (by[key] = by[key] || {})[o.w + 'x' + o.h] = 1;
  });
  const out = {};
  Object.keys(by).forEach((k) => {
    const vals = Object.keys(by[k]);
    if (vals.length === 1) { const p = vals[0].split('x'); out[k] = [+p[0], +p[1]]; }
  });
  // CH089 在在售型录里 4 条一致为 4096×2160
  out.CH089 = [4096, 2160];
  return out;
}

const existing = readExisting();
const RES = resMap(existing);
const found = {};

fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).forEach((f) => {
  const key = f.replace('.txt', '');
  const meta = NOTICES[key];
  if (!meta) return;
  const txt = fs.readFileSync(path.join(DIR, f), 'utf8');
  let tokens = meta.affected;
  if (!tokens) {
    tokens = (txt.match(/MV-[A-Z]{2}\d{3}-[A-Z0-9/]+/g) || [])
      .map((t) => t.replace(/[),.;]+$/, ''))
      .filter((t) => (meta.prefix || []).some((p) => t.startsWith(p)));
  }
  const models = new Set();
  tokens.forEach((t) => expand(t).forEach((x) => models.add(x)));
  const replMap = key === '43_2025-09-12' ? replMap2025(txt) : null;
  models.forEach((model) => {
    const prev = found[model];
    if (prev && prev.eol <= meta.eol) return;   // 保留最早一次退市记录
    const ex = existing[model] || {};
    const mm = /^MV-([A-Z]{2})(\d{3})-/.exec(model);
    const res = mm ? RES[mm[1] + mm[2]] : null;
    const entry = Object.assign({}, ex, {
      model,
      kind: KIND(model),
      iface: ex.iface || IFACE(model),
      color: ex.color || COLOR(model),
      mount: ex.mount || (/^MV-CL/.test(model) ? 'M42/F' : 'C'),
      series: ex.series || SERIES(model),
      eol: meta.eol,
      eolDoc: meta.doc,
      replacedBy: (ex.replacedBy && ex.replacedBy.length) ? ex.replacedBy : pickRepl(model, (replMap && replMap[model]) || []),
    });
    if (!entry.w && res) { entry.w = res[0]; entry.h = res[1]; }
    if (!entry.w) { delete entry.w; delete entry.h; }
    found[model] = entry;
  });
});

const list = Object.keys(found).sort().map((k) => found[k]);
fs.writeFileSync('tools/_cache/hk_eol_models.json', JSON.stringify(list, null, 1), 'utf8');

const bySeries = {};
list.forEach((x) => { bySeries[x.series] = (bySeries[x.series] || 0) + 1; });
console.log('total', list.length, '| 新增', list.filter((x) => !existing[x.model]).length,
  '| 无分辨率', list.filter((x) => !x.w).length);
Object.keys(bySeries).sort().forEach((s) => console.log('  ', s, bySeries[s]));
