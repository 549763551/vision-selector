/* 自定义搭配评定：从型号库自选相机 / 镜头 / 光源 → evaluateCombo 逐项评定 */
(function () {
  'use strict';

  var BRANDS = window.BRANDS || {};
  var $ = function (id) { return document.getElementById(id); };
  var DRAFT_KEY = 'vs-combo';          // 搭配台草稿（与产品库共用）
  var APPLY_KEY = 'vs-combo-apply';    // 只在「应用到选型助手」时写入，由 app.js 一次性读取

  /* ---------------- 目录合并（与 app.js 口径一致） ---------------- */
  function buildCatalog() {
    var cam = [], linescan = [], lenses = [], tele = [], lights = [], ctrls = [];
    (window.availableBrands ? window.availableBrands() : []).forEach(function (key) {
      var C = window[BRANDS[key].global];
      if (!C) return;
      (C.CAMERAS || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; cam.push(x); });
      (C.LENSES || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; lenses.push(x); });
      (C.LINESCAN || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; linescan.push(x); });
      (C.LIGHTS || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; lights.push(x); });
      tele = tele.concat(C.TELECENTRIC || []);
      (C.CONTROLLERS || []).forEach(function (x) { if (!x.brand) x.brand = BRANDS[key].name; ctrls.push(x); });
    });
    if (window.BaslerLensCatalog) {
      (window.BaslerLensCatalog.LENSES || []).forEach(function (x) {
        x.brand = x.brand || 'Basler';
        lenses.push(x);
      });
      tele = tele.concat(window.BaslerLensCatalog.TELECENTRIC || []);
    }
    return {
      META: { source: '多品牌合并目录', brand: '多品牌', generated: '', cameras: cam.length },
      CAMERAS: cam, LINESCAN: linescan, LENSES: lenses,
      TELECENTRIC: tele, LIGHTS: lights, CONTROLLERS: ctrls, PROFILERS: []
    };
  }

  var CAT = buildCatalog();
  var E = (window.VisionEngineFactory || window.VisionEngine)(CAT);

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
  function numVal(id) {
    var v = parseFloat($(id).value);
    return isNaN(v) ? undefined : v;
  }
  function keyOf(d) { return (d.brand ? d.brand + '::' : '') + d.model; }
  function recOf(key) {
    if (!key) return null;
    var p = String(key).split('::');
    return p.length > 1 ? { b: p[0], m: p[1] } : { b: null, m: p[0] };
  }

  // 品牌名在不同库里可能是注册键（hikrobot）或型录显示名（海康机器人 HIKROBOT / 华睿），统一成注册键再比较
  function brandKey(b) {
    if (!b) return null;
    if (BRANDS[b]) return b;
    var low = String(b).toLowerCase();
    var ks = Object.keys(BRANDS);
    for (var i = 0; i < ks.length; i++) {
      var m = BRANDS[ks[i]];
      if (!m) continue;
      if (m.key === b || m.name === b || m.short === b) return m.key;
      if (String(m.key).toLowerCase() === low || String(m.short).toLowerCase() === low) return m.key;
      if (b.indexOf(m.short) >= 0) return m.key;
    }
    return b;
  }

  // 把「注册键::型号」等别名写法还原成当前目录里的「显示品牌::型号」
  function resolveKey(kind, key) {
    if (!key) return null;
    var p = String(key).split('::');
    var wantBrand = p.length > 1 ? p[0] : null;
    var wantModel = p.length > 1 ? p[1] : p[0];
    var list = SLOTS[kind].src();
    var matches = list.filter(function (x) { return x.model === wantModel; });
    if (!matches.length) return key;
    var hit = wantBrand
      ? matches.filter(function (x) { return brandKey(x.brand) === brandKey(wantBrand); })[0]
      : matches[0];
    return keyOf(hit || matches[0]);
  }

  // 品牌归属标：按 brands.js 的 logo / logoScale 标注数据来源（与选型助手方案卡一致）
  function brandMeta(b) {
    var m = BRANDS[brandKey(b)];
    return m && m.logo ? m : null;
  }
  function brandShort(b) {
    var m = brandMeta(b);
    return m && m.short ? m.short : (b || '—');
  }
  function brandLogo(b, cls) {
    var m = brandMeta(b);
    if (!m) return '';
    return '<img class="' + cls + '" src="' + esc(m.logo) + '" alt="' + esc(m.short) + '"' +
      ' title="' + esc(m.name) + '" style="--logo-scale:' + (m.logoScale || 1) + '" />';
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function unstore(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 隐私模式忽略 */ }
  }
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  /* 收藏：产品库「☆ 收藏」写入，这里在选择器里直接列出（共用 vs-fav） */
  var FAV_KEY = 'vs-fav';
  var FAV_SLOT = { cam: 'camera', lens: 'lens', light: 'light' };
  function favList() {
    var v = load(FAV_KEY);
    return Array.isArray(v) ? v : [];
  }
  function favKeyOf(key) {
    var p = String(key || '').split('::');
    var b = p.length > 1 ? p[0] : '';
    var m = p.length > 1 ? p[1] : p[0];
    return (brandKey(b) || '') + '::' + m;
  }
  function isFav(d) {
    var k = favKeyOf(keyOf(d));
    return favList().some(function (x) { return favKeyOf((x.b || '') + '::' + x.m) === k; });
  }
  function favModels(kind) {
    var out = [], seen = {};
    favList().forEach(function (x) {
      if (FAV_SLOT[x.c] !== kind) return;
      var d = findIn(kind, (x.b || '') + '::' + x.m);
      if (!d) return;
      var k = keyOf(d);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(d);
    });
    return out;
  }

  var LIGHT_LABEL = {
    ring: '环形光', ring_dome: '环形无影光', bar: '条形光', bar_array: '组合条形光',
    backlight: '面光源', backlight_parallel: '平行面光源', backlight_hole: '中孔面光源', backlight_side: '侧导面光源',
    dome: '穹顶光', flat_shadowless: '平面无影光', coaxial: '同轴光',
    line: '线光源', line_high: '高亮线光源', line_focus: '聚光线光源', line_coax: '同轴线光源', point: '点光源'
  };
  var LIGHT_COLOR_LABEL = { white: '白光', red: '红光', blue: '蓝光', green: '绿光', yellow: '黄光', ir: '红外', cyan: '青光' };

  /* ---------------- 搭配槽位 ---------------- */
  var sel = { camera: null, lens: null, light: null };
  var results = { camera: [], lens: [], light: [] };

  var SLOTS = {
    camera: {
      input: 'camInput', list: 'camList', picked: 'camPicked',
      src: function () { return CAT.CAMERAS || []; },
      spec: function (d) {
        return d.w + '×' + d.h + ' px · ' + num(d.w * d.h / 1e6, 1) + ' MP · ' + (d.iface || '—') +
          ' · ' + (d.mount || '—') + ' 口 · ' + (d.color || '—') + (d.shutter ? ' · ' + d.shutter : '');
      },
      hay: function (d) {
        return [d.brand, d.model, d.series, d.iface, d.mount, d.color, d.sensor,
          d.w + 'x' + d.h, d.w + '×' + d.h, num(d.w * d.h / 1e6, 0) + 'mp'].join(' ');
      }
    },
    lens: {
      input: 'lensInput', list: 'lensList', picked: 'lensPicked',
      src: function () { return CAT.LENSES || []; },
      spec: function (d) {
        return d.focal + ' mm · ' + (d.mount || '—') + ' 口 · ' +
          (d.mp ? d.mp + ' MP' : '解析力未标注') + (d.ic ? ' · 像面 ' + d.ic + ' mm' : '') +
          (d.fmin ? ' · F' + d.fmin + '–F' + (d.fmax || 22) : '');
      },
      hay: function (d) {
        return [d.brand, d.model, d.series, d.mount, d.focal + 'mm', d.mp ? d.mp + 'mp' : ''].join(' ');
      }
    },
    light: {
      input: 'lightInput', list: 'lightList', picked: 'lightPicked',
      src: function () { return CAT.LIGHTS || []; },
      spec: function (d) {
        return (LIGHT_LABEL[d.type] || d.type || '光源') + ' · ' + (LIGHT_COLOR_LABEL[d.color] || d.color || '—') +
          ' · ' + (d.size || []).join('×') + ' mm' + (d.power != null ? ' · ' + d.power + ' W' : '');
      },
      hay: function (d) {
        return [d.brand, d.model, d.series, d.type, LIGHT_LABEL[d.type], d.color, LIGHT_COLOR_LABEL[d.color],
          (d.size || []).join('x'), (d.size || []).join('×')].join(' ');
      }
    }
  };

  function findIn(kind, key) {
    if (!key) return null;
    var p = String(key).split('::');
    var wantBrand = p.length > 1 ? p[0] : null;
    var wantModel = p.length > 1 ? p[1] : p[0];
    var list = SLOTS[kind].src();
    for (var i = 0; i < list.length; i++) {
      if (list[i].model === wantModel && (!wantBrand || brandKey(list[i].brand) === brandKey(wantBrand))) return list[i];
    }
    return null;
  }

  /* ---------------- 需求表单 ---------------- */
  function fillSelects() {
    $('task').innerHTML = Object.keys(E.TASKS).map(function (k) {
      return '<option value="' + k + '">' + esc(E.TASKS[k].label) + '</option>';
    }).join('');
    $('material').innerHTML = Object.keys(E.MATERIALS).map(function (k) {
      return '<option value="' + k + '">' + esc(E.MATERIALS[k]) + '</option>';
    }).join('');
    $('colorTarget').innerHTML = '<option value="none">不指定（按材质与任务自动选）</option>' +
      Object.keys(E.COLOR).map(function (k) {
        return '<option value="' + k + '">' + esc(E.COLOR[k].name) + ' ' + esc(E.COLOR[k].wl) + '</option>';
      }).join('');
  }

  function readReq() {
    return {
      fovW: numVal('fovW'), fovH: numVal('fovH'), precision: numVal('precision'),
      task: $('task').value, wd: numVal('wd'), material: $('material').value,
      colorTarget: $('colorTarget').value, needColor: $('needColor').checked,
      heightDiff: numVal('heightDiff'), speed: numVal('speed'), cpm: numVal('cpm'),
      space: numVal('space')
    };
  }

  function applyReq(o) {
    if (!o) return;
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space'].forEach(function (k) {
      if (o[k] != null && o[k] !== '') $(k).value = o[k];
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      if (o[k]) $(k).value = o[k];
    });
    if (o.needColor != null) $('needColor').checked = !!o.needColor;
  }

  function readQuery() {
    var o = {}, any = false;
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (e) { return null; }
    ['fovW', 'fovH', 'precision', 'wd', 'heightDiff', 'speed', 'cpm', 'space'].forEach(function (k) {
      var v = parseFloat(sp.get(k));
      if (!isNaN(v)) { o[k] = v; any = true; }
    });
    ['task', 'material', 'colorTarget'].forEach(function (k) {
      var v = sp.get(k);
      if (v) { o[k] = v; any = true; }
    });
    if (sp.get('needColor') === '1') { o.needColor = true; any = true; }
    return any ? o : null;
  }

  /* ---------------- 选择器 ---------------- */
  function pickItemHtml(kind, d) {
    var key = keyOf(d);
    return '<button type="button" class="cmpick-item' + (sel[kind] === key ? ' on' : '') + '"' +
      ' data-pick-kind="' + kind + '" data-pick-key="' + esc(key) + '">' +
      '<span class="ck-head">' + brandLogo(d.brand, 'ck-logo') +
        '<b title="' + esc(d.brand || '') + '">' + esc(brandShort(d.brand)) + '</b>' + esc(d.model) +
        (isFav(d) ? '<span class="ck-fav" title="已收藏">★</span>' : '') + '</span>' +
      '<span>' + esc(SLOTS[kind].spec(d)) + '</span></button>';
  }

  function renderList(kind) {
    var slot = SLOTS[kind];
    var box = $(slot.list);
    var term = String($(slot.input).value || '').trim().toLowerCase();
    if (!term) {
      // 未输入关键词时先列收藏，产品库收藏过的型号可以直接点选
      var favs = favModels(kind);
      results[kind] = favs;
      box.innerHTML = favs.length
        ? '<div class="cmpick-hint">★ 收藏（点击直接填入）</div>' +
          favs.map(function (d) { return pickItemHtml(kind, d); }).join('')
        : '<div class="cmpick-empty">输入型号 / 品牌 / 参数关键词开始搜索' +
          '<div class="sub">在产品库点「☆ 收藏」的型号，会直接列在这里</div></div>';
      box.classList.add('open');
      return;
    }
    var src = slot.src();
    var out = [];
    for (var i = 0; i < src.length && out.length < 30; i++) {
      var d = src[i];
      if (String(slot.hay(d) || '').toLowerCase().indexOf(term) < 0) continue;
      out.push(d);
    }
    results[kind] = out;
    box.innerHTML = out.length
      ? out.map(function (d) { return pickItemHtml(kind, d); }).join('')
      : '<div class="cmpick-empty">没有匹配型号，换个关键词试试</div>';
    box.classList.add('open');
  }

  function closeLists() {
    Object.keys(SLOTS).forEach(function (k) {
      var box = $(SLOTS[k].list);
      if (box) box.classList.remove('open');
    });
  }

  function renderPicked(kind) {
    var slot = SLOTS[kind];
    var el = $(slot.picked);
    if (!el) return;
    var d = findIn(kind, sel[kind]);
    if (!sel[kind]) {
      el.innerHTML = '<span style="color:#cbd5e1">未选择</span>';
      return;
    }
    if (!d) {
      el.innerHTML = '<b>' + esc(parseKeyModel(sel[kind])) +
        '<button class="p-clear" data-clear="' + kind + '">✕</button></b>型号不在当前库中';
      return;
    }
    el.innerHTML = '<b>' + brandLogo(d.brand, 'p-logo') +
      '<span class="p-model">' + esc(d.model) + '</span>' +
      '<button class="p-clear" data-clear="' + kind + '" title="取消选择">✕</button></b>' +
      '<span class="p-meta">' + esc(brandShort(d.brand)) + ' · ' + esc(slot.spec(d)) + '</span>';
  }
  function parseKeyModel(key) {
    var p = String(key || '').split('::');
    return p.length > 1 ? p[1] : p[0];
  }

  function setSlot(kind, key) {
    sel[kind] = resolveKey(kind, key);
    var input = $(SLOTS[kind].input);
    var d = findIn(kind, sel[kind]);
    input.value = d ? d.model : '';
    renderPicked(kind);
    closeLists();
    scheduleEval();
  }

  /* ---------------- 评定渲染 ---------------- */
  var LV_TEXT = { pass: '✓ 通过', warn: '! 注意', fail: '✕ 不通过' };

  function pickChip(icon, kind) {
    var d = findIn(kind, sel[kind]);
    if (!d) return '<span class="pick-chip empty">' + icon + (kind === 'light' ? ' 光源未选择' : ' 未选择') + '</span>';
    return '<span class="pick-chip">' + icon + brandLogo(d.brand, 'pick-logo') +
      '<span class="pick-txt"><b>' + esc(d.model) + '</b><small>' + esc(brandShort(d.brand)) + '</small></span></span>';
  }

  function evaluate() {
    var box = $('comboEval');
    if (!box) return;
    persistDraft();
    if (!sel.camera || !sel.lens) {
      box.innerHTML = '<div class="combo-empty">先选一台相机和一支镜头，系统会按上面的需求立即逐项评定；光源可稍后补。</div>';
      return;
    }
    var ev = E.evaluateCombo(readReq(), sel);
    if (!ev.ok) {
      box.innerHTML = '<div class="combo-empty">' + esc(ev.error) + '</div>';
      return;
    }
    var fails = ev.checks.filter(function (x) { return x.level === 'fail'; }).length;
    var warns = ev.checks.filter(function (x) { return x.level === 'warn'; }).length;
    var sub = ev.feasible
      ? (warns ? '硬性条件通过 · ' + warns + ' 项建议关注' : '全部检查通过')
      : fails + ' 项硬性条件不通过';
    var tagCls = ev.grade === 'A' || ev.grade === 'B' ? 'ok' : (ev.grade === 'C' ? 'warn' : 'bad');

    var rows = '', lastGroup = '';
    ev.checks.forEach(function (c) {
      if (c.group !== lastGroup) {
        rows += '<tr class="grp"><td colspan="4">' + esc(c.group) + '</td></tr>';
        lastGroup = c.group;
      }
      rows += '<tr><td>' + esc(c.label) + '</td>' +
        '<td class="mono" data-label="要求">' + esc(c.need) + '</td>' +
        '<td class="mono" data-label="实际">' + esc(c.actual) + '</td>' +
        '<td class="lv ' + c.level + '">' + LV_TEXT[c.level] +
        (c.detail ? '<br><span class="detail">' + esc(c.detail) + '</span>' : '') + '</td></tr>';
    });

    var clean = ev.feasible && ev.scoreItems.length === 0 &&
      ev.suggestions.length === 1 && !ev.suggestions[0].action;
    var sugs = ev.suggestions.map(function (s) {
      return '<li class="' + (clean ? 'ok' : '') + '">' + esc(s.text) +
        (s.action
          ? '<button class="x-mini" data-set-kind="' + s.action.kind + '" data-set-key="' +
            esc(s.action.key) + '">替换</button>'
          : '') + '</li>';
    }).join('');

    var chips = ev.scoreItems.length
      ? ev.scoreItems.map(function (x) {
          return '<span class="si-chip" title="' + esc(x.detail) + '">' + esc(x.label) + ' −' + x.penalty + '</span>';
        }).join('')
      : '<span class="si-chip ok">无扣分项</span>';

    var reqLine = '按需求：像素精度 ≤ <b>' + num(ev.req.pxAccReq, 4) + ' mm/px</b>（' +
      esc(ev.req.taskLabel) + '，每特征 ' + ev.req.k + ' 像素）· 视野 <b>' + num(readReq().fovW, 1) + '×' +
      num(readReq().fovH, 1) + ' mm</b> · WD <b>' + num(readReq().wd, 0) + ' mm</b> → 需 ≥ ' +
      ev.req.needW + '×' + ev.req.needH + ' 像素。' +
      (ev.feasible ? '' : ' 硬性条件不通过时，分数与等级仅供参考。');

    box.innerHTML =
      '<div class="combo-head">' +
        '<div class="combo-num">' + ev.score + '<small>/100</small></div>' +
        '<div class="combo-grade"><span class="tag ' + tagCls + '">' + ev.grade + ' · ' + esc(ev.gradeLabel) + '</span>' +
          '<span class="combo-sub">' + esc(sub) + '</span></div>' +
        '<button class="btn primary" id="applyBtn">应用到选型助手</button>' +
        '<button class="btn" id="copyBtn">复制评定</button>' +
      '</div>' +
      '<div class="req-line">' + reqLine + '</div>' +
      '<div class="combo-picks">' + pickChip('📷', 'camera') + pickChip('🔍', 'lens') + pickChip('💡', 'light') + '</div>' +
      '<div class="combo-body">' +
        '<div><div class="combo-title">逐项评定</div><div class="combo-table-wrap"><table class="combo-table"><thead><tr>' +
          '<th>项目</th><th>要求</th><th>实际</th><th>结论</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
        '<div class="combo-side">' +
          '<div class="combo-title">建议（' + ev.suggestions.length + '）</div>' +
          '<ul class="combo-sugs">' + sugs + '</ul>' +
          '<div class="combo-title">评分构成</div>' +
          '<div class="combo-chips">' + chips + '</div>' +
        '</div>' +
      '</div>';
    lastEval = ev;
  }

  var lastEval = null;
  var evalTimer = 0;
  function scheduleEval() {
    clearTimeout(evalTimer);
    evalTimer = setTimeout(evaluate, 120);
  }

  /* ---------------- 草稿与交接 ---------------- */
  function persistDraft() {
    store(DRAFT_KEY, {
      camera: recOf(sel.camera), lens: recOf(sel.lens), light: recOf(sel.light), req: readReq()
    });
  }

  function applyToPlan() {
    var ev = E.evaluateCombo(readReq(), sel);
    if (!ev.ok) return;
    store(APPLY_KEY, {
      camera: recOf(sel.camera), lens: recOf(sel.lens), light: recOf(sel.light), req: readReq()
    });
    location.href = 'index.html';
  }

  function comboText() {
    var ev = lastEval || E.evaluateCombo(readReq(), sel);
    if (!ev || !ev.ok) return '【自定义搭配评定】' + (ev && ev.error ? ev.error : '请先选择相机和镜头');
    var lines = [];
    lines.push('【自定义搭配评定】' + ev.grade + ' · ' + ev.gradeLabel + '（' + ev.score + '/100）');
    var c = findIn('camera', sel.camera), l = findIn('lens', sel.lens), g = findIn('light', sel.light);
    lines.push('· 相机：' + (c ? (c.brand ? '[' + c.brand + '] ' : '') + c.model : '—'));
    lines.push('· 镜头：' + (l ? (l.brand ? '[' + l.brand + '] ' : '') + l.model : '—'));
    lines.push('· 光源：' + (g ? (g.brand ? '[' + g.brand + '] ' : '') + g.model : '未选择'));
    lines.push('');
    lines.push('逐项评定：');
    ev.checks.forEach(function (x) {
      lines.push('　' + (x.level === 'pass' ? '✓' : (x.level === 'warn' ? '!' : '✕')) + ' ' +
        x.group + ' · ' + x.label + '：要求 ' + x.need + '，实际 ' + x.actual +
        (x.detail ? '（' + x.detail + '）' : ''));
    });
    if (ev.scoreItems.length) {
      lines.push('');
      lines.push('扣分项：' + ev.scoreItems.map(function (x) {
        return x.label + ' −' + x.penalty;
      }).join('；') + '。');
    }
    if (ev.suggestions.length) {
      lines.push('');
      lines.push('建议：');
      ev.suggestions.forEach(function (s) { lines.push('　· ' + s.text); });
    }
    lines.push('');
    lines.push('需求：视野 ' + readReq().fovW + '×' + readReq().fovH + 'mm，最小特征 ' +
      readReq().precision + 'mm，任务 ' + ev.req.taskLabel + '，WD ' + readReq().wd + 'mm。');
    return lines.join('\n');
  }

  function copyCombo() {
    var txt = comboText();
    var done = function (btn) {
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = '复制评定'; }, 1600);
    };
    var btn = $('copyBtn');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { done(btn); }, function () {
        window.prompt('复制下面的评定文本：', txt);
      });
    } else {
      window.prompt('复制下面的评定文本：', txt);
    }
  }

  /* ---------------- 载入自动推荐 ---------------- */
  function autoFill() {
    var r;
    try { r = E.solve(readReq()); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    var box = $('comboEval');
    if (!r.ok) {
      box.innerHTML = '<div class="combo-empty">' + esc(r.error) + '</div>';
      return;
    }
    sel.camera = keyOf(r.camera);
    sel.lens = keyOf(r.lens);
    sel.light = r.light && r.light.sku
      ? keyOf({ brand: r.light.skuBrand, model: r.light.sku })
      : null;
    ['camera', 'lens', 'light'].forEach(function (k) {
      var d = findIn(k, sel[k]);
      $(SLOTS[k].input).value = d ? d.model : '';
      renderPicked(k);
    });
    closeLists();
    evaluate();
  }

  function clearAll() {
    sel = { camera: null, lens: null, light: null };
    Object.keys(SLOTS).forEach(function (k) {
      $(SLOTS[k].input).value = '';
      renderPicked(k);
    });
    unstore(DRAFT_KEY);
    lastEval = null;
    evaluate();
    $('camInput').focus();
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    fillSelects();

    // 需求：URL 参数优先（从选型助手跳转），其次本地草稿
    var draft = load(DRAFT_KEY);
    var q = readQuery();
    if (q) applyReq(q);
    else if (draft && draft.req) applyReq(draft.req);
    else {
      $('task').value = 'defect';
      $('material').value = 'metal_shiny';
      $('colorTarget').value = 'none';
    }
    if (draft) {
      ['camera', 'lens', 'light'].forEach(function (k) {
        var rec = draft[k];
        if (rec && rec.m) sel[k] = resolveKey(k, (rec.b ? rec.b + '::' : '') + rec.m);
      });
    }
    Object.keys(SLOTS).forEach(function (k) {
      var d = findIn(k, sel[k]);
      if (d) $(SLOTS[k].input).value = d.model;
      renderPicked(k);
    });

    // 选择器：输入搜索 / 选中 / 回车选第一条 / Esc 关闭
    Object.keys(SLOTS).forEach(function (kind) {
      var input = $(SLOTS[kind].input);
      input.addEventListener('focus', function () {
        input.select();
        renderList(kind);
      });
      input.addEventListener('input', function () {
        sel[kind] = null;
        renderPicked(kind);
        renderList(kind);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeLists(); input.blur(); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          var first = results[kind][0];
          if (first) setSlot(kind, keyOf(first));
        }
      });
    });

    // 列表点击 + 选中项清除
    document.addEventListener('click', function (e) {
      var item = e.target.closest('[data-pick-kind]');
      if (item) {
        setSlot(item.getAttribute('data-pick-kind'), item.getAttribute('data-pick-key'));
        return;
      }
      var clr = e.target.closest('[data-clear]');
      if (clr) {
        var kind = clr.getAttribute('data-clear');
        sel[kind] = null;
        $(SLOTS[kind].input).value = '';
        renderPicked(kind);
        scheduleEval();
        return;
      }
      var set = e.target.closest('[data-set-kind]');
      if (set) {
        setSlot(set.getAttribute('data-set-kind'), set.getAttribute('data-set-key'));
        return;
      }
      if (e.target.id === 'applyBtn') { applyToPlan(); return; }
      if (e.target.id === 'copyBtn') { copyCombo(); return; }
      if (!e.target.closest('.cmpick')) closeLists();
    });

    $('autoBtn').addEventListener('click', autoFill);
    $('clearBtn').addEventListener('click', clearAll);

    // 需求变化即重新评定（防抖）
    Array.prototype.forEach.call(document.querySelectorAll('.req-grid input, .req-grid select'), function (el) {
      el.addEventListener('input', scheduleEval);
      el.addEventListener('change', scheduleEval);
    });

    evaluate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
