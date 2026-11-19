// 合并多份 basler-cn-spec.json（本机与服务器各抓一半分片），按型号取并集。
// 用法：node tools/merge-basler-spec.js out.json a.json b.json ...
//   同一型号多份记录时，优先取 specFound=true 的那份；都成功则取字段更全的。
const fs = require('fs');
const path = require('path');

const [out, ...ins] = process.argv.slice(2);
if (!out || !ins.length) {
  console.error('用法：node tools/merge-basler-spec.js out.json a.json b.json ...');
  process.exit(1);
}

const norm = s => String(s || '').toUpperCase().replace(/[\s\-_]/g, '');
const scored = x => {
  let n = 0;
  ['w', 'h', 'pxUm', 'size', 'fps', 'shutter', 'iface', 'mount', 'sensor', 'color', 'dims', 'series'].forEach(k => {
    if (x[k] != null && x[k] !== '') n++;
  });
  return (x.specFound ? 100 : 0) + n;
};

const merged = new Map();
let total = 0;
ins.forEach(f => {
  const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
  total += arr.length;
  arr.forEach(x => {
    const k = norm(x.model);
    const cur = merged.get(k);
    if (!cur || scored(x) > scored(cur)) merged.set(k, x);
  });
});

const list = [...merged.values()];
fs.writeFileSync(out, JSON.stringify(list, null, 1) + '\n');
console.log('输入', ins.length, '份共', total, '条 → 去重合并', list.length, '条，其中 ok', list.filter(x => x.specFound).length);
console.log('来源：', ins.map(f => path.basename(f) + '=' + JSON.parse(fs.readFileSync(f, 'utf8')).length).join('  '));
