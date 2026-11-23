// 在真浏览器页面上下文里 eval 任意 JS 并返回结果。
// 用途：站点被 WAF 挡 curl（403 挑战页），但真浏览器能过 —— 用同源 fetch 取接口数据。
// 用法：node tools/cdp-eval.js <url> <jsFile> [waitMs]
//   jsFile 内容会被包进 async 函数体，可用 await；返回值必须可 JSON 序列化。
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
const URL_ARG = process.argv[2];
const JS_FILE = process.argv[3];
const WAIT = Number(process.argv[4] || 9000);
const WIDTH = Number(process.argv[5] || 1440);
const HEIGHT = Number(process.argv[6] || 0);   // 可选：显式指定视口高度，用来测「矮窗口下左栏是否滚得全」

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
  if (!URL_ARG || !JS_FILE) { console.log('用法: node tools/cdp-eval.js <url> <jsFile> [waitMs] [width] [height]'); return; }
  const body = fs.readFileSync(JS_FILE, 'utf8');
  const prof = path.join(os.tmpdir(), 'cdp-eval-' + Date.now());
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--disable-dev-shm-usage', '--lang=zh-CN', `--window-size=${WIDTH},1200`,
    '--user-data-dir=' + prof, 'about:blank'
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
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });

  await new Promise(r => ws.addEventListener('open', r));
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Page.enable', {}, sid);
  // Chrome 的 --window-size 最小只能到 512，移动端要真量到 390 必须走设备度量覆盖
  // 指定了 HEIGHT 时也走覆盖，这样 innerHeight 是准的
  if (WIDTH < 500 || HEIGHT > 0) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT || 900,
      deviceScaleFactor: WIDTH < 500 ? 2 : 1, mobile: WIDTH < 500
    }, sid);
  }
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8'
  }, sid);
  await send('Page.navigate', { url: URL_ARG }, sid);
  await new Promise(r => setTimeout(r, WAIT));

  const expr = `(async () => { ${body} })()`;
  const r = await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, timeout: 240000
  }, sid);

  if (r.exceptionDetails) {
    console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 1500));
  } else {
    const v = r.result.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  }

  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 300);
})();
