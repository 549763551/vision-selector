/**
 * 抓取奥普特（OPT）全部系列的型号列表 ajax 页。
 *
 * 接口：https://www.optmv.com/{dir}/ajax_series_{sid}.html?pageSize=500&pageIndex=1
 *   - pageSize 一次取全（实测 304 行也能一次返回；pageIndex=2 返回空）
 *   - 表格结构固定：左侧 fixed-table（勾选/型号）+ 右侧 scroll-table（参数列，行序对齐）
 *
 * 输入：tools/_cache/opt/all/series.json
 * 输出：tools/_cache/opt/all/ajax/{dir}_{sid}.html
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_cache', 'opt', 'all');
const OUT = path.join(CACHE, 'ajax');
const BASE = 'https://www.optmv.com';
const CONC = 6;

const series = JSON.parse(fs.readFileSync(path.join(CACHE, 'series.json'), 'utf8'));

async function grab(s) {
  const file = path.join(OUT, `${s.dir}_${s.sid}.html`);
  if (fs.existsSync(file) && fs.statSync(file).size > 5000) return { s, cached: true };
  const url = `${BASE}/${s.dir}/ajax_series_${s.sid}.html?pageSize=500&pageIndex=1`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      fs.writeFileSync(file, html);
      return { s, size: html.length };
    } catch (e) {
      if (attempt === 2) return { s, error: e.message };
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let i = 0, ok = 0, fail = [];
  const rows = {};
  async function worker() {
    while (i < series.length) {
      const s = series[i++];
      const r = await grab(s);
      if (r.error) { fail.push(`${s.dir}/${s.sid} ${s.name}: ${r.error}`); continue; }
      const html = fs.readFileSync(path.join(OUT, `${s.dir}_${s.sid}.html`), 'utf8');
      const n = (html.match(/<tr data-id="/g) || []).length;
      rows[s.sid] = n;
      ok++;
      process.stdout.write(`\r${ok}/${series.length}  ${s.line} ${s.name} → ${n} 型号`.padEnd(80));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('\n完成 %d/%d，失败 %d', ok, series.length, fail.length);
  if (fail.length) console.log(fail.join('\n'));
  fs.writeFileSync(path.join(CACHE, 'ajax-count.json'), JSON.stringify(rows, null, 1));
  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  console.log('型号行合计 %d（未去重）', total);
}

main();
