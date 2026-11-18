/**
 * 抓取奥普特（OPT）相机详情页，落盘为 tools/_cache/opt/det/<id>.html
 * 输入：tools/_cache/opt/list.json（由 tools/parse-opt-list.py 生成）
 * 用法：node tools/fetch-opt-detail.js [并发数]
 * 已存在且非空的文件会跳过，便于断点续抓。
 */
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_cache', 'opt');
const DET = path.join(CACHE, 'det');
const CONC = Number(process.argv[2] || 5);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const list = JSON.parse(fs.readFileSync(path.join(CACHE, 'list.json'), 'utf8'));
fs.mkdirSync(DET, { recursive: true });

const todo = list.filter((x) => {
  const p = path.join(DET, x.id + '.html');
  return !(fs.existsSync(p) && fs.statSync(p).size > 20000);
});
console.log('待抓 ' + todo.length + ' / 共 ' + list.length + '，并发 ' + CONC);

let ok = 0, fail = 0, idx = 0;
const fails = [];

async function one(item) {
  const out = path.join(DET, item.id + '.html');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(item.url, {
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      });
      clearTimeout(t);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.length < 20000) throw new Error('HTTP ' + r.status + ' len=' + buf.length);
      fs.writeFileSync(out, buf);
      ok++;
      return;
    } catch (e) {
      if (attempt === 2) { fail++; fails.push(item.model + ' ' + e.message); }
      else await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
}

async function worker() {
  while (idx < todo.length) {
    const i = idx++;
    await one(todo[i]);
    if ((ok + fail) % 20 === 0) process.stdout.write('  进度 ' + (ok + fail) + '/' + todo.length + '\r');
  }
}

(async () => {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('\n完成：成功 ' + ok + '，失败 ' + fail + '，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (fails.length) console.log('失败清单:\n' + fails.join('\n'));
  const have = fs.readdirSync(DET).filter((f) => f.endsWith('.html')).length;
  console.log('本地详情页 ' + have + ' 个');
})();
