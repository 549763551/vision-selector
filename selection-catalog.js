/*!
 * 选型链目录合并 —— index.html / combo.html / engine.test.js 共用口径
 * ------------------------------------------------------------------
 * 页面把六品牌的在售型录用 <script> 挂到 window 上，本文件负责：
 *   1) 按「源清单」把主库 + 独立镜头 / 光源 / 控制器库合成一个 CAT；
 *   2) 相机 / 镜头 / 光源三类分别按品牌启停（远心跟镜头、线扫跟相机、控制器跟光源）；
 *   3) 排除退市型号（读 retired-catalog.js，按归一化型号比对 + eol 标记）；
 *   4) 【必要参数 hard gate】按引擎实际算路依赖校验每条型号，缺一项就不进选型池，
 *      避免算出 NaN 精度 / 0 焦距 / 无穷视场，或让引擎读 x.size[0] 抛错；
 *   5) 同一参数的等价键允许补齐（不改数值、不编造）：
 *      线阵 pxH ← pxUm、远心 wdMax ← wdMin、magMin/magMax ← mag。
 *      这类条目信息齐全，只是键名不完整；确实查不到的参数才排除。
 *   6) 给每条补 brand，并用浅拷贝避免污染 window 上的原型号库。
 *
 * 不纳入：3D / 智能相机 / 红外 / 工控机 / 非标产品 / 退市库条目本身。
 * 这些不是「相机 + 镜头 + 光源」分离选型算路可比选的条目（字段口径不兼容）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SelectionCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // 全局型录名 → 品牌注册键（brands.js）。同品牌可有多个型录。
  var SOURCES = [
    { g: 'HikrobotCatalog',    b: 'hikrobot' },
    { g: 'HuaruiCatalog',      b: 'huarui' },
    { g: 'BaslerCatalog',      b: 'basler' },
    { g: 'DahengCatalog',      b: 'daheng' },
    { g: 'OptCatalog',         b: 'opt' },
    { g: 'CstCatalog',         b: 'cst' },
    { g: 'BaslerLensCatalog',  b: 'basler' },
    { g: 'BaslerLightCatalog', b: 'basler' },
    { g: 'OptLensCatalog',     b: 'opt' },
    { g: 'OptLightCatalog',    b: 'opt' },
    { g: 'OptCtrlCatalog',     b: 'opt' }
  ];

  var GROUP_KEYS = {
    camera: ['CAMERAS', 'LINESCAN'],
    lens:   ['LENSES', 'TELECENTRIC'],
    light:  ['LIGHTS', 'CONTROLLERS']
  };

  // 必要参数：缺任一项即不纳入选型。
  // 只列「缺失会让引擎算错 / 抛错 / 完全无法比选」的字段；引擎已有 null 保护的
  // 可选参数（镜头 ic / mp、相机 expMinUs / shutter、光源 power 等）不在这里。
  var REQUIRED = {
    CAMERAS:     ['model', 'w', 'h', 'pxUm', 'sw', 'sh', 'fps', 'iface', 'mount', 'color'],
    LINESCAN:    ['model', 'w', 'lineRate', 'iface', 'mount', 'color', 'pxH'],
    LENSES:      ['model', 'focal', 'mount', 'fmin'],
    TELECENTRIC: ['model', 'mount', 'magMin', 'magMax', 'wdMin', 'wdMax'],
    LIGHTS:      ['model', 'type', 'color', 'size'],
    CONTROLLERS: ['model', 'channels', 'mode']
  };
  var NUMERIC = {
    w: 1, h: 1, pxUm: 1, sw: 1, sh: 1, fps: 1, lineRate: 1, pxH: 1,
    focal: 1, fmin: 1, magMin: 1, magMax: 1, wdMin: 1, wdMax: 1, channels: 1
  };

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function normModel(m) { return String(m == null ? '' : m).toUpperCase().replace(/\s+/g, ''); }

  // 兼容两种导出形态：浏览器 window.RetiredCatalog = {BRANDS...}，
  // Node require 返回 {RetiredCatalog: {BRANDS...}}。
  function retiredSet(win) {
    var set = {};
    var mod = win.RetiredCatalog;
    var R = mod && mod.BRANDS ? mod : (mod && mod.RetiredCatalog && mod.RetiredCatalog.BRANDS ? mod.RetiredCatalog : null);
    if (!R) return set;
    Object.keys(R.BRANDS).forEach(function (b) {
      (R.BRANDS[b].CAMERAS || []).forEach(function (x) {
        var m = normModel(x && x.model);
        if (m) set[m] = 1;
      });
    });
    return set;
  }

  function isRetired(x, set) {
    if (x.eol || x.eolRef || x.retired || x.status === '停产' || x.status === '退市') return true;
    var m = normModel(x.model);
    return !!(m && set[m]);
  }

  function brandName(win, key) {
    var B = win.BRANDS || {};
    return (B[key] && B[key].name) || key;
  }

  // 等价键补齐：只搬运已有数值，不推测、不编造。
  function fillEquivalent(kind, y, stats) {
    function bump(k) { if (stats) stats.filled[k] = (stats.filled[k] || 0) + 1; }
    if (kind === 'LINESCAN' && !(y.pxH > 0) && y.pxUm > 0) {
      y.pxH = y.pxUm; bump('pxH');
    }
    if (kind === 'TELECENTRIC') {
      if (!(y.mag > 0) && y.magMin > 0 && y.magMax > 0 && y.magMin === y.magMax) y.mag = y.magMin;
      if (!(y.magMin > 0) && y.mag > 0) { y.magMin = y.mag; bump('magMin'); }
      if (!(y.magMax > 0) && y.mag > 0) { y.magMax = y.mag; bump('magMax'); }
      if (!(y.wdMax > 0) && y.wdMin > 0) { y.wdMax = y.wdMin; bump('wdMax'); }
      if (!(y.wdMin > 0) && y.wdMax > 0) { y.wdMin = y.wdMax; bump('wdMin'); }
    }
  }

  function isValid(kind, y) {
    var fields = REQUIRED[kind] || [], i, k, v;
    for (i = 0; i < fields.length; i++) {
      k = fields[i]; v = y[k];
      if (k === 'size') {
        if (!Array.isArray(v) || !v.length || !v.some(function (n) { return n > 0; })) return false;
      } else if (NUMERIC[k]) {
        if (!(v > 0) || !isFinite(v)) return false;   // null / 0 / NaN 一律挡掉
      } else if (v == null || v === '') {
        return false;
      }
    }
    return true;
  }

  // 单条清洗：浅拷贝 → 等价键补齐 → 必要参数校验。返回 null 表示不纳入。
  function prepare(kind, x, stats) {
    if (!x) return null;
    var y = {}, k;
    for (k in x) if (hasOwn(x, k)) y[k] = x[k];
    fillEquivalent(kind, y, stats);
    if (!isValid(kind, y)) {
      if (stats) stats.invalid[kind] = (stats.invalid[kind] || 0) + 1;
      return null;
    }
    return y;
  }

  /** 清洗后仍有该类目有效型号的品牌键（按源清单顺序去重） */
  function brandKeys(win, kind) {
    var keys = GROUP_KEYS[kind] || [];
    var seen = {}, out = [];
    SOURCES.forEach(function (s) {
      var C = win[s.g];
      if (!C || seen[s.b]) return;
      var has = keys.some(function (k) {
        return (C[k] || []).some(function (x) {
          if (!x || x.eol || x.eolRef || x.retired || x.status === '停产' || x.status === '退市') return false;
          return !!prepare(k, x, null);
        });
      });
      if (has) { seen[s.b] = 1; out.push(s.b); }
    });
    return out;
  }

  function allBrandKeys(win) {
    return { camera: brandKeys(win, 'camera'), lens: brandKeys(win, 'lens'), light: brandKeys(win, 'light') };
  }

  /**
   * 合成目录。active = {camera:[key], lens:[key], light:[key]}；
   * 省略 active 表示全部纳入（自定义搭配页用）。
   * 返回 CAT（引擎可直接吃），另挂 _stats 供页面文案说明清洗结果。
   */
  function merge(win, active) {
    var all = allBrandKeys(win);
    var on = {
      camera: (active && active.camera) || all.camera,
      lens:   (active && active.lens)   || all.lens,
      light:  (active && active.light)  || all.light
    };
    var retired = retiredSet(win);
    var stats = { retired: 0, invalid: {}, filled: {} };
    var out = {
      CAMERAS: [], LINESCAN: [], LENSES: [], TELECENTRIC: [],
      LIGHTS: [], CONTROLLERS: [], PROFILERS: []
    };

    function take(list, kind, key, target) {
      var name = brandName(win, key);
      (list || []).forEach(function (x) {
        if (!x) return;
        if (isRetired(x, retired)) { stats.retired++; return; }
        var y = prepare(kind, x, stats);
        if (!y) return;
        if (!y.brand) y.brand = name;
        target.push(y);
      });
    }

    function has(arr, k) { return arr.indexOf(k) >= 0; }

    SOURCES.forEach(function (s) {
      var C = win[s.g];
      if (!C) return;
      if (has(on.camera, s.b)) {
        take(C.CAMERAS, 'CAMERAS', s.b, out.CAMERAS);
        take(C.LINESCAN, 'LINESCAN', s.b, out.LINESCAN);
      }
      if (has(on.lens, s.b)) {
        take(C.LENSES, 'LENSES', s.b, out.LENSES);
        take(C.TELECENTRIC, 'TELECENTRIC', s.b, out.TELECENTRIC);
      }
      if (has(on.light, s.b)) {
        take(C.LIGHTS, 'LIGHTS', s.b, out.LIGHTS);
        take(C.CONTROLLERS, 'CONTROLLERS', s.b, out.CONTROLLERS);
      }
    });

    // 海康 3D 轮廓传感器：供「高度 / 3D 轮廓测量」任务的建议，跟随相机品牌开关。
    if (win.Hikrobot3DCatalog && has(on.camera, 'hikrobot')) {
      take(win.Hikrobot3DCatalog.PROFILERS, 'PROFILERS', 'hikrobot', out.PROFILERS);
    }

    out.META = {
      source: '多品牌合并目录（在售 · 退市与必要参数缺失型号已排除）',
      brand: '多品牌', generated: '', cameras: out.CAMERAS.length
    };
    out._stats = stats;
    return out;
  }

  return {
    SOURCES: SOURCES,
    REQUIRED: REQUIRED,
    brandKeys: brandKeys,
    allBrandKeys: allBrandKeys,
    merge: merge,
    isValid: isValid,
    normModel: normModel
  };
});
