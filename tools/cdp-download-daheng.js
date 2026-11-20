// 大恒图像官网有阿里云 WAF：curl / Python 请求一律返回 23670 字节的 JS 挑战页，
// 但真浏览器打开下载页完成挑战后，同源 fetch 能拿到真正的 PDF。
// 本脚本用一次浏览器会话把 docs-data.js 里 daheng 的缺失副本补齐到 manuals/。
// 用法：node tools/cdp-download-daheng.js
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'manuals');
const HOME = 'https://www.daheng-imaging.com/downloads/doc/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CHUNK = 400000;

function jget(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = '';
      r.on('data', d => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'docs-data.js'), 'utf8');
  const data = JSON.parse(src.match(/return (\{.*\});/s)[1]);
  const brand = data.brands.find(b => b.key === 'daheng');
  const jobs = brand.docs.filter(d => d.l && !fs.existsSync(path.join(OUT, d.l)));
  console.log('大恒待下载', jobs.length, '份');
  if (!jobs.length) return;

  const prof = path.join(os.tmpdir(), 'cdp-daheng-' + Date.now());
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--disable-dev-shm-usage', '--lang=zh-CN', '--user-data-dir=' + prof, 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    try { ver = await jget('/json/version'); break; } catch (e) { await sleep(400); }
  }
  if (!ver) { console.log('Chrome 未就绪'); proc.kill(); return; }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params, sessionId) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Page.enable', {}, sid);
  await send('Emulation.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'zh-CN,zh;q=0.9' }, sid);
  await send('Page.navigate', { url: HOME }, sid);
  await sleep(9000); // 等 WAF 挑战完成

  let ok = 0, fail = 0;
  for (let i = 0; i < jobs.length; i++) {
    const d = jobs[i];
    const expr = `(async () => {
      const r = await fetch(${JSON.stringify(d.u)}, { credentials: 'include' });
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.length < 10000 || b[0] !== 0x25) return { err: 'not-pdf', len: b.length };
      let s = '';
      for (let k = 0; k < b.length; k += 8192) {
        s += String.fromCharCode.apply(null, b.subarray(k, k + 8192));
      }
      window.__dl = btoa(s);
      return { len: b.length, b64: window.__dl.length };
    })()`;
    try {
      const r = await send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000
      }, sid);
      const info = r.result && r.result.value;
      if (r.exceptionDetails || !info || info.err) {
        console.log('  ✗', d.l, r.exceptionDetails ? 'eval 异常' : JSON.stringify(info));
        fail++; continue;
      }
      let b64 = '';
      for (let off = 0; off < info.b64; off += CHUNK) {
        const q = await send('Runtime.evaluate', {
          expression: `window.__dl.slice(${off},${Math.min(info.b64, off + CHUNK)})`,
          returnByValue: true
        }, sid);
        b64 += q.result.value || '';
      }
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 10000 || buf.slice(0, 4).toString() !== '%PDF') {
        console.log('  ✗', d.l, '回传数据不是 PDF', buf.length);
        fail++; continue;
      }
      fs.writeFileSync(path.join(OUT, d.l), buf);
      ok++;
      console.log('  ✓ %d/%d %s (%s MB)', i + 1, jobs.length, d.l, (buf.length / 1e6).toFixed(1));
    } catch (e) {
      console.log('  ✗', d.l, String(e).slice(0, 90));
      fail++;
    }
  }
  console.log('完成：成功 %d，失败 %d', ok, fail);
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 300);
})();
