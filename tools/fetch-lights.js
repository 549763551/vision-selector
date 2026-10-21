/**
 * 抓取海康机器人光源型号（标准系列光源），生成 lights.json。
 * 标准产品手册不含光源章节，故光源型号取自官网产品列表。
 *
 * 用法：node tools/fetch-lights.js > lights.json
 */
'use strict';

const BASE = 'https://www.hikrobotics.com/cn/Api/Foreground/Vision/';
const HEADERS = {
  Referer: 'https://www.hikrobotics.com/cn/machinevision/visionproduct',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
};

// 型号前缀 -> 光源类型
const TYPE_BY_PREFIX = [
  ['MV-LRSS', 'ring_dome'],   // 环形无影
  ['MV-LRDS', 'ring'],        // 环形
  ['MV-LLAS', 'bar_array'],   // 组合条形
  ['MV-LLDS', 'bar'],         // 条形
  ['MV-LTFS', 'line_focus'],  // 聚光型线光
  ['MV-LTHS', 'line_high'],   // 高亮型线光
  ['MV-LTPS', 'line_coax'],   // 同轴线光
  ['MV-LTPM', 'line_coax'],   // 高亮同轴线光
  ['MV-LTDS', 'line'],        // 标准线光
  ['MV-LBES', 'backlight_hole'], // 中孔面光
  ['MV-LBSS', 'backlight'],   // 面光源
  ['MV-LBFS', 'backlight_side'],
  ['MV-LBFH', 'backlight_parallel'],
  ['MV-LBPS', 'backlight_parallel'],
  ['MV-LCDM', 'coaxial'],
  ['MV-LCDS', 'coaxial'],
  ['MV-LGSH', 'dome'],
  ['MV-LGSS', 'dome'],
  ['MV-LGES', 'flat_shadowless'],
  ['MV-LDFS', 'point'],
  ['MV-LDSS', 'point']
];

const COLOR_BY_SUFFIX = {
  W: 'white', WS: 'white', WX: 'white',
  R: 'red', B: 'blue', G: 'green', Y: 'yellow',
  IR850: 'ir', IR940: 'ir', IR740: 'ir', UV365: 'uv'
};

async function get(pathname) {
  const r = await fetch(BASE + pathname, { headers: HEADERS });
  if (!r.ok) throw new Error(pathname + ' -> HTTP ' + r.status);
  return r.json();
}

function parseModel(model, name) {
  const parts = model.split('-');
  const color = COLOR_BY_SUFFIX[parts[parts.length - 1]] || null;
  const type = TYPE_BY_PREFIX.find(([p]) => model.startsWith(p));
  if (!type || !color) return null;

  // 数字段：形如 120-30 表示 外径120mm / 角度30°
  const nums = parts.filter((p) => /^\d+$/.test(p)).map(Number);
  return {
    model,
    name: (name || '').split(',').slice(1).join(',').trim(),
    type: type[1],
    color,
    size: nums
  };
}

(async () => {
  const list = (await get('Cameras?seriesName=' + encodeURIComponent('标准系列光源'))).data || [];
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (seen.has(x.productModel)) continue;
    seen.add(x.productModel);
    const p = parseModel(x.productModel, x.productName);
    if (p) out.push(p);
  }
  out.sort((a, b) => a.type.localeCompare(b.type) || a.model.localeCompare(b.model));
  process.stdout.write(JSON.stringify(out));
  const byType = {};
  for (const o of out) byType[o.type] = (byType[o.type] || 0) + 1;
  process.stderr.write('光源 ' + out.length + ' 个型号 ' + JSON.stringify(byType) + '\n');
  const byColor = {};
  for (const o of out) byColor[o.color] = (byColor[o.color] || 0) + 1;
  process.stderr.write('颜色 ' + JSON.stringify(byColor) + '\n');
})();
