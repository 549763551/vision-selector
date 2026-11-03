/**
 * 抓取海康官网 3D 产品参数表（立体相机 / 结构光传感器 / 感知相机），存快照供 parse-3d.py 生成目录。
 *
 * 为什么以官网为主、手册为辅：《机器视觉3D产品手册26年Q3》的参数表是排版表格，
 * 存在同型号不同硬件版本混排的问题（如 MV-DPS200P-02 手册写近视场 180×140，
 * 官网当前页写 180×160@250mm），官网页可按 id 精确取到单型号字段，交叉验证更可靠。
 * 官网没有产品页的型号（MV-DS5025/5090/5145/5200、MV-DLS300UL-13、MV-DLS600P-12L、
 * MV-DLS1400M-15B、MV-DLS1300P、MV-DL2125/2126、MV-DT1300S）在 parse-3d.py 里按手册录入。
 *
 * 用法：node tools/fetch-hikrobot-3d.js
 * 输出：tools/_cache/hikrobot_3d_official.json（{ 型号: {字段名: 值} }）
 */
'use strict';
const fs = require('fs');

const H = {
  Referer: 'https://www.hikrobotics.com/cn/machinevision/visionproduct',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 Chrome/120'
};
const API = 'https://www.hikrobotics.com/cn/Api/Foreground/Vision/';
const SERIES = [
  'DLS系列', 'DLS-U系列', 'DLS-L系列', 'DLS-T系列',
  'DPS系列', 'DPS-U系列', 'DS5000系列', 'DT系列感知相机'
];

async function get(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.json();
}

(async () => {
  const list = [];
  for (const s of SERIES) {
    const j = await get(API + 'Cameras?seriesName=' + encodeURIComponent(s));
    (j.data || []).forEach(p => list.push({ series: s, id: p.id, model: p.productModel }));
  }
  // 同裸名多硬件版本（…V2.0 / …/AA）只取官网当前主版本，避免目录里重复计数
  const seen = {};
  const pick = list.filter(p => {
    const base = String(p.model).replace(/\s+(V\d+(\.\d+)?|\/AA|NPOE)$/i, '');
    if (seen[base]) return false;
    seen[base] = 1; return true;
  });
  const out = {};
  for (const p of pick) {
    const j = await get(API + 'VisionProductConfig?id=' + p.id);
    const fields = {};
    (j.data || []).forEach(row => {
      const k = row.name || row.fieldName;
      const v = row.value !== undefined ? row.value : row.fieldValue;
      if (k && v != null && String(v).trim() !== '') fields[String(k).replace(/\s+/g, '')] = String(v).trim();
    });
    out[p.model] = { series: p.series, id: p.id, fields };
    process.stdout.write('  ' + p.model + ' ' + Object.keys(fields).length + ' 字段\n');
  }
  fs.writeFileSync('tools/_cache/hikrobot_3d_official.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('官网 3D 抓取完成：系列命中 ' + list.length + ' 条，去重后入库 ' + Object.keys(out).length + ' 条');
})();
