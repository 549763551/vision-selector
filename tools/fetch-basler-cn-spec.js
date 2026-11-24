// 抓 Basler 中国站（baslerweb.cn）型号规格。
// 背景：baslerweb.com / www2.baslerweb.com 对本机 IP 全站 403；baslerweb.cn 同样对 curl 返回
//   403 挑战页（6076 字节 "Embed Iframe"），但真 Chrome 能正常过 —— 所以走 CDP：
//   在已加载的 baslerweb.cn 页面上下文里同源 fetch 详情页 HTML，页面内解析完只回传小 JSON。
// 数据源：
//   列表  GET /api/magento/products?store=china_cn&locale=zh-cn&filters={"page":["1"],"category_key":["cameras"]}
//         每页 21 条，page_info.total_pages 给总页数
//   详情  GET /zh-cn/shop/<model 小写>/   规格是 SSR 直出的表格文本
// 用法：node tools/fetch-basler-cn-spec.js [--list] [--spec] [--force]
//   --list   重抓列表 → tmp/basler-cn-items.json
//   --spec   抓详情规格 → tmp/basler-cn-spec.json（默认；已抓过的型号跳过，除非 --force）
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Chrome 可执行文件：Windows 本机默认路径，Linux 服务器用 CHROME_BIN 覆盖
//   CHROME_BIN=/usr/bin/google-chrome node tools/fetch-basler-cn-spec.js --spec
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const LIST_OUT = path.join(TMP, 'basler-cn-items.json');
const SPEC_OUT = path.join(TMP, 'basler-cn-spec.json');
const HOME = 'https://www.baslerweb.cn/zh-cn/cameras/';
const BATCH = 25;
const ARGS = process.argv.slice(2);
const DO_LIST = ARGS.includes('--list');
const DO_SPEC = ARGS.includes('--spec') || !DO_LIST;
const FORCE = ARGS.includes('--force');
const ONLY = (() => { const i = ARGS.indexOf('--only'); return i >= 0 ? String(ARGS[i + 1] || '') : ''; })();
const LIMIT = (() => { const i = ARGS.indexOf('--limit'); return i >= 0 ? Number(ARGS[i + 1]) : 0; })();
const COOL = (() => { const i = ARGS.indexOf('--cool'); return i >= 0 ? Number(ARGS[i + 1]) * 1000 : 330000; })();

