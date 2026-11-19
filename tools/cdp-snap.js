// 通用页面快照探针：真 Chrome（headless=new）打开页面，回报
//   - 主文档状态码 / 最终 URL / 标题 / HTML 长度
//   - 所有 XHR/fetch 及其状态码（用于找数据接口）
//   - 截图（可选）
// 用途：curl 被 WAF 挡（403 + 挑战页）时，判断真浏览器能不能过，以及数据藏在哪个异步接口。
// 用法：node tools/cdp-snap.js <url> [outPng]
// 例：node tools/cdp-snap.js "https://www.baslerweb.cn/zh-cn/cameras/" tmp/cn-cam.png
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9345;
const URL_ARG = process.argv[2];
const OUT_PNG = process.argv[3] || null;
const WAIT = Number(process.argv[4] || 15000);

function jget(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = '';
      r.on('data', d => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  if (!URL_ARG) { console.log('用法: node tools/cdp-snap.js <url> [outPng] [waitMs]'); return; }
  const prof = path.join(os.tmpdir(), 'cdp-snap-' + Date.now());
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size=1440,1200',
    '--lang=zh-CN', '--user-data-dir=' + prof, 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    try { ver = await jget('/json/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 400)); }
  }
  if (!ver) { console.log('chrome 未就绪'); proc.kill(); return; }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params, sessionId) => new Promise(res => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

  const reqs = new Map();   // requestId -> {url, type, post}
  const resps = [];         // {url, type, status, len}
  let main = null;

  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent') {
      reqs.set(p.requestId, { url: p.request.url, type: p.type, post: p.request.postData || null });
    }
    if (m.method === 'Network.responseReceived') {
      const r = reqs.get(p.requestId) || { url: p.response.url };
      if (p.type === 'Document' && !main) main = { url: p.response.url, status: p.response.status, mime: p.response.mimeType };
      if (p.type === 'XHR' || p.type === 'Fetch') {
        resps.push({ url: p.response.url, type: p.type, status: p.response.status, mime: p.response.mimeType });
      }
    }
  });

  await new Promise(r => ws.addEventListener('open', r));
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Network.enable', { maxTotalBufferSize: 200000000 }, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8'
  }, sid);
  await send('Page.navigate', { url: URL_ARG }, sid);
  await new Promise(r => setTimeout(r, WAIT));

  const title = (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sid)).result.value;
  const len = (await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML.length', returnByValue: true }, sid)).result.value;
  const loc = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sid)).result.value;
  const bodyHead = (await send('Runtime.evaluate', {
    expression: '(document.body ? document.body.innerText : "").replace(/\\s+/g," ").slice(0,600)',
    returnByValue: true
  }, sid)).result.value;

  console.log('主文档   :', main ? `${main.status} ${main.mime} ${main.url}` : '(未捕获)');
  console.log('最终 URL :', loc);
  console.log('标题     :', title);
  console.log('HTML 长度:', len);
  console.log('可见文本 :', bodyHead);
  console.log('--- XHR/Fetch ---');
  if (!resps.length) console.log('(无)');
  const seen = new Set();
  resps.forEach(r => {
    const k = r.status + ' ' + r.url;
    if (seen.has(k)) return; seen.add(k);
    console.log(`[${r.status}] ${r.type} ${r.url.slice(0, 220)}`);
  });

  if (OUT_PNG) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
    fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
    fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));
    console.log('截图     :', OUT_PNG);
  }

  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 300);
})();
