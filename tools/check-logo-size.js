// 一次性校验：lib/brand-logo.js 的基准高度（base）必须与对应 WXSS 写的 height 一致；
// 实际渲染高度 = base × 品牌配重（SCALE），由 WXML 的内联 height 覆盖，故这里只比基准。
const fs = require('fs');
const path = require('path');
const L = require('../小程序项目/lib/brand-logo.js');

const MAP = {
  dev: ['pages/index/index.wxss', 'dev-logo'],
  alt: ['pages/index/index.wxss', 'ac-logo'],
  bom: ['pages/index/index.wxss', 'bom-logo'],
  chip: ['pages/index/index.wxss', 'chip-logo'],
  home: ['pages/home/home.wxss', 'bd-l'],
  lib: ['pages/library/library.wxss', 'it-logo'],
  combo: ['pages/combo/combo.wxss', 'pk-logo']
};

const root = path.join(__dirname, '..', '小程序项目');
let bad = 0;
Object.keys(MAP).forEach(k => {
  const [file, cls] = MAP[k];
  const css = fs.readFileSync(path.join(root, file), 'utf8');
  const re = new RegExp('\\.' + cls + '\\s*\\{[^}]*height:\\s*(\\d+)rpx');
  const m = css.match(re);
  const cssH = m ? Number(m[1]) : null;
  const jsH = L.base(k);
  const ok = cssH === jsH;
  if (!ok) bad++;
  console.log(k.padEnd(6) + cls.padEnd(12) + 'JS ' + String(jsH).padStart(3) + '  CSS ' + String(cssH).padStart(4) + '  ' + (ok ? 'OK' : '不一致'));
});
console.log(bad ? '存在 ' + bad + ' 处不一致' : '全部一致');
