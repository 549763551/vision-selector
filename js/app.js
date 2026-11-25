/* 界面逻辑：读表单 → 调引擎（海康型号库）→ 渲染结果 */
(function () {
  'use strict';

  var BRANDS = window.BRANDS || {};
  var SC = window.SelectionCatalog;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 动效：只做「值真的变了」的反馈 ----------------
     结果区每次重算都会重建 DOM，入场动画会跟着重播，所以除了首次绘制，
     一律由这里按「上一次的值」判断：变了才给元素挂一次动画类，播完撤掉。 */
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function pulseOnce(el, cls, ms) {
    if (!el || REDUCED) return;
    el.classList.remove(cls);
    void el.offsetWidth;            // 强制重排，让同一个类能重新触发
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 460);
  }

  /* ---------------- 阅读模式：简明（外行）/ 专业（工程师） ---------------- */
  // 首帧的类由 index.html 的头部内联脚本先写好，这里只读取，避免两套内容闪一下。
  var MODE = /(^|\s)mode-pro(\s|$)/.test(document.documentElement.className) ? 'pro' : 'simple';
  var MODE_KEY = 'vs-mode';
  var fitColFn = null;   // 左栏高度适配在 init 里定义，切模式后要重算一次
  var fitCardFn = null;  // 简明模式「一屏」适配，同样在 init 里定义
  var swapTimer = 0;     // 模式切换淡入的收尾定时器

  function setMode(m) {
    MODE = m === 'pro' ? 'pro' : 'simple';
    var de = document.documentElement;
    de.classList.toggle('mode-pro', MODE === 'pro');
    de.classList.toggle('mode-simple', MODE === 'simple');
    try { localStorage.setItem(MODE_KEY, MODE); } catch (e) { /* 隐私模式下忽略 */ }
    var sw = $('modeSwitch');
    if (sw) {
      Array.prototype.forEach.call(sw.querySelectorAll('[data-mode]'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-mode') === MODE);
      });
    }
    // 专业模式默认摊开左栏全部字段；简明模式收起（值仍然生效）
    var rp = $('reqPro');
    if (rp) rp.open = MODE === 'pro';
    render();
    if (fitColFn) fitColFn();
    if (fitCardFn) fitCardFn();
    // 换读法时给结论卡与需求面板一次淡入，提示「这一屏是另一套说法」
    if (!REDUCED) {
      de.classList.remove('mode-swap');
      void de.offsetWidth;
      de.classList.add('mode-swap');
      clearTimeout(swapTimer);
      swapTimer = setTimeout(function () { de.classList.remove('mode-swap'); }, 420);
    }
  }

  // 三个类目各自按「清洗后仍有有效型号」的品牌初始化，默认全选。
  // 退市排除、必要参数硬门槛、等价字段补齐统一在 selection-catalog.js，
  // 选型助手与自定义搭配共用同一套口径。
  var activeBrands = SC.brandKeys(window, 'camera').slice();
  var activeLensBrands = SC.brandKeys(window, 'lens').slice();
  var activeLightBrands = SC.brandKeys(window, 'light').slice();

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

  // 把多个品牌型录拼成一个目录：相机 / 镜头 / 光源各按自己的品牌筛选，
  // 控制器与光源同品牌配套（跟随光源筛选）；线扫跟随相机、远心跟随镜头。
  // 具体合并、退市排除与必要参数校验见 selection-catalog.js。
  function buildMergedCatalog() {
    return SC.merge(window, {
      camera: activeBrands, lens: activeLensBrands, light: activeLightBrands
    });
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
        '<img class="bf-logo" src="' + esc(m.logo) + '" alt="' + esc(m.short) + '" style="--logo-scale:' + (m.logoScale || 1) + '" />' +
        '<span class="bf-txt">' + esc(m.short) + '</span>' +
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

  // 筛选条只列出「清洗后仍有有效型号」的品牌，避免点了没反应的空 chip
  function renderBrandFilter() {
    renderFilterBox('brandFilter', SC.brandKeys(window, 'camera'), activeBrands, '相机品牌');
  }

  function renderLensFilter() {
    renderFilterBox('lensFilter', SC.brandKeys(window, 'lens'), activeLensBrands, '镜头品牌');
  }

  function renderLightFilter() {
    renderFilterBox('lightFilter', SC.brandKeys(window, 'light'), activeLightBrands, '光源品牌');
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
    heightDiff: 1, speed: 0, cpm: 0, space: 0, lineScanFirst: false,
    stitchOverlap: 10, stitchMaxCams: 6
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

  // 只给真正决定选型的几项上色；其余行保留类别但压低视觉权重
  function kvKey(k, v) {
    return '<div class="kv key"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  }
  function kvSoft(k, v) {
    return '<div class="kv soft"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  }
  // 值里的补充说明：跟在关键值后面做小字，不另起一行
  function sub(txt) {
    return '<small class="v-sub">' + esc(txt) + '</small>';
  }
  // 安装角度 / 尺寸建议这类长句：首句高亮，后半留作小字，信息不丢
  function leadRest(txt) {
    var i = txt.indexOf('，');
    if (i < 0 || txt.length < 26) return esc(txt);
    return '<b class="v-key">' + esc(txt.slice(0, i)) + '</b>' + sub(txt.slice(i + 1));
  }
  // 引擎的 series / suffix / example 是海康 MV-L 系列命名规则。
  // 光源实际来自 CST / OPT / Basler 等品牌时这套模板不适用；即便海康，手动指定的
  // 子类 / 颜色与模板不一致时（如 MV-LBSS 背光、白光 -W 配红色模板）也不能展示。
  function hikRuleOf(g) {
    // 合并目录里 brand 是品牌全名（如「海康机器人 HIKROBOT」），不是注册键
    var m = g ? brandMeta(g.skuBrand) : null;
    return !!(m && m.key === 'hikrobot' && g.series && g.sku && g.suffix &&
      g.sku.indexOf(g.series) === 0 && g.sku.slice(-g.suffix.length) === g.suffix);
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
      '<div class="bom-actions"><a class="btn bom-go" href="library.html?inq=1" title="在产品库中查看清单与完整参数">到产品库查看 →</a></div>' +
      '<div class="sib-note">清单按当前方案自动生成；「加入询价清单」保存在本机浏览器，可在产品库查看完整参数。</div></div>';
  }

  /** 指标判定：把数字翻成「够不够」，外行看结论、内行看数值 */
  function verdictsHtml(r) {
    var out = [];
    function chip(tone, icon, label, text) {
      out.push('<span class="vd ' + tone + '"><i>' + icon + '</i><span><em>' + label +
        '</em><b>' + text + '</b></span></span>');
    }
    var m = r.margin;
    if (m != null) {
      var tone = m >= 0.15 ? 'ok' : (m >= 0 ? 'tight' : 'bad');
      chip(tone, m >= 0.15 ? '✓' : (m >= 0 ? '!' : '✕'), '精度',
        num(r.camera.pxAcc, 4) + ' mm/px（需求 ' + num(r.pxAccReq, 3) +
        (m >= 0 ? '，余 ' + pct(m) + '）' : '，差 ' + pct(-m) + '）'));
    }
    var dof = r.lens && r.lens.dof;
    var hd = r.input ? r.input.heightDiff : 0;
    if (dof != null) {
      if (!(hd > 0)) chip('ok', '✓', '景深', num(dof, 2) + ' mm，未填高低差');
      else chip(dof >= hd ? 'ok' : 'bad', dof >= hd ? '✓' : '✕', '景深',
        num(dof, 2) + ' mm，' + (dof >= hd
          ? '覆盖高低差 ' + num(hd, 2) + ' mm'
          : '小于高低差 ' + num(hd, 2) + ' mm'));
    }
    var sp = r.space;
    if (sp) {
      if (sp.pass == null) {
        chip('ok', 'i', '安装', '按总长 ' + num(sp.need, 0) + ' mm 预留（未填可用空间）');
      } else if (sp.pass) {
        chip('ok', '✓', '安装', '总长 ' + num(sp.need, 0) + ' mm，余 ' + num(sp.available - sp.need, 0) + ' mm');
      } else {
        chip('bad', '✕', '安装', '总长 ' + num(sp.need, 0) + ' mm，超出 ' + num(sp.over, 0) + ' mm');
      }
    }
    return out.join('');
  }

  /* ---------------- 简明模式：结论 / 三项判定 / 三件套 ---------------- */
  // 外行只关心「能不能用、买什么」：留结论、三条判定与三个型号，
  // 评分、公式、风险表都在专业模式与详细方案里。

  /** 光源类型的白话说明：表格里的专业名词对非工程师没有意义 */
  var LIGHT_PLAIN = {
    ring: '环形光，整圈均匀照亮',
    ring_high: '高角度环光，表面细节更亮',
    ring_low: '低角度环光，专照划痕与毛刺',
    bar_low: '条形暗场光，适合长条工件与边缘',
    backlight: '背光，轮廓最清楚',
    coaxial: '同轴光，压住镜面反光',
    dome: '无影光，曲面件也不发暗'
  };

  function simpleHero(r, passN, total) {
    var note = total ? (passN === total ? total + ' 项工程核查全部通过' : passN + ' / ' + total + ' 项工程核查通过') : '';
    if (r.feasible) {
      return {
        chip: '方案可行', bad: false, note: note,
        h: '这套方案可以直接用',
        p: '相机、镜头、光源三件都够用，按下面的三个型号询价即可。'
      };
    }
    return {
      chip: '需要调整', bad: true, note: note,
      h: '还差一点，这套要先放宽条件',
      p: '六家在售型号里没找到三项全过的组合，下面是其中最接近的一套。' +
        '把精度、视野或工作距离放宽一点再算，通常就有能直接交付的方案。'
    };
  }

  /** 三格成绩单：数字最大，标签与要求退到第二层；外行只看这三格就够判断 */
  function metricsHtml(r) {
    var out = [];
    function cell(k, tone, key, value, unit, sub) {
      out.push('<div class="hm ' + tone + '" data-k="' + k + '"><div class="hm-k"><i></i>' + key + '</div>' +
        '<div class="hm-v">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
        '<div class="hm-s">' + sub + '</div></div>');
    }
    var m = r.margin;
    if (m != null) {
      cell('p', m >= 0.15 ? '' : (m >= 0 ? 'tight' : 'bad'), '精度 · 看得清',
        num(r.camera.pxAcc, 3), 'mm',
        '要求 ' + num(r.pxAccReq, 3) + ' mm' + (m >= 0 ? '，余 ' + pct(m) : '，还差 ' + pct(-m)));
    }
    var l = r.lens, dof = l && l.dof, hd = (r.input && r.input.heightDiff) || 0;
    if (dof != null) {
      if (!(hd > 0)) cell('d', '', '景深 · 高低都清楚', num(dof, 2), 'mm', '在此范围内都清楚');
      else cell('d', dof >= hd ? '' : 'bad', '景深 · 高低都清楚', num(dof, 2), 'mm',
        '高低差 ' + num(hd, 2) + ' mm' + (dof >= hd ? '，盖得住' : '，盖不住'));
    }
    var sp = r.space;
    if (sp) {
      if (sp.pass == null) cell('s', '', '安装 · 放得下', num(sp.need, 0), 'mm', '相机 + 镜头总长');
      else if (sp.pass) cell('s', '', '安装 · 放得下', num(sp.need, 0), 'mm',
        '可用 ' + num(sp.available, 0) + ' mm，余 ' + num(sp.available - sp.need, 0) + ' mm');
      else cell('s', 'bad', '安装 · 放得下', num(sp.need, 0), 'mm', '超出可用 ' + num(sp.over, 0) + ' mm');
    }
    return out.join('');
  }

  /** 光路示意：相机 → 镜头 → 视野锥 → 工件面，标出视野与工作距离（不写型号，型号在下面三张卡里） */
  // 颜色全交给 CSS（.hb-art 下的 .oa-* 规则）：屏幕上是深底浅线，打印时同一套图形换成深线
  function opticsSvg(r, anim) {
    var i = r.input || {};
    var fw = num(i.fovW, 0), fh = num(i.fovH, 0);
    var wd = r.lens && r.lens.wd ? Math.round(r.lens.wd) : num(i.wd, 0);
    return '<svg class="oa" viewBox="0 0 620 184" xmlns="http://www.w3.org/2000/svg" role="img" ' +
      'aria-label="光路示意：工作距离 ' + wd + ' mm，视野 ' + fw + ' × ' + fh + ' mm">' +
      '<text class="oa-tit" x="310" y="12" text-anchor="middle" font-size="10" letter-spacing="2.6">CAMERA + LENS + LIGHT</text>' +
      '<g class="oa-cam" fill="none" stroke-width="1.2">' +
      '<rect x="268" y="24" width="84" height="38" rx="4"/>' +
      '<line x1="282" y1="43" x2="338" y2="43"/>' +
      '<rect x="288" y="62" width="44" height="16" rx="2"/>' +
      '<rect x="300" y="78" width="20" height="8" rx="1.5"/>' +
      '</g>' +
      '<circle class="oa-dot" cx="332" cy="33" r="2.8"/>' +
      '<g class="oa-beam' + (anim ? ' oa-in' : '') + '">' +
      '<path class="oa-fill" d="M298 88 L90 142 H530 L322 88 Z"/>' +
      '<g class="oa-cone" stroke-width="1.1" fill="none" stroke-dasharray="4 4">' +
      '<line x1="298" y1="88" x2="90" y2="142"/><line x1="322" y1="88" x2="530" y2="142"/>' +
      '</g>' +
      '</g>' +
      '<line class="oa-base" x1="70" y1="142" x2="550" y2="142" stroke-width="2"/>' +
      '<rect class="oa-work" x="290" y="134" width="40" height="8" rx="1.5"/>' +
      '<g class="oa-dim" stroke-width="1" fill="none">' +
      '<line x1="90" y1="156" x2="530" y2="156"/>' +
      '<line x1="90" y1="147" x2="90" y2="165"/><line x1="530" y1="147" x2="530" y2="165"/>' +
      '<line x1="574" y1="88" x2="574" y2="142"/>' +
      '<line x1="567" y1="88" x2="581" y2="88"/><line x1="567" y1="142" x2="581" y2="142"/>' +
      '</g>' +
      '<text class="oa-txt" x="310" y="178" text-anchor="middle" font-size="12">' +
      '视野 ' + fw + ' × ' + fh + ' mm</text>' +
      '<text class="oa-tit" x="574" y="80" text-anchor="middle" font-size="10.5" letter-spacing=".6">WD</text>' +
      '<text class="oa-txt" x="574" y="160" text-anchor="middle" font-size="11">' + wd + ' mm</text>' +
      '</svg>';
  }

  /** 产品库里的「返回刚才的方案」：把当前需求 + 固定型号 + 阅读模式编码成返回地址 */
  function backParam() {
    try {
      var u = shareUrl();
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'mode=' + MODE;
      return '&back=' + encodeURIComponent(u);
    } catch (e) { return ''; }
  }

  /** 三件套：编号 + 品牌标识 + 型号 + 一句人话 + 关键规格 */
  function pickCardsHtml(r) {
    var back = backParam();
    function pick(no, cls, cat, brand, model, note, spec) {
      var m = brandMeta(brand);
      var bc = m ? m.color : '#94a3b8';
      var logo = m
        ? '<img class="pick-logo" src="' + esc(m.logo) + '" alt="' + esc(m.short) +
          '" style="--logo-scale:' + (m.logoScale || 1) + '" />'
        : (brand ? '<span class="pick-cat">' + esc(brand) + '</span>' : '');
      var href = 'library.html?cat=' + encodeURIComponent(cls) + '&q=' + encodeURIComponent(model) + back;
      return '<a class="pick ' + cls + '" href="' + href + '" style="--bc:' + esc(bc) + '" title="在产品库看 ' + esc(model) + ' 的全参数与备选">' +
        '<div class="pick-top"><span class="pick-no">' + no + '</span>' +
        '<span class="pick-cat">' + cat + '</span>' + logo + '</div>' +
        '<div class="pick-model">' + esc(model) + '</div>' +
        '<div class="pick-note">' + note + '</div>' +
        '<div class="pick-foot"><span class="pick-sub">' + spec + '</span>' +
        '<span class="pick-link">看参数 ↗</span></div>' +
        '</a>';
    }
    var c = r.camera, l = r.lens, g = r.light;
    var camNote = '能拍清 <b>' + num(c.pxAcc, 3) + ' mm</b> 的细节';
    var camSpec = c.w + '×' + c.h + ' ' + esc(c.color) + ' · ' + esc(c.interface);
    var lensNote = '一次拍全 <b>' + num(l.fovW, 0) + ' × ' + num(l.fovH, 0) + ' mm</b>';
    var lensSpec = (l.f ? l.f + ' mm' : (l.mag ? num(l.mag, 3) + '× 远心' : esc(l.model))) +
      ' · F' + l.aperture + ' · ' + esc(l.mount) + ' 口';
    var lightNote = LIGHT_PLAIN[g.type] || '按要求照亮视野';
    var lightSpec = esc(g.colorName) + (g.wavelength ? ' ' + esc(g.wavelength) : '') +
      (g.power != null ? ' · ' + g.power + ' W' : '');
    return pick('01', 'cam', '相机', c.brand, c.model, camNote, camSpec) +
      pick('02', 'lens', '镜头', l.brand, l.model, lensNote, lensSpec) +
      pick('03', 'light', '光源', g.skuBrand, g.sku || g.seriesName, lightNote, lightSpec);
  }

  /** 9 项工程核查：只留通过与否，扣分来由不再单列成表 */
  function checkChipsHtml(checks) {
    if (!checks || !checks.length) return '';
    return '<span class="cc-label">工程核查</span>' + checks.map(function (c) {
      return '<span class="si-chip ' + (c.ok ? 'ok' : '') + '" data-k="' + esc(c.label) +
        '" data-ok="' + (c.ok ? 1 : 0) + '" title="' + esc(c.detail) + '">' +
        (c.ok ? '✓ ' : '✕ ') + esc(c.label) + '</span>';
    }).join('');
  }

  /** 结论行：数字都在下面的判定标签里，这里只说「这套能不能用」 */
  function heroLine(r) {
    var i = r.input || {};
    var cond = '视野 ' + num(i.fovW, 0) + '×' + num(i.fovH, 0) + ' mm、最小特征 ' + num(i.precision, 2) + ' mm';
    if (r.feasible) {
      return '按「' + cond + '」，硬性条件（精度、视场、卡口、曝光）全部满足，可直接按下方清单询价。';
    }
    return '按「' + cond + '」，型号库里没有完全达标的组合：下面是最接近的一套，先按风险提示调整条件再定。';
  }

  /**
   * 一眼结论：三件套压成两行。
   * 第一行只放型号（点型号跳到对应参数卡），第二行放真正能判断合不合适的规格，
   * 像素数、帧率这类卡里已经有的不再重复。
   */
  function quickRows(r) {
    function seg(goto, label, model) {
      return '<button type="button" class="q-seg" data-goto="' + goto + '" title="查看' + label + '完整参数">' +
        '<i>' + label + '</i><b>' + esc(model) + '</b></button>';
    }
    var c = r.camera, l = r.lens;
    var lightName = r.light.sku || r.light.seriesName || '—';
    var line1 = seg('cam', '相机', c.model) + '<span class="q-sep">/</span>' +
      seg('lens', '镜头', l.model) + '<span class="q-sep">/</span>' +
      seg('light', '光源', lightName);
    var spec = [
      c.w + '×' + c.h + ' · ' + num(c.w * c.h / 1e6, 1) + ' MP',
      num(l.f, 0) + ' mm F' + l.aperture,
      (r.light.colorName || '') + (r.light.wavelength ? ' ' + r.light.wavelength : ''),
      '实际 <b>' + num(c.pxAcc, 3) + ' mm/px</b>',
      '余量 ' + Math.round(Math.max(0, r.margin) * 100) + '%'
    ].filter(Boolean).join(' · ');
    return '<div class="q-line">' + line1 + '</div><div class="q-sub">' + spec + '</div>';
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
      stitchOverlap: readNum('stitchOverlap'),
      stitchMaxCams: readNum('stitchMaxCams'),
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
    if ($('stitchOverlap')) $('stitchOverlap').value = st.stitchOverlap == null ? 10 : st.stitchOverlap;
    if ($('stitchMaxCams')) $('stitchMaxCams').value = st.stitchMaxCams == null ? 6 : st.stitchMaxCams;
    syncStitchOpt();
    render();
  }

  /* ---------------- 卡片渲染 ---------------- */
  // 「在产品库查看」链接：带型号与类别跳产品库，产品库会自动搜索并弹出详情；
  // 同时把当前方案编进 back，产品库那边一键就能回到这份需求
  function libLink(cat, model) {
    if (!model) return '';
    return '<a class="lib-link" href="library.html?cat=' + encodeURIComponent(cat) +
      '&q=' + encodeURIComponent(model) + backParam() + '" title="在产品库中查看全参数与备选">产品库 ↗</a>';
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
    return '<div class="card cam" id="card-cam">' +
      '<div class="card-head"><span class="ico">📷</span><h3>相机</h3>' + blogo + '<span class="tag">' + esc(c.color) + '</span></div>' +
      '<div class="hero">' + esc(c.model) + '</div>' +
      '<div class="hero-sub"><span>' + esc(c.series) + ' · ' + c.w + '×' + c.h + ' px</span>' + libLink('cam', c.model) + '</div>' +
      kvKey('有效像素精度', esc(n4(c.pxAcc)) + ' mm/px') +
      kvKey('精度余量', esc(r.margin >= 0 ? pct(r.margin) : '不足')) +
      kv('像元尺寸', esc(c.pxUm) + ' µm') +
      kv('最大帧率', esc(c.maxFps) + ' fps') +
      kv('靶面尺寸', esc(c.sw + ' × ' + c.sh) + ' mm' +
        (c.size ? ' · ' + esc(c.size) : (c.sw > 0 && c.sh > 0 ? ' · ' + sensorSizeTxt(c) : ''))) +
      kv('镜头接口', esc(c.mount) + ' 口') +
      kv('数据接口', esc(c.interface)) +
      kvSoft('传感器型号', esc(c.sensor || '—')) +
      kvSoft('快门类型', esc(c.shutter)) +
      kvSoft('动态范围', esc(c.dr == null ? '—' : c.dr + ' dB')) +
      kvSoft('信噪比', esc(c.snr == null ? '—' : c.snr + ' dB')) +
      kvSoft('曝光范围', esc(expoRange(c.expMinUs, c.expMaxUs))) +
      kvSoft('供电', esc(c.poe == null ? '—' : c.poe ? 'PoE / 12V' : '12V')) +
      kvSoft('典型功耗', esc(c.powerW == null ? '—' : c.powerW + ' W')) +
      kvSoft('所需带宽', esc(num(c.bandwidthMBps, 2)) + ' MB/s') +
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
    // 满足景深的最大光圈：F 数字越小进光量越大；apMaxOk=false 表示最小光圈景深仍不足。
    // 括号里的口径说明压成小字，数值留在第一行。
    var apTxt = 'F' + l.aperture + sub(l.apMaxOk
      ? '景深上限，可再收一档'
      : '已至最小光圈，景深不足');
    var lenTxt = l.len
      ? l.len + ' mm' + sub(l.adapter ? '手册图 + 转接环 ≈12 mm' : '手册图')
      : (l.lenEst != null ? '≈' + l.lenEst + ' mm' + sub(l.adapter ? '含转接环' : '估算') : '—');
    return '<div class="card lens" id="card-lens">' +
      '<div class="card-head"><span class="ico">🔍</span><h3>镜头</h3>' + llogo +
      '<span class="tag">' + esc(l.mount) + ' 口</span>' + adapterTxt + '</div>' +
      '<div class="hero">' + l.f + ' mm<span style="font-size:14px;color:#64748b;font-weight:600"> / F' + l.aperture + '</span></div>' +
      '<div class="hero-sub"><span>' + esc(l.model) + '</span>' + libLink('lens', l.model) + '</div>' +
      kvKey('实际视场', esc(num(l.fovW, 2) + ' × ' + num(l.fovH, 2)) + ' mm') +
      kvKey('景深', esc(num(l.dof, 2)) + ' mm') +
      kv('满足景深的最大光圈', apTxt) +
      kv('放大倍率', esc(n4(l.m)) + '×') +
      kv('像面 / 解析力', esc(icTxt)) +
      kvSoft('理论焦距', esc(num(l.fReq, 1)) + ' mm') +
      kvSoft('镜头系列', esc(l.series)) +
      kvSoft('衍射弥散', esc(num(l.blurPx, 2)) + ' px') +
      kvSoft('光学畸变', esc(l.dist == null ? '—' : num(l.dist, 2) + '%')) +
      kvSoft('镜头总长', lenTxt) +
      kvSoft('最近摄距', esc(l.minDist != null ? l.minDist + ' m' : '—')) +
      '</div>';
  }

  function lightCard(r) {
    var g = r.light;
    var gmeta = brandMeta(g.skuBrand);
    var glogo = gmeta ? '<img class="card-brand-logo" src="' + esc(gmeta.logo) + '" alt="' + esc(gmeta.short) + '" style="--logo-scale:' + (gmeta.logoScale || 1) + '" />' : '';
    return '<div class="card light" id="card-light">' +
      '<div class="card-head"><span class="ico">💡</span><h3>光源</h3>' + glogo + '<span class="tag">' + esc(TYPE_TAG[g.type] || '环形') + '</span></div>' +
      '<div class="hero">' + esc(g.sku || g.seriesName) + '</div>' +
      '<div class="hero-sub"><span>' + swatch(g.color) + esc(g.colorName) + ' ' + esc(g.wavelength) +
        (hikRuleOf(g) ? ' · ' + esc(g.series + g.suffix) : '') + '</span>' + libLink('light', g.sku) + '</div>' +
      block('安装 / 打光角度', leadRest(g.angle)) +
      block('尺寸建议', leadRest(g.size)) +
      block('功率 / 数量',
        g.power == null ? '—' : '<b class="v-key">' + esc(g.power + ' W × ' + g.count + ' 只 = ' + g.totalPower + ' W') + '</b>') +
      block('控制器型号', esc(g.controllerModel
        ? g.controllerModel + '（' + g.controllerChannels + ' 通道）'
        : '—') + libLink('ctrl', g.controllerModel)) +
      // 命名模板只在海康型号上成立，CST / OPT 等品牌按自己的型号命名
      (hikRuleOf(g) ? block('型号构成', '<b class="v-key">' + esc(g.example) + '</b><br>' + sub(g.suffixNote)) : '') +
      (g.skuNote ? block('选型说明', '<span style="color:#b45309">' + esc(g.skuNote) + '</span>') : '') +
      block('配件', esc(g.accessories.length ? g.accessories.join('；') : '无')) +
      block('控制方式', esc(g.controller)) +
      (g.reasons.length
        ? '<ul class="why kv-extra">' + g.reasons.slice(0, 3).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '') +
      '</div>';
  }

  /* ------------------------ 线扫多机拼接 ------------------------ */
  /** 勾了线扫优先才需要填重叠率与台数上限；不勾时这两项藏起来，免得误填 */
  function syncStitchOpt() {
    var on = $('lineScanFirst') && $('lineScanFirst').checked;
    ['stitchOvRow', 'stitchMaxRow'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = !on;
    });
  }

  /**
   * 俯视排布图：横向是幅面方向，N 个条带即 N 台的单台视场，交叠处就是拼接区。
   * 图只表达几何关系（谁跟谁重叠多少、光轴隔多远），不做比例失真处理 ——
   * 条带宽度按真实比例画，重叠区一眼能看出够不够宽。
   */
  function stitchSvg(p, totalW) {
    var W = 660, H = 224;
    var x0 = 66, x1 = 626;
    var k = (x1 - x0) / totalW;
    var yb = 92, bh = 42;
    var n = p.n, F = p.fovPer, P = p.pitch;
    var s2 = [];
    s2.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="dg" role="img" aria-label="' + n + ' 台线扫拼接排布">');

    // 每台条带
    for (var i = 0; i < n; i++) {
      var bx = x0 + i * P * k;
      var bw = F * k;
      s2.push('<rect class="st-band" style="--i:' + i + '" x="' + num(bx, 1) + '" y="' + yb + '" width="' + num(bw, 1) + '" height="' + bh +
        '" fill="' + (i % 2 ? '#e0eafc' : '#eff6ff') + '" stroke="#93c5fd"/>');
      // 光轴
      var cx = bx + bw / 2;
      s2.push('<line class="st-band" style="--i:' + i + '" x1="' + num(cx, 1) + '" y1="' + (yb - 26) + '" x2="' + num(cx, 1) + '" y2="' + (yb + bh) +
        '" stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3"/>');
      // 相机 + 镜头
      s2.push('<rect class="st-band" style="--i:' + i + '" x="' + num(cx - 13, 1) + '" y="' + (yb - 30) + '" width="26" height="13" rx="2.5" fill="#f1f5f9" stroke="#64748b"/>');
      s2.push('<path class="st-band" style="--i:' + i + '" d="M' + num(cx - 8, 1) + ' ' + (yb - 17) + ' L' + num(cx + 8, 1) + ' ' + (yb - 17) +
        ' L' + num(cx + 11, 1) + ' ' + (yb - 12) + ' L' + num(cx - 11, 1) + ' ' + (yb - 12) + ' Z" fill="#dbeafe" stroke="#93c5fd"/>');
      s2.push('<text x="' + num(cx, 1) + '" y="' + (yb + bh - 8) + '" text-anchor="middle" class="dg-xs" ' +
        'class="st-band" style="--i:' + i + '" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">C' + (i + 1) + '</text>');
    }

    // 重叠区：斜线填充，宽度 = 单台视场 × 重叠率
    for (var j = 0; j < n - 1; j++) {
      var ox = x0 + ((j + 1) * P) * k;
      var ow = (F - P) * k;
      s2.push('<rect class="st-band" style="--i:' + (j + 1) + '" x="' + num(ox, 1) + '" y="' + yb + '" width="' + num(Math.max(ow, 0.6), 1) + '" height="' + bh +
        '" fill="url(#stHatch)" stroke="#f59e0b" stroke-width="0.8"/>');
    }
    s2.push('<defs><pattern id="stHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" stroke-width="1.4" opacity="0.55"/></pattern></defs>');

    // 光轴间距：紧跟条带下方，只标第一段（多了会挤）
    if (n >= 2) {
      var c1 = x0 + (F * k) / 2, c2 = x0 + (P + F / 2) * k;
      var yp = yb + bh + 16;
      s2.push('<line x1="' + num(c1, 1) + '" y1="' + (yp - 5) + '" x2="' + num(c1, 1) + '" y2="' + (yp + 5) + '" stroke="#7c3aed"/>');
      s2.push('<line x1="' + num(c2, 1) + '" y1="' + (yp - 5) + '" x2="' + num(c2, 1) + '" y2="' + (yp + 5) + '" stroke="#7c3aed"/>');
      s2.push('<line x1="' + num(c1, 1) + '" y1="' + yp + '" x2="' + num(c2, 1) + '" y2="' + yp +
        '" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="3 2"/>');
      s2.push('<text x="' + num((c1 + c2) / 2, 1) + '" y="' + (yp + 17) + '" text-anchor="middle" class="dg-xs" fill="#6d28d9">光轴间距 ' +
        num(P, 0) + ' mm</text>');
    }

    // 幅面总宽：放在最下面一条独立轴线上，跟局部尺寸分开
    var yd = yb + bh + (n >= 2 ? 52 : 26);
    s2.push('<line x1="' + x0 + '" y1="' + yd + '" x2="' + x1 + '" y2="' + yd + '" stroke="#475569"/>');
    s2.push('<line x1="' + x0 + '" y1="' + (yd - 6) + '" x2="' + x0 + '" y2="' + (yd + 6) + '" stroke="#475569"/>');
    s2.push('<line x1="' + x1 + '" y1="' + (yd - 6) + '" x2="' + x1 + '" y2="' + (yd + 6) + '" stroke="#475569"/>');
    s2.push('<rect x="' + x0 + '" y="' + (yd + 10) + '" width="' + (x1 - x0) + '" height="3" fill="#cbd5e1"/>');
    s2.push('<text x="' + ((x0 + x1) / 2) + '" y="' + (yd + 26) + '" text-anchor="middle" class="dg-s">总幅面 ' +
      num(totalW, 0) + ' mm（' + n + ' 台拼接）</text>');
    // 重叠区标注（只在第一处，靠右避开间距标注）
    var ox0 = x0 + P * k, ow0 = (F - P) * k;
    s2.push('<text x="' + num(ox0 + ow0 / 2, 1) + '" y="' + (yb + 16) + '" text-anchor="middle" class="dg-xs" ' +
      'fill="#b45309" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">重叠 ' +
      num(p.overlapW, 0) + '</text>');
    s2.push('</svg>');
    return s2.join('');
  }

  /** 单台覆盖不了整幅时的拼接方案：台数对比 + 选中方案明细 + 现场要点 */
  function stitchCard(r) {
    var st = r.lineScanStitch;
    if (!st) return '';

    var head = '<div class="card"><h2 class="sec">线扫多机拼接' +
      '<span class="hint">单台覆盖不了 ' + num(st.totalW, 0) + ' mm 幅面，沿幅面并排 N 台、靠重叠区拼接</span></h2>';

    if (!st.ok) {
      return head +
        '<div class="kv-block"><span>为什么拼不了</span><p style="color:#b45309">' + esc(st.reason) + '</p></div>' +
        kv('单台最大覆盖', esc(num(st.singleMaxW * st.pxAccReq, 0)) + ' mm（' + st.singleMaxW + ' 像素 × ' + num(st.pxAccReq, 3) + ' mm/px）') +
        kv('按当前上限所需台数', esc(st.needCams == null ? '—' : '≥ ' + st.needCams + ' 台')) +
        kv('当前设定', esc('重叠 ' + Math.round(st.overlap * 100) + '%，上限 ' + st.maxCams + ' 台')) +
        '<div class="sib-note">拼接只解决横向覆盖，不会提高行频，也不会放宽像素精度；' +
        '要把 ' + num(st.totalW, 0) + ' mm 铺满，可放宽像素精度、提高台数上限，或改用多工位分段检测。</div>' +
        '</div>';
    }

    var b = st.best;
    var rows = st.plans.map(function (p, i) {
      var lensTxt = p.lens
        ? esc(p.lens.focal + ' mm') + '<i class="sub"> ' + esc(p.lens.mount) + '</i>'
        : '<span class="st-bad">另配</span>';
      var accTxt = n4(p.pxAcc) + (p.accOk ? '' : '<i class="sub st-bad"> 超差</i>');
      // 镜头视场与设计值差得多时把设计值带出来，免得看表的人以为重叠率没按设定走
      var fovTxt = num(p.fovPer, 0) +
        (p.fovLensDriven ? '<i class="sub"> 设计 ' + num(p.fovDesign, 0) + '</i>' : '');
      return '<tr' + (i === 0 ? ' class="best"' : '') + '>' +
        '<td class="num"><b>' + p.n + ' 台</b>' + (i === 0 ? ' <span class="pick-mark">推荐</span>' : '') + '</td>' +
        '<td class="model">' + esc(p.camera.model) + '</td>' +
        '<td class="num">' + fovTxt + '</td>' +
        '<td class="num">' + p.camera.w + ' px</td>' +
        '<td class="num">' + accTxt + '</td>' +
        '<td class="num">' + num(p.pitch, 0) + '</td>' +
        '<td class="num">' + num(p.overlapW, 0) +
          '<i class="sub"> / ' + p.overlapPx + ' px · ' + Math.round(p.overlapPct * 100) + '%</i></td>' +
        '<td class="num">' + num(p.rate, 1) + '</td>' +
        '<td class="num">' + num(p.bandwidthTotal, 0) + '</td>' +
        '<td>' + lensTxt + '</td></tr>';
    }).join('');

    var lensLine = b.lens
      ? '<b>' + esc((b.lens.brand ? '[' + b.lens.brand + '] ' : '') + b.lens.model) + '</b>　' + esc(b.lens.focal) + ' mm　' +
        esc(b.lens.mount) + ' 口直配　每台行向视场 ' + num(b.lens.fovW, 1) + ' mm' +
        (b.lens.note ? '<br><span style="color:#b45309">' + esc(b.lens.note) + '</span>' : '') +
        libLink('lens', b.lens.model)
      : '<span style="color:#b45309">' + esc(b.lensNote || '镜头库无直配型号') + '</span>　' + b.f + ' mm 附近、像面 ≥ ' + num(b.sensorW, 1) + ' mm 即可';

    var lightLine = b.light
      ? '<b>' + esc((b.light.brand ? '[' + b.light.brand + '] ' : '') + b.light.model) + '</b>　' +
        (b.light.count > 1 ? b.light.count + ' 段对接　' : '整条 ') +
        (b.light.power == null ? '' : esc(b.light.power) + ' W × ' + b.light.count + ' = ' + esc(b.light.power * b.light.count) + ' W') +
        (b.light.note ? '<br><span style="color:#b45309">' + esc(b.light.note) + '</span>' : '')
      : '—';

    return head +
      // 结论
      '<div class="st-hero">' +
        '<span class="st-n">' + b.n + '<small> 台</small></span>' +
        '<span class="st-txt"><b>' + esc(b.camera.model) + '</b><i>单台视场 ' + num(b.fovPer, 0) + ' mm　光轴间距 ' +
          num(b.pitch, 0) + ' mm　合计带宽 ' + num(b.bandwidthTotal, 0) + ' MB/s</i></span>' +
        '<span class="st-tag ' + (b.accOk ? 'ok' : 'bad') + '">' +
          (b.accOk ? '✓ 精度达标 ' + n4(b.pxAcc) + ' mm/px' : '✕ 精度超差 ' + n4(b.pxAcc) + ' mm/px') + '</span>' +
      '</div>' +
      // 排布图
      '<div class="st-svg">' + stitchSvg(b, st.totalW) + '</div>' +
      // 台数对比
      '<div style="overflow-x:auto"><table class="mini st-table"><thead><tr>' +
        '<th>台数</th><th>相机</th><th>单台视场</th><th>像素</th><th>实际精度</th>' +
        '<th>光轴间距</th><th>重叠</th><th>行频</th><th>合计带宽</th><th>镜头</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="sib-note">单位：视场 / 间距 / 重叠 mm，精度 mm/px，行频 kHz，带宽 MB/s。' +
        '台数越多单台视场越小、越容易选到高精度相机，但镜头、光源、标定与同步的复杂度同步上升；' +
        '表内已按「台数最少且镜头配得上」排好序。</div>' +
      // 选中方案明细
      '<div class="st-detail">' +
        block('每台相机 / 镜头', lensLine) +
        block('整幅光源', lightLine) +
        kv('单台视场', esc(num(b.fovPer, 1)) + ' mm（设计 ' + num(b.fovDesign, 1) +
          (b.fovLensDriven ? '，由镜头焦距档决定' : '') + '）') +
        kv('实际横向精度', esc(n4(b.pxAcc)) + ' mm/px（需求 ' + num(st.pxAccReq, 3) + '，' +
          (b.accMargin >= 0 ? '余 ' + pct(b.accMargin) : '超差 ' + pct(-b.accMargin)) + '）') +
        kv('实际重叠', esc(num(b.overlapW, 1)) + ' mm / ' + b.overlapPx + ' px（' + Math.round(b.overlapPct * 100) + '%，设定 ' +
          Math.round(st.overlap * 100) + '%' + (b.overlapPct > st.overlap + 0.005 ? '，镜头视场比设计宽，重叠随之变大' : '') + '）') +
        kv('每台所需行频', esc(num(b.rate, 1)) + ' kHz（上限 ' + b.rateCap + ' kHz）') +
        kv('单台带宽', esc(num(b.bandwidth, 0)) + ' MB/s（' + esc(b.camera.iface) + ' 上限 ' + b.ifaceCap + '）' +
          (b.bitAssumed ? '　位深型号未标，按 ' + b.bitDepth + ' bit 估' : '')) +
        kv(b.camPowerTotal == null ? '总像素' : '总像素 / 总功耗',
          esc(b.pixelTotal + ' px' + (b.camPowerTotal == null ? '' : '　合计 ' + num(b.camPowerTotal, 1) + ' W'))) +
      '</div>' +
      // 现场要点
      '<div class="st-notes"><div class="sub-h">现场四条硬要求</div><ul>' +
        st.notes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      // 演算
      '<details class="fold sub st-calc"><summary>单台演算 <span class="sum-hint">' + b.n + ' 台方案逐格复核</span><span class="sum-act"></span></summary>' +
        '<div class="fold-body"><table class="mini"><thead><tr><th>步骤</th><th>公式 / 代入</th>' +
        '<th style="text-align:right">结果</th></tr></thead><tbody>' +
        b.steps.map(function (x) {
          return '<tr><td>' + esc(x.t) + '</td><td class="model">' + esc(x.f) + '</td>' +
            '<td style="text-align:right"><b>' + esc(x.v) + '</b></td></tr>';
        }).join('') +
        '</tbody></table></div></details>' +
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
    if (r.lineScanStitch && r.lineScanStitch.ok) {
      var sg = r.lineScanStitch, bp = sg.best;
      // 三行：配置 / 几何与精度 / 链路 + 入口。四行会把「达标」挤到单独一行，读起来散
      items.push(block('线扫多机拼接（单台覆盖不了 ' + num(sg.totalW, 0) + ' mm 幅面）',
        '<b>' + bp.n + ' 台 ' + esc(bp.camera.model) + '</b>' +
        (bp.lens ? '　+ ' + esc(bp.lens.model) + '（' + bp.lens.focal + ' mm）' : '　镜头需另配') +
        '<br>单台视场 ' + num(bp.fovPer, 0) + ' mm　光轴间距 ' + num(bp.pitch, 0) + ' mm　重叠 ' +
        num(bp.overlapW, 0) + ' mm（' + Math.round(bp.overlapPct * 100) + '%）　精度 ' +
        n4(bp.pxAcc) + ' mm/px ' +
        (bp.accOk ? '<span class="ok-mark">达标</span>' : '<span style="color:#b91c1c">超差</span>') +
        '<br>合计带宽 ' + num(bp.bandwidthTotal, 0) + ' MB/s　' +
        '<a class="lib-link" data-stitch-jump role="button" tabindex="0">台数对比与排布 ↗</a>'));
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

  /* ---------------- 同系列参数：标签页切换 + 就地结果 ---------------- */
  var SIB_TAB = 'camera';
  var SIB_PULSE = false;
  var SIB_FADE = false;       // 点选型号 / 恢复自动后，备选面板淡入一次
  var lastStitchSig = '';     // 拼接排布图只在台数或选型真的变了才按台次入场
  var stitchAnimSeq = 0;      // 动画收尾用序号防止旧定时器清掉新一轮

  /** 自动方案基线：清掉手动指定再算一次，用来显示「比自动方案好/差多少」 */
  function sibBaseline() {
    var inp = readInput();
    inp.manualCamera = null;
    inp.manualLens = null;
    inp.manualLight = null;
    try {
      var x = E.solve(inp);
      return x && x.ok ? x : null;
    } catch (e) { return null; }
  }

  function sibMetricRow(label, text, d) {
    return '<div class="sl-m"><span>' + label + '</span><b>' + esc(text) + '</b>' +
      (d ? '<i class="' + (d.g > 0 ? 'good' : d.g < 0 ? 'bad' : 'same') + '">' + esc(d.t) + '</i>' : '') +
      '</div>';
  }

  /** 就地结果面板：换型号后分数与关键指标立刻在右侧更新，不必回到页面顶部 */
  function sibLive(r) {
    var base = sibBaseline();
    var m = r.manual || {};
    var same = !m.camera && !m.lens && !m.light;
    var d = base ? r.score - base.score : 0;

    function item(kind, label, model, sub, prev) {
      return '<div class="sl-item' + (SIB_TAB === kind ? ' on' : '') + '" data-kind="' + kind + '">' +
        '<span class="sl-k">' + label + '</span>' +
        '<span class="sl-v"><b>' + esc(model) + '</b>' + (sub ? '<i>' + esc(sub) + '</i>' : '') +
        (prev && prev !== model ? '<i class="sl-prev">自动方案 ' + esc(prev) + '</i>' : '') + '</span>' +
        (m[kind] ? '<em>手动</em>' : '') +
        '</div>';
    }

    function dlt(cur, b, fmt, lowerBetter) {
      if (b == null || cur == null) return null;
      var v = cur - b;
      if (Math.abs(v) < 1e-9) return { t: '持平', g: 0 };
      return { t: (v > 0 ? '+' : '−') + fmt(Math.abs(v)), g: (lowerBetter ? v < 0 : v > 0) ? 1 : -1 };
    }

    var rows = sibMetricRow('像素精度', n4(r.camera.pxAcc) + ' mm/px',
      base ? dlt(r.camera.pxAcc, base.camera.pxAcc, function (v) { return n4(v); }, true) : null);
    rows += sibMetricRow('精度余量', r.margin >= 0 ? pct(r.margin) : '不足',
      base ? dlt(r.margin, base.margin, function (v) { return Math.round(v * 100) + 'pt'; }, false) : null);
    rows += sibMetricRow('景深', num(r.lens.dof, 2) + ' mm',
      base ? dlt(r.lens.dof, base.lens.dof, function (v) { return num(v, 2) + 'mm'; }, false) : null);

    var badge = same ? '当前即自动方案'
      : d > 0 ? '比自动方案 +' + d + ' 分'
      : d < 0 ? '比自动方案 −' + Math.abs(d) + ' 分'
      : '与自动方案同分 · 看指标';
    var badgeCls = (same || d === 0) ? 'same' : d > 0 ? 'good' : 'bad';

    return '<div class="sl-head"><span class="sl-title">当前方案</span>' +
        '<span class="sl-score' + (SIB_PULSE ? ' pulse' : '') + '">' + r.score + '<i>/100</i></span></div>' +
      '<div class="sl-badge ' + badgeCls + '">' + esc(badge) +
        (r.feasible ? '' : '　·　需升级') + '</div>' +
      '<div class="sl-items">' +
        item('camera', '相机', r.camera.model, num(r.camera.w * r.camera.h / 1e6, 1) + 'MP · ' + r.camera.fps + ' fps',
          base ? base.camera.model : null) +
        item('lens', '镜头', r.lens.model, r.lens.f + ' mm · F' + r.lens.aperture,
          base ? base.lens.model : null) +
        item('light', '光源', r.light.sku || r.light.seriesName || '—', r.light.colorName || '',
          base ? (base.light.sku || base.light.seriesName) : null) +
      '</div>' +
      '<div class="sl-metrics">' + rows + '</div>' +
      '<div class="sl-act">' +
        '<button type="button" data-action="auto"' + (same ? ' disabled' : '') + '>恢复自动</button>' +
        '<a href="#scoreCard">看完整方案 ↑</a>' +
      '</div>';
  }

  /** 同系列参数：一次只显示一类（相机/镜头/光源），点型号即换，右侧同步出结果 */
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
        '<td>' + (x.power == null ? '—' : x.power + ' W') + '</td>' +
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

    var camBrandShort = (brandMeta(r.camera.brand) || {}).short || '';
    var panes = [
      { k: 'camera', t: '相机', n: s.camera.total, inner: camBlockInner,
        sub: camBrandShort ? camBrandShort + ' · ' + s.camera.label : s.camera.label },
      { k: 'lens', t: '镜头', n: s.lens.total, inner: lensBlockInner, sub: s.lens.label },
      { k: 'light', t: '光源', n: s.light.total, inner: table([{ t: '型号' }, { t: '尺寸' }, { t: '功率' }], lightRows), sub: s.light.label }
    ];

    var tabs = '', body = '';
    panes.forEach(function (p) {
      tabs += '<button type="button" class="sib-tab' + (SIB_TAB === p.k ? ' on' : '') + '" data-tab="' + p.k + '">' +
        p.t + '<b>' + p.n + '</b></button>';
      body += '<div class="sib-pane' + (SIB_TAB === p.k ? ' on' : '') + '" data-pane="' + p.k + '">' +
        '<div class="sib-pane-h">' + esc(p.sub) + '</div>' +
        '<div class="sib-scroll">' + p.inner + '</div></div>';
    });

    var live = sibLive(r);
    SIB_PULSE = false;

    return '<div class="sib-wrap">' +
      '<div class="sib-main">' +
        '<div class="sib-tabs">' + tabs +
          '<span class="sib-hint">点型号切换，再点一次取消 · 高亮行是当前方案</span></div>' +
        body +
        '<div class="sib-note">「够用?」= 单看像素数是否达标，实际还看镜头、景深与带宽；标「备选」的是同样走得通的替代款。</div>' +
      '</div>' +
      '<aside class="sib-live">' + live + '</aside>' +
      '</div>';
  }

  /** 当前行滚出可视区时才拉回中间，避免每次点选表格都跳一下 */
  function sibEnsureCurrent() {
    var box = document.querySelector('#siblings .sib-pane.on .sib-scroll');
    if (!box) return;
    var cur = box.querySelector('tr.cur');
    if (!cur) return;
    var b = box.getBoundingClientRect(), c = cur.getBoundingClientRect();
    if (c.top < b.top + 34 || c.bottom > b.bottom - 4) {
      box.scrollTop += (c.top - b.top) - box.clientHeight / 2 + cur.offsetHeight / 2;
    }
  }

  /** 备选面板淡入一次：结束时撤掉 class，避免终态卡在半透明 */
  function pulseSibFade() {
    var pane = $('siblings').querySelector('.sib-pane.on');
    if (!pane) return;
    void pane.offsetWidth;
    pane.classList.add('sib-in');
    setTimeout(function () { pane.classList.remove('sib-in'); }, 320);
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
      '<div class="sib-note">可照抄的起始值，现场按直方图与标准件微调后固定。</div>';
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
      '<div class="sib-note">顺序：机械与打光（图像对比度达标）→ 标定 → 重复性与偏差。</div>';
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
      '<div class="sib-note">按均方根合成，未含温漂与振动；测量类建议用标准件实测复核。</div>';
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
      '<div class="sib-note">相机厚度取自官方尺寸（缺项按 45 mm 估）；镜头长度按手册或系列典型值' +
      (sp.adapter ? '（含转接环 12 mm）' : '') +
      '；线缆预留 25 mm。</div>';

    return s.join('') + spaceLine;
  }

  /* ---------------- 渲染 ---------------- */
  // 评分数字变了才闪一下：改完需求能立刻注意到「结果更新了」，值没变就不打扰
  var lastScoreTxt = '';
  // 简明结论板：记住上一次的文本 / 几何，只有真的变了才播一次反馈动画
  var lastHeroH = '', lastHeroP = '', lastMetric = {}, lastOaSig = '';
  var lastChipState = {};   // 9 项核查：上一轮每项是通过还是没过
  var lastPickSig = '';     // 三件套上一轮的型号组合
  function flashScore() {
    var el = $('scoreNum');
    if (!el) return;
    var t = el.textContent;
    if (t === lastScoreTxt) return;
    lastScoreTxt = t;
    el.classList.remove('flash');
    void el.offsetWidth;   // 强制重排，让同一个 class 能重新触发动画
    el.classList.add('flash');
  }

  function render() {
    if (!E || !CAT) {
      $('stateChip').className = 'tag bad';
      $('stateChip').textContent = '加载失败';
      $('summary').innerHTML = '<span style="color:#b91c1c">型号库或引擎未加载：请确认 hikrobot-catalog.js 与 engine.js 在同一目录。</span>';
      return;
    }

    var r = E.solve(readInput());
    Array.prototype.forEach.call(document.querySelectorAll('[data-combo-link]'), function (a) {
      a.href = comboLinkHref();
    });

    if (!r.ok) {
      $('scoreNum').innerHTML = '--';
      flashScore();
      $('scoreBar').style.width = '0%';
      $('scoreNote').textContent = '';
      $('verdicts').innerHTML = '';
      $('stateChip').className = 'tag bad';
      $('stateChip').textContent = '输入有误';
      $('summary').innerHTML = '<span style="color:#b91c1c">' + esc(r.error) + '</span>';
      $('heroChip').className = 'hero-chip bad';
      $('heroChip').textContent = '输入有误';
      $('heroNote').textContent = '';
      $('heroH').textContent = '先补全左侧需求';
      $('heroP').textContent = r.error;
      $('heroArt').innerHTML = '';
      $('heroMetrics').innerHTML = '';
      $('heroAssume').innerHTML = '';
      $('picks').innerHTML = '';
      lastHeroH = ''; lastHeroP = ''; lastMetric = {}; lastOaSig = ''; lastPickSig = '';
      $('checkChips').innerHTML = '';
      $('quick').innerHTML = '';
      $('cards').innerHTML = '';
      $('stitch').innerHTML = '';
      $('stitchSec').hidden = true;
      lastStitchSig = '';
      $('stitch').classList.remove('st-static');
      $('bom').innerHTML = '';
      $('calcBody').innerHTML = '';
      $('risks').innerHTML = '';
      $('riskCount').textContent = '';
      $('site').innerHTML = '';
      $('install').innerHTML = '';
      $('accept').innerHTML = '';
      return;
    }

    // 主数字是「通过了多少项工程核查」，不是质量分：100 分只代表没有触发扣分项，
    // 容易被读成「画质满分」，0-100 只留在备选方案之间做比较（见 scoreNote）。
    var chk = r.checks || [];
    var passN = 0;
    for (var ci = 0; ci < chk.length; ci++) if (chk[ci].ok) passN++;
    if (chk.length) {
      $('scoreNum').innerHTML = passN + '<small>/' + chk.length + '</small>';
      flashScore();
      $('scoreBar').style.width = Math.round(passN / chk.length * 100) + '%';
      $('scoreNote').textContent =
        (passN === chk.length ? '共 ' + chk.length + ' 项工程核查全部通过'
                              : '共 ' + chk.length + ' 项工程核查，' + (chk.length - passN) + ' 项未通过') +
        ' · 匹配度 ' + r.score + ' 分（仅用于备选方案间比较）';
    } else {
      $('scoreNum').innerHTML = r.score + '<small>/100</small>';
      flashScore();
      $('scoreBar').style.width = r.score + '%';
      $('scoreNote').textContent = '';
    }
    $('stateChip').className = 'tag ' + (r.feasible ? 'ok' : 'bad');
    $('stateChip').textContent = r.feasible ? '方案可行' : '需升级方案';
    // 可行时整句结论与下方三项判定重复，不再显示；不可行时保留一句提醒，避免三项判定全绿却说「需升级方案」
    $('summary').hidden = !!r.feasible;
    $('summary').innerHTML = r.feasible ? '' : esc(heroLine(r));
    $('verdicts').innerHTML = verdictsHtml(r);
    $('quick').innerHTML = quickRows(r);
    $('checkChips').innerHTML = checkChipsHtml(chk);
    // 查核结果翻转（过 → 不过 / 不过 → 过）时把那一枚 chip 闪一下，改完参数能一眼看到影响
    Array.prototype.forEach.call($('checkChips').querySelectorAll('.si-chip'), function (el) {
      var k = el.getAttribute('data-k'), ok = el.getAttribute('data-ok');
      if (lastChipState[k] != null && lastChipState[k] !== ok && !REDUCED) {
        el.classList.remove('flip');
        void el.offsetWidth;
        el.classList.add('flip');
      }
      lastChipState[k] = ok;
    });

    // 简明模式：一块结论板 —— 能不能用 / 怎么装 / 买什么（与专业模式同一份计算结果）
    var sh = simpleHero(r, passN, chk.length);
    $('heroChip').className = 'hero-chip' + (sh.bad ? ' bad' : '');
    $('heroChip').textContent = sh.chip;
    $('heroNote').textContent = sh.note;
    $('heroH').textContent = sh.h;
    $('heroP').textContent = sh.p;
    // 结论句 / 说明换字才动一次：连续调参时它们通常不变，不会一直抖
    if (sh.h !== lastHeroH) { pulseOnce($('heroH'), 'swap', 440); lastHeroH = sh.h; }
    if (sh.p !== lastHeroP) { pulseOnce($('heroP'), 'swap', 440); lastHeroP = sh.p; }

    // 光锥按几何（视野 / 工作距离）判断：只在真的改了尺寸时从镜头处张开一次
    var oaSig = [num(r.input.fovW, 0), num(r.input.fovH, 0), Math.round((r.lens && r.lens.wd) || 0)].join('/');
    $('heroArt').innerHTML = opticsSvg(r, oaSig !== lastOaSig);
    lastOaSig = oaSig;

    // 成绩单：逐格比对，数字变了的才推一下
    $('heroMetrics').innerHTML = metricsHtml(r);
    Array.prototype.forEach.call($('heroMetrics').querySelectorAll('.hm'), function (el) {
      var k = el.getAttribute('data-k'), v = el.querySelector('.hm-v');
      if (!v) return;
      var t = v.textContent;
      if (lastMetric[k] && lastMetric[k] !== t && !REDUCED) v.classList.add('flash');
      lastMetric[k] = t;
    });
    // 简明模式不填最小特征与工作距离，明说按什么值算的
    var hadn = r.input || {};
    $('heroAssume').innerHTML = '按最小特征 <b>' + num(hadn.precision, 3) + ' mm</b>、工作距离 <b>' +
      num(hadn.wd, 0) + ' mm</b> 估算';
    $('picks').innerHTML = pickCardsHtml(r);
    // 三件套整体换型号（换了档位 / 关了某个品牌）才让三张卡依次落位；
    // 只是数值微调、型号没动时不重播，避免连续调参时一直闪。
    var pickSig = [r.camera.model, r.lens.model, (r.light.sku || r.light.seriesName || '')].join('/');
    if (pickSig !== lastPickSig) {
      lastPickSig = pickSig;
      if (!REDUCED) {
        Array.prototype.forEach.call($('picks').children, function (el, i) {
          el.style.setProperty('--i', i);
          el.classList.add('pick-in');
        });
      }
    }

    $('cards').innerHTML = camCard(r) + lensCard(r) + lightCard(r);
    // 拼接方案独立成卡：三件套网格塞不下对比表和排布图
    var stHtml = stitchCard(r);
    $('stitch').innerHTML = stHtml;
    $('stitchSec').hidden = !stHtml;
    // 排布图：只在台数 / 相机 / 几何真的变了才按台次入场；连续调参重算不重播
    if (!stHtml) {
      lastStitchSig = '';
      $('stitch').classList.remove('st-static');
    } else {
      var sg = r.lineScanStitch.best;
      var sig = [r.lineScanStitch.totalW, sg.n, sg.camera.model, Math.round(sg.pitch),
        Math.round(sg.fovPer), Math.round(sg.overlapW)].join('/');
      if (sig === lastStitchSig) $('stitch').classList.add('st-static');
      else {
        $('stitch').classList.remove('st-static');
        lastStitchSig = sig;
        // 动画放完撤掉动画类，避免某些浏览器把终态停在首帧
        var seq = ++stitchAnimSeq;
        setTimeout(function () { if (seq === stitchAnimSeq) $('stitch').classList.add('st-static'); }, 1100);
      }
    }
    $('bom').innerHTML = bomCard(r);
    $('suggest').innerHTML = suggestCard(r);
    // 同系列面板重绘时保留表格滚动位置，避免每次点选都跳回顶部
    var sibBox = document.querySelector('#siblings .sib-pane.on .sib-scroll');
    var sibTop = sibBox ? sibBox.scrollTop : 0;
    $('siblings').innerHTML = siblingCard(r);
    if (SIB_FADE) {
      pulseSibFade();
      SIB_FADE = false;
    }
    var sibBox2 = document.querySelector('#siblings .sib-pane.on .sib-scroll');
    if (sibBox2) { sibBox2.scrollTop = sibTop; sibEnsureCurrent(); }
    $('site').innerHTML = siteCard(r);
    $('install').innerHTML = installCard(r);
    $('accept').innerHTML = acceptCard(r);
    $('budget').innerHTML = budgetCard(r);
    $('diagram').innerHTML = diagramCard(r);

    // 这段是 12.5px 的说明小字，六家 logo 混排时双行锁定稿（华睿 / 奥普特）会被压到看不清，
    // 统一改用品牌名文本，跟正文同字号反而更整齐。
    var bNames = Object.keys(BRANDS).filter(function (k) {
      return activeBrands.indexOf(k) >= 0 && window[BRANDS[k].global];
    }).map(function (k) { return esc(BRANDS[k].short); }).join(' · ');
    var st = CAT._stats || {}, inv = st.invalid || {}, fill = st.filled || {};
    function sumObj(o) {
      var n = 0;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n += o[k];
      return n;
    }
    var invN = sumObj(inv), fillN = sumObj(fill), retN = st.retired || 0;
    $('catalogNote').innerHTML =
      (bNames ? '在售品牌 <b>' + bNames + '</b>。' : '') +
      '已启用：面阵 <b>' + CAT.CAMERAS.length + '</b> 台、线扫 <b>' + (CAT.LINESCAN || []).length +
      '</b> 台、镜头 <b>' + CAT.LENSES.length + '</b> 支、远心 <b>' + (CAT.TELECENTRIC || []).length +
      '</b> 系列、光源 <b>' + (CAT.LIGHTS || []).length + '</b> 款、控制器 <b>' + (CAT.CONTROLLERS || []).length + '</b> 款。' +
      '<span style="color:#94a3b8">已启用：相机 ' + activeBrands.length + ' / 镜头 ' + activeLensBrands.length +
      ' / 光源 ' + activeLightBrands.length + ' 品牌在售官方型录；已排除 <b>' + retN + '</b> 款退市型号与 <b>' +
      invN + '</b> 款必要参数不全 / 不适用该算路的型号（厂商未公布卡口、无结构化尺寸、变倍镜头无定焦距等），' +
      (fillN ? '另按等价字段补齐 ' + fillN + ' 处（pxH←pxUm、wdMax←wdMin），' : '') +
      '避免算出不可行方案。靶面缺项按像素尺寸推导并标注「估算」，不影响选型计算。非官方辅助工具。</span>';

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
    $('riskCount').className = warns > 0 ? 'sum-hint warn' : 'sum-hint';

    // 移动端（仿小程序）：更新表单摘要 / 折叠方案卡 / 刷新分段高亮
    var fs = [];
    fs.push(r.input.fovW + '×' + r.input.fovH + 'mm');
    // 简明模式不填最小特征与工作距离，摘要里也不摆这两项
    if (MODE === 'pro') fs.push('δ ' + r.input.precision + 'mm');
    fs.push(String(r.task.label).split('（')[0]);
    if (MODE === 'pro') fs.push('WD ' + r.input.wd + 'mm');
    if (r.input.needColor) fs.push('彩色');
    if (r.input.speed > 0) fs.push(r.input.speed + 'mm/s');
    $('fsTxt').textContent = fs.join(' · ');
    foldCards();
    updateSegbar();
  }

  /* ---------------- 复制方案 ---------------- */
  /* 移动端（仿小程序）：分段导航锚点 / 滚动高亮 / 方案卡折叠后处理（render 与 init 共用） */
  var SEGS = { form: '#sec-form', sol: '[data-anchor="sol"]', detail: '[data-anchor="detail"]' };
  function updateSegbar() {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    var best = null, bestTop = -1e9;
    Object.keys(SEGS).forEach(function (k) {
      var el = document.querySelector(SEGS[k]);
      if (!el) return;
      // 简明模式下「详细方案」整块隐藏，别把它算进高亮
      if (el.offsetParent === null && el.getClientRects().length === 0) return;
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
      if (kvs.length + blocks.length < 7) return;
      Array.prototype.forEach.call(kvs, function (kv, i) { if (i >= 6) kv.classList.add('kv-extra'); });
      Array.prototype.forEach.call(blocks, function (b, j) { if (j >= 4) b.classList.add('kv-extra'); });
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
    lines.push('· 光源：' + (g.skuBrand ? '[' + g.skuBrand + '] ' : '') + (g.sku || g.series) + '（' + g.seriesName + '），' + g.colorName + ' ' + g.wavelength +
      (hikRuleOf(g) ? '（后缀 ' + g.suffix + '）' : ''));
    if (hikRuleOf(g)) lines.push('　 型号构成：' + g.example);
    if (g.skuNote) lines.push('　 选型说明：' + g.skuNote);
    lines.push('　 安装：' + g.angle);
    lines.push('　 尺寸：' + g.size);
    lines.push('　 配件：' + (g.accessories.length ? g.accessories.join('；') : '无'));
    lines.push('　 控制：' + g.controller);
    if (g.power != null) {
      lines.push('　 功率：' + g.power + ' W × ' + g.count + ' 只 = ' + g.totalPower + ' W' +
        (g.controllerModel ? '；控制器 ' + g.controllerModel + '（' + g.controllerChannels + ' 通道）' : ''));
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
    if (r.lineScanStitch) {
      var sg = r.lineScanStitch;
      lines.push('');
      lines.push('· 线扫多机拼接：总幅面 ' + num(sg.totalW, 0) + 'mm，重叠 ' + Math.round(sg.overlap * 100) + '%，台数上限 ' + sg.maxCams);
      if (!sg.ok) {
        lines.push('　 当前不可行：' + sg.reason);
        if (sg.needCams) lines.push('　 至少需要 ' + sg.needCams + ' 台');
      } else {
        lines.push('　 方案对比（台数 / 相机 / 单台视场 / 实际精度 / 光轴间距 / 重叠 / 行频 / 合计带宽）：');
        sg.plans.forEach(function (p, i) {
          lines.push('　 ' + (i === 0 ? '★ ' : '　 ') + p.n + ' 台　' + p.camera.model + '　' +
            num(p.fovPer, 0) + 'mm　' + n4(p.pxAcc) + 'mm/px　间距 ' + num(p.pitch, 0) + 'mm　重叠 ' +
            p.overlapPx + 'px　' + num(p.rate, 1) + 'kHz　' + num(p.bandwidthTotal, 0) + 'MB/s');
        });
        var bp = sg.best;
        lines.push('　 推荐 ' + bp.n + ' 台：' + bp.camera.model + '，镜头 ' +
          (bp.lens ? ((bp.lens.brand ? '[' + bp.lens.brand + '] ' : '') + bp.lens.model + '（' + bp.lens.focal + 'mm ' + bp.lens.mount + ' 口）')
                   : (bp.lensNote || '库内无直配型号，需另配')));
        if (bp.light) {
          lines.push('　 整幅光源：' + (bp.light.brand ? '[' + bp.light.brand + '] ' : '') + bp.light.model +
            '　' + (bp.light.count > 1 ? bp.light.count + ' 段对接（' + bp.light.note + '）' : '整条 ' + bp.light.len + 'mm'));
        }
        lines.push('　 合计像素 ' + bp.pixelTotal + 'px，相机合计功耗 ' +
          (bp.camPowerTotal == null ? '—' : num(bp.camPowerTotal, 1) + 'W') + '，合计带宽 ' + num(bp.bandwidthTotal, 0) + 'MB/s');
        sg.notes.forEach(function (x) { lines.push('　 · ' + x); });
      }
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
      setTimeout(function () { btn.textContent = '复制方案'; }, 1600);
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

  // 链接里携带的固定型号。applyState 会清空 manual，所以要在它之后再回填。
  var queryPicks = null;

  /** 从 URL 读取表单参数，便于把具体需求发给别人 */
  function fromQuery() {
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (e) { return {}; }
    var q = {};
    // 数值项：空串与非法值一律忽略，避免把 NaN 填进输入框
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space',
      'stitchOverlap', 'stitchMaxCams'].forEach(function (k) {
      var v = sp.get(k);
      if (v != null && v !== '' && isFinite(parseFloat(v))) q[k] = parseFloat(v);
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      var v = sp.get(k);
      if (v) q[k] = v;
    });
    if (sp.get('needColor') === '1') q.needColor = true;
    if (sp.get('lineScanFirst') === '1') q.lineScanFirst = true;

    var cam = sp.get('cam'), lens = sp.get('lens'), light = sp.get('light');
    if (cam || lens || light) queryPicks = { cam: cam || null, lens: lens || null, light: light || null };
    return q;
  }

  /**
   * 把「当前需求 + 已固定型号」编码成一条可分享的链接。
   * 只带真正有值的项，所以默认需求不会生成一长串 ?fovW=&fovH=…
   */
  function shareUrl() {
    var parts = [];
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space'].forEach(function (k) {
      var v = $(k) ? $(k).value : '';
      if (v !== '' && v != null) parts.push(k + '=' + encodeURIComponent(v));
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      if ($(k) && $(k).value) parts.push(k + '=' + encodeURIComponent($(k).value));
    });
    if ($('needColor') && $('needColor').checked) parts.push('needColor=1');
    if ($('lineScanFirst') && $('lineScanFirst').checked) parts.push('lineScanFirst=1');
    // 拼接参数只在勾了线扫时才有意义，没勾就不带，免得对方打开看到一堆无效值
    if ($('lineScanFirst') && $('lineScanFirst').checked) {
      ['stitchOverlap', 'stitchMaxCams'].forEach(function (k) {
        if ($(k) && $(k).value !== '') parts.push(k + '=' + encodeURIComponent($(k).value));
      });
    }
    if (manual.camera) parts.push('cam=' + encodeURIComponent(manual.camera));
    if (manual.lens) parts.push('lens=' + encodeURIComponent(manual.lens));
    if (manual.light) parts.push('light=' + encodeURIComponent(manual.light));
    var base = location.href.split('#')[0].split('?')[0];
    return base + (parts.length ? '?' + parts.join('&') : '');
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    renderBrandFilter();
    renderLensFilter();
    renderLightFilter();
    fillSelects();

    // 输入框逐字符触发全量重算（型号库 8868 条），120ms 内的连续输入合并成一次；
    // 下拉与复选框是离散动作，立刻算，不等防抖。
    var renderTimer = null;
    function renderSoon() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 120);
    }
    function renderNow() {
      clearTimeout(renderTimer);
      render();
    }
    Array.prototype.forEach.call(document.querySelectorAll('input, select'), function (el) {
      var discrete = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio';
      el.addEventListener('input', discrete ? renderNow : renderSoon);
      el.addEventListener('change', renderNow);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = PRESETS[btn.getAttribute('data-preset')];
        if (p) applyState(p);
      });
    });

    $('resetBtn').addEventListener('click', function () { applyState(DEFAULT); });
    if ($('lineScanFirst')) $('lineScanFirst').addEventListener('change', syncStitchOpt);
    syncStitchOpt();
    $('copyBtn').addEventListener('click', copyText);

    // 复制分享链接：只读当前表单与固定型号，不改地址栏（否则用户改完参数会对不上）
    var shareBtn = $('shareBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var url = shareUrl();
        var done = function () {
          shareBtn.textContent = '链接已复制 ✓';
          setTimeout(function () { shareBtn.textContent = '复制链接'; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
        } else {
          fallbackCopy(url, done);
        }
      });
    }

    /* ---------------- 详细方案：大屏默认摊开，手机按需展开 ---------------- */
    var detailWrap = $('detailWrap');
    function jumpTo(el) {
      if (!el) return;
      var top = el.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    if (detailWrap) {
      // 大屏：详细方案与同系列默认展开；验算过程与工程细节默认收起（要看再点）
      var mqWide = window.matchMedia('(min-width: 1021px)');
      var wideFolds = ['sib'];
      function applyWideFolds() {
        if (!mqWide.matches) return;
        detailWrap.open = true;
        wideFolds.forEach(function (k) {
          var d = document.querySelector('details[data-anchor="' + k + '"]');
          if (d) d.open = true;
        });
      }
      applyWideFolds();
      if (mqWide.addEventListener) mqWide.addEventListener('change', applyWideFolds);
      // 速览型号：展开详细方案并跳到对应参数卡
      if ($('quick')) {
        $('quick').addEventListener('click', function (e) {
          var seg = e.target.closest('[data-goto]');
          if (!seg) return;
          detailWrap.open = true;
          jumpTo(document.getElementById('card-' + seg.getAttribute('data-goto')));
        });
      }
      // 扩展建议里的拼接结论：一句结论在首屏，细节在详细方案，点一下过去
      if ($('suggest')) {
        $('suggest').addEventListener('click', function (e) {
          if (!e.target.closest('[data-stitch-jump]')) return;
          detailWrap.open = true;
          jumpTo($('stitchSec'));
        });
      }
    }

    /* ---------------- 导出 PDF：打印前把折叠全展开 ---------------- */
    // 打印稿里折叠区如果保持收起，导出的 PDF 就只有半页结论；beforeprint 里统一摊开，
    // afterprint 再还原，Ctrl+P 走同一套逻辑，不必依赖按钮。
    var foldState = null;
    function openAllFolds() {
      if (foldState) return;   // 点击按钮已展开过一次，beforeprint 再触发时别覆盖原始状态
      var list = document.querySelectorAll('details');
      foldState = Array.prototype.map.call(list, function (d) { return d.open; });
      Array.prototype.forEach.call(list, function (d) { d.open = true; });
      var req = $('printReq');
      if (req) {
        var i = readInput();
        var taskSel = $('task');
        var taskTxt = taskSel && taskSel.options[taskSel.selectedIndex]
          ? taskSel.options[taskSel.selectedIndex].textContent : i.task;
        req.textContent = '需求：视野 ' + num(i.fovW, 0) + '×' + num(i.fovH, 0) + ' mm · 最小特征 ' +
          num(i.precision, 2) + ' mm · 工作距离 ' + num(i.wd, 0) + ' mm · ' + taskTxt +
          '　|　生成时间 ' + new Date().toLocaleString('zh-CN', { hour12: false });
      }
    }
    function restoreFolds() {
      if (!foldState) return;
      var list = document.querySelectorAll('details');
      Array.prototype.forEach.call(list, function (d, i) {
        if (i < foldState.length) d.open = foldState[i];
      });
      foldState = null;
    }
    window.addEventListener('beforeprint', openAllFolds);
    window.addEventListener('afterprint', restoreFolds);
    if ($('pdfBtn')) {
      $('pdfBtn').addEventListener('click', function () {
        openAllFolds();
        window.print();
        // 某些浏览器不派发 afterprint，兜底还原
        setTimeout(restoreFolds, 400);
      });
    }

    // 简明 / 专业：顶栏开关与结论卡里的「切到专业」共用一套委托
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-mode]');
      if (t) setMode(t.getAttribute('data-mode'));
    });
    // 首帧按已读模式摆好开关与左栏折叠状态（不再触发一次全量重算）
    var sw0 = $('modeSwitch');
    if (sw0) {
      Array.prototype.forEach.call(sw0.querySelectorAll('[data-mode]'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-mode') === MODE);
      });
    }
    var rp0 = $('reqPro');
    if (rp0) rp0.open = MODE === 'pro';
    // 简明模式下点「专业参数」就是在要细节：直接切到专业，避免展开后字段仍被模式规则隐藏
    if (rp0) {
      var rpSum = rp0.querySelector('summary');
      if (rpSum) rpSum.addEventListener('click', function (e) {
        if (MODE === 'pro') return;
        e.preventDefault();
        setMode('pro');
      });
    }

    // 左栏 sticky 面板的高度按「视口内实际顶部」算。
    // 写死 100vh-32 只在吸顶之后成立：页面停在顶部时面板是从页头下方（≈119px）才开始的，
    // 底边会超出视口 100 px 上下，于是内容没超限时滚不动、超限时内部滚到底也差这一截。
    var reqCol = document.querySelector('.req-col');
    if (reqCol) {
      var reqColRaf = 0;
      var fitReqCol = function () {
        reqColRaf = 0;
        // 折叠态只有窄轨，不需要内滚动框
        if (document.documentElement.classList.contains('req-folded')) {
          if (reqCol.style.maxHeight) reqCol.style.maxHeight = '';
          return;
        }
        // 窄屏（≤1020）是单列堆叠，面板跟着整页滚，不该自带内滚动框：把内联高度让开
        if (window.matchMedia('(max-width: 1020px)').matches) {
          if (reqCol.style.maxHeight) reqCol.style.maxHeight = '';
          return;
        }
        var top = Math.max(16, reqCol.getBoundingClientRect().top);
        // 与右侧「一屏」卡片同口径（-20）：两栏等高，页面才不会因为左栏多出几像素而出现滚动条
        var h = Math.max(320, Math.round(window.innerHeight - top - 20));
        var v = h + 'px';
        if (reqCol.style.maxHeight !== v) reqCol.style.maxHeight = v;
      };
      var queueFitReqCol = function () { if (!reqColRaf) reqColRaf = requestAnimationFrame(fitReqCol); };
      fitColFn = fitReqCol;
      window.addEventListener('scroll', queueFitReqCol, { passive: true });
      window.addEventListener('resize', queueFitReqCol);
      window.addEventListener('load', queueFitReqCol);
      fitReqCol();

      // 需求面板折叠：收起后左栏只剩 54px 窄轨，右栏占满剩下的宽度（列宽用 CSS 过渡）
      var foldReq = function (on) {
        document.documentElement.classList.toggle('req-folded', !!on);
        try { localStorage.setItem('vs-req-fold', on ? '1' : '0'); } catch (e) {}
        reqCol.scrollTop = 0;   // 收起/展开后都从面板顶部开始，别停在半截
        if (fitColFn) requestAnimationFrame(fitColFn);
      };
      var rfBtn = $('reqFold'), rfRail = $('reqRail');
      if (rfBtn) rfBtn.addEventListener('click', function () { foldReq(true); });
      if (rfRail) rfRail.addEventListener('click', function () { foldReq(false); });

      // 简明模式：结论卡（三件套 + 结论板）锁在一屏内，不让外行往下滚才看到按钮。
      // 高度按「视口 − 卡片实际顶边 − 底部留白」算，比 CSS calc 稳（顶栏会随宽度变高）。
      var scoreCard = $('scoreCard');
      var fitSimpleCard = function () {
        if (!scoreCard) return;
        if (MODE !== 'simple' || window.innerWidth < 1021) {
          if (scoreCard.style.height) scoreCard.style.height = '';
          return;
        }
        // 顶边用 offsetTop 累加量：模式切换有 6px 位移的淡入动画，getBoundingClientRect 会把它算进去
        var top = 0, el = scoreCard;
        while (el) { top += el.offsetTop; el = el.offsetParent; }
        var v = Math.max(600, Math.round(window.innerHeight - top - 20)) + 'px';
        if (scoreCard.style.height !== v) scoreCard.style.height = v;
      };
      fitCardFn = fitSimpleCard;
      window.addEventListener('resize', fitSimpleCard);
      window.addEventListener('load', fitSimpleCard);
      fitSimpleCard();
    }

    // 品牌范围常驻显示，不再折叠（见 index.html .brands-fold）
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
      // 折叠区被跳转时自动展开
      if (el.tagName === 'DETAILS' && !el.open) el.open = true;
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

    // 同系列面板：切标签 / 点型号 = 手动指定（再点取消）/ 恢复自动
    $('siblings').addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (tab) {
        SIB_TAB = tab.getAttribute('data-tab');
        Array.prototype.forEach.call($('siblings').querySelectorAll('.sib-tab'), function (b) {
          b.classList.toggle('on', b === tab);
        });
        Array.prototype.forEach.call($('siblings').querySelectorAll('.sib-pane'), function (p) {
          var on = p.getAttribute('data-pane') === SIB_TAB;
          p.classList.toggle('on', on);
          if (!on) p.classList.remove('sib-in');
        });
        pulseSibFade();
        Array.prototype.forEach.call($('siblings').querySelectorAll('.sl-item'), function (it) {
          it.classList.toggle('on', it.getAttribute('data-kind') === SIB_TAB);
        });
        sibEnsureCurrent();
        return;
      }
      var auto = e.target.closest('[data-action="auto"]');
      if (auto) {
        manual.camera = null;
        manual.lens = null;
        manual.light = null;
        SIB_PULSE = true;
        SIB_FADE = true;
        render();
        return;
      }
      var tr = e.target.closest('tr[data-kind]');
      if (!tr) return;
      var kind = tr.getAttribute('data-kind');
      var model = tr.getAttribute('data-model');
      if (!kind || !model) return;
      manual[kind] = manual[kind] === model ? null : model;
      SIB_PULSE = true;
      SIB_FADE = true;
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
    } else if (queryPicks) {
      // 分享链接里带了固定型号：放在 applyState 之后回填（那一步会把 manual 清空）。
      // 搭配页的交接属于主动动作，优先级高于链接，所以只在没有交接时才用。
      manual.camera = queryPicks.cam;
      manual.lens = queryPicks.lens;
      manual.light = queryPicks.light;
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
