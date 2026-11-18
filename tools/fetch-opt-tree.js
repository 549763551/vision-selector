/**
 * 抓取奥普特（OPT）官网各产品线的「分类 → 系列」树。
 *
 * 官网每个产品线页面左侧有公共分类树（catalog-group / catalog-sub-item），
 * 抓一条 seriesAll 页即可拿全该产品线的树：
 *   <div class="catalog-group" data-id="445" group-id="445"><a href="/p_bzgy/seriesAll_445.html"><span>环形光源</span>...
 *   <div class="catalog-sub-item" data-id="446" item-id="445"><a href="/p_bzgy/series_446.html" title="OPT-RI系列">
 *
 * 输出：tools/_cache/opt/all/tree.json
 *   { "bzgy": { "name":"标准光源", "groups":[ {"id":"445","name":"环形光源","subs":[{"id":"446","name":"OPT-RI系列"}]} ] } }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_cache', 'opt', 'all');
const BASE = 'https://www.optmv.com';

// 入口页：优先用该产品线的分类总览页（含完整左侧树）
const LINES = [
  { dir: 'p_gyjt',  key: 'gyjt',  name: '工业镜头',        seed: 'seriesAll_365' },
  { dir: 'p_bzgy',  key: 'bzgy',  name: '标准光源',        seed: 'seriesAll_445' },
  { dir: 'p_fbzgy', key: 'fbzgy', name: '非标光源',        seed: 'series_1014' },
  { dir: 'p_gykzq', key: 'gykzq', name: '光源控制器',      seed: 'seriesAll_413' },
  { dir: 'p_gkj',   key: 'gkj',   name: '视觉控制器/工控机', seed: 'series_450' },
  { dir: 'p_znxj',  key: 'znxj',  name: 'SC智能相机',      seed: 'seriesAll_616' },
  { dir: 'p_zndmq', key: 'zndmq', name: '智能读码器',      seed: 'seriesAll_617' },
  { dir: 'p_cgq',   key: 'cgq',   name: '传感器',          seed: 'seriesAll_453' },
  { dir: 'p_ydcdbj',key: 'ydcdbj',name: '运控部件',        seed: 'series_432' },
  { dir: 'p_clxt',  key: 'clxt',  name: '测量系统',        seed: 'seriesAll_406' },
  { dir: 'p_jszn',  key: 'jszn',  name: '具身智能',        seed: 'series_1051' },
];

function clean(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseTree(html) {
  // 注意两点（踩过坑）：
  //  1) 侧栏 item-id 属性不可信（模板把子项都写成当前分类 id），只能按文档顺序归属
  //  2) 不要用「group|sub」交替正则一次扫：交替分支会吞掉中间的 sub 节点
  // 做法：两类节点各扫一遍，按出现位置排序后顺序归属。
  const marks = [];
  const gRe = /class="catalog-group[^"]*" data-id="(\d+)"[^>]*>[\s\S]{0,600}?<span>([^<]*)<\/span>/g;
  let m;
  while ((m = gRe.exec(html))) marks.push({ i: m.index, gid: m[1], name: clean(m[2]) });
  const sRe = /class="catalog-sub-item" data-id="(\d+)"[^>]*>[\s\S]{0,400}?title="([^"]*)"/g;
  while ((m = sRe.exec(html))) marks.push({ i: m.index, sid: m[1], name: clean(m[2]) });
  marks.sort((a, b) => a.i - b.i);

  const groups = [];
  let cur = null;
  for (const k of marks) {
    if (k.gid) {
      cur = { id: k.gid, name: k.name, subs: [] };
      groups.push(cur);
    } else if (cur) {
      cur.subs.push({ id: k.sid, name: k.name });
    }
  }
  return groups;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = {};
  for (const L of LINES) {
    const url = `${BASE}/${L.dir}/${L.seed}.html`;
    let html = '';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      html = await r.text();
      fs.writeFileSync(path.join(CACHE, `${L.key}_seed.html`), html);
    } catch (e) {
      console.error(`${L.key} 抓取失败: ${e.message}`);
      continue;
    }
    let groups = parseTree(html);
    // series 入口页（无 seriesAll）时，树里可能只有一个分类；退化处理：整条线视作一个分类
    if (!groups.length) {
      const subs = [...html.matchAll(/catalog-sub-item" data-id="(\d+)" item-id="(\d+)"[\s\S]*?title="([^"]*)"/g)]
        .map(x => ({ id: x[1], name: clean(x[3]) }));
      groups = [{ id: L.seed, name: L.name, subs }];
    }
    const nSub = groups.reduce((a, g) => a + g.subs.length, 0);
    out[L.key] = { name: L.name, dir: L.dir, groups };
    console.log(`${L.key.padEnd(7)} ${L.name.padEnd(14)} 分类 ${String(groups.length).padStart(2)} · 系列 ${String(nSub).padStart(2)}`);
  }
  fs.writeFileSync(path.join(CACHE, 'tree.json'), JSON.stringify(out, null, 1));
  console.log('→ tools/_cache/opt/all/tree.json');
}

main();
