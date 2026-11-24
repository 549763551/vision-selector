/**
 * 机器视觉工程公式引擎（17 个公式的独立速算，不生成方案）
 * ---------------------------------------------------------------
 * 纯计算模块，无 DOM 依赖：
 *   - 浏览器：window.CalcEngine
 *   - Node  ：const CalcEngine = require('./js/calc-engine.js')
 *
 * 口径与 engine.js / docs/algorithm.md 完全一致（同一套 k 表、光圈档、
 * 焦距档、接口带宽 × 0.85、λ=0.55µm、c=2 像元、彩色 Bayer ×1.2）。
 * 每个公式返回「符号公式 → 代入 → 结果 → 单位 → 判定」五段。
 * 纯计算器：不预填参数、不生成方案，缺参数就不出结果。
 *
 * 单位约定：长度 mm、像元 µm、速度 mm/s、时间 ms、带宽 MB/s、行频 kHz。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CalcEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================ 常量（与选型引擎对齐） ============================ */

  var CONST = {
    TASKS: {
      precise_measure: { label: '精密尺寸测量', k: 5 },
      measure:         { label: '一般尺寸 / 间距测量', k: 4 },
      defect:          { label: '缺陷检测（划痕 / 毛刺）', k: 3 },
      surface:         { label: '表面质量（脏污 / 色差）', k: 3 },
      presence:        { label: '有无 / 装配确认', k: 2.5 },
      align:           { label: '定位引导（抓取 / 对位）', k: 4 },
      ocr:             { label: '字符 / 条码读取', k: 4 },
      color:           { label: '颜色 / 材质区分', k: 2 },
      height:          { label: '高度 / 3D 轮廓测量', k: 4 }
    },
    APERTURES: [2.8, 4, 5.6, 8, 11, 16, 22],
    FOCAL_LADDER: [6, 8, 12, 16, 20, 25, 35, 50, 75, 100],
    IFACE_BW: {
      GigE: 110, '2.5GigE': 280, USB3: 350, '5GigE': 560, '10GigE': 1100,
      CameraLink: 680, CoaXPress: 1250, XoFLink: 1250, XoCLink: 1250,
      GMSL2: 400, BCON: 400
    },
    IFACE_EFF: 0.85,          // 扣包头 / 协议 / 帧间隔后的有效载荷比例
    LAMBDA_UM: 0.55,          // 艾里斑计算用波长
    COC_PIXELS: 2,            // 弥散圆 = 2 像元
    BAYER_FACTOR: 1.2,        // 彩色所需分辨率余量
    STATIC_FPS: 15,           // 静态拍摄默认帧率
    CABLE_MM: 25,             // 线缆余量
    BRACKET_MM: 40,           // 支架
    ADJUST_MM: 10,            // 调整余量
    DIFFRACTION_LIMIT_PX: 2.5,
    STROBE_EXP_MS: 1,         // 曝光短于此值建议频闪
    SUBPIXEL: 0.3,            // 亚像素定位误差（像素）
    CALIB: 0.5,               // 标定与装夹（像素）
    DIST_RESIDUAL: 0.2        // 标定后畸变残差比例
  };

  var GROUPS = [
    { id: 'optics', label: '光学几何', hint: '视野 / 分辨率 / 焦距 / 工作距离互算' },
    { id: 'quality', label: '图像质量与运动', hint: '景深、衍射、曝光、帧率、精度预算' },
    { id: 'system', label: '系统与链路', hint: '带宽、安装空间、线扫、远心' },
    { id: 'quick', label: '方案速查', hint: '照明规则表与单位换算' }
  ];

  /* ============================ 数值工具 ============================ */

  function num(v, d) {
    var x = typeof v === 'number' ? v : parseFloat(v);
    if (isFinite(x)) return x;
    return d == null ? null : d;
  }
  function fmt(x, n) {
    if (typeof x === 'string') return x;
    if (x == null || !isFinite(x)) return '—';
    var s = Number(x).toFixed(n == null ? 4 : n);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function kOf(task) {
    var t = CONST.TASKS[task] || CONST.TASKS.defect;
    return t.k;
  }
  function ifaceCap(iface) {
    return (CONST.IFACE_BW[iface] || 350) * CONST.IFACE_EFF;
  }
  function S(label, sym, sub, value, unit, ok, note) {
    return { label: label, sym: sym, sub: sub, raw: value, value: fmt(value), unit: unit || '',
             ok: ok === undefined || ok === null ? null : !!ok, note: note || '' };
  }
  function rnd(x, n) { return Math.round(x * Math.pow(10, n || 0)) / Math.pow(10, n || 0); }

  /* ============================ 底层口径（单项与计算书共用） ============================ */

  function pxAccReqOf(p) {
    return num(p.precision, 0) / kOf(p.task);
  }
  function resolutionOf(p) {
    var acc = pxAccReqOf(p), f = p.needColor ? CONST.BAYER_FACTOR : 1;
    return {
      acc: acc,
      w: Math.ceil(num(p.fovW, 0) / acc * f - 1e-9),
      h: Math.ceil(num(p.fovH, 0) / acc * f - 1e-9),
      factor: f
    };
  }
  function magNeedOf(p) {
    var byW = num(p.sw, 0) / num(p.fovW, 1);
    var byH = num(p.sh, 0) / num(p.fovH, 1);
    return { byW: byW, byH: byH, m: Math.min(byW, byH), limitedBy: byW <= byH ? '宽' : '高' };
  }
  function focalReqOf(m, wd) { return num(wd, 0) * m / (1 + m); }
  function ladderOf(fReq) {
    var L = CONST.FOCAL_LADDER, pick = L[0], i;
    for (i = 0; i < L.length; i++) if (L[i] <= fReq) pick = L[i];
    return { pick: pick, belowMin: fReq < L[0], aboveMax: fReq > L[L.length - 1] };
  }
  function magActualOf(f, wd) {
    var d = num(wd, 0) - num(f, 0);
    return d > 0 ? num(f, 0) / d : null;
  }
  function fovActualOf(p, m) {
    return { w: num(p.sw, 0) / m, h: num(p.sh, 0) / m };
  }
  function pxAccEffOf(p, fov) {
    return Math.max(fov.w / num(p.camW, 1), fov.h / num(p.camH, 1));
  }
  function cocMmOf(pxUm) { return CONST.COC_PIXELS * num(pxUm, 0) / 1000; }
  function dofOf(F, c, m) { return 2 * num(F, 0) * c * (1 + m) / (m * m); }
  function airyPxOf(F, pxUm) { return 2.44 * CONST.LAMBDA_UM * num(F, 0) / num(pxUm, 1); }
  function expMaxMsOf(pxAcc, speed) {
    return num(speed, 0) > 0 ? pxAcc / num(speed, 0) * 1000 : Infinity;
  }
  function fpsOf(speed, fovH) {
    return num(speed, 0) > 0 ? Math.max(1, Math.ceil(num(speed, 0) / num(fovH, 1) * 1.2)) : CONST.STATIC_FPS;
  }
  function bandwidthOf(W, H, bit, fps) { return num(W, 0) * num(H, 0) * num(bit, 8) * fps / 8 / 1e6; }
  function maxFpsOf(cap, W, H, bit) { return cap * 8 * 1e6 / (num(W, 1) * num(H, 1) * num(bit, 8)); }
  function budgetOf(pxAcc, fovW, fovH, dist) {
    var items = [
      { name: '像素量化', mm: pxAcc, sym: 'pxAcc', sub: fmt(pxAcc, 5), note: '1 像素对应的实际尺寸' },
      { name: '亚像素定位', mm: pxAcc * CONST.SUBPIXEL, sym: 'pxAcc × 0.3', sub: fmt(pxAcc, 5) + ' × 0.3', note: '边缘 / 质心算法，按 0.3 像素估' }
    ];
    if (num(dist, 0) > 0) {
      var maxFov = Math.max(num(fovW, 0), num(fovH, 0));
      items.push({ name: '镜头畸变残差',
                   mm: (num(dist, 0) / 100) * (maxFov / 2) * CONST.DIST_RESIDUAL,
                   sym: '畸变% × 视野/2 × 20%',
                   sub: fmt(dist, 2) + '% × ' + fmt(maxFov, 1) + '/2 × 0.2',
                   note: '畸变 ' + fmt(dist, 2) + '%，标定后残差按 20% 估' });
    } else {
      items.push({ name: '镜头畸变残差', mm: pxAcc * CONST.CALIB, sym: 'pxAcc × 0.5', sub: fmt(pxAcc, 5) + ' × 0.5', note: '无畸变数据，按 0.5 像素估' });
    }
    items.push({ name: '标定与装夹', mm: pxAcc * CONST.CALIB, sym: 'pxAcc × 0.5', sub: fmt(pxAcc, 5) + ' × 0.5', note: '棋盘格标定 + 夹具重复性，按 0.5 像素估' });
    var sq = 0;
    for (var i = 0; i < items.length; i++) sq += items[i].mm * items[i].mm;
    return { items: items, total: Math.sqrt(sq) };
  }
  function spaceOf(p) {
    return num(p.wd, 0) + num(p.lensLen, 0) + num(p.camDepth, 0) + CONST.CABLE_MM;
  }
  function lineRateOf(speed, pxAccReq) {
    return num(speed, 0) > 0 ? num(speed, 0) / pxAccReq / 1000 : null;
  }

  /* ============================ 结果封装 ============================ */

  function pack(meta, p, steps, result, verdict, tone, notes, warnings, provides) {
    var lines = [];
    lines.push('【' + meta.title + '】');
    if (meta.sym) lines.push('公式：' + meta.sym);
    var used = meta.inputs.filter(function (i) { return p[i.key] !== undefined && p[i.key] !== ''; });
    if (used.length) {
      lines.push('输入：' + used.map(function (i) {
        return i.label + '=' + (typeof p[i.key] === 'number' ? fmt(p[i.key]) : p[i.key]) + (i.unit || '');
      }).join('，'));
    }
    lines.push('');
    steps.forEach(function (s, i) {
      var res = s.raw == null ? '—' : s.value + (s.unit ? ' ' + s.unit : '');
      lines.push('  ' + (i + 1) + ') ' + s.label + '：' + s.sym + (s.sub ? ' = ' + s.sub : '') +
                 ' = ' + res +
                 (s.ok === true ? '  ✓' : s.ok === false ? '  ✗' : '') +
                 (s.note ? '（' + s.note + '）' : ''));
    });
    lines.push('');
    var shown = typeof result.value === 'number' ? fmt(result.value, 6) : result.value;
    lines.push('结论：' + shown + (result.unit ? ' ' + result.unit : '') + '　' + verdict);
    (notes || []).forEach(function (n) { lines.push('  · ' + n); });
    (warnings || []).forEach(function (w) { lines.push('  ⚠ ' + w); });
    return {
      id: meta.id, group: meta.group, title: meta.title, sym: meta.sym || '',
      inputs: used.map(function (i) { return { label: i.label, key: i.key, value: p[i.key], unit: i.unit || '' }; }),
      steps: steps, result: result, verdict: verdict, tone: tone || 'info',
      notes: notes || [], warnings: warnings || [], provides: provides || {},
      text: lines.join('\n')
    };
  }

  /* ============================ 单项公式 ============================ */

  var TASK_OPTS = Object.keys(CONST.TASKS).map(function (k) { return { value: k, label: CONST.TASKS[k].label + '（k=' + CONST.TASKS[k].k + '）' }; });
  var IFACE_OPTS = Object.keys(CONST.IFACE_BW).map(function (k) { return { value: k, label: k + '（' + CONST.IFACE_BW[k] + ' MB/s）' }; });
  var AP_OPTS = CONST.APERTURES.map(function (x) { return { value: String(x), label: 'F' + x }; });
  var BIT_OPTS = ['8', '10', '12'].map(function (x) { return { value: x, label: x + ' bit' }; });
  function I(key, label, def, unit, type, opts, hint) {
    return { key: key, label: label, def: def, unit: unit || '', type: type || 'number', opts: opts || null, hint: hint || '' };
  }

  var FORMULAS = [
    {
      id: 'pxacc', group: 'optics', title: '所需像素精度', sym: '像素精度 = δ / k',
      inputs: [I('precision', '最小特征 δ', 0.15, 'mm'), I('task', '检测任务', 'defect', '', 'select', TASK_OPTS)],
      run: function (p) {
        var k = kOf(p.task), acc = pxAccReqOf(p);
        var steps = [S('所需像素精度', 'δ / k', fmt(p.precision, 3) + ' / ' + k, acc, 'mm/px', true)];
        return pack(this, p, steps, { value: acc, unit: 'mm/px' },
          '每个最小特征需占 ' + k + ' 像素，单像素不得超过 ' + fmt(acc, 4) + ' mm', 'ok',
          ['k 取值：精密尺寸测量 5 / 一般测量·定位·OCR 4 / 缺陷·表面 3 / 有无 2.5 / 颜色区分 2'],
          null, { pxAccReq: acc });
      }
    },
    {
      id: 'resolution', group: 'optics', title: '所需分辨率', sym: 'H ≥ 视野宽 / (δ/k) × 彩色余量',
      inputs: [I('fovW', '视野宽', 60, 'mm'), I('fovH', '视野高', 45, 'mm'),
               I('precision', '最小特征 δ', 0.15, 'mm'), I('task', '检测任务', 'defect', '', 'select', TASK_OPTS),
               I('needColor', '需要彩色相机', false, '', 'check')],
      run: function (p) {
        var r = resolutionOf(p), acc = pxAccReqOf(p);
        var steps = [
          S('所需像素精度', 'δ / k', fmt(p.precision, 3) + ' / ' + kOf(p.task), acc, 'mm/px'),
          S('水平所需像素', '视野宽 / 像素精度 × 彩色余量', fmt(p.fovW, 1) + ' / ' + fmt(acc, 4) + ' × ' + fmt(r.factor, 1), r.w, 'px', num(p.camW, 0) ? num(p.camW, 0) >= r.w : null),
          S('垂直所需像素', '视野高 / 像素精度 × 彩色余量', fmt(p.fovH, 1) + ' / ' + fmt(acc, 4) + ' × ' + fmt(r.factor, 1), r.h, 'px', num(p.camH, 0) ? num(p.camH, 0) >= r.h : null),
          S('相机像素总量', 'H × V / 10⁶', r.w + ' × ' + r.h + ' / 10⁶', r.w * r.h / 1e6, 'MP')
        ];
        return pack(this, p, steps, { value: r.w * r.h / 1e6, unit: 'MP' },
          '至少 ' + r.w + ' × ' + r.h + ' px（约 ' + fmt(r.w * r.h / 1e6, 2) + ' MP）', 'info',
          ['彩色 Bayer 插值后细节分辨率偏低，所需分辨率 × 1.2；黑白 × 1.0',
           '选机时从小到大取第一台两个方向都满足的，够用就好'],
          null, { pxW: r.w, pxH: r.h, mp: r.w * r.h / 1e6 });
      }
    },
    {
      id: 'magnification', group: 'optics', title: '所需放大倍率', sym: 'm₀ = min(靶面宽/视野宽, 靶面高/视野高)',
      inputs: [I('fovW', '视野宽', 60, 'mm'), I('fovH', '视野高', 45, 'mm'),
               I('sw', '靶面宽', 7.2, 'mm'), I('sh', '靶面高', 5.4, 'mm')],
      run: function (p) {
        var m = magNeedOf(p);
        var steps = [
          S('按宽度反算', '靶面宽 / 视野宽', fmt(p.sw, 2) + ' / ' + fmt(p.fovW, 1), m.byW, '×'),
          S('按高度反算', '靶面高 / 视野高', fmt(p.sh, 2) + ' / ' + fmt(p.fovH, 1), m.byH, '×'),
          S('所需放大倍率', 'min(按宽, 按高)', 'min(' + fmt(m.byW, 4) + ', ' + fmt(m.byH, 4) + ')', m.m, '×', true, '受' + m.limitedBy + '边约束')
        ];
        return pack(this, p, steps, { value: m.m, unit: '×' }, '取 ' + fmt(m.m, 4) + '×（' + m.limitedBy + '边受限）', 'info', null, null,
          { m: m.m });
      }
    },
    {
      id: 'focal', group: 'optics', title: '所需焦距与标准档位', sym: 'f = WD · m₀ / (1 + m₀)',
      inputs: [I('wd', '工作距离 WD', 250, 'mm'), I('fovW', '视野宽', 60, 'mm'), I('fovH', '视野高', 45, 'mm'),
               I('sw', '靶面宽', 7.2, 'mm'), I('sh', '靶面高', 5.4, 'mm')],
      run: function (p) {
        var m = magNeedOf(p), fReq = focalReqOf(m.m, p.wd), L = ladderOf(fReq);
        var steps = [
          S('所需放大倍率', 'min(靶面/视野)', 'min(' + fmt(m.byW, 4) + ', ' + fmt(m.byH, 4) + ')', m.m, '×'),
          S('理论焦距', 'WD · m₀ / (1 + m₀)', fmt(p.wd, 0) + ' × ' + fmt(m.m, 4) + ' / (1 + ' + fmt(m.m, 4) + ')', fReq, 'mm'),
          S('标准焦距档', '取 ≤ 理论值的最大档', CONST.FOCAL_LADDER.join(' / '), L.pick, 'mm', !L.belowMin)
        ];
        var warnings = [];
        if (L.belowMin) warnings.push('理论焦距小于最小标准档 6mm，需改用更短焦距或增大工作距离');
        if (L.aboveMax) warnings.push('理论焦距大于 100mm，标准档位已封顶，需按实际镜头库选');
        return pack(this, p, steps, { value: L.pick, unit: 'mm' },
          '理论 ' + fmt(fReq, 2) + ' mm → 选 ' + L.pick + ' mm（视场只会变大，不会裁掉工件）', 'info',
          ['实际镜头需再核对最近摄距与卡口；转接环会额外占 12mm 左右'], warnings,
          { focalPick: L.pick, focalReq: fReq, m: m.m });
      }
    },
    {
      id: 'fov', group: 'optics', title: '实际视场（由焦距反算）', sym: 'm = f / (WD − f)，视场 = 靶面 / m',
      inputs: [I('focal', '镜头焦距 f', 25, 'mm'), I('wd', '工作距离 WD', 250, 'mm'),
               I('sw', '靶面宽', 7.2, 'mm'), I('sh', '靶面高', 5.4, 'mm'),
               I('fovW', '需求视野宽', 60, 'mm', 'number', null, '用于判定是否覆盖工件'),
               I('fovH', '需求视野高', 45, 'mm')],
      run: function (p) {
        var m = magActualOf(p.focal, p.wd);
        if (m == null) return pack(this, p, [S('实际放大倍率', 'f / (WD − f)', fmt(p.focal, 1) + ' / (' + fmt(p.wd, 0) + ' − ' + fmt(p.focal, 1) + ')', null, '×', false, 'WD 必须大于 f')],
          { value: null, unit: '' }, '工作距离必须大于焦距', 'bad');
        var fov = fovActualOf(p, m), cover = fov.w >= num(p.fovW, 0) && fov.h >= num(p.fovH, 0);
        var steps = [
          S('实际放大倍率', 'f / (WD − f)', fmt(p.focal, 1) + ' / (' + fmt(p.wd, 0) + ' − ' + fmt(p.focal, 1) + ')', m, '×'),
          S('实际视场宽', '靶面宽 / m', fmt(p.sw, 2) + ' / ' + fmt(m, 4), fov.w, 'mm', fov.w >= num(p.fovW, 0)),
          S('实际视场高', '靶面高 / m', fmt(p.sh, 2) + ' / ' + fmt(m, 4), fov.h, 'mm', fov.h >= num(p.fovH, 0))
        ];
        return pack(this, p, steps, { value: fov.w * fov.h, unit: 'mm²' },
          fmt(fov.w, 1) + ' × ' + fmt(fov.h, 1) + ' mm，' + (cover ? '覆盖需求视野 ✓' : '未覆盖需求视野 ✗'), cover ? 'ok' : 'bad',
          ['视场略大于需求是正常的（焦距只能取标准档），但像素会被摊薄，需复核有效像素精度'],
          null, { fovActW: fov.w, fovActH: fov.h, m: m });
      }
    },
    {
      id: 'pxeff', group: 'optics', title: '有效像素精度与余量', sym: 'pxAcc = max(视场宽/W, 视场高/V)',
      inputs: [I('fovW', '实际视场宽', 64.8, 'mm'), I('fovH', '实际视场高', 48.6, 'mm'),
               I('camW', '相机水平像素', 2448, 'px'), I('camH', '相机垂直像素', 2048, 'px'),
               I('precision', '最小特征 δ', 0.15, 'mm'), I('task', '检测任务', 'defect', '', 'select', TASK_OPTS)],
      run: function (p) {
        var acc = pxAccEffOf(p, { w: num(p.fovW, 1), h: num(p.fovH, 1) });
        var req = pxAccReqOf(p), k = kOf(p.task), margin = (req - acc) / req * 100;
        var steps = [
          S('要求像素精度', 'δ / k', fmt(p.precision, 3) + ' / ' + k, req, 'mm/px'),
          S('水平有效精度', '视场宽 / W', fmt(p.fovW, 1) + ' / ' + fmt(p.camW, 0), num(p.fovW, 1) / num(p.camW, 1), 'mm/px'),
          S('垂直有效精度', '视场高 / V', fmt(p.fovH, 1) + ' / ' + fmt(p.camH, 0), num(p.fovH, 1) / num(p.camH, 1), 'mm/px'),
          S('取较差方向', 'max(水平, 垂直)', 'max(' + fmt(num(p.fovW, 1) / num(p.camW, 1), 5) + ', ' + fmt(num(p.fovH, 1) / num(p.camH, 1), 5) + ')', acc, 'mm/px', acc <= req),
          S('精度余量', '(要求 − 实际) / 要求', '(' + fmt(req, 4) + ' − ' + fmt(acc, 5) + ') / ' + fmt(req, 4), margin, '%', margin >= 15),
          S('可分辨最小特征', '有效精度 × k', fmt(acc, 5) + ' × ' + k, acc * k, 'mm', acc * k <= num(p.precision, 1))
        ];
        return pack(this, p, steps, { value: acc, unit: 'mm/px' },
          fmt(acc, 5) + ' mm/px，余量 ' + fmt(margin, 1) + '%（建议 ≥ 15%）', margin >= 15 ? 'ok' : 'warn',
          [], acc * k > num(p.precision, 1) ? ['有效精度不满足 δ/k，需升一档分辨率或缩短工作距离'] : [],
          { pxAccEff: acc, margin: margin });
      }
    },
    {
      id: 'wd', group: 'optics', title: '工作距离反算', sym: 'WD = f · (1 + m) / m',
      inputs: [I('focal', '镜头焦距 f', 25, 'mm'), I('fovW', '视野宽', 60, 'mm'),
               I('sw', '靶面宽', 7.2, 'mm'), I('freeSpace', '可用安装深度', 400, 'mm', 'number', null, '可选')],
      run: function (p) {
        var m = num(p.sw, 0) / num(p.fovW, 1), wd = num(p.focal, 0) * (1 + m) / m;
        var steps = [
          S('所需放大倍率', '靶面宽 / 视野宽', fmt(p.sw, 2) + ' / ' + fmt(p.fovW, 1), m, '×'),
          S('所需工作距离', 'f · (1 + m) / m', fmt(p.focal, 1) + ' × (1 + ' + fmt(m, 4) + ') / ' + fmt(m, 4), wd, 'mm')
        ];
        var space = num(p.freeSpace, 0);
        return pack(this, p, steps, { value: wd, unit: 'mm' }, 'WD 需 ≈ ' + fmt(wd, 1) + ' mm', 'info',
          ['镜头最近摄距与法兰距必须另行核对；实际调焦会留 ±5% 余量'],
          space > 0 && wd > space ? ['可用安装深度 ' + fmt(space, 0) + ' mm 不足'] : [],
          { wdReq: wd });
      }
    },
    {
      id: 'dof', group: 'quality', title: '景深与衍射', sym: 'DOF = 2 · F · c · (1 + m) / m²（c = 2 像元）',
      inputs: [I('m', '放大倍率 m', 0.111, '×'), I('aperture', '光圈 F', '5.6', '', 'select', AP_OPTS),
               I('pxUm', '像元尺寸', 3.45, 'µm'), I('heightDiff', '工件高度变化 Δh', 2, 'mm')],
      run: function (p) {
        var m = num(p.m, 0.1), F = num(p.aperture, 8), c = cocMmOf(p.pxUm);
        var dof = dofOf(F, c, m), blur = airyPxOf(F, p.pxUm);
        var hd = num(p.heightDiff, null);            // 未填 Δh 时不判定覆盖能力
        var steps = [
          S('弥散圆 c', '2 × 像元 / 1000', '2 × ' + fmt(p.pxUm, 2) + ' / 1000', c, 'mm'),
          S('景深', '2 · F · c · (1 + m) / m²', '2 × ' + fmt(F, 1) + ' × ' + fmt(c, 5) + ' × (1 + ' + fmt(m, 4) + ') / ' + fmt(m, 4) + '²', dof, 'mm', hd == null ? null : dof >= hd),
          S('衍射艾里斑', '2.44 · λ · F / 像元', '2.44 × 0.55 × ' + fmt(F, 1) + ' / ' + fmt(p.pxUm, 2), blur, 'px', blur <= CONST.DIFFRACTION_LIMIT_PX)
        ];
        var next = CONST.APERTURES.filter(function (x) { return x > F; })[0];
        if (next) {
          var d2 = dofOf(next, c, m), b2 = airyPxOf(next, p.pxUm);
          steps.push(S('收一档到 F' + next, '同一公式重算', 'F' + next + ' → DOF / 艾里斑', d2, 'mm', hd == null ? null : d2 >= hd,
            '艾里斑 ' + fmt(b2, 2) + ' px' + (b2 > CONST.DIFFRACTION_LIMIT_PX ? '，已超 2.5px 不建议再收' : '')));
        }
        var warnings = [];
        if (hd != null && dof < hd) warnings.push('景深 ' + fmt(dof, 2) + ' mm < 高度变化 ' + fmt(p.heightDiff, 1) + ' mm，需收小光圈或改远心');
        if (hd == null) warnings.push('未填工件高度变化 Δh，只给景深值、不判定能否覆盖');
        if (blur > CONST.DIFFRACTION_LIMIT_PX) warnings.push('衍射弥散 ' + fmt(blur, 2) + ' px > 2.5 px，成像会变软');
        return pack(this, p, steps, { value: dof, unit: 'mm' },
          'DOF ≈ ' + fmt(dof, 2) + ' mm' +
            (hd == null ? '（未填 Δh，未判定覆盖）' : '，' + (dof >= hd ? '满足' : '不满足') + ' Δh') +
            '；衍射 ' + fmt(blur, 2) + ' px',
          hd != null && dof < hd || blur > CONST.DIFFRACTION_LIMIT_PX ? 'warn' : (hd == null ? 'info' : 'ok'),
          ['几何光学近似，不含像差；微距 m > 0.3 时误差增大'], warnings,
          { dof: dof, airy: blur });
      }
    },
    {
      id: 'exposure', group: 'quality', title: '曝光上限（运动模糊）', sym: 't ≤ 像素精度 / 速度 × 1000',
      inputs: [I('pxAcc', '有效像素精度', 0.0265, 'mm/px'), I('speed', '工件速度 v', 100, 'mm/s'),
               I('expMinUs', '相机最短曝光', 20, 'µs')],
      run: function (p) {
        var acc = num(p.pxAcc, 0), v = num(p.speed, 0), t = expMaxMsOf(acc, v);
        var hasExp = !(p.expMinUs === undefined || p.expMinUs === null || p.expMinUs === '');
        var tMin = hasExp ? num(p.expMinUs, 0) / 1000 : null;   // 未填相机最短曝光时不校核
        var steps = [
          S('曝光上限', '像素精度 / 速度 × 1000', fmt(acc, 4) + ' / ' + fmt(v, 1) + ' × 1000', t, 'ms', t >= CONST.STROBE_EXP_MS)
        ];
        if (hasExp) steps.push(S('相机最短曝光', 'µs / 1000', fmt(p.expMinUs, 0) + ' / 1000', tMin, 'ms', t >= tMin));
        if (!isFinite(t)) return pack(this, p, [S('曝光上限', '静态拍摄', '速度 = 0', null, 'ms', true, '无运动模糊约束')],
          { value: null, unit: '' }, '静态拍摄，先按 2 ms 试拍', 'info', null, null, { tMax: null });
        var blur = v * t / 1000 / acc;
        steps.push(S('该曝光下模糊量', 'v · t / 像素精度', fmt(v, 1) + ' × ' + fmt(t, 3) + ' / 1000 / ' + fmt(acc, 4), blur, 'px', blur <= 1));
        var warnings = [];
        if (t < CONST.STROBE_EXP_MS) warnings.push('曝光 < 1 ms，需配频闪控制器（脉冲宽度 = 曝光时间）');
        if (hasExp && t < tMin) warnings.push('曝光上限短于相机最短曝光 ' + fmt(tMin, 3) + ' ms，该相机不可用');
        return pack(this, p, steps, { value: t, unit: 'ms' }, '曝光不得超过 ' + fmt(t, 3) + ' ms', warnings.length ? 'warn' : 'ok',
          ['保证运动模糊 ≤ 1 像素；最终曝光以现场直方图与标准件为准'], warnings,
          { tMax: t });
      }
    },
    {
      id: 'fps', group: 'quality', title: '帧率与节拍', sym: 'fps = 速度 / 实际视场高 × 1.2（静态 15）',
      inputs: [I('speed', '工件速度 v', 100, 'mm/s'), I('fovH', '实际视场高', 48.6, 'mm'),
               I('cpm', '产线节拍', 60, '件/分', 'number', null, '可选，0 表示不填')],
      run: function (p) {
        var v = num(p.speed, 0), fps = fpsOf(v, p.fovH), cpm = num(p.cpm, 0);
        var steps = [S('帧率需求', v > 0 ? 'v / 视场高 × 1.2' : '静态默认',
                       v > 0 ? fmt(v, 1) + ' / ' + fmt(p.fovH, 1) + ' × 1.2' : '速度 = 0', fps, 'fps', true)];
        if (v > 0) steps.push(S('每帧前进距离', 'v / fps', fmt(v, 1) + ' / ' + fmt(fps, 0), v / fps, 'mm'));
        if (cpm > 0) steps.push(S('节拍换算', '件/分 ÷ 60', fmt(cpm, 0) + ' / 60', cpm / 60, '件/s', fps >= cpm / 60));
        return pack(this, p, steps, { value: fps, unit: 'fps' },
          '需求 ≥ ' + fps + ' fps（静态默认 ' + CONST.STATIC_FPS + ' fps）', 'info',
          ['1.2 是重叠与触发抖动余量；有触发信号时按硬触发频率取值'],
          null, { fpsNeed: fps });
      }
    },
    {
      id: 'budget', group: 'quality', title: '精度预算（RMS 合成）', sym: 'σ = √(Σ 误差项²)',
      inputs: [I('pxAcc', '有效像素精度', 0.0265, 'mm/px'), I('precision', '最小特征 δ', 0.15, 'mm'),
               I('task', '检测任务', 'defect', '', 'select', TASK_OPTS),
               I('fovW', '实际视场宽', 64.8, 'mm'), I('fovH', '实际视场高', 48.6, 'mm'),
               I('dist', '镜头畸变规格', 0, '%', 'number', null, '填 0 表示无数据，按 0.5 像素估')],
      run: function (p) {
        var acc = num(p.pxAcc, 0), req = pxAccReqOf(p), b = budgetOf(acc, p.fovW, p.fovH, p.dist);
        var steps = b.items.map(function (it) {
          return S(it.name, it.sym, it.sub, it.mm, 'mm', null, it.note);
        });
        steps.push(S('均方根合成', '√(Σ 误差项²)', b.items.map(function (x) { return fmt(x.mm, 5) + '²'; }).join(' + '), b.total, 'mm', b.total <= req));
        steps.push(S('要求上限', 'δ / k', fmt(p.precision, 3) + ' / ' + kOf(p.task), req, 'mm'));
        return pack(this, p, steps, { value: b.total, unit: 'mm' },
          '合成 ' + fmt(b.total, 5) + ' mm ' + (b.total <= req ? '≤' : '>') + ' 要求 ' + fmt(req, 5) + ' mm',
          b.total <= req ? 'ok' : 'bad',
          ['理论像素精度只是「一个像素多大」，工程上还要叠加亚像素、畸变残差与标定误差'],
          b.total > req ? ['预算超差，需提高分辨率或加强标定'] : [],
          { sigma: b.total });
      }
    },
    {
      id: 'bandwidth', group: 'system', title: '数据带宽与接口校核', sym: 'BW = W · V · 位深 · fps / 8',
      inputs: [I('camW', '水平像素', 2448, 'px'), I('camH', '垂直像素', 2048, 'px'),
               I('bitDepth', '位深', '8', 'bit', 'select', BIT_OPTS), I('fps', '帧率', 15, 'fps'),
               I('iface', '相机接口', 'GigE', '', 'select', IFACE_OPTS)],
      run: function (p) {
        var bw = bandwidthOf(p.camW, p.camH, p.bitDepth, p.fps), cap = ifaceCap(p.iface);
        var maxFps = maxFpsOf(cap, p.camW, p.camH, p.bitDepth), ratio = bw / cap * 100;
        var steps = [
          S('链路带宽', 'W · V · bit · fps / 8 / 10⁶', fmt(p.camW, 0) + ' × ' + fmt(p.camH, 0) + ' × ' + fmt(p.bitDepth, 0) + ' × ' + fmt(p.fps, 0) + ' / 8 / 10⁶', bw, 'MB/s', bw <= cap),
          S('接口理论线速', '查表', p.iface, CONST.IFACE_BW[p.iface] || 350, 'MB/s'),
          S('有效带宽', '理论线速 × 0.85', fmt(CONST.IFACE_BW[p.iface] || 350, 0) + ' × 0.85', cap, 'MB/s'),
          S('带宽占用', '链路 / 有效', fmt(bw, 2) + ' / ' + fmt(cap, 2), ratio, '%', ratio <= 100),
          S('该接口最大帧率', '有效带宽 × 8 × 10⁶ / (W·V·bit)', fmt(cap, 2) + ' × 8 × 10⁶ / (' + fmt(p.camW, 0) + ' × ' + fmt(p.camH, 0) + ' × ' + fmt(p.bitDepth, 0) + ')', maxFps, 'fps')
        ];
        return pack(this, p, steps, { value: bw, unit: 'MB/s' },
          fmt(bw, 2) + ' / ' + fmt(cap, 2) + ' MB/s（占用 ' + fmt(ratio, 1) + '%），' + (bw <= cap ? '放得下 ✓' : '放不下 ✗'),
          bw <= cap ? 'ok' : 'bad',
          ['位深取相机单通道原始输出 8/10/12 bit；彩色 Bayer 也是单通道，RGB 插值发生在上位机',
           '0.85 扣掉包头 / 协议 / 帧间隔开销'],
          bw > cap ? ['需降帧率 / 降位深 / 换更高带宽接口'] : [],
          { bw: bw, cap: cap, maxFps: maxFps });
      }
    },
    {
      id: 'space', group: 'system', title: '安装空间尺寸链', sym: '总长 = WD + 镜头长 + 相机厚 + 线缆余量',
      inputs: [I('wd', '工作距离 WD', 250, 'mm'), I('lensLen', '镜头长度', 50, 'mm'),
               I('camDepth', '相机厚度', 45, 'mm'), I('freeSpace', '可用安装深度', 400, 'mm')],
      run: function (p) {
        var total = spaceOf(p), kit = total + CONST.BRACKET_MM + CONST.ADJUST_MM, free = num(p.freeSpace, 0);
        var steps = [
          S('线缆余量', '经验值', String(CONST.CABLE_MM), CONST.CABLE_MM, 'mm'),
          S('光机总长', 'WD + 镜头 + 相机 + 线缆', fmt(p.wd, 0) + ' + ' + fmt(p.lensLen, 0) + ' + ' + fmt(p.camDepth, 0) + ' + ' + CONST.CABLE_MM, total, 'mm', free <= 0 || total <= free),
          S('含支架与调整余量', '总长 + 40 + 10', fmt(total, 0) + ' + 40 + 10', kit, 'mm', free <= 0 || kit <= free)
        ];
        var warnings = [];
        if (free > 0 && total > free) warnings.push('光机总长超出可用空间 ' + fmt(total - free, 1) + ' mm');
        return pack(this, p, steps, { value: total, unit: 'mm' },
          fmt(total, 1) + ' mm' + (free > 0 ? '，可用 ' + fmt(free, 0) + ' mm' : ''), warnings.length ? 'bad' : 'ok',
          ['镜头长度取手册外形图；缺数据按系列典型值估并标注', '转接环另加约 12mm'], warnings,
          { totalLen: total, kitLen: kit });
      }
    },
    {
      id: 'linescan', group: 'system', title: '线扫行频与像面宽', sym: '行频 = v / (δ/k) / 1000',
      inputs: [I('speed', '工件速度 v', 500, 'mm/s'), I('precision', '最小特征 δ', 0.15, 'mm'),
               I('task', '检测任务', 'defect', '', 'select', TASK_OPTS),
               I('sensorPx', '线阵像素数', 8192, 'px'), I('pxUm', '像元尺寸', 7.04, 'µm'),
               I('lineRateMax', '相机标称行频', 0, 'kHz', 'number', null, '可选，0 表示不校核')],
      run: function (p) {
        var acc = pxAccReqOf(p), rate = lineRateOf(p.speed, acc), sensorW = num(p.sensorPx, 0) * num(p.pxUm, 0) / 1000;
        var marginRate = rate == null ? null : rate * 1.2, max = num(p.lineRateMax, 0);
        var steps = [
          S('行方向像素精度', 'δ / k', fmt(p.precision, 3) + ' / ' + kOf(p.task), acc, 'mm/px'),
          S('所需行频', '速度 / 像素精度 / 1000', fmt(p.speed, 1) + ' / ' + fmt(acc, 4) + ' / 1000', rate, 'kHz', max > 0 ? marginRate <= max : null),
          S('含 20% 余量', '行频 × 1.2', fmt(rate, 2) + ' × 1.2', marginRate, 'kHz'),
          S('像面宽', '像素数 × 像元 / 1000', fmt(p.sensorPx, 0) + ' × ' + fmt(p.pxUm, 2) + ' / 1000', sensorW, 'mm')
        ];
        if (rate != null && rate > 0) {
          steps.push(S('每行前进距离', 'v / (行频 × 1000)', fmt(p.speed, 1) + ' / (' + fmt(rate, 2) + ' × 1000)', num(p.speed, 0) / (rate * 1000), 'mm', true, '应 ≈ 像素精度'));
        }
        var warnings = max > 0 && marginRate > max ? ['标称行频 ' + fmt(max, 1) + ' kHz 不够，需降速或换更高行频相机'] : [];
        return pack(this, p, steps, { value: rate, unit: 'kHz' },
          '需 ≥ ' + fmt(marginRate, 2) + ' kHz（含余量），像面宽 ' + fmt(sensorW, 2) + ' mm',
          warnings.length ? 'bad' : 'info',
          ['线扫镜头需按像面宽另选（本工具型录未收录线扫镜头）', '线光源长度 ≥ 视野宽 × 1.15'], warnings,
          { lineRate: rate, lineRateMargin: marginRate, sensorW: sensorW });
      }
    },
    {
      id: 'telecentric', group: 'system', title: '远心倍率与 WD 校验', sym: '倍率 = min(靶面/视野)，视野 = 靶面 / 倍率',
      inputs: [I('fovW', '视野宽', 30, 'mm'), I('fovH', '视野高', 22, 'mm'),
               I('sw', '靶面宽', 7.2, 'mm'), I('sh', '靶面高', 5.4, 'mm'),
               I('wd', '实际工作距离', 110, 'mm'), I('wdMin', '系列 WD 下限', 0, 'mm', 'number', null, '0 表示不校核'),
               I('wdMax', '系列 WD 上限', 0, 'mm')],
      run: function (p) {
        var m = magNeedOf(p), fov = { w: num(p.sw, 0) / m.m, h: num(p.sh, 0) / m.m };
        var lo = num(p.wdMin, 0), hi = num(p.wdMax, 0), checked = hi > lo, pass = !checked || (num(p.wd, 0) >= lo && num(p.wd, 0) <= hi);
        var steps = [
          S('所需倍率', 'min(靶面/视野)', 'min(' + fmt(m.byW, 4) + ', ' + fmt(m.byH, 4) + ')', m.m, '×'),
          S('该倍率下视野宽', '靶面宽 / 倍率', fmt(p.sw, 2) + ' / ' + fmt(m.m, 4), fov.w, 'mm'),
          S('该倍率下视野高', '靶面高 / 倍率', fmt(p.sh, 2) + ' / ' + fmt(m.m, 4), fov.h, 'mm'),
          S('工作距离校验', 'WD ∈ [下限, 上限]', checked ? fmt(p.wd, 0) + ' ∈ [' + fmt(lo, 0) + ', ' + fmt(hi, 0) + ']' : '未填区间', num(p.wd, 0), 'mm', checked ? pass : null)
        ];
        return pack(this, p, steps, { value: m.m, unit: '×' },
          '倍率 ≈ ' + fmt(m.m, 4) + '×，' + (checked ? (pass ? 'WD 在系列区间内 ✓' : 'WD 超出系列区间 ✗') : 'WD 待核对系列手册'),
          checked && !pass ? 'bad' : 'info',
          ['远心景深按 F8 估算，实际工作光圈以型号为准', '倍率只能取系列标称档，需按最近的档重算视野'],
          checked && !pass ? ['换 WD 区间覆盖当前距离的系列'] : [],
          { m: m.m });
      }
    },
    {
      id: 'lighting', group: 'quick', title: '照明方式与光色速查', sym: '规则表（任务 × 材质 × 目标色）',
      inputs: [I('task', '检测任务', 'defect', '', 'select', [
                 { value: 'precise_measure', label: '精密尺寸测量' }, { value: 'measure', label: '一般测量' },
                 { value: 'defect', label: '缺陷 / 划痕' }, { value: 'presence', label: '有无 / 装配确认' },
                 { value: 'ocr', label: '字符 / 条码' }, { value: 'color', label: '颜色区分' }]),
               I('material', '工件材质', 'metal_shiny', '', 'select', [
                 { value: 'metal_shiny', label: '金属高光面' }, { value: 'metal_matte', label: '金属哑光面' },
                 { value: 'plastic', label: '塑料件' }, { value: 'glass', label: '玻璃 / 透明件' },
                 { value: 'dark', label: '深色 / 黑色件' }, { value: 'label', label: '标签 / 纸张' }]),
               I('colorTarget', '目标主色', 'none', '', 'select', [
                 { value: 'none', label: '未指定' }, { value: 'red', label: '红' }, { value: 'yellow', label: '黄 / 铜 / 金' },
                 { value: 'green', label: '绿' }, { value: 'blue', label: '蓝' }, { value: 'dark', label: '黑 / 深色' }])],
      run: function (p) {
        var LIGHT_RULE = {
          metal_shiny: { defect: '低角度条形光（暗场）+ 偏振', default: '圆顶无影光（球积分）' },
          metal_matte: { defect: '低角度条形光', default: '高角度环形光' },
          plastic:     { defect: '低角度条形光', default: '高角度环形光' },
          glass:       { default: '平行背光（精密测量用远心背光）' },
          dark:        { default: '高角度环形光 / 同轴光，必要时红外' },
          label:       { default: '同轴光 / 条形光' }
        };
        var COLOR_RULE = {
          none:    null,
          red:     { same: '红光 625nm', anti: '青光 490nm' },
          yellow:  { same: '黄光 590nm', anti: '蓝光 450nm' },
          green:   { same: '绿光 525nm', anti: '红光 625nm' },
          blue:    { same: '蓝光 450nm', anti: '黄光 590nm' },
          dark:    { same: '红外 850nm', anti: '白光' }
        };
        var task = p.task, mat = p.material, ct = p.colorTarget;
        var r = LIGHT_RULE[mat] || LIGHT_RULE.plastic;
        var type = (task === 'precise_measure' || task === 'measure' || mat === 'glass') ? (LIGHT_RULE.glass.default)
                 : (task === 'ocr' ? '同轴光' : (task === 'presence' ? '高角度环形光' : (r.defect || r.default)));
        var cr = COLOR_RULE[ct];
        var color = cr ? cr.same : (mat === 'metal_shiny' ? '蓝光 450nm（抑制镜面成分）' : '红光 625nm（通用、消色差）');
        var steps = [
          S('照明方式', '任务 × 材质 查表', task + ' + ' + mat, type, '', true),
          S('推荐光色', '同色提亮 / 补色压暗', ct === 'none' ? '未指定，按材质默认' : ct, color, '', true),
          S('压暗用互补色', '查表', ct, cr ? cr.anti : '白光（深色件）', '', null)
        ];
        return pack(this, p, steps, { value: type, unit: '' }, type + '｜' + color, 'info',
          ['曝光 < 1 ms 或速度 > 300 mm/s 时改用频闪控制器，脉冲宽度 = 曝光时间',
           '照度需现场试样：工具算不出工件反射率与环境光',
           '绿 / 黄 / 青光标准系列不一定有货，可能需定制']);
      }
    },
    {
      id: 'unit', group: 'quick', title: '单位速查', sym: '同一长度 / 时间 / 速率的等价换算',
      inputs: [I('value', '输入数值', 0.05, ''), I('basis', '输入单位', 'mm', '', 'select', [
                 { value: 'mm', label: 'mm' }, { value: 'um', label: 'µm' }, { value: 'inch', label: 'inch' },
                 { value: 'px', label: 'px（按像素精度换算）' }]),
               I('pxAcc', '像素精度', 0.05, 'mm/px'), I('fps', '帧率', 30, 'fps')],
      run: function (p) {
        var v = num(p.value, 0), basis = p.basis, mm;
        if (basis === 'mm') mm = v;
        else if (basis === 'um') mm = v / 1000;
        else if (basis === 'inch') mm = v * 25.4;
        else mm = v * num(p.pxAcc, 0);
        var steps = [
          S('换算为 mm', basis + ' → mm', fmt(v, 4) + ' ' + basis, mm, 'mm'),
          S('换算为 µm', 'mm × 1000', fmt(mm, 6) + ' × 1000', mm * 1000, 'µm'),
          S('换算为 inch', 'mm / 25.4', fmt(mm, 6) + ' / 25.4', mm / 25.4, 'inch'),
          S('换算为 mil', 'mm / 0.0254', fmt(mm, 6) + ' / 0.0254', mm / 0.0254, 'mil'),
          S('换算为像素', 'mm / 像素精度', fmt(mm, 6) + ' / ' + fmt(p.pxAcc, 5), mm / num(p.pxAcc, 1), 'px'),
          S('每帧时间', '1000 / fps', '1000 / ' + fmt(p.fps, 0), 1000 / num(p.fps, 1), 'ms'),
          S('单帧单件节拍', 'fps × 60', fmt(p.fps, 0) + ' × 60', num(p.fps, 0) * 60, '件/分')
        ];
        return pack(this, p, steps, { value: mm, unit: 'mm' },
          fmt(v, 4) + ' ' + basis + ' = ' + fmt(mm, 5) + ' mm = ' + fmt(mm * 1000, 2) + ' µm', 'info',
          ['靶面「英寸」是 16mm 管径的旧标称，不等于 25.4mm；本行换算只用于长度单位']);
      }
    }
  ];

  var BY_ID = {};
  FORMULAS.forEach(function (f) { BY_ID[f.id] = f; });

  /* ============================ 组合计算器 ============================ */
  /*
   * 把 17 个公式按「一次方案里同时要算的东西」编成 6 组：
   * 同组共用一套输入（同一个量只填一次），组内哪个公式输入齐了就先算哪个；
   * 缺的只在结果卡里点名，不要求为了某一个公式把整套条件重填一遍。
   * 组与组之间只向下传递「算出来的量」（放大倍率 / 有效像素精度 / 实际视场 /
   * 建议焦距 / 需求帧率），用户填的原始条件各组独立，避免不同方案的数值互相污染。
   */

  var COMBO_DEFS = [
    {
      id: 'camera', label: '面阵成像与精度',
      desc: '工件与视野填好后，分辨率、放大倍率、焦距、实际视场、有效像素精度、精度预算与安装距离依次算出；镜头焦距留空时按建议档带入。',
      items: [
        { id: 'pxacc' },
        { id: 'resolution' },
        { id: 'magnification' },
        { id: 'focal' },
        { id: 'fov' },
        { id: 'pxeff', auto: { fovW: 'fov#fovActW', fovH: 'fov#fovActH' } },
        { id: 'budget', auto: { pxAcc: 'pxeff#pxAccEff', fovW: 'fov#fovActW', fovH: 'fov#fovActH' }, opt: { dist: 0 } },
        { id: 'wd', opt: { freeSpace: 0 } }
      ],
      fieldFrom: { focal: 'focal#focalPick' },
      labels: { focal: '镜头焦距 f', dist: '镜头畸变规格' },
      optional: ['dist', 'freeSpace'],
      sections: [
        { title: '工件与视野', keys: ['precision', 'task', 'needColor', 'fovW', 'fovH'] },
        { title: '相机与镜头', keys: ['sw', 'sh', 'camW', 'camH', 'wd', 'focal'] },
        { title: '可选校核', keys: ['dist', 'freeSpace'] }
      ]
    },
    {
      id: 'motion', label: '运动、曝光与帧率',
      desc: '放大倍率、有效像素精度、实际视场高从上一组自动带入（可随时改），填速度就能出曝光上限、需求帧率与景深。',
      items: [
        { id: 'exposure', opt: { expMinUs: null } },
        { id: 'fps', opt: { cpm: 0 } },
        { id: 'dof', opt: { heightDiff: null } }
      ],
      fieldFrom: { m: 'magnification#m', pxAcc: 'pxeff#pxAccEff', fovH: 'fov#fovActH' },
      labels: { pxAcc: '有效像素精度' },
      optional: ['expMinUs', 'cpm', 'heightDiff'],
      sections: [
        { title: '运动', keys: ['speed', 'heightDiff', 'cpm'] },
        { title: '镜头与像元', keys: ['m', 'aperture', 'pxUm'] },
        { title: '曝光与精度', keys: ['pxAcc', 'expMinUs', 'fovH'] }
      ]
    },
    {
      id: 'link', label: '接口与安装',
      desc: '相机像素、位深、帧率决定链路带宽；WD + 镜头 + 相机厚度决定结构总长。帧率留空时用上一组算出的需求帧率。',
      items: [{ id: 'bandwidth' }, { id: 'space', opt: { freeSpace: 0 } }],
      fieldFrom: { fps: 'fps#fpsNeed' },
      optional: ['freeSpace'],
      sections: [
        { title: '相机与链路', keys: ['camW', 'camH', 'bitDepth', 'fps', 'iface'] },
        { title: '结构尺寸', keys: ['wd', 'lensLen', 'camDepth', 'freeSpace'] }
      ]
    },
    {
      id: 'scan', label: '线扫行频',
      desc: '按速度与像素精度算所需行频与像面宽，并核对相机标称行频是否够用。',
      items: [{ id: 'linescan', opt: { lineRateMax: 0 } }],
      optional: ['lineRateMax'],
      sections: [
        { title: '线扫参数', keys: ['speed', 'precision', 'task', 'sensorPx', 'pxUm', 'lineRateMax'] }
      ]
    },
    {
      id: 'tele', label: '远心倍率',
      desc: '按视野与靶面算所需倍率与设计视场，再用系列 WD 区间校核实际工作距离。',
      items: [{ id: 'telecentric', opt: { wdMin: 0, wdMax: 0 } }],
      optional: ['wdMin', 'wdMax'],
      sections: [
        { title: '视野与靶面', keys: ['fovW', 'fovH', 'sw', 'sh'] },
        { title: '工作距离', keys: ['wd', 'wdMin', 'wdMax'] }
      ]
    },
    {
      id: 'quick', label: '照明与单位速查',
      desc: '查表类：按任务与材质给照明方式与光色；长度 / 时间 / 帧率互换。',
      items: [{ id: 'lighting', opt: { colorTarget: 'none' } }, { id: 'unit' }],
      optional: ['colorTarget'],
      sections: [
        { title: '照明规则', keys: ['task', 'material', 'colorTarget'] },
        { title: '单位换算', keys: ['value', 'basis', 'pxAcc', 'fps'] }
      ]
    }
  ];

  var COMBOS = [], COMBO_BY_ID = {};
  COMBO_DEFS.forEach(function (def) {
    var seen = {}, fields = [], uses = {}, autos = {};
    def.items.forEach(function (it) {
      var f = BY_ID[it.id];
      if (!f) throw new Error('组合 ' + def.id + ' 引用了未知公式 ' + it.id);
      f.inputs.forEach(function (inp) {
        uses[inp.key] = (uses[inp.key] || 0) + 1;
        if (it.auto && Object.prototype.hasOwnProperty.call(it.auto, inp.key)) {
          autos[inp.key] = (autos[inp.key] || 0) + 1;
        }
      });
    });
    def.items.forEach(function (it) {
      var f = BY_ID[it.id];
      f.inputs.forEach(function (inp) {
        // 「所有用到它的公式都能自己算出来」的量（如实际视场、有效像素精度）不给输入框；
        // 部分公式能算、部分要填的（如视野宽）仍然是正常字段。
        if (seen[inp.key] || (autos[inp.key] && autos[inp.key] === uses[inp.key])) return;
        seen[inp.key] = true;
        fields.push({
          key: inp.key,
          label: (def.labels && def.labels[inp.key]) || inp.label,
          unit: inp.unit || '', type: inp.type || 'number', opts: inp.opts || null,
          hint: inp.hint || '', optional: (def.optional || []).indexOf(inp.key) >= 0
        });
      });
    });
    var byKey = {}, placed = [];
    fields.forEach(function (fd) { byKey[fd.key] = fd; });
    var sections = [];
    (def.sections || []).forEach(function (sec) {
      var list = [];
      sec.keys.forEach(function (k) {
        if (byKey[k] && placed.indexOf(k) < 0) { list.push(byKey[k]); placed.push(k); }
      });
      if (list.length) sections.push({ title: sec.title, fields: list });
    });
    var rest = fields.filter(function (fd) { return placed.indexOf(fd.key) < 0; });
    if (rest.length) sections.push({ title: '其它', fields: rest });

    var combo = {
      id: def.id, label: def.label, desc: def.desc || '',
      fields: fields, sections: sections, items: def.items,
      fieldFrom: def.fieldFrom || {}, count: def.items.length
    };
    COMBOS.push(combo);
    COMBO_BY_ID[def.id] = combo;
  });

  function hasVal(v) { return !(v === undefined || v === null || v === ''); }

  /**
   * 计算一个组合。
   * @param {string} id            组合 id
   * @param {object} params        用户填的值（只有填了的键）
   * @param {object} [seed]        前面组合算出来的量，形如 { 'pxeff#pxAccEff': {...} }
   * 返回 { items, filled, prov, done, total, text }：
   *   items 里每一项要么是公式结果（computed: true），要么是缺口清单（missing）。
   */
  function computeCombo(id, params, seed) {
    var combo = COMBO_BY_ID[id];
    if (!combo) return { error: '未知组合：' + id };
    var prov = {}, fieldKeys = {};
    combo.fields.forEach(function (fd) { fieldKeys[fd.key] = true; });
    var out = {
      id: id, label: combo.label, desc: combo.desc,
      fields: combo.fields, sections: combo.sections,
      items: [], filled: {}, prov: prov, done: 0, total: combo.items.length
    };
    function look(src) { return prov[src] || (seed && seed[src]) || null; }

    combo.items.forEach(function (item) {
      var f = BY_ID[item.id], p = {}, miss = [], from = {};
      f.inputs.forEach(function (inp) {
        var own = item.auto && Object.prototype.hasOwnProperty.call(item.auto, inp.key);
        var v = params ? params[inp.key] : undefined;
        // 声明了 auto 的输入表示「这个量由别的公式算」，同名条件不能顶替（如需求视野≠实际视场）
        if (!own && hasVal(v)) { p[inp.key] = v; return; }
        var src = (own && item.auto[inp.key]) || (combo.fieldFrom && combo.fieldFrom[inp.key]);
        if (src) {
          var hit = look(src);
          if (hit) { p[inp.key] = hit.value; from[inp.key] = hit; return; }
          var sid = src.split('#')[0], prev = null;
          out.items.forEach(function (x) { if (x.id === sid) prev = x; });
          var root = prev && prev.missing && prev.missing.length ? prev.missing[0] : null;
          miss.push({
            key: inp.key, label: inp.label, viaId: sid,
            viaTitle: (BY_ID[sid] || {}).title || sid,
            rootKey: root ? root.key : null, rootLabel: root ? root.label : null, rootCount: prev && prev.missing ? prev.missing.length : 0
          });
          return;
        }
        if (item.opt && Object.prototype.hasOwnProperty.call(item.opt, inp.key)) { p[inp.key] = item.opt[inp.key]; return; }
        if (inp.type === 'check') { p[inp.key] = false; return; }
        miss.push({ key: inp.key, label: inp.label });
      });

      if (miss.length) {
        out.items.push({ id: item.id, title: f.title, sym: f.sym, computed: false, missing: miss });
        return;
      }
      var res = f.run(p);
      res.computed = true; res.id = item.id; res.title = f.title; res.sym = f.sym;
      res.filled = from;
      out.items.push(res);
      out.done++;
      var pv = res.provides || {};
      Object.keys(pv).forEach(function (k) {
        var val = pv[k];
        if (val === undefined || val === null) return;
        if (typeof val === 'number' && !isFinite(val)) return;
        prov[item.id + '#' + k] = { value: val, from: f.title, fromId: item.id };
      });
      Object.keys(from).forEach(function (k) {
        if (!fieldKeys[k] || hasVal(params ? params[k] : undefined)) return;
        out.filled[k] = { value: p[k], from: from[k].from, fromId: from[k].fromId };
      });
    });

    // 即使消费该字段的公式因别的项缺失没算出来，字段本身该带入的值也照样显示
    combo.fields.forEach(function (fd) {
      if (hasVal(params ? params[fd.key] : undefined)) return;
      var src = combo.fieldFrom && combo.fieldFrom[fd.key];
      if (!src) return;
      var hit = look(src);
      if (hit) out.filled[fd.key] = { value: hit.value, from: hit.from, fromId: hit.fromId };
    });

    out.text = out.items.filter(function (x) { return x.computed; })
      .map(function (x) { return x.text; }).join('\n\n');
    return out;
  }

  function defaults(id) {
    var f = BY_ID[id], p = {};
    if (!f) return p;
    f.inputs.forEach(function (i) { p[i.key] = i.def; });
    return p;
  }

  /**
   * 计算单个公式。计算器语义：不填就不算，不使用任何隐式默认值。
   * 缺参数时返回 { incomplete: [...] }，由界面提示还差哪几项。
   * 复选项（check）未勾选视为 false，不要求用户填写。
   */
  function compute(id, params) {
    var f = BY_ID[id];
    if (!f) return { error: '未知公式：' + id };
    var p = {}, missing = [];
    f.inputs.forEach(function (i) {
      var v = params ? params[i.key] : undefined;
      if (v === undefined || v === null || v === '') {
        if (i.type === 'check') p[i.key] = false;
        else missing.push(i.label);
      } else p[i.key] = v;
    });
    if (missing.length) return { incomplete: missing, error: '请填写：' + missing.join('、'), title: f.title };
    return f.run(p);
  }

  return {
    CONST: CONST, GROUPS: GROUPS, FORMULAS: FORMULAS,
    COMBOS: COMBOS, computeCombo: computeCombo,
    comboById: function (id) { return COMBO_BY_ID[id] || null; },
    byId: function (id) { return BY_ID[id] || null; },
    defaults: defaults, compute: compute,
    // 底层口径暴露出来，便于单测与选型引擎交叉核对
    core: {
      pxAccReqOf: pxAccReqOf, resolutionOf: resolutionOf, magNeedOf: magNeedOf,
      focalReqOf: focalReqOf, ladderOf: ladderOf, magActualOf: magActualOf,
      fovActualOf: fovActualOf, pxAccEffOf: pxAccEffOf, cocMmOf: cocMmOf,
      dofOf: dofOf, airyPxOf: airyPxOf, expMaxMsOf: expMaxMsOf, fpsOf: fpsOf,
      bandwidthOf: bandwidthOf, ifaceCap: ifaceCap, budgetOf: budgetOf,
      spaceOf: spaceOf, lineRateOf: lineRateOf, fmt: fmt, num: num
    }
  };
});
