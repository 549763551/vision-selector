/* 界面逻辑：读表单 → 调引擎 → 渲染结果 */
(function () {
  'use strict';

  var E = window.VisionEngine;
  var $ = function (id) { return document.getElementById(id); };

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
    heightDiff: 1, speed: 0, cpm: 0
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
      cpm: readNum('cpm')
    };
  }

  function applyState(st) {
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
    render();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var r = E.solve(readInput());

    if (!r.ok) {
      $('scoreNum').innerHTML = '--<small>/100</small>';
      $('scoreBar').style.width = '0%';
      $('stateChip').className = 'tag bad';
      $('stateChip').textContent = '输入有误';
      $('summary').innerHTML = '<span style="color:#b91c1c">' + esc(r.error) + '</span>';
      $('cards').innerHTML = '';
      $('calcBody').innerHTML = '';
      $('risks').innerHTML = '';
      $('riskCount').textContent = '';
      return;
    }

    /* --- 顶部分数 --- */
    $('scoreNum').innerHTML = r.score + '<small>/100</small>';
    $('scoreBar').style.width = r.score + '%';
    $('stateChip').className = 'tag ' + (r.feasible ? 'ok' : 'bad');
    $('stateChip').textContent = r.feasible ? '方案可行' : '需升级方案';
    $('summary').innerHTML = esc(r.summary);

    /* --- 三张卡 --- */
    var c = r.camera;
    var l = r.lens;
    var g = r.light;

    var camHtml =
      '<div class="card cam">' +
        '<div class="card-head"><span class="ico">📷</span><h3>相机</h3><span class="tag">' + esc(c.color) + '</span></div>' +
        '<div class="hero">' + esc(c.model) + '</div>' +
        '<div class="hero-sub">' + c.w + ' × ' + c.h + ' px　·　' + esc(c.interface) + '</div>' +
        kv('所需分辨率', esc(r.pxNeed.w + ' × ' + r.pxNeed.h) + ' px') +
        kv('靶面尺寸', esc(c.sw + ' × ' + c.sh) + ' mm') +
        kv('像元尺寸', esc(c.pixelSizeUm) + ' µm') +
        kv('有效像素精度', esc(n4(c.pxAcc)) + ' mm/px') +
        kv('精度余量', esc(r.margin >= 0 ? Math.round(r.margin * 100) + '%' : '不足')) +
        kv('可辨最小特征', esc(n4(c.capability)) + ' mm') +
        kv('所需帧率', esc(c.fps) + ' fps') +
        kv('数据带宽', esc(num(c.bandwidthMBps, 2)) + ' MB/s') +
        kv('镜头接口', esc(c.mount) + ' 口') +
      '</div>';

    var lensHtml =
      '<div class="card lens">' +
        '<div class="card-head"><span class="ico">🔍</span><h3>镜头</h3><span class="tag">' + esc(c.mount) + ' 口</span></div>' +
        '<div class="hero">' + l.f + ' mm<span style="font-size:13px;color:#64748b;font-weight:600"> / F' + l.aperture + '</span></div>' +
        '<div class="hero-sub">放大倍率 ' + esc(n4(l.m)) + '×</div>' +
        kv('理论焦距', esc(num(l.fReq, 1)) + ' mm') +
        kv('实际视场', esc(num(l.fovW, 2) + ' × ' + num(l.fovH, 2)) + ' mm') +
        kv('景深', esc(num(l.dof, 2)) + ' mm') +
        kv('衍射弥散', esc(num(l.blurPx, 2)) + ' px') +
        kv('工作距离', esc(r.input.wd) + ' mm') +
        kv('高度容差', esc(r.input.heightDiff) + ' mm') +
      '</div>';

    var lightHtml =
      '<div class="card light">' +
        '<div class="card-head"><span class="ico">💡</span><h3>光源</h3><span class="tag">' + esc(TYPE_TAG[g.type] || '环形') + '</span></div>' +
        '<div class="hero">' + esc(g.label) + '</div>' +
        '<div class="hero-sub">' + swatch(g.color) + esc(g.colorName) + '　' + esc(g.wavelength) + '</div>' +
        block('安装 / 打光角度', esc(g.angle)) +
        block('尺寸建议', esc(g.size)) +
        block('配件', esc(g.accessories.length ? g.accessories.join('；') : '无')) +
        block('控制器', esc(g.controller)) +
        (g.reasons.length
          ? '<ul class="why">' + g.reasons.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
          : '') +
      '</div>';

    $('cards').innerHTML = camHtml + lensHtml + lightHtml;

    /* --- 验算表 --- */
    $('calcBody').innerHTML = r.calc.map(function (x) {
      return '<tr><td>' + esc(x.step) + '</td>' +
        '<td class="mono">' + esc(x.formula) + '</td>' +
        '<td class="num">' + esc(x.value) + '</td>' +
        '<td class="unit">' + esc(x.unit) + '</td></tr>';
    }).join('');

    /* --- 风险 --- */
    var risks = r.warnings.length
      ? r.warnings.map(function (w) {
          return '<div class="risk ' + (w.level === 'warn' ? 'warn' : 'info') + '">' +
            '<i class="dot"></i><div>' + esc(w.text) + '</div></div>';
        }).join('')
      : '<div class="risk good"><i class="dot"></i><div>未发现明显风险项：精度、景深、曝光、带宽均在合理余量内。</div></div>';

    $('risks').innerHTML = risks;
    var warns = r.warnings.filter(function (w) { return w.level === 'warn'; }).length;
    $('riskCount').textContent = warns > 0 ? warns + ' 项需注意' : '全部通过';
  }

  /* ---------------- 复制方案 ---------------- */
  function buildText() {
    var r = E.solve(readInput());
    if (!r.ok) return '【机器视觉选型】输入有误：' + r.error;

    var c = r.camera, l = r.lens, g = r.light;
    var lines = [];
    lines.push('【机器视觉选型方案】');
    lines.push(r.summary);
    lines.push('');
    lines.push('· 任务：' + r.task.label + '（每特征 ' + r.task.k + ' 像素）');
    lines.push('· 相机：' + c.model + '，' + c.w + '×' + c.h + '，' + c.color + '，' +
      c.sw + '×' + c.sh + 'mm 靶面，像元 ' + c.pixelSizeUm + 'µm，' + c.mount + ' 口');
    lines.push('　 接口 ' + c.interface + '，' + c.fps + 'fps，带宽 ' + num(c.bandwidthMBps, 2) + 'MB/s，' +
      '有效像素精度 ' + n4(c.pxAcc) + 'mm/px');
    lines.push('· 镜头：' + l.f + 'mm F' + l.aperture + '，放大倍率 ' + n4(l.m) + '×，实际视场 ' +
      num(l.fovW, 2) + '×' + num(l.fovH, 2) + 'mm，景深 ' + num(l.dof, 2) + 'mm，' + l.mount + ' 口');
    lines.push('· 光源：' + g.label + '，' + g.colorName + ' ' + g.wavelength);
    lines.push('　 安装：' + g.angle);
    lines.push('　 尺寸：' + g.size);
    lines.push('　 配件：' + (g.accessories.length ? g.accessories.join('；') : '无'));
    lines.push('　 控制：' + g.controller);
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

  /* ---------------- 绑定 ---------------- */
  function init() {
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

    // 支持 ?p=copper 直接打开某个预设，便于分享/演示
    var m = /[?&]p=([a-z]+)/.exec(location.search);
    applyState(m && PRESETS[m[1]] ? PRESETS[m[1]] : DEFAULT);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
