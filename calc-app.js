/**
 * 工程计算器页面逻辑（组合计算器）
 * ---------------------------------------------------------------
 * 每个组合 = 一次方案里同时要算的几个公式，共用一套输入：
 *   · 同一个条件只填一次，组内所有「输入齐了」的公式一起出结果；
 *   · 算不出的不报错，只点名缺哪一项，可一键定位到那个输入框；
 *   · 组内能推导的量（实际视场 / 有效像素精度 …）自动带入，标明来源、可随时改；
 *   · 上一组算出的放大倍率 / 有效像素精度 / 需求帧率会带到下一组，不用重填。
 * 不预填示例值、不生成方案、不读写型号库、不记本地数据。
 * 所有公式与判定都在 calc-engine.js 里，这里不重复算任何数字。
 */
(function () {
  'use strict';

  var C = window.CalcEngine;
  if (!C) return;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = C.core.fmt;

  var vals = {};      // vals[combo][key] = 用户填的原始值
  var touched = {};   // 动过的字段不再被自动带入覆盖（否则清不掉）
  var last = {};      // 最近一次组合结果

  /* ---------------- 基础工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(v) {
    return typeof v === 'number' ? fmt(v, 4) : String(v == null ? '' : v);
  }
  // 写回输入框的自动值只保留 6 位有效数字，避免 0.12000000000000001 这种尾巴
  function brief(v) {
    return typeof v === 'number' ? Number(v.toPrecision(6)) : v;
  }
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function copyText(txt, label) {
    function done() { toast((label || '结果') + '已复制 ✓'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else toast('复制失败，请手动选中结果');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } else fallback();
  }

  /* ---------------- 输入控件（全部空白，无默认值） ---------------- */

  function fieldHTML(combo, fd) {
    var id = 'f_' + combo.id + '_' + fd.key;
    var data = 'data-combo="' + esc(combo.id) + '" data-key="' + esc(fd.key) + '"';
    var title = fd.hint ? ' title="' + esc(fd.hint) + '"' : '';
    var label = '<label for="' + id + '"' + title + '>' + esc(fd.label) +
                (fd.unit ? ' <span class="u">' + esc(fd.unit) + '</span>' : '') +
                (fd.optional ? ' <span class="opt">可选</span>' : '') + '</label>';
    var tag = '<span class="ftag"></span>';
    if (fd.type === 'select') {
      var opts = '<option value="">请选择</option>' + (fd.opts || []).map(function (o) {
        return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
      }).join('');
      return '<div class="field sel" data-fk="' + esc(fd.key) + '">' + label +
             '<select id="' + id + '" ' + data + ' data-type="select">' + opts + '</select>' + tag + '</div>';
    }
    if (fd.type === 'check') {
      return '<div class="field check" data-fk="' + esc(fd.key) + '">' +
             '<input type="checkbox" id="' + id + '" ' + data + ' data-type="check">' + label + tag + '</div>';
    }
    return '<div class="field" data-fk="' + esc(fd.key) + '">' + label +
           '<input type="number" step="any" id="' + id + '" ' + data + ' data-type="number" placeholder="输入数值">' + tag + '</div>';
  }

  function build() {
    var html = '';
    C.COMBOS.forEach(function (combo) {
      html += '<section class="combo" id="c_' + esc(combo.id) + '" data-combo="' + esc(combo.id) + '">' +
        '<div class="chead">' +
          '<h2>' + esc(combo.label) + '<small>' + combo.items.length + ' 个结果</small></h2>' +
          '<span class="cstat" data-role="stat">待填参数</span>' +
          '<div class="cbtns">' +
            '<button type="button" class="btn" data-act="copyCombo" data-combo="' + esc(combo.id) + '">复制本组结果</button>' +
            '<button type="button" class="btn" data-act="clearCombo" data-combo="' + esc(combo.id) + '">清空本组</button>' +
          '</div>' +
        '</div>' +
        '<p class="cdesc">' + esc(combo.desc) + '</p>' +
        '<div class="cprog" data-role="prog"><i></i></div>' +
        '<div class="cform">' + combo.sections.map(function (sec) {
          return '<div class="fsec"><div class="fsec-h">' + esc(sec.title) + '</div>' +
                 '<div class="fields">' +
                 sec.fields.map(function (fd) { return fieldHTML(combo, fd); }).join('') +
                 '</div></div>';
        }).join('') + '</div>' +
        '<div class="cres" data-role="res"></div>' +
      '</section>';
    });
    $('combos').innerHTML = html;
  }

  /* ---------------- 结果渲染 ---------------- */

  function stepsHTML(steps) {
    return '<div class="steps">' + steps.map(function (s) {
      var cls = s.ok === true ? ' ok' : s.ok === false ? ' bad' : '';
      var flag = s.ok === true ? '<span class="flag">✓</span>' : s.ok === false ? '<span class="flag">✗</span>' : '';
      return '<div class="step' + cls + '">' +
             '<div class="sn">' + esc(s.label) + '</div>' +
             '<div class="sf"><b>' + esc(s.sym) + '</b>' + (s.sub ? ' = ' + esc(s.sub) : '') + '</div>' +
             '<div class="sv">' + esc(s.value) + (s.unit ? '<span class="su">' + esc(s.unit) + '</span>' : '') + flag + '</div>' +
             (s.note ? '<div class="snote">' + esc(s.note) + '</div>' : '') +
             '</div>';
    }).join('') + '</div>';
  }
  function notesHTML(notes, warnings) {
    var h = (notes || []).map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('') +
            (warnings || []).map(function (w) { return '<div class="risk">' + esc(w) + '</div>'; }).join('');
    return h ? '<div class="notes">' + h + '</div>' : '';
  }
  function missHTML(combo, item) {
    var m = item.missing || [];
    var plain = [], via = [], seen = {};
    m.forEach(function (x) {
      var key = (x.viaTitle || '') + '|' + (x.rootLabel || x.label);
      if (seen[key]) return;
      seen[key] = 1;
      (x.viaTitle ? via : plain).push(x);
    });
    var parts = [];
    if (plain.length) parts.push('缺 <b>' + plain.map(function (x) { return esc(x.label); }).join('、') + '</b>');
    via.forEach(function (x) {
      parts.push('「' + esc(x.viaTitle) + '」还缺 <b>' + esc(x.rootLabel || x.label) + '</b>' +
                 (x.rootCount > 1 ? ' 等 ' + x.rootCount + ' 项' : ''));
    });
    var target = m[0] ? (m[0].rootKey || m[0].key) : '';
    return '<div class="rmiss">' + parts.join('；') +
           (target ? ' <button type="button" class="locate" data-locate="' + esc(combo.id) + ':' + esc(target) + '">去填</button>' : '') +
           '</div>';
  }
  function resultHTML(combo, item) {
    if (!item.computed) {
      return '<div class="rcard wait">' +
             '<div class="rhead"><h4>' + esc(item.title) + '</h4><span class="rtag wait">待填</span></div>' +
             '<div class="rsym">' + esc(item.sym || '') + '</div>' +
             missHTML(combo, item) + '</div>';
    }
    var fdef = C.byId(item.id);
    var parts = Object.keys(item.filled || {}).map(function (k) {
      var inDef = fdef ? fdef.inputs.filter(function (x) { return x.key === k; })[0] : null;
      var fd = combo.fields.filter(function (x) { return x.key === k; })[0] || inDef || {};
      return (inDef && inDef.label || fd.label || k) + ' ' + show(item.filled[k].value) +
             (fd.unit ? ' ' + fd.unit : '');
    });
    var srcs = [];
    Object.keys(item.filled || {}).forEach(function (k) {
      if (srcs.indexOf(item.filled[k].from) < 0) srcs.push(item.filled[k].from);
    });
    var autos = parts.length ? ['自动带入：' + parts.join('、') + '（来自「' + srcs.join('」「') + '」）'] : [];
    return '<div class="rcard ' + esc(item.tone) + '">' +
           '<div class="rhead"><h4>' + esc(item.title) + '</h4>' +
           '<span class="rtag" data-item="' + esc(item.id) + '">' + esc(show(item.result.value)) +
           (item.result.unit ? ' ' + esc(item.result.unit) : '') + '</span></div>' +
           '<div class="rsym">' + esc(item.sym) + '</div>' +
           '<div class="verdict ' + esc(item.tone) + '">' + esc(item.verdict) + '</div>' +
           stepsHTML(item.steps) + notesHTML(item.notes, item.warnings) +
           (autos.length ? '<div class="rauto">' + autos.map(esc).join('<br>') + '</div>' : '') +
           '<div class="rfoot"><button type="button" class="btn" data-act="copyOne" data-combo="' +
           esc(combo.id) + '" data-item="' + esc(item.id) + '">复制这一项</button></div>' +
           '</div>';
  }

  function statText(out) {
    var need = [];
    out.items.forEach(function (it) {
      if (it.computed) return;
      (it.missing || []).forEach(function (m) {
        var l = m.rootLabel || m.label;
        if (need.indexOf(l) < 0) need.push(l);
      });
    });
    if (!out.done) return '待填：' + need.slice(0, 4).join('、') + (need.length > 4 ? ' 等 ' + need.length + ' 项' : '');
    var s = '已算 ' + out.done + ' / ' + out.total;
    if (need.length) s += ' · 还缺 ' + need.slice(0, 3).join('、') + (need.length > 3 ? ' 等 ' + need.length + ' 项' : '');
    else s += ' · 全算完 ✓';
    return s;
  }

  function render(combo, out) {
    var root = document.querySelector('.combo[data-combo="' + combo.id + '"]');
    if (!root || !out || out.error) return;
    var stat = root.querySelector('[data-role="stat"]');
    if (stat) stat.textContent = statText(out);
    var res = root.querySelector('[data-role="res"]');
    if (res) {
      // 结果标签重建前先记下旧值：只有数值真的变了才闪一下，输错退回不闪
      var prevVals = {};
      res.querySelectorAll('.rtag[data-item]').forEach(function (el) {
        prevVals[el.getAttribute('data-item')] = el.textContent;
      });
      res.innerHTML = out.items.map(function (it) { return resultHTML(combo, it); }).join('');
      res.className = 'cres' + (out.items.length === 1 ? ' one' : '');
      res.querySelectorAll('.rtag[data-item]').forEach(function (el) {
        if (prevVals[el.getAttribute('data-item')] !== el.textContent) el.classList.add('flash');
      });
    }
    // 组内进度：已算出的公式占比，只有这个数字会连续变，所以用宽度过渡最不容易抖
    var prog = root.querySelector('[data-role="prog"]');
    if (prog) {
      var p = out.total ? out.done / out.total : 0;
      prog.className = 'cprog' + (p > 0 ? ' on' : '') + (p >= 1 ? ' done' : '');
      var fill = prog.querySelector('i');
      if (fill) fill.style.width = Math.round(p * 100) + '%';
    }
    combo.fields.forEach(function (fd) {
      var wrap = root.querySelector('.field[data-fk="' + fd.key + '"]');
      if (!wrap) return;
      var el = wrap.querySelector('[data-key]');
      var tag = wrap.querySelector('.ftag');
      var userHas = !!(vals[combo.id] && vals[combo.id][fd.key] !== undefined);
      var isTouched = !!(touched[combo.id] && touched[combo.id][fd.key]);
      var hit = out.filled[fd.key];
      var focused = document.activeElement === el;
      if (hit && !userHas && !isTouched) {
        if (!focused) {
          if (el.dataset.type === 'check') el.checked = !!hit.value;
          else el.value = brief(hit.value);
        }
        wrap.classList.add('auto');
        if (tag) {
          tag.textContent = '自动 · 来自「' + hit.from + '」';
          tag.title = '由「' + hit.from + '」算出并带入：' + show(hit.value) +
                      (fd.unit ? ' ' + fd.unit : '') + '（可直接改，改后以你填的为准）';
        }
      } else {
        if (!userHas && !isTouched && !focused) {
          if (el.dataset.type === 'check') el.checked = false;
          else el.value = '';
        }
        wrap.classList.remove('auto');
        if (tag) tag.textContent = '';
      }
    });
  }

  /* ---------------- 交互 ---------------- */

  function coerce(el) {
    if (el.dataset.type === 'check') return el.checked;
    if (el.value === '') return '';
    if (el.dataset.type === 'number') {
      var n = Number(el.value);
      return isFinite(n) ? n : el.value;
    }
    return el.value;
  }

  function recalc() {
    var seed = {};
    C.COMBOS.forEach(function (combo) {
      var out = C.computeCombo(combo.id, vals[combo.id] || {}, seed);
      last[combo.id] = out;
      Object.keys(out.prov || {}).forEach(function (k) { seed[k] = out.prov[k]; });
    });
    C.COMBOS.forEach(function (combo) { render(combo, last[combo.id]); });
  }

  function onEdit(e) {
    var el = e.target;
    if (!el || !el.dataset || !el.dataset.key) return;
    var combo = el.dataset.combo, key = el.dataset.key;
    vals[combo] = vals[combo] || {};
    touched[combo] = touched[combo] || {};
    touched[combo][key] = true;
    var v = coerce(el);
    if (v === '') delete vals[combo][key];
    else vals[combo][key] = v;
    recalc();
  }

  function clearCombo(id) {
    vals[id] = {};
    touched[id] = {};
    var root = document.querySelector('.combo[data-combo="' + id + '"]');
    if (root) {
      root.querySelectorAll('[data-key]').forEach(function (el) {
        if (el.dataset.type === 'check') el.checked = false;
        else el.value = '';
      });
      root.querySelectorAll('.field.auto, .field.need').forEach(function (w) {
        w.classList.remove('auto', 'need');
      });
      root.querySelectorAll('.ftag').forEach(function (t) { t.textContent = ''; });
    }
    recalc();
  }

  function locate(comboId, key) {
    var root = document.querySelector('.combo[data-combo="' + comboId + '"]');
    if (!root) return;
    var wrap = root.querySelector('.field[data-fk="' + key + '"]');
    if (!wrap) { toast('这个条件不在本组输入里'); return; }
    wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var el = wrap.querySelector('[data-key]');
    if (el) setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 240);
    wrap.classList.add('need');
    setTimeout(function () { wrap.classList.remove('need'); }, 1900);
  }

  function bind() {
    document.addEventListener('input', onEdit);
    document.addEventListener('change', onEdit);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act], [data-locate]') : null;
      if (!b) return;
      if (b.dataset.locate) {
        var p = b.dataset.locate.split(':');
        locate(p[0], p[1]);
        return;
      }
      var cid = b.dataset.combo;
      if (b.dataset.act === 'clearCombo') { clearCombo(cid); toast('已清空本组'); return; }
      if (b.dataset.act === 'copyCombo') {
        var out = last[cid];
        if (!out || !out.text) { toast('本组还没有算出结果'); return; }
        copyText('【' + out.label + '】\n' + out.text, out.label);
        return;
      }
      if (b.dataset.act === 'copyOne') {
        var it = (last[cid] ? last[cid].items : []).filter(function (x) { return x.id === b.dataset.item; })[0];
        if (!it || !it.computed) { toast('这一项还没算出来'); return; }
        copyText(it.text, it.title);
      }
    });
    var all = $('btnClearAll');
    if (all) all.addEventListener('click', function () {
      C.COMBOS.forEach(function (combo) { clearCombo(combo.id); });
      toast('已清空全部输入');
    });
  }

  build();
  recalc();
  bind();
})();