function jget(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = '';
      r.on('data', d => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

// 页面内执行的解析器（字符串形式，注入到 evaluate 里）
const PARSER = `
// 规格表是 <table><tbody><tr><th>标签</th><td class="rte-text">值</td></tr>，值可能含多个 div。
// 注意：DOMParser 生成的是惰性文档，innerText 不可用（会退回 textContent 且所有节点粘连），
// 所以必须走 DOM 结构，不能对全文本做正则切分。
function domMap(doc) {
  const map = new Map();
  [...doc.querySelectorAll('tr')].forEach(tr => {
    const th = tr.querySelector('th');
    const td = tr.querySelector('td');
    if (!th || !td) return;
    const k = (th.textContent || '').trim();
    const v = (td.textContent || '').replace(/\\u200c/g, '').replace(/\\s+/g, ' ').trim();
    if (!k || !v) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  });
  return map;
}
function parseSpec(html, model) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const M = domMap(doc);
  const pick = (label) => { const v = M.get(label); return v && v.length ? v[0] : null; };
  const pickAll = (label) => M.get(label) || [];

  const resRaw = pick('分辨率（长x宽）') || pick('分辨率(长x宽)');
  const res = resRaw ? resRaw.match(/(\\d{1,6})\\s*px\\s*[×x]\\s*(\\d{1,6})\\s*px/) : null;
  const pxRaw = pick('像素尺寸（长x宽）') || pick('像素尺寸(长x宽)');
  const px = pxRaw ? pxRaw.match(/([\\d.]+)\\s*(?:μm|um)/) : null;
  const fpsRaw = pick('帧速率');
  const fps = fpsRaw ? fpsRaw.match(/([\\d.]+)\\s*fps/i) : null;
  const lineRaw = pick('行频');
  const lineRate = lineRaw ? lineRaw.match(/([\\d.]+)\\s*kHz/i) : null;
  const shutterRaw = pick('快门');
  const colorRaw = pick('黑白/彩色');
  const iface = pick('接口');
  const mount = pick('镜头接口');
  const formats = pickAll('芯片尺寸');
  const sensors = pickAll('感光芯片');
  const sensor = sensors.find(v => /^[A-Z]{2,}\\d|^IMX|^PYTHON|^GMAX|^AR\\d|^EV\\d|^CMV|^GSENSE/i.test(v)) || (sensors[0] || null);
  const dimsRaw = pick('外壳尺寸（长x宽x高）') || pick('外壳尺寸');
  const dims = dimsRaw ? dimsRaw.match(/([\\d.]+)\\s*mm\\s*[×x]\\s*([\\d.]+)\\s*mm\\s*[×x]\\s*([\\d.]+)/) : null;
  const weightRaw = pick('重量');
  const weight = weightRaw ? weightRaw.match(/([\\d.]+)\\s*g/) : null;
  const power = pick('电源');
  const series = pick('相机系列');
  const cat = pick('相机类别');
  const expoRaw = pick('曝光时间');
  // 3D 相机（ToF / 双目）看的不是像素尺寸，而是视场、工作范围、精度
  const fovRaw = pick('视场') || pick('视场角');
  const workRaw = pick('工作范围') || pick('测量范围');
  const accRaw = pick('精度') || pick('Z 轴精度') || pick('测量精度');
  const depthRaw = pick('深度图像分辨率与帧速率') || pick('深度图像分辨率');
  const maxFps = pick('最大帧速率') || null;

  // 芯片尺寸出现多次：'2/3"' 是靶面格式，'11 mm' 是对角线，'7.8 mm × 7.8 mm' 是长宽
  let fmt = null, diag = null, sw = null, sh = null;
  formats.forEach(v => {
    const mIn = v.match(/([\\d.]+\\s*\\/\\s*[\\d.]+|[\\d.]+)\\s*(?:"|”|″|英寸|inch)/i);
    if (mIn && !fmt) fmt = mIn[1].replace(/\\s+/g, '') + '"';
    const mDual = v.match(/([\\d.]+)\\s*mm\\s*[×x]\\s*([\\d.]+)/);
    if (mDual && !sw) { sw = parseFloat(mDual[1]); sh = parseFloat(mDual[2]); }
    const mOne = v.match(/^([\\d.]+)\\s*mm$/);
    if (mOne && !diag) diag = parseFloat(mOne[1]);
  });

  return {
    model: model,
    w: res ? +res[1] : null,
    h: res ? +res[2] : null,
    pxUm: px ? +px[1] : null,
    sw: sw, sh: sh,
    size: fmt, diag: diag,
    fps: fps ? +fps[1] : null,
    lineKHz: lineRate ? +lineRate[1] : null,
    shutter: shutterRaw ? (/Global/i.test(shutterRaw) ? 'Global' : (/Rolling/i.test(shutterRaw) ? 'Rolling' : null)) : null,
    iface: iface,
    mount: mount,
    sensor: sensor,
    color: colorRaw ? (/Mono|黑白/.test(colorRaw) ? '黑白' : (/Color|彩色/.test(colorRaw) ? '彩色' : colorRaw)) : null,
    colorRaw: colorRaw,
    dims: dims ? [+dims[1], +dims[2], +dims[3]] : null,
    weightG: weight ? +weight[1] : null,
    power: power,
    poe: power ? /PoE/i.test(power) : null,
    series: series, cat: cat,
    expo: expoRaw, maxFps: maxFps, fov: fovRaw, work: workRaw, acc: accRaw, depth: depthRaw,
    specFound: !!(res && px) || !!res,
    url: '/zh-cn/shop/' + model.toLowerCase() + '/'
  };
}
`;

// 站点限流是按浏览器会话计的：新实例重新过一遍挑战就拿到一份新配额，
// 而每次导航到列表页本身就要消耗掉大半配额（首屏 JS/CSS/图片全算在里面）。
// 所以改成一批一个会话、用完即弃 —— 每批都是满额，不再靠干等冷却。
async function boot(waitHome) {
  const prof = path.join(os.tmpdir(), 'cdp-basler-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox',
    '--disable-dev-shm-usage', '--lang=zh-CN', '--window-size=1440,1200',
    '--user-data-dir=' + prof, 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await jget('/json/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 400)); }
  }
  if (!ver) { try { proc.kill(); } catch (e) {} throw new Error('chrome 未就绪'); }

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
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8'
  }, sid);
  // 必须先过一次挑战把同源 cookie 拿到，之后才能同源 fetch 详情页
  await send('Page.navigate', { url: HOME }, sid);
  await new Promise(r => setTimeout(r, waitHome || 9000));

  const evaluate = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 150000 }, sid);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} };
  return { evaluate, close };
}

