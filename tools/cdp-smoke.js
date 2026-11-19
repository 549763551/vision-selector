// 服务器最小冒烟：起 Chrome、连 CDP、打开首页、等挑战跑完、报标题与长度。
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const PORT = 9401;
const URL_ARG = process.argv[2] || 'https://www.baslerweb.cn/zh-cn/cameras/';

const jget = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let b = ''; r.on('data', d => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const proc = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions',
    '--user-data-dir=' + os.tmpdir() + '/smoke-' + Date.now(), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', d => (err += d));

  let ver = null;
  for (let i = 0; i < 40; i++) {
    try { ver = await jget('/json/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!ver) { console.log('CHROME_FAIL', err.slice(-400)); proc.kill(); return; }
  console.log('browser:', ver.Browser);

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p, s) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = att.sessionId;
  await send('Page.enable', {}, sid);
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9'
  }, sid);
  await send('Page.navigate', { url: URL_ARG }, sid);

  for (const wait of [5000, 10000, 15000]) {
    await new Promise(r => setTimeout(r, wait));
    const info = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({t:document.title,l:document.documentElement.outerHTML.length,jsc:/_jsc_ch_conf/.test(document.documentElement.outerHTML),ok:/适用于机器视觉的相机/.test(document.documentElement.outerHTML)})',
      returnByValue: true
    }, sid);
    console.log('after', wait, info.result.value);
    if (info.result.value && info.result.value.includes('"ok":true')) break;
  }
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 200);
})();
