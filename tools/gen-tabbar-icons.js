/**
 * 生成小程序 tabBar 图标（81×81 PNG，RGBA）。
 * 不依赖第三方库：用 node 内置 zlib 手写 PNG 编码，4× 超采样抗锯齿。
 * 运行：node tools/gen-tabbar-icons.js   输出：小程序项目/assets/tabbar/*.png
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 形状判定（81×81 坐标系，返回是否在图形内） ---------- */
function inTriangle(px, py, a, b, c) {
  const s = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const t = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const u = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}
function inRect(px, py, x, y, w, h) { return px >= x && px <= x + w && py >= y && py <= y + h; }
function inRoundRect(px, py, x, y, w, h, r) {
  if (!inRect(px, py, x, y, w, h)) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r || inRect(px, py, x + r, y, w - 2 * r, h) || inRect(px, py, x, y + r, w, h - 2 * r);
}
function ring(px, py, cx, cy, r, halfW) {
  const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  return Math.abs(d - r) <= halfW;
}

// 主页：房子（三角屋顶 + 方身 + 门洞）
function shapeHome(x, y) {
  const roof = inTriangle(x, y, [40.5, 11], [7, 38], [74, 38]);
  const body = inRect(x, y, 17, 36, 47, 33);
  const door = inRect(x, y, 34, 49, 15, 20);
  return (roof || body) && !door;
}
// 选型：十字准星（外环 + 中心点 + 四个刻度）
function shapePick(x, y) {
  const dot = (x - 40.5) * (x - 40.5) + (y - 40.5) * (y - 40.5) <= 7 * 7;
  const ticks =
    (x >= 37.3 && x <= 43.7 && (y <= 14.5 || y >= 66.5)) ||
    (y >= 37.3 && y <= 43.7 && (x <= 14.5 || x >= 66.5));
  return ring(x, y, 40.5, 40.5, 25, 3.2) || dot || ticks;
}
// 产品库：2×2 圆角方块（应用网格）
function shapeLib(x, y) {
  return inRoundRect(x, y, 4.5, 4.5, 32, 32, 8) || inRoundRect(x, y, 44.5, 4.5, 32, 32, 8) ||
    inRoundRect(x, y, 4.5, 44.5, 32, 32, 8) || inRoundRect(x, y, 44.5, 44.5, 32, 32, 8);
}
// 自定义搭配：三个节点 + 连线（组合关系），与准星 / 网格区分
function segDist(px, py, ax, ay, bx, by, halfW) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy)) <= halfW;
}
function shapeCombo(x, y) {
  const node = (cx, cy) => ring(x, y, cx, cy, 10, 3.4);
  const link = (ax, ay, bx, by) => segDist(x, y, ax, ay, bx, by, 3.4);
  return node(24, 22) || node(57, 22) || node(40.5, 58) ||
    link(24, 22, 40.5, 58) || link(57, 22, 40.5, 58);
}

/* ---------- 4× 超采样渲染 ---------- */
const SIZE = 81, SS = 4;
function render(shape, hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (shape(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
        }
      }
      const a = Math.round(hit / (SS * SS) * 255);
      const i = (y * SIZE + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return encodePng(SIZE, SIZE, rgba);
}

const OUT = path.join(__dirname, '..', '小程序项目', 'assets', 'tabbar');
fs.mkdirSync(OUT, { recursive: true });
const ICONS = { home: shapeHome, pick: shapePick, lib: shapeLib, combo: shapeCombo };
Object.keys(ICONS).forEach(name => {
  fs.writeFileSync(path.join(OUT, name + '.png'), render(ICONS[name], '#94a3b8'));
  fs.writeFileSync(path.join(OUT, name + '-on.png'), render(ICONS[name], '#2563eb'));
  console.log('生成', name + '.png / ' + name + '-on.png');
});
console.log('完成 →', OUT);