(async () => {
  let S = await boot();
  const evaluate = (...a) => S.evaluate(...a);

  fs.mkdirSync(TMP, { recursive: true });

  // ---- 1. 列表 ----
  let items = [];
  if (DO_LIST || !fs.existsSync(LIST_OUT)) {
    console.log('抓列表 ...');
    const body = `
      const out = [];
      const pick = (it, code) => {
        const a = ((it.custom_attributesV2 || {}).items || []).find(x => x.code === code);
        if (!a) return null;
        if (a.selected_options) return a.selected_options.map(o => o.label).join('/');
        return a.value == null ? null : a.value;
      };
      for (let p = 1; p <= 40; p++) {
        const f = {"sort_dir":["asc"],"page":[String(p)],"category_key":["cameras"]};
        const u = '/api/magento/products?store=china_cn&locale=zh-cn&filters=' + encodeURIComponent(JSON.stringify(f));
        const j = await (await fetch(u, { headers: { Accept: 'application/json' } })).json();
        (j.items || []).forEach(it => out.push({
          model: pick(it, 'model_name') || it.name,
          name: it.name, sku: it.sku, url_key: it.url_key,
          cat: pick(it, 'camera_category'), series: pick(it, 'camera_series'),
          iface: pick(it, 'interface'), mp: pick(it, 'sensor_resolution_mp'),
          fps: pick(it, 'sensor_framerate'), wl: pick(it, 'cameradata_wavelength'),
          eol: pick(it, 'discontinuation_status'), stock: it.stock_status
        }));
        const pi = j.page_info || {};
        if (p >= (pi.total_pages || 1)) break;
      }
      return JSON.stringify({ n: out.length, items: out });`;
    const r = JSON.parse(await evaluate(`(async () => { ${body} })()`));
    items = r.items;
    fs.writeFileSync(LIST_OUT, JSON.stringify(items, null, 1));
    console.log('列表', r.n, '条 →', path.relative(ROOT, LIST_OUT));
  } else {
    items = JSON.parse(fs.readFileSync(LIST_OUT, 'utf8'));
    console.log('复用列表', items.length, '条');
  }

  // ---- 2. 型号差集（对库内已有型号不重复抓）----
  if (!DO_SPEC) { S.close(); setTimeout(() => process.exit(0), 200); return; }

  const norm = s => String(s || '').toUpperCase().replace(/[\s\-_]/g, '');
  // dmA / boost 等系列在列表里显示成 "dmA2048-37gm (Mono)"，括号后缀只是颜色标注，不是型号的一部分
  const cleanModel = m => String(m || '').replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim();
  const key = s => norm(cleanModel(s));
  const lib = (() => {
    const files = ['basler-catalog.js'];
    const have = new Set();
    files.forEach(f => {
      const p = path.join(ROOT, 'js', f);
      if (!fs.existsSync(p)) return;
      const c = require(p);
      ['CAMERAS', 'LINESCAN'].forEach(k => (c[k] || []).forEach(x => have.add(key(x.model))));
    });
    return have;
  })();

  const done = new Map();
  if (fs.existsSync(SPEC_OUT)) {
    JSON.parse(fs.readFileSync(SPEC_OUT, 'utf8')).forEach(x => done.set(key(x.model), x));
    console.log('续抓：已有', done.size, '条');
  }
  // 黑白/彩色是同一块板子的两种色彩配置，除色彩外规格完全相同（19 对实测数据 19/19 一致）。
  // 所以成对型号只抓一个，另一个按配对推导，请求量直接砍半。
  if (!ARGS.includes('--no-derive')) {
    let derived = 0;
    for (let round = 0; round < 3; round++) {
      const haveSpec = new Map();
      done.forEach((v, k) => { if (v && v.specFound) haveSpec.set(k, v); });
      let added = 0;
      items.forEach(it => {
        const k = key(it.model);
        const cur = done.get(k);
        if (cur && cur.specFound) return;
        const raw = String(it.model);
        const base = raw.replace(/[cm]$/i, '');
        if (base === raw) return; // 型号不以 c/m 结尾，没有配对可推
        const isColor = /c$/i.test(raw);
        const src = haveSpec.get(key(base + (isColor ? 'm' : 'c')));
        if (!src) return;
        const copy = Object.assign({}, src, {
          model: cleanModel(raw),
          urlKey: it.url_key,
          color: isColor ? '彩色' : '黑白',
          derived: true
        });
        done.set(k, copy);
        added++; derived++;
      });
      if (!added) break;
    }
    if (derived) {
      console.log('配对推导补入', derived, '台（同板不同色彩，未重复请求）');
      fs.writeFileSync(SPEC_OUT, JSON.stringify([...done.values()], null, 1));
    }
  }

  // 已抓过（含推导）的跳过；上次因限流（406/0）失败的条目要重抓
  const todo = items.filter(it => {
    if (ONLY) return new RegExp(ONLY, 'i').test(it.model);
    if (FORCE) return true;
    const d = done.get(key(it.model));
    if (!d) return true;
    return d.httpStatus != null;
  });
  const allMissing = todo.filter(it => !lib.has(key(it.model)));
  // 限流是按出口 IP 计的，所以换一台机器就是另一份额度。
  // --shard i/n 按 i % n 取模分片，让两个 IP 并行抓同一份待抓清单，抓完再合并。
  const SHARD = (() => {
    const i = ARGS.indexOf('--shard');
    if (i < 0) return null;
    const m = String(ARGS[i + 1] || '').split('/').map(Number);
    return m.length === 2 && m[1] > 0 ? { i: m[0], n: m[1] } : null;
  })();
  const sharded = SHARD ? allMissing.filter((_, idx) => idx % SHARD.n === SHARD.i) : allMissing;
  const missing = sharded.slice(0, LIMIT || undefined);
  console.log(`官网 ${items.length} 台；库内已有 ${items.length - allMissing.length} 台；官网有库无 ${allMissing.length} 台` + (LIMIT ? `（本次只抓前 ${missing.length}）` : ''));

  let ok = 0, fail = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    // 每批换一个新会话：上一批的配额用光了，新会话重新过一遍挑战就是新配额。
    // 比在同一会话里干等冷却快一个数量级（实测等 6 分钟只恢复 1 个请求）。
    if (i > 0) {
      S.close();
      await new Promise(r => setTimeout(r, 1200));
      S = await boot();
    }
    const batch = missing.slice(i, i + BATCH);
    const models = batch.map(b => b.model);
    const body = `${PARSER}
      const jobs = ${JSON.stringify(batch.map(b => ({ m: b.model, u: b.url_key || b.model.toLowerCase() })))};
      const out = [];
      const t0 = Date.now();
      for (const job of jobs) {
        // 每批自带上限，避免某一页挂住把整批 evaluate 拖到超时
        if (Date.now() - t0 > 95000) { out.push({ model: '__batch_timeout__', specFound: false }); break; }
        // 详情页走 url_key（型号名可能带 " (Mono)" 这类展示后缀，直接拼会 404）
        // 不加自定义 Accept：带了 text/html 会走内容协商，被 WAF 判死后整片回 406
        const url = '/zh-cn/shop/' + String(job.u).toLowerCase() + '/';
        let got = null, code = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(url);
            code = r.status;
            if (code === 200) { got = await r.text(); break; }
            if (code === 404) break;
            await new Promise(x => setTimeout(x, 4000 * (attempt + 1)));
          } catch (e) { code = -1; await new Promise(x => setTimeout(x, 3000)); }
        }
        if (got) {
          try { out.push(parseSpec(got, job.m)); }
          catch (e) { out.push({ model: job.m, urlKey: job.u, err: String(e).slice(0, 120), specFound: false }); }
        } else {
          out.push({ model: job.m, urlKey: job.u, httpStatus: code || 0, specFound: false });
          if (code === 406) { out.push({ model: '__rate_limited__', specFound: false }); break; }
        }
        await new Promise(x => setTimeout(x, 700));
      }
      return JSON.stringify(out);`;
    try {
      const arr = JSON.parse(await evaluate(`(async () => { ${body} })()`));
      let hit406 = false;
      arr.forEach(x => {
        if (x.model === '__batch_timeout__' || x.model === '__rate_limited__') { hit406 = true; return; }
        if (x.httpStatus === 406) hit406 = true;
        x.model = cleanModel(x.model);
        done.set(key(x.model), x);
        if (x.specFound) ok++; else fail++;
      });
      console.log(`批 ${Math.floor(i / BATCH) + 1}/${Math.ceil(missing.length / BATCH)} 完成，累计 ok=${ok} 缺规格=${fail}` + (hit406 ? '（本批撞到限流，下批换会话）' : ''));
    } catch (e) {
      console.log('批失败:', String(e.message).slice(0, 200));
      fail += batch.length;
    }
    fs.writeFileSync(SPEC_OUT, JSON.stringify([...done.values()], null, 1));
  }

  fs.writeFileSync(SPEC_OUT, JSON.stringify([...done.values()], null, 1));
  console.log('完成 →', path.relative(ROOT, SPEC_OUT), '条目', done.size);
  S.close();
  setTimeout(() => process.exit(0), 300);
})();
