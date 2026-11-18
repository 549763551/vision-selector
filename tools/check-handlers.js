/*
 * 事件冒烟测试：把 WXML 里所有 bindtap / catchtap 绑定的方法逐个调一遍，
 * 用标签上的 data-* 组出 dataset。用来抓「改了 WXML 之后方法名写错 / 取不到字段」这类问题。
 *
 *   node tools/check-handlers.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../小程序项目');

const PAGES = ['home', 'index', 'library', 'combo', 'about'];
const store = {};

global.getApp = () => ({
  globalData: {
    activeCamBrands: ['hikrobot', 'huarui', 'basler', 'daheng'],
    activeLensBrands: ['hikrobot', 'basler', 'daheng'],
    libQuery: null
  }
});
global.wx = {
  showToast() {}, switchTab() {}, navigateTo() {}, navigateBack() {}, pageScrollTo() {},
  setClipboardData() {},
  getStorageSync: k => store[k], setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: k => { delete store[k]; },
  getWindowInfo: () => ({ pixelRatio: 2 }),
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec() {} }),
  createIntersectionObserver: () => ({ relativeToViewport() { return this; }, observe() {}, disconnect() {} }),
  createCanvasContext: () => ({})
};

function setPath(o, p, v) {
  const seg = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let c = o;
  for (let i = 0; i < seg.length - 1; i++) {
    if (c[seg[i]] == null) c[seg[i]] = {};
    c = c[seg[i]];
  }
  c[seg[seg.length - 1]] = v;
}

let cfg = null;
global.Page = c => { cfg = c; };

let fails = 0;
PAGES.forEach(page => {
  delete require.cache[require.resolve(path.join(ROOT, 'pages', page, page + '.js'))];
  cfg = null;
  require(path.join(ROOT, 'pages', page, page + '.js'));
  const pg = Object.assign({}, cfg);
  pg.data = JSON.parse(JSON.stringify(cfg.data));
  pg.setData = function (patch, cb) {
    Object.keys(patch).forEach(k => setPath(this.data, k, patch[k]));
    if (cb) cb();
  };
  if (pg.onLoad) pg.onLoad({});
  if (pg.onShow) pg.onShow();
  if (page === 'index' && pg.applyPreset) pg.applyPreset({ currentTarget: { dataset: { key: 'copper' } } });
  if (page === 'combo' && pg.autoFill) pg.autoFill({});
  // 产品库：先把详情打开，才能覆盖到抽屉里的按钮
  if (page === 'library' && pg.filtered && pg.filtered.length && pg.openDetail) pg.openDetail(pg.filtered[0]);

  // 从 WXML 抓 handler + dataset
  const wxml = fs.readFileSync(path.join(ROOT, 'pages', page, page + '.wxml'), 'utf8');
  const tags = [...wxml.matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*)\/?>/g)];
  const calls = [];
  tags.forEach(t => {
    const attrs = t[2];
    const hs = [...attrs.matchAll(/(?:bind|catch)(?::)?tap="([\w$]+)"/g)].map(m => m[1]);
    if (!hs.length) return;
    const ds = {};
    for (const m of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) {
      const v = m[2];
      const lit = v.match(/^\{\{\s*(-?\d+)\s*\}\}$/);
      // data-i="{{si}}" 这类依赖循环变量的值在静态扫描里取不到，按 0 兜底
      ds[m[1]] = lit ? Number(lit[1]) : (/^\{\{/.test(v) ? 0 : v);
    }
    hs.forEach(h => calls.push({ h, ds }));
  });

  const seen = new Set();
  calls.forEach(({ h, ds }) => {
    const key = h + JSON.stringify(ds);
    if (seen.has(key)) return;
    seen.add(key);
    if (typeof pg[h] !== 'function') {
      console.log('✗ ' + page + ' 未定义方法: ' + h);
      fails++;
      return;
    }
    try {
      pg[h]({ currentTarget: { dataset: ds }, detail: { value: 0 } });
    } catch (e) {
      console.log('✗ ' + page + ' ' + h + ' 抛错: ' + (e && e.message));
      fails++;
    }
  });
  console.log('· ' + page + ' 覆盖 ' + seen.size + ' 个事件');
});

console.log(fails ? '事件冒烟失败 ' + fails : '事件冒烟通过');
