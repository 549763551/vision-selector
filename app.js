/* 界面逻辑：读表单 → 调引擎（海康型号库）→ 渲染结果 */
(function () {
  'use strict';

  var BRANDS = window.BRANDS || {};
  var $ = function (id) { return document.getElementById(id); };

  // 已加载且默认启用的品牌（脚本引入即视为可用）
  var activeBrands = (window.availableBrands ? window.availableBrands() : ['hikrobot']).slice();
  // 镜头品牌：与相机分开筛选（仅纳入已入库镜头的品牌，初始全选）
  var activeLensBrands = (window.availableBrands ? window.availableBrands() : ['hikrobot']).filter(function (k) {
    var C = window[BRANDS[k].global];
    if (C && (C.LENSES || []).length > 0) return true;
    if (k === 'basler' && window.BaslerLensCatalog && (window.BaslerLensCatalog.LENSES || []).length > 0) return true;
    return false;
  });
  if (!activeLensBrands.length) activeLensBrands = ['hikrobot'];

  function brandMeta(b) {
    if (!b) return null;
    var ks = Object.keys(BRANDS);
    for (var i = 0; i < ks.length; i++) {
      var m = BRANDS[ks[i]];
      if (!m) continue;
      if (m.name === b || m.short === b || (m.short && b.indexOf(m.short) >= 0)) return m;
    }
    return null;
  }

  // 品牌小徽标：色点 + 简称文字（用于同系列/跨品牌表格行）
  function brandMiniHtml(b) {
    var m = brandMeta(b);
    if (!m) return '';
    return '<span class="bf-mini" style="color:' + esc(m.color) + '" title="' + esc(m.name) + '">●</span>' +
      '<span class="bf-mini-name" title="' + esc(m.name) + '">' + esc(m.short) + '</span>';
  }

  // 把多个品牌型号库拼成一个目录：相机按「相机品牌」筛选，镜头按「镜头品牌」筛选，
  // 其余类目（光源/线扫/远心/控制器）始终合并（当前仅海康提供，无筛选需求）
  function buildMergedCatalog() {
    var cam = [], linescan = [], lenses = [], tele = [], lights = [], ctrls = [];
    (window.availableBrands ? window.availableBrands() : []).forEach(function (key) {
      var C = window[BRANDS[key].global];
      if (!C) return;
      // 相机：仅纳入“已启用”品牌；镜头：仅纳入“已启用镜头品牌”
      var camSrc = (activeBrands.indexOf(key) >= 0) ? (C.CAMERAS || []) : [];
      camSrc.forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; cam.push(x); });
      if (activeLensBrands.indexOf(key) >= 0) {
        (C.LENSES || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; lenses.push(x); });
      }
      (C.LINESCAN || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; linescan.push(x); });
      (C.LIGHTS || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; lights.push(x); });
      tele = tele.concat(C.TELECENTRIC || []);
      (C.CONTROLLERS || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; ctrls.push(x); });
    });
    // Basler 镜头/远心独立库：勾选「Basler 镜头品牌」时参与镜头与远心比选
    if (activeLensBrands.indexOf('basler') >= 0 && window.BaslerLensCatalog) {
      (window.BaslerLensCatalog.LENSES || []).forEach(function (x) { x.brand = x.brand || 'Basler'; lenses.push(x); });
      tele = tele.concat(window.BaslerLensCatalog.TELECENTRIC || []);
    }
    // 海康 3D 传感器（MV-DP 轮廓等）：供「高度 / 3D 轮廓测量」任务的建议
    var profilers = [];
    if (window.Hikrobot3DCatalog) {
      (window.Hikrobot3DCatalog.PROFILERS || []).forEach(function (x) {
        if (!x.brand) x.brand = BRANDS.hikrobot.name;
        profilers.push(x);
      });
    }
    return {
      META: { source: '多品牌合并目录', brand: '多品牌', generated: '', cameras: cam.length },
      CAMERAS: cam, LINESCAN: linescan, LENSES: lenses,
      TELECENTRIC: tele, LIGHTS: lights, CONTROLLERS: ctrls, PROFILERS: profilers
    };
  }

  var CAT = buildMergedCatalog();
  var E = (window.VisionEngineFactory || window.VisionEngine)(CAT);

  function rebuildEngine() {
    CAT = buildMergedCatalog();
    E = (window.VisionEngineFactory || window.VisionEngine)(CAT);
    render();
  }

  /* ---------------- 顶栏品牌筛选（相机 / 镜头分开） ---------------- */
  function renderFilterBox(boxId, keys, active, label) {
    var box = $(boxId);
    if (!box) return;
    var html = '<span class="bf-label">' + esc(label) + '</span>';
    keys.forEach(function (k) {
      var m = BRANDS[k];
      if (!m) return;
      var on = active.indexOf(k) >= 0;
      html += '<button type="button" class="bf-chip ' + (on ? 'on' : 'off') + '" data-brand="' + esc(k) + '"' +
        ' title="' + esc(m.name) + '：' + (on ? '已纳入，点击排除' : '已排除，点击纳入') + '">' +
        '<img class="bf-logo" src="' + esc(m.logo) + '" alt="' + esc(m.short) + '" style="--logo-scale:' + (m.logoScale || 1) + '" />' + esc(m.short) +
        '</button>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.bf-chip'), function (chip) {
      chip.addEventListener('click', function () {
        var k = chip.getAttribute('data-brand');
        var idx = active.indexOf(k);
        if (idx >= 0) {
          if (active.length > 1) active.splice(idx, 1);
        } else {
          active.push(k);
        }
        renderFilterBox(boxId, keys, active, label);
        rebuildEngine();
      });
    });
  }

  // 有镜头入库的品牌才出现在镜头筛选条（Basler 镜头在独立库 basler-lens-catalog.js）
  function lensBrandKeys() {
    return (window.availableBrands ? window.availableBrands() : []).filter(function (k) {
      var C = window[BRANDS[k].global];
      if (C && (C.LENSES || []).length > 0) return true;
      if (k === 'basler' && window.BaslerLensCatalog && (window.BaslerLensCatalog.LENSES || []).length > 0) return true;
      return false;
    });
  }

  function renderBrandFilter() {
    renderFilterBox('brandFilter', window.availableBrands ? window.availableBrands() : [], activeBrands, '相机品牌');
  }

  function renderLensFilter() {
    renderFilterBox('lensFilter', lensBrandKeys(), activeLensBrands, '镜头品牌');
  }

  /* ---------------- 预设场景 ---------------- */
  var PRESETS = {
    copper:    { fovW: 50,  fovH: 40, precision: 0.1,  task: 'defect',          wd: 300, material: 'metal_shiny', colorTarget: 'yellow', needColor: false, heightDiff: 1,   speed: 0,   cpm: 0 },
    precision: { fovW: 20,  fovH: 15, precision: 0.05, task: 'precise_measure', wd: 250, material: 'metal_matte', colorTarget: 'none',   needColor: false, heightDiff: 0.5, speed: 0,   cpm: 0 },
    qr:        { fovW: 60,  fovH: 45, precision: 0.15, task: 'ocr',             wd: 200, material: 'label',       colorTarget: 'none',   needColor: false, heightDiff: 0,   speed: 200, cpm: 0 },
    scratch:   { fovW: 80,  fovH: 60, precision: 0.08, task: 'surface',         wd: 350, material: 'metal_matte', colorTarget: 'none',   needColor: false, heightDiff: 2,   speed: 0,   cpm: 0 },
    inline:    { fovW: 100, fovH: 75, precision: 0.2,  task: 'presence',        wd: 400, material: 'plastic',     colorTarget: 'none',   needColor: true,  heightDiff: 3,   speed: 500, cpm: 0 },
    glass:     { fovW: 40,  fovH: 30, precision: 0.05, task: 'measure',         wd: 260, material: 'glass',       colorTarget: 'none',   needColor: false, heightDiff: 1,   speed: 0,   cpm: 0 }
  };

  var DEFAULT = {
    fovW: 50, fovH: 40, precision: 0.1, task: 'defect', wd: 300,
    material: 'metal_shiny', colorTarget: 'none', needColor: false,
    heightDiff: 1, speed: 0, cpm: 0, space: 0, lineScanFirst: false
  };

  var SWATCH = {
    white: '#e5e7eb', red: '#ef4444', yellow: '#f59e0b', green: '#22c55e',
    blue: '#3b82f6', ir: '#6b7280', cyan: '#06b6d4'
  };

  var TYPE_TAG = {
    backlight: '背光', bar_low: '暗场', dome: '无影',
    coaxial: '同轴', ring_high: '高角度', ring_low: '低角度', ring: '环形'
  };

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function num(x, d) {
    if (!isFinite(x)) return '∞';
    var p = Math.pow(10, d == null ? 2 : d);
    return String(Math.round(x * p) / p);
  }

  function n4(x) { return num(x, 4); }

  function pct(x) { return isFinite(x) ? Math.round(x * 100) + '%' : '—'; }

  function kv(k, v) {
    return '<div class="kv"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  }

  function block(k, v) {
    return '<div class="kv-block"><span>' + esc(k) + '</span><p>' + v + '</p></div>';
  }

  function swatch(key) {
    var c = SWATCH[key] || '#cbd5e1';
    return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + c +
      ';margin-right:6px;vertical-align:middle;box-shadow:0 0 0 1px rgba(15,23,42,.12)"></span>';
  }

  /* ---------------- 表单读写 ---------------- */
  function fillSelects() {
    var t = $('task');
    t.innerHTML = Object.keys(E.TASKS).map(function (k) {
      return '<option value="' + k + '">' + esc(E.TASKS[k].label) + '</option>';
    }).join('');

    var m = $('material');
    m.innerHTML = Object.keys(E.MATERIALS).map(function (k) {
      return '<option value="' + k + '">' + esc(E.MATERIALS[k]) + '</option>';
    }).join('');

    var ct = $('colorTarget');
    ct.innerHTML = '<option value="none">不指定（按材质与任务自动选）</option>' +
      Object.keys(E.COLOR).map(function (k) {
        return '<option value="' + k + '">' + esc(E.COLOR[k].name) + ' ' + esc(E.COLOR[k].wl) + '</option>';
      }).join('');
  }

  function readNum(id) {
    var v = parseFloat($(id).value);
    return isNaN(v) ? undefined : v;
  }

  /* ---------------- 手动指定型号 ---------------- */
  var manual = { camera: null, lens: null, light: null };

  /* ---------------- 自定义搭配交接（独立页面 combo.html） ---------------- */
  // vs-combo 是搭配台草稿（产品库 / 搭配页共用）；vs-combo-apply 只在「应用到选型助手」时写入
  var COMBO_KEY = 'vs-combo-apply';

  function comboKey(brand, model) { return (brand ? brand + '::' : '') + model; }

  // 一次性读取来自「自定义搭配」页的交接数据（读完即删，避免刷新时反复覆盖手动选择）
  function takeComboHandoff() {
    try {
      var raw = localStorage.getItem(COMBO_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || (!o.camera && !o.lens && !o.light && !o.req)) return null;
      return o;
    } catch (e) { return null; }
  }

  /* ---- 方案清单（BOM） ---- */
  function inqLoad() {
    try { return JSON.parse(localStorage.getItem('vs-inquiry-list') || '[]'); } catch (e) { return []; }
  }
  function inqSave(list) {
    try { localStorage.setItem('vs-inquiry-list', JSON.stringify(list)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function inqAdd(rec) {
    var list = inqLoad();
    if (!list.some(function (x) { return x.m === rec.m; })) { list.push(rec); inqSave(list); }
  }
  function inqHas(model) {
    return inqLoad().some(function (x) { return x.m === model; });
  }
  // 询价清单与产品库共用，品牌统一存产品库使用的注册键
  function brandKeyOf(b) {
    if (!b) return null;
    var ks = Object.keys(BRANDS);
    for (var i = 0; i < ks.length; i++) {
      var m = BRANDS[ks[i]];
      if (!m) continue;
      if (m.key === b || m.name === b || m.short === b) return m.key;
      if (String(m.key).toLowerCase() === String(b).toLowerCase()) return m.key;
      if (String(b).indexOf(m.short) >= 0) return m.key;
    }
    return b;
  }

  function bomRows(r) {
    var c = r.camera, l = r.lens, g = r.light;
    var rows = [];
    rows.push({
      cat: 'cam', catName: '相机', brand: c.brand, model: c.model, qty: 1,
      spec: c.w + '×' + c.h + ' px · ' + c.sw + '×' + c.sh + ' mm · ' + c.interface + ' · ' + c.mount + ' 口'
    });
    rows.push({
      cat: 'lens', catName: '镜头', brand: l.brand, model: l.model, qty: 1,
      spec: l.f + ' mm F' + l.aperture + ' · ' + l.mount + ' 口 · 视场 ' + num(l.fovW, 1) + '×' + num(l.fovH, 1) + ' mm' +
        (l.adapter ? ' · 需转接环' : '')
    });
    if (l.adapter) {
      rows.push({
        cat: 'acc', catName: '附件', brand: null, model: c.mount + '→' + l.mount + ' 转接环', qty: 1,
        spec: '约 12 mm，已计入安装空间'
      });
    }
    if (g && g.sku) {
      rows.push({
        cat: 'light', catName: '光源', brand: g.skuBrand, model: g.sku, qty: g.count || 1,
        spec: (g.skuSize || []).join('×') + ' mm · ' + (g.power == null ? '' : g.power + ' W · ') +
          g.colorName + ' · ' + (g.controller || '')
      });
    }
    if (g && g.controllerModel) {
      var ctrl = ((CAT && CAT.CONTROLLERS) || []).filter(function (x) { return x.model === g.controllerModel; })[0];
      rows.push({
        cat: 'ctrl', catName: '控制器', brand: ctrl ? ctrl.brand : g.skuBrand, model: g.controllerModel, qty: 1,
        spec: (ctrl && ctrl.channels ? ctrl.channels + ' 通道' : (g.controllerChannels || '—') + ' 通道') +
          (ctrl && ctrl.strobe ? ' · 支持频闪' : '')
      });
    }
    return rows;
  }

  function bomCard(r) {
    var rows = bomRows(r);
    var htmlRows = rows.map(function (x, i) {
      var added = x.cat !== 'acc' && inqHas(x.model);
      return '<tr><td class="cat">' + esc(x.catName) + '</td>' +
        '<td class="model">' + esc(x.model) + (x.brand ? '<span class="bom-brand">' + esc(x.brand) + '</span>' : '') + '</td>' +
        '<td class="qty">' + x.qty + '</td>' +
        '<td>' + esc(x.spec) + '</td>' +
        '<td style="white-space:nowrap">' + (x.cat === 'acc'
          ? '<span style="color:#94a3b8">—</span>'
          : '<button class="bom-add' + (added ? ' on' : '') + '" data-bom-add="' + i + '" data-bom-model="' + esc(x.model) + '"' +
            ' data-bom-brand="' + esc(x.brand || '') + '" data-bom-cat="' + esc(x.cat) + '">' +
            (added ? '✓ 已加入' : '＋ 询价') + '</button>') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2 class="sec">方案清单 (BOM) <span class="hint">直接拿去询价 / 备料</span>' +
      '<button class="btn bom-all" id="bomAll">全部加入询价清单</button></h2>' +
      '<div style="overflow-x:auto"><table class="mini bom-table"><thead><tr>' +
      '<th>类别</th><th>品牌 / 型号</th><th>数量</th><th>关键规格</th><th></th>' +
      '</tr></thead><tbody>' + htmlRows + '</tbody></table></div>' +
      '<div class="sib-note">清单按当前方案自动生成；「加入询价清单」保存在本机浏览器，可在产品库查看完整参数。</div></div>';
  }

  /* ---- 评分构成 ---- */
  function scoreItemsHtml(r) {
    var items = r.scoreItems || [];
    if (!items.length) return '评分构成：<span class="si-chip ok">无扣分项</span>';
    return '评分构成：' + items.map(function (x) {
      return '<span class="si-chip" title="' + esc(x.detail) + '">' + esc(x.label) + ' −' + x.penalty + '</span>';
    }).join('');
  }

  function readInput() {
    return {
      fovW: readNum('fovW'),
      fovH: readNum('fovH'),
      precision: readNum('precision'),
      task: $('task').value,
      wd: readNum('wd'),
      material: $('material').value,
      colorTarget: $('colorTarget').value,
      needColor: $('needColor').checked,
      heightDiff: readNum('heightDiff'),
      speed: readNum('speed'),
      cpm: readNum('cpm'),
      space: readNum('space'),
      lineScanFirst: $('lineScanFirst').checked,
      manualCamera: manual.camera,
      manualLens: manual.lens,
      manualLight: manual.light
    };
  }

  function applyState(st) {
    manual.camera = null;
    manual.lens = null;
    manual.light = null;
    $('fovW').value = st.fovW;
    $('fovH').value = st.fovH;
    $('precision').value = st.precision;
    $('task').value = st.task;
    $('wd').value = st.wd;
    $('material').value = st.material;
    $('colorTarget').value = st.colorTarget;
    $('needColor').checked = !!st.needColor;
    $('heightDiff').value = st.heightDiff;
    $('speed').value = st.speed;
    $('cpm').value = st.cpm;
    $('space').value = st.space == null ? 0 : st.space;
    $('lineScanFirst').checked = !!st.lineScanFirst;
    render();
  }

  /* ---------------- 卡片渲染 ---------------- */
  // 「在产品库查看」链接：带型号与类别跳产品库，产品库会自动搜索并弹出详情
  function libLink(cat, model) {
    if (!model) return '';
    return '<a class="lib-link" href="library.html?cat=' + encodeURIComponent(cat) +
      '&q=' + encodeURIComponent(model) + '" title="在产品库中查看全参数与备选">产品库 ↗</a>';
  }

  // 带当前需求跳「自定义搭配」页，避免在那边重填一遍
  function comboLinkHref() {
    var parts = [];
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space'].forEach(function (k) {
      var v = $(k).value;
      if (v !== '') parts.push(k + '=' + encodeURIComponent(v));
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      if ($(k).value) parts.push(k + '=' + encodeURIComponent($(k).value));
    });
    if ($('needColor').checked) parts.push('needColor=1');
    if ($('lineScanFirst').checked) parts.push('lineScanFirst=1');
    return 'combo.html' + (parts.length ? '?' + parts.join('&') : '');
  }

  function expoRange(a, b) {
    function one(us) {
      if (us == null) return '—';
      if (us >= 1e6) return num(us / 1e6, 1) + ' s';
      if (us >= 1000) return num(us / 1000, 1) + ' ms';
      return num(us, 0) + ' µs';
    }
    if (a == null && b == null) return '—';
    return one(a) + ' ~ ' + one(b);
  }

  // 靶面对角线英寸数：优先用型号库标注；缺失时由 sw/sh 推导（标注“约/估算”）
  function sensorSizeTxt(c) {
    if (c.size) return esc(c.size);
    if (!(c.sw > 0 && c.sh > 0)) return '';
    var inch = Math.sqrt(c.sw * c.sw + c.sh * c.sh) / 25.4;
    return '<span title="型录未标注靶面，由 ' + c.sw + '×' + c.sh + ' mm 对角线推导">约 ' + num(inch, 2) + '"（估算）</span>';
  }

  function camCard(r) {
    var c = r.camera;
    var bmeta = brandMeta(c.brand);
    var blogo = bmeta ? '<img class="card-brand-logo" src="' + esc(bmeta.logo) + '" alt="' + esc(bmeta.short) + '" style="--logo-scale:' + (bmeta.logoScale || 1) + '" />' : '';
    return '<div class="card cam">' +
      '<div class="card-head"><span class="ico">📷</span><h3>相机</h3>' + blogo + '<span class="tag">' + esc(c.color) + '</span>' + libLink('cam', c.model) + '</div>' +
      '<div class="hero">' + esc(c.model) + '</div>' +
      '<div class="hero-sub">' + esc(c.series) + '　·　' + c.w + ' × ' + c.h + ' px　·　' + esc(c.brand || '—') + '</div>' +
      kv('靶面尺寸', esc(c.sw + ' × ' + c.sh) + ' mm' + (c.size || (c.sw > 0 && c.sh > 0) ? '（' + sensorSizeTxt(c) + '）' : '')) +
      kv('像元尺寸', esc(c.pxUm) + ' µm') +
      kv('传感器型号', esc(c.sensor || '—')) +
      kv('数据接口', esc(c.interface)) +
      kv('快门类型', esc(c.shutter)) +
      kv('动态范围', esc(c.dr == null ? '—' : c.dr + ' dB')) +
      kv('信噪比', esc(c.snr == null ? '—' : c.snr + ' dB')) +
      kv('曝光范围', esc(expoRange(c.expMinUs, c.expMaxUs))) +
      kv('供电', esc(c.poe == null ? '—' : c.poe ? 'PoE / 12V' : '12V')) +
      kv('典型功耗', esc(c.powerW == null ? '—' : c.powerW + ' W')) +
      kv('最大帧率', esc(c.maxFps) + ' fps') +
      kv('所需带宽', esc(num(c.bandwidthMBps, 2)) + ' MB/s') +
      kv('有效像素精度', esc(n4(c.pxAcc)) + ' mm/px') +
      kv('精度余量', esc(r.margin >= 0 ? pct(r.margin) : '不足')) +
      kv('镜头接口', esc(c.mount) + ' 口') +
      '</div>';
  }

  function lensCard(r) {
    var l = r.lens;
    var lmeta = brandMeta(l.brand);
    var llogo = lmeta ? '<img class="card-brand-logo" src="' + esc(lmeta.logo) + '" alt="' + esc(lmeta.short) + '" style="--logo-scale:' + (lmeta.logoScale || 1) + '" />' : '';
    var icTxt = (l.ic == null ? '大靶面' : l.ic + ' mm') + (l.mp ? '　' + l.mp + 'MP' : '');
    // 转接环：大口径相机经转接环配 C 口镜头
    var camMount = r.camera ? r.camera.mount : '';
    var adapterTxt = l.adapter
      ? '<span class="tag" style="background:#fef3c7;color:#92400e" title="大口径相机经转接环安装 C 口镜头，接环约 12 mm 已计入安装空间">需 ' +
        esc(camMount + '→' + l.mount) + ' 转接环</span>'
      : '';
    // 满足景深的最大光圈：F 数字越小进光量越大；apMaxOk=false 表示最小光圈景深仍不足
    var apTxt = 'F' + l.aperture + (l.apMaxOk
      ? '（景深允许的最大光圈，现场可再收一档保险）'
      : '（已至最小光圈，景深仍不足）');
    var lenTxt = l.len
      ? l.len + ' mm（手册图）' + (l.adapter ? ' + 转接环 ≈12 mm' : '')
      : (l.lenEst != null ? '≈' + l.lenEst + ' mm' + (l.adapter ? '（含转接环）' : '') : '—');
    return '<div class="card lens">' +
      '<div class="card-head"><span class="ico">🔍</span><h3>镜头</h3>' + llogo +
      '<span class="tag">' + esc(l.mount) + ' 口</span>' + adapterTxt + libLink('lens', l.model) + '</div>' +
      '<div class="hero">' + l.f + ' mm<span style="font-size:13px;color:#64748b;font-weight:600"> / F' + l.aperture + '</span></div>' +
      '<div class="hero-sub">' + esc(l.model) + '　·　' + esc(l.brand || '—') + '</div>' +
      kv('镜头系列', esc(l.series)) +
      kv('理论焦距', esc(num(l.fReq, 1)) + ' mm') +
      kv('放大倍率', esc(n4(l.m)) + '×') +
      kv('像面 / 解析力', esc(icTxt)) +
      kv('实际视场', esc(num(l.fovW, 2) + ' × ' + num(l.fovH, 2)) + ' mm') +
      kv('景深', esc(num(l.dof, 2)) + ' mm') +
      kv('满足景深的最大光圈', esc(apTxt)) +
      kv('衍射弥散', esc(num(l.blurPx, 2)) + ' px') +
      kv('光学畸变', esc(l.dist == null ? '—' : num(l.dist, 2) + '%')) +
      kv('镜头总长', esc(lenTxt)) +
      kv('最近摄距', esc(l.minDist != null ? l.minDist + ' m' : '—')) +
      (r.lensAlternates && r.lensAlternates.length
        ? kv('备选镜头', esc(r.lensAlternates.map(function (a) {
          return a.lens + ' ' + a.focal + ' mm' + (a.adapter ? '（转接）' : '');
        }).join('；')) + '<br><span style="color:#94a3b8">均为同一相机下仍满足精度的替代款，可在左栏「同系列参数」点选</span>')
        : '') +
      '</div>';
  }

  function lightCard(r) {
    var g = r.light;
    var gmeta = brandMeta(g.skuBrand);
    var glogo = gmeta ? '<img class="card-brand-logo" src="' + esc(gmeta.logo) + '" alt="' + esc(gmeta.short) + '" style="--logo-scale:' + (gmeta.logoScale || 1) + '" />' : '';
    return '<div class="card light">' +
      '<div class="card-head"><span class="ico">💡</span><h3>光源</h3>' + glogo + '<span class="tag">' + esc(TYPE_TAG[g.type] || '环形') + '</span>' + libLink('light', g.sku) + '</div>' +
      '<div class="hero">' + esc(g.sku || g.seriesName) + '</div>' +
      '<div class="hero-sub">' + swatch(g.color) + esc(g.colorName) + '　' + esc(g.wavelength) + '　·　' +
        esc(g.series) + esc(g.suffix) + '　·　' + esc(g.skuBrand || '—') + '</div>' +
      block('型号构成', esc(g.example) + '<br><span style="color:#94a3b8">' + esc(g.suffixNote) + '</span>') +
      (g.skuNote ? block('选型说明', '<span style="color:#b45309">' + esc(g.skuNote) + '</span>') : '') +
      block('安装 / 打光角度', esc(g.angle)) +
      block('尺寸建议', esc(g.size)) +
      block('配件', esc(g.accessories.length ? g.accessories.join('；') : '无')) +
      block('功率 / 数量',
        esc(g.power == null ? '—' : g.power + ' W × ' + g.count + ' 只 = ' + g.totalPower + ' W')) +
      block('控制器型号', esc(g.controllerModel
        ? g.controllerModel + '（' + g.controllerChannels + ' 通道）'
        : '—') + libLink('ctrl', g.controllerModel)) +
      block('控制方式', esc(g.controller)) +
      (g.skuAlts && g.skuAlts.length
        ? block('备选型号', g.skuAlts.map(function (x) {
          return esc((x.brand ? '[' + x.brand + '] ' : '') + x.model +
            '（' + ((x.size || []).join(' × ')) + ' mm' + (x.power != null ? '，' + x.power + ' W' : '') + '）');
        }).join('<br>') + '<br><span style="color:#94a3b8">同一照明方式下尺寸够用的其他款，可在左栏「同系列参数」点选</span>')
        : '') +
      (g.reasons.length
        ? '<ul class="why">' + g.reasons.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '') +
      '</div>';
  }

  function suggestCard(r) {
    var items = [];
    if (r.profile3D) {
      var d3 = r.profile3D;
      items.push(block('3D 轮廓测量方案（高度 / 平面度 / 段差）',
        '<b>' + esc(d3.model) + '</b>　' + d3.points + ' 点/轮廓　X ' + esc(d3.xRange) + '　Z ' + esc(d3.zRange) +
        '<br>参考距离 ' + esc(d3.ref) + '　Z 重复精度 ' + esc(d3.zRepeat) + '（要求 ≤ ' + num(d3.zReqUm, 1) + ' µm）' +
        '　行频 ' + esc(d3.rate) + '　激光 ' + esc(d3.laser) +
        '　' + libLink('prof', d3.model) +
        '<br><span style="color:#64748b">' + esc(d3.note) + '</span>' +
        (d3.ok ? '' : '<br><span style="color:#b45309">⚠ 参考距离与当前 WD 不完全匹配，见说明</span>')));
    }
    if (r.lineScan) {
      var ls = r.lineScan;
      var optics = ls.optics || {};
      items.push(block('线扫方案（面阵精度不足时）',
        '<b>' + esc(ls.model) + '</b>　' + ls.w + ' 像素　' + ls.lineRate + ' kHz　' + esc(ls.iface) +
        '　' + esc(ls.color) +
        '<br>光学：倍率 ' + num(optics.m, 3) + '×，焦距 ≈ ' + num(optics.f, 1) + ' mm（像面宽 ' + num(optics.sensorW, 1) + ' mm）' +
        (ls.lens
          ? '<br>线扫镜头：<b>' + esc((ls.lens.brand ? '[' + ls.lens.brand + '] ' : '') + ls.lens.model) + '</b>　' +
            esc(ls.lens.focal) + ' mm　' + esc(ls.lens.mount) + ' 口直配　行方向视场 ' + num(ls.lens.fovW, 1) + ' mm' +
            (ls.lens.note ? '<span style="color:#b45309">（' + esc(ls.lens.note) + '）</span>' : '') +
            '　' + libLink('lens', ls.lens.model)
          : '<br>线扫镜头：镜头库中无直配达标型号，需按像面宽度另选') +
        '<br>行频需求 ' + num(ls.needRate, 1) + ' kHz　带宽约 ' + num(ls.bandwidth, 0) + ' MB/s（接口上限 ' + ls.ifaceCap + '）' +
        '<br>线光源：' + (ls.lineLight ? esc(ls.lineLight.model) + '　' + (ls.lineLight.size || []).join(' × ') +
          ' mm　' + (ls.lineLight.power || '—') + ' W' : '—') +
        '<br><span style="color:#64748b">' + esc(ls.note) + '</span>'));
    }
    if (r.telecentric) {
      var t = r.telecentric;
      items.push(block('远心镜头（高精度 / 景深不足时）',
        '<b>' + esc(t.series) + '</b>　倍率 ' + num(t.mag, 3) + '×　工作距离 ' + t.wdMin + '~' + t.wdMax + ' mm　' +
        (t.feasible ? '<span class="ok-mark">当前 WD 可用</span>' : '<span style="color:#b91c1c">当前 WD 不在区间</span>') +
        '<br>景深估算 ' + num(t.dofEst, 2) + ' mm（按 F8 估）　卡口 ' + esc(t.mount) +
        (t.coax ? '　可扩展同轴光' : '') +
        '<br><span style="color:#64748b">' + esc(t.note) + '</span>'));
    }
    if (!items.length) return '';
    return '<div class="card"><h2 class="sec">扩展建议 <span class="hint">主方案之外的升级路径</span></h2>' +
      items.join('') + '</div>';
  }

  /** 同系列参数表：当前型号高亮，便于换一档/换焦距 */
  function siblingCard(r) {
    var s = r.siblings;
    if (!s) return '';

    function table(headers, rows) {
      return '<table class="mini"><thead><tr>' +
        headers.map(function (h) { return '<th' + (h.align ? ' style="text-align:' + h.align + '"' : '') + '>' + esc(h.t) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    var camRows = s.camera.items.map(function (x) {
      var dmodel = (x.brand ? x.brand + '::' : '') + x.model;
      return '<tr class="' + (x.cur ? 'cur' : '') + '" data-kind="camera" data-model="' + esc(dmodel) + '" title="点击手动指定这台相机">' +
        '<td class="mono">' + brandMiniHtml(x.brand) + esc(x.model) + '</td>' +
        '<td>' + x.megs + 'MP</td>' +
        '<td>' + x.w + '×' + x.h + '</td>' +
        '<td>' + x.fps + ' fps</td>' +
        '<td>' + (x.meets ? '<span class="ok-mark">✓</span>' + (x.alt && !x.cur ? '<span class="alt-mark">备选</span>' : '') : '<span class="bad-mark">—</span>') + '</td>' +
        '</tr>';
    }).join('');

    var lensRows = s.lens.items.map(function (x) {
      var dmodel = (x.brand ? x.brand + '::' : '') + x.model;
      return '<tr class="' + (x.cur ? 'cur' : '') + '" data-kind="lens" data-model="' + esc(dmodel) + '" title="点击手动指定这支镜头">' +
        '<td class="mono">' + brandMiniHtml(x.brand) + esc(x.model) + (x.alt && !x.cur ? '<span class="alt-mark">备选</span>' : '') + '</td>' +
        '<td>' + x.focal + ' mm</td>' +
        '<td>' + (x.ic == null ? '—' : x.ic + ' mm') + '</td>' +
        '<td>' + (x.minDist == null ? '—' : x.minDist + ' m') + '</td>' +
        '<td>' + (x.dist == null ? '—' : num(x.dist, 2) + '%') + '</td>' +
        '</tr>';
    }).join('');

    // 镜头跨品牌等价替换：同卡口 + 焦距接近 + 与当前相机光学匹配的其他品牌镜头
    var lensCrossRows = (s.lens.crossBrand || []).map(function (x) {
      var dmodel = (x.brand ? x.brand + '::' : '') + x.model;
      return '<tr class="' + (x.cur ? 'cur' : '') + '" data-kind="lens" data-model="' + esc(dmodel) + '" title="点击手动指定这支（跨品牌）镜头">' +
        '<td class="mono">' + brandMiniHtml(x.brand) + esc(x.model) + (x.alt && !x.cur ? '<span class="alt-mark">备选</span>' : '') + '</td>' +
        '<td>' + x.focal + ' mm</td>' +
        '<td>' + (x.ic == null ? '—' : x.ic + ' mm') + '</td>' +
        '<td>' + (x.minDist == null ? '—' : x.minDist + ' m') + '</td>' +
        '<td>' + (x.dist == null ? '—' : num(x.dist, 2) + '%') + '</td>' +
        '</tr>';
    }).join('');

    var lightRows = s.light.items.map(function (x) {
      return '<tr class="' + (x.cur ? 'cur' : '') + '" data-kind="light" data-model="' + esc(x.model) + '" title="点击手动指定这个光源">' +
        '<td class="mono">' + brandMiniHtml(x.brand) + esc(x.model) + (x.alt && !x.cur ? '<span class="alt-mark">备选</span>' : '') + '</td>' +
        '<td>' + (x.size && x.size.length ? x.size.join(' × ') + ' mm' : '—') + '</td>' +
        '</tr>';
    }).join('');

    // 跨品牌等价替换：同分辨率 + 同接口 + 同彩色，不同品牌（点选即手动指定 品牌::型号）
    var crossRows = (s.camera.crossBrand || []).map(function (x) {
      var dmodel = (x.brand ? x.brand + '::' : '') + x.model;
      return '<tr class="' + (x.cur ? 'cur' : '') + '" data-kind="camera" data-model="' + esc(dmodel) + '" title="点击手动指定这台（跨品牌）相机">' +
        '<td class="mono">' + brandMiniHtml(x.brand) + esc(x.model) + '</td>' +
        '<td>' + x.megs + 'MP</td>' +
        '<td>' + x.fps + ' fps</td>' +
        '<td>' + (x.meets ? '<span class="ok-mark">✓</span>' + (x.alt && !x.cur ? '<span class="alt-mark">备选</span>' : '') : '<span class="bad-mark">—</span>') + '</td>' +
        '</tr>';
    }).join('');

    var camBlockInner = table([{ t: '型号' }, { t: '像素' }, { t: '分辨率' }, { t: '帧率' }, { t: '够用?', align: 'center' }], camRows);
    if (s.camera.crossTotal > 0) {
      camBlockInner += '<div class="sib-sub"><div class="sib-sub-h">跨品牌等价替换（同分辨率 · 同接口 · 同彩色）</div>' +
        table([{ t: '品牌 / 型号' }, { t: '像素' }, { t: '帧率' }, { t: '够用?', align: 'center' }], crossRows) + '</div>';
    }

    var lensBlockInner = table([{ t: '型号' }, { t: '焦距' }, { t: '像面' }, { t: '最近摄距' }, { t: '畸变' }], lensRows);
    if (s.lens.crossTotal > 0) {
      lensBlockInner += '<div class="sib-sub"><div class="sib-sub-h">跨品牌等价替换（同卡口 · 焦距接近 · 适配当前相机）</div>' +
        table([{ t: '品牌 / 型号' }, { t: '焦距' }, { t: '像面' }, { t: '最近摄距' }, { t: '畸变' }], lensCrossRows) + '</div>';
    }

    function blk(title, cnt, inner) {
      return '<div class="sib-block"><h4>' + esc(title) +
        '<span class="cnt">共 ' + cnt + ' 个</span>' +
        '</h4><div class="sib-scroll">' + inner + '</div></div>';
    }

    // 手动指定状态条
    var m = r.manual || {};
    var pills = [];
    if (m.camera) pills.push('相机 ' + (r.camera.brand ? '[' + esc(r.camera.brand) + '] ' : '') + esc(r.camera.model));
    if (m.lens) pills.push('镜头 ' + (r.lens.brand ? '[' + esc(r.lens.brand) + '] ' : '') + esc(r.lens.model));
    if (m.light) pills.push('光源 ' + esc(r.light.sku || ''));
    var bar = '<div class="sib-manual">' +
      (pills.length
        ? '<span>已手动指定：</span>' + pills.map(function (t) { return '<span class="pill">' + t + '</span>'; }).join('') +
          '<button type="button" data-action="auto">恢复自动选型</button>'
        : '<span>点击下面任意型号可手动指定，再点一次取消；高亮行为当前方案。</span>') +
      '</div>';

    // 相机块标题标注当前品牌（同系列面板内机型一般同品牌，跨品牌机型见下方“跨品牌等价替换”）
    var camBrandShort = (brandMeta(r.camera.brand) || {}).short || '';

    return '<div class="card"><h2 class="sec">同系列参数 <span class="hint">点型号即可手动指定</span></h2>' +
      bar +
      '<div class="sib-grid">' +
      blk('相机　' + s.camera.label + (camBrandShort ? ' · ' + camBrandShort : ''), s.camera.total, camBlockInner) +
      blk('镜头　' + s.lens.label, s.lens.total, lensBlockInner) +
      blk('光源　' + s.light.label, s.light.total,
        table([{ t: '型号' }, { t: '尺寸' }], lightRows)) +
      '</div>' +
      '<div class="sib-note">「够用?」表示该型号单看像素数是否满足当前需求；实际能否用还要看镜头、景深与带宽。' +
      '标了<span class="alt-mark">备选</span>的属于还走得通的另一条路——备选方案的相机、同一台相机下另一支仍达标的镜头、' +
      '同一照明方式下另一款尺寸够用的灯具，点它即可切换比较。' +
      '型号已全部列出，表内可滚动浏览；手动指定后若精度或视场不达标，风险区会给出提示。</div>' +
      '</div>';
  }

  /** 把每个列表滚动到当前型号附近 */
  function scrollSiblingsToCurrent() {
    Array.prototype.forEach.call(document.querySelectorAll('#siblings .sib-scroll'), function (box) {
      var cur = box.querySelector('tr.cur');
      if (!cur) return;
      var top = cur.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTop = Math.max(0, top - box.clientHeight / 2 + cur.offsetHeight / 2);
    });
  }


  /* ---------------- 选型依据（与次优对比） ---------------- */
  function rationaleCard(r) {
    var q = r.rationale;
    if (!q) return '';
    var head = '<div class="rationale"><div class="why-title">选型依据 <span class="hint">与次优方案逐项对比</span></div>';
    if (q.manual || q.none) {
      return head + '<div class="why-sum">' + esc(q.note) + '</div></div>';
    }
    var rows = q.rows.map(function (x) {
      var cls = x.cmp === 'win' ? 'cmp-win' : (x.cmp === 'lose' ? 'cmp-lose' : 'cmp-tie');
      return '<tr><td>' + esc(x.k) + '</td><td class="' + cls + '">' + esc(x.a) + '</td><td>' + esc(x.b) + '</td></tr>';
    }).join('');
    return head +
      '<div class="why-sum">' + esc(q.summary) + '</div>' +
      '<table class="mini wrap why-table"><thead><tr><th>项目</th><th>本方案</th><th>次优（' + esc(q.altCamera) + '）</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="sib-note">次优方案的镜头为 ' + esc(q.altLens) +
      '；两项硬指标持平时，按「像素更少 → 接口更常用 → 镜头可直连」的次序取舍。分数口径与上方匹配度一致。</div></div>';
  }

  /* ---------------- 现场参数建议 ---------------- */
  function siteCard(r) {
    var s = r.site;
    if (!s) return '';
    var rows = [];
    rows.push(['光圈', 'F' + s.aperture.value, s.aperture.note]);
    var exp = s.exposure;
    rows.push(['曝光',
      '起 ' + num(exp.startMs, 3) + ' ms' + (exp.upperMs == null ? '（静态不限）' : '（上限 ' + num(exp.upperMs, 3) + ' ms）'),
      exp.note]);
    rows.push(['增益', '0 dB',
      '先用照度与曝光把灰度做到 70–80%；增益只在亮度不足时小幅加（≤ 6 dB），加太多噪点会吃掉亚像素精度']);
    rows.push(['触发', s.trigger.mode, s.trigger.note]);
    if (s.light) {
      rows.push(['光源调光',
        (s.light.mode || '') + (s.light.controller ? ' · ' + s.light.controller : '') +
          (s.light.channels ? '（' + s.light.channels + ' 通道）' : ''),
        s.light.note]);
    }
    var body = rows.map(function (x) {
      return '<tr><td class="nw">' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td class="unit" style="white-space:normal">' + esc(x[2]) + '</td></tr>';
    }).join('');
    return '<table class="mini wrap"><thead><tr><th>项目</th><th>建议设置</th><th>说明</th></tr></thead><tbody>' +
      body + '</tbody></table>' +
      '<div class="sib-note">给的是「可照抄的起始值」，不是最终参数：现场用直方图与标准件微调后固定下来，并记录在设备参数表里。</div>';
  }

  /* ---------------- 安装与配套清单 ---------------- */
  function installCard(r) {
    var k = r.install;
    if (!k) return '';
    var body = k.items.map(function (x) {
      return '<tr><td class="nw">' + esc(x.name) + '</td><td>' + esc(x.value) + '</td>' +
        '<td class="unit" style="white-space:normal">' + esc(x.note) + '</td></tr>';
    }).join('');
    var spaceTag = k.pass == null
      ? '<span class="hint">未填可用安装空间，只列尺寸链</span>'
      : (k.pass
        ? '<span class="tag ok">尺寸链放得下</span>'
        : '<span class="tag bad">超出 ' + num(k.needAll - k.available, 0) + ' mm</span>');
    return '<div class="space-line">含支架与调整余量共计 <b>≈ ' + num(k.needAll, 0) + ' mm</b>　' + spaceTag + '</div>' +
      '<table class="mini wrap"><thead><tr><th>项目</th><th>配置</th><th>说明</th></tr></thead><tbody>' +
      body + '</tbody></table>';
  }

  /* ---------------- 验收与复核清单 ---------------- */
  function acceptCard(r) {
    var a = r.acceptance;
    if (!a) return '';
    var body = a.items.map(function (x) {
      return '<tr><td class="nw">' + esc(x.name) + '</td><td>' + esc(x.target) + '</td>' +
        '<td class="unit" style="white-space:normal">' + esc(x.method) + '</td></tr>';
    }).join('');
    var focus = a.focus.length
      ? '<ul class="why">' + a.focus.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
      : '';
    return '<table class="mini wrap"><thead><tr><th>检查项</th><th>验收指标</th><th>测法</th></tr></thead><tbody>' +
      body + '</tbody></table>' + focus +
      '<div class="sib-note">验收顺序：先机械与打光（图像对比度达标）→ 再标定 → 最后测重复性与偏差；任何一项不达标先回查上一环节。</div>';
  }

  /* ---------------- 精度预算 ---------------- */
  function budgetCard(r) {
    var b = r.budget;
    if (!b) return '';
    var rows = b.items.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td>' +
        '<td class="num" style="white-space:nowrap">± ' + n4(x.mm) + ' mm</td>' +
        '<td class="unit">' + esc(x.note) + '</td></tr>';
    }).join('');
    var pct = Math.round(b.ratio * 100);
    return '<table class="mini wrap"><thead><tr><th>误差项</th>' +
      '<th style="text-align:right">估算</th><th>说明</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="budget-sum">合成 <b>± ' + n4(b.total) + ' mm</b>' +
      '<span>占像素精度要求 ' + pct + '%</span>' +
      '<span class="tag ' + (b.pass ? 'ok' : 'bad') + '">' + (b.pass ? '满足' : '超限') + '</span></div>' +
      '<div class="sib-note">按均方根合成。实际还受温漂、振动、工件表面特性影响，测量类建议用标准件实测复核。</div>';
  }

  /* ---------------- 光路与安装示意 ---------------- */
  function diagramCard(r) {
    var g = r.geometry;
    if (!g) return '';
    var W = 660, H = 240, ay = 106;
    var total = g.wd + g.lensLen + g.camDepth;
    var x0 = 88, x1 = 600;
    var k = (x1 - x0) / total;
    var xObj = x0;
    var xLens = xObj + g.wd * k;
    var xCam = xLens + g.lensLen * k;
    var xEnd = xCam + g.camDepth * k;
    var fovHalf = Math.max(13, Math.min(46, g.fovH * 0.7));
    var dofHalf = Math.max(2.5, Math.min(32, g.dof * k));

    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="dg" role="img">');
    s.push('<line x1="' + (xObj - 40) + '" y1="' + ay + '" x2="' + (xEnd + 14) + '" y2="' + ay + '" stroke="#cbd5e1" stroke-dasharray="6 5"/>');
    // 工件面
    s.push('<line x1="' + xObj + '" y1="' + (ay - fovHalf - 16) + '" x2="' + xObj + '" y2="' + (ay + fovHalf + 16) + '" stroke="#334155" stroke-width="2.5"/>');
    s.push('<text x="' + (xObj - 6) + '" y="' + (ay - fovHalf - 22) + '" text-anchor="middle" class="dg-xs">工件</text>');
    // 视场标注
    s.push('<line x1="' + (xObj - 30) + '" y1="' + (ay - fovHalf) + '" x2="' + (xObj - 30) + '" y2="' + (ay + fovHalf) + '" stroke="#2563eb" stroke-width="1.2"/>');
    s.push('<text x="' + (xObj - 38) + '" y="' + (ay - 2) + '" text-anchor="end" class="dg-s" fill="#1d4ed8">' + num(g.fovW, 0) + '×' + num(g.fovH, 0) + '</text>');
    s.push('<text x="' + (xObj - 38) + '" y="' + (ay + 14) + '" text-anchor="end" class="dg-xs">视场 mm</text>');
    // 景深带
    s.push('<line x1="' + (xObj - dofHalf) + '" y1="' + (ay + fovHalf + 24) + '" x2="' + (xObj + dofHalf) + '" y2="' + (ay + fovHalf + 24) + '" stroke="#16a34a" stroke-width="2.5"/>');
    s.push('<text x="' + (xObj + dofHalf + 8) + '" y="' + (ay + fovHalf + 28) + '" class="dg-xs" fill="#15803d">景深 ' + num(g.dof, 2) + ' mm</text>');
    // 镜头
    s.push('<path d="M' + xLens + ' ' + (ay - 30) + ' L' + xCam + ' ' + (ay - 24) + ' L' + xCam + ' ' + (ay + 24) + ' L' + xLens + ' ' + (ay + 30) + ' Z" fill="#eff6ff" stroke="#93c5fd"/>');
    s.push('<text x="' + (xLens + (xCam - xLens) / 2) + '" y="' + (ay + 4) + '" text-anchor="middle" class="dg-xs">镜头</text>');
    // 相机
    s.push('<rect x="' + xCam + '" y="' + (ay - 26) + '" width="' + (xEnd - xCam) + '" height="52" rx="4" fill="#f1f5f9" stroke="#94a3b8"/>');
    s.push('<text x="' + (xCam + (xEnd - xCam) / 2) + '" y="' + (ay + 4) + '" text-anchor="middle" class="dg-xs">相机</text>');
    // WD 尺寸线
    s.push('<line x1="' + xObj + '" y1="' + (ay + 74) + '" x2="' + xLens + '" y2="' + (ay + 74) + '" stroke="#475569"/>');
    s.push('<line x1="' + xObj + '" y1="' + (ay + 68) + '" x2="' + xObj + '" y2="' + (ay + 80) + '" stroke="#475569"/>');
    s.push('<line x1="' + xLens + '" y1="' + (ay + 68) + '" x2="' + xLens + '" y2="' + (ay + 80) + '" stroke="#475569"/>');
    s.push('<text x="' + (xObj + (xLens - xObj) / 2) + '" y="' + (ay + 94) + '" text-anchor="middle" class="dg-s">WD ' + num(g.wd, 0) + ' mm</text>');
    // 光源
    if (g.lightType === 'backlight') {
      s.push('<rect x="' + (xObj - 46) + '" y="' + (ay - fovHalf - 8) + '" width="10" height="' + (fovHalf * 2 + 16) + '" fill="#dbeafe" stroke="#93c5fd" rx="2"/>');
      s.push('<text x="' + (xObj - 50) + '" y="' + (ay + fovHalf + 30) + '" text-anchor="end" class="dg-xs" fill="#1d4ed8">背光</text>');
    } else if (g.lightType === 'coaxial') {
      s.push('<path d="M' + xLens + ' ' + (ay - 7) + ' L' + xObj + ' ' + (ay - fovHalf) + ' L' + xObj + ' ' + (ay + fovHalf) + ' L' + xLens + ' ' + (ay + 7) + ' Z" fill="rgba(37,99,235,.10)"/>');
      s.push('<text x="' + (xLens - 8) + '" y="' + (ay - 34) + '" text-anchor="end" class="dg-xs" fill="#1d4ed8">同轴光</text>');
    } else if (g.lightType === 'dome') {
      s.push('<path d="M' + (xObj + 4) + ' ' + (ay - fovHalf - 12) + ' Q' + (xObj + 92) + ' ' + (ay - 96) + ' ' + (xLens - 6) + ' ' + (ay - 30) + '" fill="none" stroke="#93c5fd" stroke-width="1.5" stroke-dasharray="5 4"/>');
      s.push('<text x="' + (xObj + 16) + '" y="' + (ay - 88) + '" class="dg-xs" fill="#1d4ed8">穹顶光</text>');
    } else {
      s.push('<line x1="' + (xObj + 6) + '" y1="' + (ay + fovHalf + 54) + '" x2="' + (xObj + 64) + '" y2="' + (ay + fovHalf - 2) + '" stroke="#f59e0b" stroke-width="1.6" stroke-dasharray="5 3"/>');
      s.push('<line x1="' + (xObj + 34) + '" y1="' + (ay + fovHalf + 54) + '" x2="' + (xObj + 84) + '" y2="' + (ay + fovHalf - 2) + '" stroke="#f59e0b" stroke-width="1.6" stroke-dasharray="5 3"/>');
      s.push('<text x="' + (xObj + 2) + '" y="' + (ay + fovHalf + 70) + '" class="dg-xs" fill="#b45309">' +
        (g.lightType === 'bar_low' ? '条形光 低角度' : '环形光 ' + g.lightAngle + '°') + '</text>');
    }
    // 总长
    var sp = r.space;
    s.push('<text x="' + x0 + '" y="' + (H - 10) + '" class="dg-xs">总长 ≈ ' + num(sp.need, 0) + ' mm（WD + 镜头 ' +
      sp.lensLen + ' + 相机 ' + sp.camDepth + ' + 线缆 ' + sp.cable + '）</text>');
    s.push('</svg>');

    var spaceLine = '<div class="space-line">' +
      (sp.available
        ? '可用 ' + num(sp.available, 0) + ' mm　<span class="tag ' + (sp.pass ? 'ok' : 'bad') + '">' +
          (sp.pass ? '放得下' : '超出 ' + num(sp.over, 0) + ' mm') + '</span>'
        : '<span class="hint">未填可用安装空间，仅列出总长</span>') +
      '</div>' +
      '<div class="sib-note">相机厚度取自官方外形尺寸' +
      (sp.estimated ? '（该型号缺尺寸，按 45 mm 估）' : '') +
      '；镜头长度' + (sp.lensLenReal ? '取自手册外形尺寸图' : '按系列典型值估算') +
      (sp.adapter ? '（另加转接环 12 mm）' : '') +
      '；线缆与接插件预留 25 mm。</div>';

    return s.join('') + spaceLine;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!E || !CAT) {
      $('stateChip').className = 'tag bad';
      $('stateChip').textContent = '加载失败';
      $('summary').innerHTML = '<span style="color:#b91c1c">型号库或引擎未加载：请确认 hikrobot-catalog.js 与 engine.js 在同一目录。</span>';
      return;
    }

    var r = E.solve(readInput());
    var comboLink = $('comboLink');
    if (comboLink) comboLink.href = comboLinkHref();

    if (!r.ok) {
      $('scoreNum').innerHTML = '--<small>/100</small>';
      $('scoreBar').style.width = '0%';
      $('stateChip').className = 'tag bad';
      $('stateChip').textContent = '输入有误';
      $('summary').innerHTML = '<span style="color:#b91c1c">' + esc(r.error) + '</span>';
      $('scoreItems').innerHTML = '';
      $('rationale').innerHTML = '';
      $('cards').innerHTML = '';
      $('bom').innerHTML = '';
      $('calcBody').innerHTML = '';
      $('risks').innerHTML = '';
      $('riskCount').textContent = '';
      $('site').innerHTML = '';
      $('install').innerHTML = '';
      $('accept').innerHTML = '';
      return;
    }

    $('scoreNum').innerHTML = r.score + '<small>/100</small>';
    $('scoreBar').style.width = r.score + '%';
    $('stateChip').className = 'tag ' + (r.feasible ? 'ok' : 'bad');
    $('stateChip').textContent = r.feasible ? '方案可行' : '需升级方案';
    $('summary').innerHTML = esc(r.summary);
    $('scoreItems').innerHTML = scoreItemsHtml(r);
    $('rationale').innerHTML = rationaleCard(r);

    $('cards').innerHTML = camCard(r) + lensCard(r) + lightCard(r);
    $('bom').innerHTML = bomCard(r);
    $('suggest').innerHTML = suggestCard(r);
    $('siblings').innerHTML = siblingCard(r);
    scrollSiblingsToCurrent();
    $('site').innerHTML = siteCard(r);
    $('install').innerHTML = installCard(r);
    $('accept').innerHTML = acceptCard(r);
    $('budget').innerHTML = budgetCard(r);
    $('diagram').innerHTML = diagramCard(r);

    var byBrand = {};
    CAT.CAMERAS.forEach(function (c) { var b = c.brand || '未知'; byBrand[b] = (byBrand[b] || 0) + 1; });
    var bLogos = Object.keys(BRANDS).filter(function (k) {
      return activeBrands.indexOf(k) >= 0 && window[BRANDS[k].global];
    }).map(function (k) {
      return '<img src="' + esc(BRANDS[k].logo) + '" alt="' + esc(BRANDS[k].short) + '" style="--logo-scale:' + (BRANDS[k].logoScale || 1) + ';height:calc(13px * var(--logo-scale,1));vertical-align:-1px;margin-right:6px" />';
    }).join('');
    var bCounts = Object.keys(byBrand).map(function (b) { return esc(b) + ' ' + byBrand[b] + ' 台'; }).join('、');
    var lensByBrand = {};
    CAT.LENSES.forEach(function (l) { var b = l.brand || '未知'; lensByBrand[b] = (lensByBrand[b] || 0) + 1; });
    var lensTxt = Object.keys(lensByBrand).map(function (b) { return esc(b) + ' ' + lensByBrand[b] + ' 支'; }).join('、');
    var lightByBrand = {};
    ((CAT && CAT.LIGHTS) || []).forEach(function (l) { var b = l.brand || '未知'; lightByBrand[b] = (lightByBrand[b] || 0) + 1; });
    var lightTxt = Object.keys(lightByBrand).map(function (b) { return esc(b) + ' ' + lightByBrand[b] + ' 款'; }).join('、');
    // 数据健康度：靶面/传感器标注覆盖率（缺字段机型在方案卡按“估算”展示，不影响选型）
    var nCam = CAT.CAMERAS.length || 1;
    var sizeCov = CAT.CAMERAS.filter(function (c) { return c.size; }).length;
    var sensorCov = CAT.CAMERAS.filter(function (c) { return c.sensor; }).length;
    $('catalogNote').innerHTML =
      bLogos +
      '已启用型号库：<b>' + bCounts + '</b>　' +
      '面阵合计 <b>' + CAT.CAMERAS.length + '</b> 台（含板级 ' + CAT.CAMERAS.filter(function (c) { return c.kind === 'board'; }).length + '）、' +
      '线扫 <b>' + (CAT.LINESCAN || []).length + '</b> 台、镜头 <b>' + CAT.LENSES.length + '</b> 支（' + lensTxt + '）、' +
      '远心 <b>' + (CAT.TELECENTRIC || []).length + '</b> 个系列、光源 <b>' + (CAT.LIGHTS || []).length + '</b> 款（' + lightTxt + '）、' +
      '控制器 <b>' + (CAT.CONTROLLERS || []).length + '</b> 款。<br>' +
      '<span style="color:#94a3b8">靶面标注覆盖率 ' + Math.round(sizeCov / nCam * 100) + '%、传感器型号覆盖率 ' + Math.round(sensorCov / nCam * 100) +
      '%（缺项按 sw/sh 推导显示“估算”，不影响选型计算）。本项目为非官方选型辅助工具；各品牌标识仅用于标注数据来源，归各自权利人所有。</span>';

    $('calcBody').innerHTML = r.calc.map(function (x) {
      return '<tr><td>' + esc(x.step) + '</td>' +
        '<td class="mono">' + esc(x.formula) + '</td>' +
        '<td class="num">' + esc(x.value) + '</td>' +
        '<td class="unit">' + esc(x.unit) + '</td></tr>';
    }).join('');

    var risks = r.warnings.length
      ? r.warnings.map(function (w) {
          return '<div class="risk ' + (w.level === 'warn' ? 'warn' : 'info') + '">' +
            '<i class="dot"></i><div>' + esc(w.text) + '</div></div>';
        }).join('')
      : '<div class="risk good"><i class="dot"></i><div>未发现明显风险项：精度、景深、曝光、带宽均在合理余量内。</div></div>';

    $('risks').innerHTML = risks;
    var warns = r.warnings.filter(function (w) { return w.level === 'warn'; }).length;
    $('riskCount').textContent = warns > 0 ? warns + ' 项需注意' : '全部通过';

    // 移动端（仿小程序）：更新表单摘要 / 折叠方案卡 / 刷新分段高亮
    var fs = [];
    fs.push('视野 ' + r.input.fovW + '×' + r.input.fovH + 'mm');
    fs.push('精度 ' + r.input.precision + 'mm');
    fs.push(r.task.label);
    fs.push('WD ' + r.input.wd + 'mm');
    if (r.input.needColor) fs.push('彩色');
    if (r.input.speed > 0) fs.push(r.input.speed + 'mm/s');
    if (r.input.lineScanFirst) fs.push('优先线扫');
    $('fsTxt').textContent = fs.join(' · ');
    foldCards();
    updateSegbar();
  }

  /* ---------------- 复制方案 ---------------- */
  /* 移动端（仿小程序）：分段导航锚点 / 滚动高亮 / 方案卡折叠后处理（render 与 init 共用） */
  var SEGS = { form: '#sec-form', sol: '[data-anchor="sol"]', sib: '[data-anchor="sib"]', calc: '[data-anchor="calc"]', risk: '[data-anchor="risk"]' };
  function updateSegbar() {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    var best = null, bestTop = -1e9;
    Object.keys(SEGS).forEach(function (k) {
      var el = document.querySelector(SEGS[k]);
      if (!el) return;
      var top = el.getBoundingClientRect().top;
      if (top <= 60 && top > bestTop) { bestTop = top; best = k; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (s) {
      s.classList.toggle('on', s.getAttribute('data-seg') === best);
    });
  }
  function foldCards() {
    Array.prototype.forEach.call(document.querySelectorAll('#cards .card'), function (card) {
      if (card.querySelector('.sol-toggle')) return;
      var kvs = card.querySelectorAll('.kv'), blocks = card.querySelectorAll('.kv-block');
      if (kvs.length + blocks.length < 8) return;
      Array.prototype.forEach.call(kvs, function (kv, i) { if (i >= 6) kv.classList.add('kv-extra'); });
      Array.prototype.forEach.call(blocks, function (b, j) { if (j >= 3) b.classList.add('kv-extra'); });
      var t = document.createElement('div');
      t.className = 'sol-toggle';
      t.textContent = '展开全部参数 ▾';
      card.appendChild(t);
    });
  }
  function buildText() {
    var r = E.solve(readInput());
    if (!r.ok) return '【机器视觉选型】输入有误：' + r.error;

    var c = r.camera, l = r.lens, g = r.light;
    var lines = [];
    lines.push('【机器视觉选型方案】');
    lines.push(r.summary);
    if (r.scoreItems && r.scoreItems.length) {
      lines.push('· 扣分项：' + r.scoreItems.map(function (x) {
        return x.label + ' −' + x.penalty + (x.detail ? '（' + x.detail + '）' : '');
      }).join('；'));
    }
    lines.push('');
    lines.push('· 任务：' + r.task.label + '（每特征 ' + r.task.k + ' 像素）');
    lines.push('· 相机：' + (c.brand ? '[' + c.brand + '] ' : '') + c.model + '（' + c.series + '）');
    lines.push('　 ' + c.w + '×' + c.h + '，' + c.color + '，' + c.shutter + '，' + c.sw + '×' + c.sh + 'mm 靶面，像元 ' + c.pxUm + 'µm，' + c.mount + ' 口');
    lines.push('　 接口 ' + c.interface + '，最大 ' + c.maxFps + 'fps，所需带宽 ' + num(c.bandwidthMBps, 2) + 'MB/s');
    lines.push('　 动态范围 ' + (c.dr == null ? '—' : c.dr + 'dB') + '，信噪比 ' + (c.snr == null ? '—' : c.snr + 'dB') +
      '，曝光 ' + expoRange(c.expMinUs, c.expMaxUs) + '，' + (c.poe ? '支持 PoE' : '12V 供电'));
    lines.push('　 有效像素精度 ' + n4(c.pxAcc) + 'mm/px，可辨最小特征 ' + n4(c.capability) + 'mm');
    lines.push('· 镜头：' + (l.brand ? '[' + l.brand + '] ' : '') + l.model + '（' + l.series + '）');
    lines.push('　 ' + l.f + 'mm F' + l.aperture + (l.apMaxOk ? '（满足景深的最大光圈）' : '（最小光圈，景深仍不足）') +
      '，放大倍率 ' + n4(l.m) + '×，实际视场 ' +
      num(l.fovW, 2) + '×' + num(l.fovH, 2) + 'mm，景深 ' + num(l.dof, 2) + 'mm');
    lines.push('　 像面 ' + (l.ic == null ? '大靶面' : l.ic + 'mm') + '，解析力 ' + (l.mp ? l.mp + 'MP' : '—') + '，' + l.mount + ' 口' +
      (l.adapter ? '（需 ' + r.camera.mount + '→' + l.mount + ' 转接环，约 12mm）' : ''));
    if (r.lensAlternates && r.lensAlternates.length) {
      lines.push('　 备选镜头：' + r.lensAlternates.map(function (a) {
        return a.lens + ' ' + a.focal + 'mm' + (a.adapter ? '（转接）' : '');
      }).join('；'));
    }
    lines.push('· 光源：' + (g.skuBrand ? '[' + g.skuBrand + '] ' : '') + (g.sku || g.series) + '（' + g.seriesName + '），' + g.colorName + ' ' + g.wavelength + '（后缀 ' + g.suffix + '）');
    lines.push('　 型号构成：' + g.example);
    if (g.skuNote) lines.push('　 选型说明：' + g.skuNote);
    lines.push('　 安装：' + g.angle);
    lines.push('　 尺寸：' + g.size);
    lines.push('　 配件：' + (g.accessories.length ? g.accessories.join('；') : '无'));
    lines.push('　 控制：' + g.controller);
    if (g.power != null) {
      lines.push('　 功率：' + g.power + ' W × ' + g.count + ' 只 = ' + g.totalPower + ' W' +
        (g.controllerModel ? '；控制器 ' + g.controllerModel + '（' + g.controllerChannels + ' 通道）' : ''));
    }
    if (g.skuAlts && g.skuAlts.length) {
      lines.push('　 备选光源：' + g.skuAlts.map(function (x) {
        return (x.brand ? '[' + x.brand + '] ' : '') + x.model +
          '（' + (x.size || []).join('×') + 'mm' + (x.power != null ? '，' + x.power + 'W' : '') + '）';
      }).join('；'));
    }
    if (r.lineScan) {
      var ls = r.lineScan;
      lines.push('');
      lines.push('· 扩展建议（线扫）：' + ls.model + '　' + ls.w + ' 像素　' + ls.lineRate + 'kHz　' + ls.iface);
      lines.push('　 光学：倍率 ' + n4(ls.optics.m) + '×，焦距 ≈ ' + num(ls.optics.f, 1) + 'mm（像面宽 ' + num(ls.optics.sensorW, 1) + 'mm）');
      if (ls.lens) lines.push('　 线扫镜头：' + (ls.lens.brand ? '[' + ls.lens.brand + '] ' : '') + ls.lens.model +
        '（' + ls.lens.focal + 'mm ' + ls.lens.mount + ' 口直配，行方向视场 ' + num(ls.lens.fovW, 1) + 'mm）' +
        (ls.lens.note ? ' ' + ls.lens.note : ''));
      else lines.push('　 线扫镜头：库中无直配达标型号，需按像面宽度另选');
      lines.push('　 行频需求 ' + num(ls.needRate, 1) + 'kHz，带宽约 ' + num(ls.bandwidth, 0) + 'MB/s（上限 ' + ls.ifaceCap + '）');
      if (ls.lineLight) lines.push('　 线光源：' + ls.lineLight.model + '　' + (ls.lineLight.size || []).join('×') + 'mm');
      lines.push('　 ' + ls.note);
    }
    if (r.profile3D) {
      var d3c = r.profile3D;
      lines.push('');
      lines.push('· 扩展建议（3D 轮廓）：' + d3c.model + '　' + d3c.points + ' 点/轮廓　X ' + d3c.xRange + '　Z ' + d3c.zRange);
      lines.push('　 参考距离 ' + d3c.ref + '，Z 重复精度 ' + d3c.zRepeat + '（要求 ≤ ' + num(d3c.zReqUm, 1) + 'µm），行频 ' + d3c.rate + '，激光 ' + d3c.laser);
      lines.push('　 ' + d3c.note);
    }
    if (r.telecentric) {
      var t = r.telecentric;
      lines.push('');
      lines.push('· 扩展建议（远心）：' + t.series + ' 系列，倍率 ' + n4(t.mag) + '×，工作距离 ' + t.wdMin + '~' + t.wdMax + 'mm' +
        (t.feasible ? '（当前 WD 可用）' : '（当前 WD 不在区间，需调整）'));
      lines.push('　 景深估算 ' + num(t.dofEst, 2) + 'mm（F8）');
      lines.push('　 ' + t.note);
    }
    lines.push('');
    lines.push('· 方案清单（BOM）：');
    bomRows(r).forEach(function (x) {
      lines.push('　' + x.catName + '：' + (x.brand ? '[' + x.brand + '] ' : '') + x.model +
        ' × ' + x.qty + (x.spec ? '　' + x.spec : ''));
    });
    if (r.rationale && r.rationale.rows) {
      lines.push('');
      lines.push('· 选型依据：');
      lines.push('　' + r.rationale.summary);
      r.rationale.rows.forEach(function (x) {
        lines.push('　' + x.k + '：本方案 ' + x.a + '　| 次优 ' + x.b);
      });
    } else if (r.rationale && r.rationale.note) {
      lines.push('');
      lines.push('· 选型依据：' + r.rationale.note);
    }
    if (r.site) {
      var st = r.site;
      lines.push('');
      lines.push('· 现场参数建议：');
      lines.push('　 光圈 F' + st.aperture.value + '：' + st.aperture.note);
      lines.push('　 曝光 起 ' + num(st.exposure.startMs, 3) + ' ms' +
        (st.exposure.upperMs == null ? '（静态不限）' : '（上限 ' + num(st.exposure.upperMs, 3) + ' ms）') +
        '：' + st.exposure.note);
      lines.push('　 增益 0 dB：先用照度与曝光把灰度做到 70–80%，增益只在不足时小幅加（≤ 6 dB）');
      lines.push('　 触发 ' + st.trigger.mode + '：' + st.trigger.note);
      if (st.light) lines.push('　 调光：' + st.light.note);
    }
    if (r.install) {
      lines.push('');
      lines.push('· 安装与配套清单：');
      r.install.items.forEach(function (x) {
        lines.push('　' + x.name + '：' + x.value + (x.note ? '（' + x.note + '）' : ''));
      });
    }
    if (r.acceptance) {
      lines.push('');
      lines.push('· 验收与复核清单：');
      r.acceptance.items.forEach(function (x) {
        lines.push('　' + x.name + '：' + x.target + '　→ ' + x.method);
      });
      r.acceptance.focus.forEach(function (x) { lines.push('　重点：' + x); });
    }
    if (r.warnings.length) {
      lines.push('');
      lines.push('· 风险与建议：');
      r.warnings.forEach(function (w) {
        lines.push('　[' + (w.level === 'warn' ? '注意' : '提示') + '] ' + w.text);
      });
    }
    lines.push('');
    lines.push('· 验算：');
    r.calc.forEach(function (x) {
      lines.push('　' + x.step + ': ' + x.formula + ' = ' + x.value + ' ' + x.unit);
    });
    return lines.join('\n');
  }

  function copyText() {
    var txt = buildText();
    // 移动端：弹底部抽屉展示方案文本（长按可选中复制），桌面保持直接写剪贴板
    if (window.matchMedia('(max-width: 760px)').matches) {
      var pm = document.getElementById('pMask');
      if (pm) {
        document.getElementById('pText').textContent = txt;
        pm.classList.add('show');
        return;
      }
    }
    var btn = $('copyBtn');
    var done = function () {
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = '复制方案文本'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else {
      fallbackCopy(txt, done);
    }
  }

  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  /** 从 URL 读取表单参数，便于把具体需求发给别人 */
  function fromQuery() {
    var q = {};
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space'].forEach(function (k) {
      var m = new RegExp('[?&]' + k + '=([\\d.]+)').exec(location.search);
      if (m) q[k] = parseFloat(m[1]);
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      var m = new RegExp('[?&]' + k + '=([a-zA-Z_]+)').exec(location.search);
      if (m) q[k] = m[1];
    });
    if (/[?&]needColor=1\b/.test(location.search)) q.needColor = true;
    return q;
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    renderBrandFilter();
    renderLensFilter();
    fillSelects();

    Array.prototype.forEach.call(document.querySelectorAll('input, select'), function (el) {
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = PRESETS[btn.getAttribute('data-preset')];
        if (p) applyState(p);
      });
    });

    $('resetBtn').addEventListener('click', function () { applyState(DEFAULT); });
    $('copyBtn').addEventListener('click', copyText);

    /* ---------------- 仿小程序移动端交互 ---------------- */
    var mqMobile = window.matchMedia('(max-width: 760px)');

    // 1) 表单摘要条：点「✎ 修改需求」展开 / 收起（仅移动端可见，桌面不受影响）
    $('fsBtn').addEventListener('click', function () {
      var card = document.querySelector('.req-card');
      var open = card.classList.toggle('form-open');
      this.textContent = open ? '✓ 收起表单' : '✎ 修改需求';
      if (!open) window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 2) 吸顶分段导航：点击平滑滚动（高亮逻辑在模块级 updateSegbar）
    $('segbar').addEventListener('click', function (e) {
      var seg = e.target.closest('.seg');
      if (!seg) return;
      var el = document.querySelector(SEGS[seg.getAttribute('data-seg')]);
      if (!el) return;
      var top = el.getBoundingClientRect().top + window.pageYOffset - 44;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
    window.addEventListener('scroll', updateSegbar, { passive: true });
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', function () { render(); });

    // 3) 方案卡折叠交互（后处理在模块级 foldCards，render 尾部调用）
    $('cards').addEventListener('click', function (e) {
      var t = e.target.closest('.sol-toggle');
      if (!t) return;
      var card = t.closest('.card');
      var open = card.classList.toggle('sol-open');
      t.textContent = open ? '收起全部参数 ▴' : '展开全部参数 ▾';
    });

    // 4) 方案文本抽屉（移动端替代直接复制）：展示文本 + 复制按钮
    function openPlanDrawer() {
      $('pText').textContent = buildText();
      $('pMask').classList.add('show');
    }
    $('pClose').addEventListener('click', function () { $('pMask').classList.remove('show'); });
    $('pMask').addEventListener('click', function (e) { if (e.target === $('pMask')) $('pMask').classList.remove('show'); });
    $('pCopy').addEventListener('click', function () {
      var txt = $('pText').textContent;
      var btn = $('pCopy');
      var done = function () {
        btn.textContent = '已复制 ✓';
        setTimeout(function () { btn.textContent = '复制全部'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
      } else fallbackCopy(txt, done);
    });

    // 方案清单：逐行加入询价清单（与产品库共用 vs-inquiry-list）
    $('bom').addEventListener('click', function (e) {
      var add = e.target.closest('[data-bom-add]');
      if (add) {
        var model = add.getAttribute('data-bom-model');
        if (!inqHas(model)) {
          inqAdd({ m: model, b: brandKeyOf(add.getAttribute('data-bom-brand')), c: add.getAttribute('data-bom-cat') });
        }
        add.textContent = '✓ 已加入';
        add.classList.add('on');
        return;
      }
      if (e.target.id === 'bomAll') {
        var rr = E.solve(readInput());
        if (!rr.ok) return;
        bomRows(rr).forEach(function (x) {
          if (x.cat !== 'acc') inqAdd({ m: x.model, b: brandKeyOf(x.brand), c: x.cat });
        });
        Array.prototype.forEach.call($('bom').querySelectorAll('[data-bom-add]'), function (b) {
          b.textContent = '✓ 已加入';
          b.classList.add('on');
        });
        e.target.textContent = '✓ 已加入清单';
      }
    });

    // 同系列表格：点型号 = 手动指定，再点一次 = 取消
    $('siblings').addEventListener('click', function (e) {
      var auto = e.target.closest('[data-action="auto"]');
      if (auto) {
        manual.camera = null;
        manual.lens = null;
        manual.light = null;
        render();
        return;
      }
      var tr = e.target.closest('tr[data-kind]');
      if (!tr) return;
      var kind = tr.getAttribute('data-kind');
      var model = tr.getAttribute('data-model');
      if (!kind || !model) return;
      manual[kind] = manual[kind] === model ? null : model;
      render();
    });

    // ?p=copper 直接打开预设；再叠加显式参数，如 ?fovW=100&precision=0.02&speed=200
    var pm = /[?&]p=([a-z]+)/.exec(location.search);
    var state = Object.assign({}, pm && PRESETS[pm[1]] ? PRESETS[pm[1]] : DEFAULT, fromQuery());
    applyState(state);

    // 来自「自定义搭配」页的一键应用：先恢复需求，再固定三个手动型号
    var ho = takeComboHandoff();
    if (ho) {
      if (ho.req) applyState(Object.assign({}, DEFAULT, ho.req));
      manual.camera = ho.camera ? comboKey(ho.camera.b, ho.camera.m) : null;
      manual.lens = ho.lens ? comboKey(ho.lens.b, ho.lens.m) : null;
      manual.light = ho.light ? ho.light.m : null;
      try { localStorage.removeItem(COMBO_KEY); } catch (e) { /* 隐私模式忽略 */ }
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
