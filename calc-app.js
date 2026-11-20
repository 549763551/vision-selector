/**
 * 工程计算器页面逻辑（纯公式计算器）
 * ---------------------------------------------------------------
 * 不预填参数、不生成方案、不读写型号库、不记本地数据。
 * 按 CalcEngine 的元数据生成空白输入，用户填完即算；
 * 每张卡另有「计算 / 清空 / 复制结果」三个按钮。
 * 所有公式与判定都在 calc-engine.js 里，这里不重复算任何数字。
 */
(function () {
  'use strict';

  var C = window.CalcEngine;
  if (!C) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = {};
  C.FORMULAS.forEach(function (f) { state[f.id] = {}; });

  /* ---------------- 基础工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

  /* ---------------- 空白输入控件（无默认值） ---------------- */

  function fieldHTML(def, value, fid) {
    var id = 'f_' + fid + '_' + def.key;
    var data = 'data-fid="' + esc(fid) + '" data-key="' + esc(def.key) + '"';
    var hint = def.hint ? ' title="' + esc(def.hint) + '"' : '';
    var label = '<label for="' + id + '"' + hint + '>' + esc(def.label) +
                (def.unit ? ' <span class="u">' + esc(def.unit) + '</span>' : '') + '</label>';
    if (def.type === 'select') {
      var opts = '<option value="">请选择</option>' + (def.opts || []).map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('');
      return '<div class="field wide">' + label +
             '<select id="' + id + '" ' + data + ' data-type="select">' + opts + '</select></div>';
    }
    if (def.type === 'check') {
      return '<div class="field check wide"><input type="checkbox" id="' + id + '" ' + data +
             ' data-type="check"' + (value === true ? ' checked' : '') + '>' + label + '</div>';
    }
    return '<div class="field">' + label +
           '<input type="number" step="any" id="' + id + '" ' + data + ' data-type="number" value="' +
           esc(value === undefined ? '' : value) + '" placeholder="输入数值"></div>';
  }

  function renderGroups() {
    var html = '';
    C.GROUPS.forEach(function (g) {
      var list = C.FORMULAS.filter(function (f) { return f.group === g.id; });
      if (!list.length) return;
      html += '<div class="group" id="g_' + g.id + '"><h3 class="group-h">' + esc(g.label) +
              '<small>' + esc(g.hint) + ' · ' + list.length + ' 式</small></h3><div class="cards">';
      list.forEach(function (f) {
        html += '<div class="fcard" data-id="' + esc(f.id) + '">' +
                '<div class="fhead"><h3>' + esc(f.title) + '</h3><span class="fid">' + esc(f.id) + '</span></div>' +
                '<div class="fsym">' + esc(f.sym) + '</div>' +
                '<div class="fields">' + f.inputs.map(function (d) { return fieldHTML(d, state[f.id][d.key], f.id); }).join('') + '</div>' +
                '<div class="fbody"></div>' +
                '<div class="fbtns">' +
                '<button type="button" class="btn go" data-act="calc" data-id="' + esc(f.id) + '">计算</button>' +
                '<button type="button" class="btn" data-act="clear" data-id="' + esc(f.id) + '">清空</button>' +
                '<button type="button" class="btn" data-act="copy" data-id="' + esc(f.id) + '">复制结果</button>' +
                '</div></div>';
      });
      html += '</div></div>';
    });
    $('groups').innerHTML = html;
    $('singleCount').textContent = '共 ' + C.FORMULAS.length + ' 个公式 · ' + C.GROUPS.length +
                                   ' 组；每项独立输入，填完即自动出结果';
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

  function renderCard(id) {
    var card = document.querySelector('.fcard[data-id="' + id + '"]');
    if (!card) return;
    var out = C.compute(id, state[id]);
    var box = card.querySelector('.fbody');
    if (out.error) {
      box.innerHTML = '<div class="fempty">' + (out.incomplete
        ? '填完以下参数即可计算：<b>' + esc(out.incomplete.join('、')) + '</b>'
        : esc(out.error)) + '</div>';
      return;
    }
    box.innerHTML = '<div class="verdict ' + out.tone + '">' + esc(out.verdict) + '</div>' +
                    stepsHTML(out.steps) + notesHTML(out.notes, out.warnings);
  }
  function renderAll() { C.FORMULAS.forEach(function (f) { renderCard(f.id); }); }

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
  function clearCard(id, card) {
    state[id] = {};
    if (card) card.querySelectorAll('[data-key]').forEach(function (el) {
      if (el.dataset.type === 'check') el.checked = false;
      else el.value = '';
    });
    renderCard(id);
  }

  function bind() {
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.dataset || !el.dataset.key) return;
      var key = el.dataset.key, val = coerce(el);
      if (val === '') delete state[el.dataset.fid][key];
      else state[el.dataset.fid][key] = val;
      renderCard(el.dataset.fid);
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || !el.dataset || !el.dataset.key) return;
      var key = el.dataset.key, val = coerce(el);
      if (val === '') delete state[el.dataset.fid][key];
      else state[el.dataset.fid][key] = val;
      renderCard(el.dataset.fid);
    });
    document.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id;
        var card = document.querySelector('.fcard[data-id="' + id + '"]');
        if (b.dataset.act === 'clear') { clearCard(id, card); toast('已清空'); return; }
        var out = C.compute(id, state[id]);
        if (out.error) { toast(out.incomplete ? '还差：' + out.incomplete.join('、') : out.error); renderCard(id); return; }
        renderCard(id);
        if (b.dataset.act === 'copy') copyText(out.text, C.byId(id).title);
        else toast('已计算 ✓');
      });
    });
    $('btnClearAll').addEventListener('click', function () {
      C.FORMULAS.forEach(function (f) {
        clearCard(f.id, document.querySelector('.fcard[data-id="' + f.id + '"]'));
      });
      toast('已清空全部输入');
    });
  }

  renderGroups();
  renderAll();
  bind();
})();
