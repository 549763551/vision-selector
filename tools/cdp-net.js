// 通用探针：用 Chrome DevTools Protocol 监听页面发出的 XHR/fetch，找出数据接口。
// 用途：站点是 React/Vue SPA 时，curl 抓 HTML 只有空壳（或被 WAF 返回挑战页），
// 型号数据全在异步请求里，看一遍网络就知道该调哪个接口。
// 用法：node tools/cdp-net.js [url]
// 实例（华睿镜头）：node tools/cdp-net.js "https://www.irayple.com/cn/product/vision?id=9&navId=121"
//   → /api/cn/vision/productListNew?id=<navId>&attr=&page=1&type=
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL = process.argv[2] || 'https://www.irayple.com/cn/product/vision?id=9&navId=121';

function jget(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = '';
      r.on('data', d => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + require('os').tmpdir() + '/cdp-irayple', 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 30; i++) {
    try { ver = await jget('/json/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!ver) { console.log('chrome 未就绪'); proc.kill(); return; }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params, sessionId) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });
  const hits = [];

  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (/\/api|series|product|list|json/i.test(u) && !/\.(js|css|png|jpg|svg|woff2?)($|\?)/.test(u)) {
        hits.push({ url: u, type: m.params.type, post: m.params.request.postData || null });
      }
    }
  });

  await new Promise(r => ws.addEventListener('open', r));
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Network.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Page.navigate', { url: URL }, sid);

  await new Promise(r => setTimeout(r, 12000));
  console.log('URL:', URL);
  console.log('--- 捕获请求 ---');
  const seen = new Set();
  hits.forEach(h => {
    if (seen.has(h.url)) return;
    seen.add(h.url);
    console.log(`[${h.type}] ${h.url}`);
    if (h.post) console.log('   post:', h.post.slice(0, 200));
  });
  console.log(`共 ${seen.size} 条`);
  ws.close();
  proc.kill();
  process.exit(0);
})();
