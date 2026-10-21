/**
 * 机器视觉智能选型引擎（海康机器人型号库版）
 * ---------------------------------------------------------------
 * 纯计算模块，无 DOM 依赖：
 *   - 浏览器：先加载 hikrobot-catalog.js，再加载 engine.js → window.VisionEngine
 *   - Node  ：const VisionEngine = require('./engine.js')
 *
 * 输入（单位 mm / fps）：
 *   { fovW, fovH, precision, task, wd, material, colorTarget,
 *     needColor, heightDiff, speed, cpm }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./hikrobot-catalog.js'));
  } else {
    root.VisionEngine = factory(root.HikrobotCatalog);
  }
})(typeof self !== 'undefined' ? self : this, function (CAT) {
  'use strict';

  /* ============================ 数据表 ============================ */

  // k = 每个最小特征需要占用的像素数
  var TASKS = {
    precise_measure: { label: '精密尺寸测量', k: 5, hint: '亚像素边缘拟合，每个特征至少占 5 像素' },
    measure:         { label: '一般尺寸 / 间距测量', k: 4 },
    defect:          { label: '缺陷检测（划痕 / 毛刺 / 缺料）', k: 3 },
    surface:         { label: '表面质量（脏污 / 纹理 / 色差）', k: 3 },
    presence:        { label: '有无 / 装配确认', k: 2.5 },
    align:           { label: '定位引导（抓取 / 对位）', k: 4 },
    ocr:             { label: '字符 / 条码读取', k: 4 },
    color:           { label: '颜色 / 材质区分', k: 2 }
  };

  var MATERIALS = {
    metal_shiny: '金属高光面（抛光铜 / 铝 / 不锈钢）',
    metal_matte: '金属哑光面（铸铁 / 氧化 / 喷砂）',
    plastic:     '塑料件（通用）',
    glass:       '玻璃 / 透明件',
    dark:        '深色 / 黑色件（橡胶 / 涂黑）',
    pcb:         'PCB / 电子元件',
    label:       '标签 / 纸张 / 印刷品',
    textile:     '布 / 纤维 / 毛绒'
  };

  var COLOR = {
    white:  { name: '白光',        wl: '5500K', anti: '—',          why: '白光可还原真实颜色，需彩色还原时必选' },
    red:    { name: '红光',        wl: '625nm', anti: '青光 490nm', why: '红色特征在红光下反射率最高，且单色光可消除镜头色差' },
    yellow: { name: '黄光（琥珀）', wl: '590nm', anti: '蓝光 450nm', why: '黄 / 铜 / 金等暖色特征在黄光下反射率最高，目标明显变亮' },
    green:  { name: '绿光',        wl: '525nm', anti: '红光 625nm', why: '绿色特征在绿光下反射率最高，绿光传感器量子效率高、成像锐利' },
    blue:   { name: '蓝光',        wl: '450nm', anti: '黄光 590nm', why: '蓝色特征在蓝光下反射率最高，短波长对细节分辨更有利' },
    ir:     { name: '红外光',      wl: '850nm', anti: '白光',       why: '深色 / 黑色工件对可见光吸收强，红外波段反射更高，可拉开与背景的灰度差' },
    cyan:   { name: '青光',        wl: '490nm', anti: '红光 625nm', why: '青色特征在青光下反射率最高' }
  };

  // 海康光源产品系列（型号以 MV-L 开头，后缀表示颜色）
  var LIGHT_SERIES = {
    bar_low:   { code: 'MV-LLDS', name: '条形光源' },
    ring:      { code: 'MV-LRDS', name: '环形光源' },
    ring_low:  { code: 'MV-LRDS', name: '环形光源（低角度）' },
    ring_high: { code: 'MV-LRDS', name: '环形光源（高角度）' },
    backlight: { code: 'MV-LBPS', name: '平行面光源（背光）' },
    dome:      { code: 'MV-LGSS', name: '穹顶光源' },
    coaxial:   { code: 'MV-LCDS', name: '同轴光源' },
    line:      { code: 'MV-LTDS', name: '标准线光源' },
    point:     { code: 'MV-LDSS', name: '点光源' }
  };

  // 单色光对应的型号颜色后缀（海康标准系列）
  var COLOR_SUFFIX = {
    white:  { suf: '-W',     note: '白光（标准系列最常用）' },
    red:    { suf: '-R',     note: '红光' },
    blue:   { suf: '-B',     note: '蓝光' },
    green:  { suf: '-G',     note: '绿光，部分系列需单独确认是否有 -G 规格' },
    yellow: { suf: '-Y',     note: '黄/琥珀光，部分系列需单独确认规格' },
    ir:     { suf: '-IR850', note: '红外 850nm（另有 IR940 可选）' },
    cyan:   { suf: '-C',     note: '青光，需确认系列规格' }
  };

  var APERTURES = [2.8, 4, 5.6, 8, 11, 16, 22];
  var LAMBDA_UM = 0.55;

  // 各接口的可用带宽（MB/s，经验值）
  var IFACE_BW = {
    GigE: 110, USB3: 350, '10GigE': 1100,
    CameraLink: 680, CoaXPress: 1250, XoFLink: 1250, XoCLink: 1250
  };
  // 同像素量下优先选便宜/易用的接口
  var IFACE_RANK = { GigE: 0, USB3: 1, '10GigE': 2, CameraLink: 3, CoaXPress: 4, XoFLink: 5, XoCLink: 6 };

  /* ============================ 小工具 ============================ */

  function round(x, n) {
    var p = Math.pow(10, n == null ? 2 : n);
    return Math.round(x * p) / p;
  }

  function fmt(x, n) {
    if (!isFinite(x)) return '∞';
    if (Math.abs(x) >= 1000) return round(x, 0).toLocaleString('en-US');
    return String(round(x, n == null ? 3 : n));
  }

  function normalizeInput(raw) {
    var i = raw || {};
    var num = function (v, d) {
      var n = Number(v);
      return isFinite(n) ? n : d;
    };
    var out = {
      fovW: num(i.fovW, 50),
      fovH: num(i.fovH, 40),
      precision: num(i.precision, 0.1),
      task: TASKS[i.task] ? i.task : 'defect',
      wd: num(i.wd, 300),
      material: MATERIALS[i.material] ? i.material : 'metal_shiny',
      colorTarget: i.colorTarget || 'none',
      needColor: !!i.needColor,
      heightDiff: num(i.heightDiff, 0),
      speed: num(i.speed, 0),
      cpm: num(i.cpm, 0)
    };
    if (!(out.fovW > 0) || !(out.fovH > 0)) return { ok: false, error: '视野尺寸必须大于 0' };
    if (!(out.precision > 0)) return { ok: false, error: '检测精度（最小特征）必须大于 0' };
    if (!(out.wd > 0)) return { ok: false, error: '工作距离必须大于 0' };
    if (out.heightDiff < 0) out.heightDiff = 0;
    if (out.speed < 0) out.speed = 0;
    if (out.cpm < 0) out.cpm = 0;
    out.ok = true;
    return out;
  }

  /* ============================ 选型核心 ============================ */

  /**
   * 单台相机 + 镜头可行性评估。
   * m0 取宽高两个方向所需倍率的较小值，保证两台相机都能覆盖整个视野。
   */
  function tryCamera(cam, inp) {
    var m0 = Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH); // 覆盖视野所需最大倍率
    var fReq = (inp.wd * m0) / (1 + m0);                     // 对应焦距 f = WD·m/(1+m)
    var camMp = (cam.w * cam.h) / 1e6;
    var diag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);
    var isC = cam.mount === 'C';

    var pool = [];
    for (var i = 0; i < CAT.LENSES.length; i++) {
      var l = CAT.LENSES[i];
      var mountOk = isC ? l.mount === 'C' : l.mount !== 'C';
      if (!mountOk) continue;
      if (l.ic != null && l.ic < diag * 0.97) continue;          // 像面必须覆盖靶面
      if (l.mp != null && l.mp < camMp * 0.85) continue;         // 镜头解析力不能低于相机
      if (!(l.focal < inp.wd * 0.95)) continue;                  // 工作距离必须大于焦距
      if (l.focal > fReq + 1e-9) continue;                       // 焦距过大则视场不足
      pool.push(l);
    }
    if (!pool.length) return null;

    // 焦距越大 → 视场越小、像素精度越好；同焦距优先低规格（更便宜）
    pool.sort(function (a, b) {
      if (b.focal !== a.focal) return b.focal - a.focal;
      return (a.mp == null ? 25 : a.mp) - (b.mp == null ? 25 : b.mp);
    });

    var lens = pool[0];
    var m = lens.focal / (inp.wd - lens.focal);
    var fovW = cam.sw / m;
    var fovH = cam.sh / m;
    var pxAcc = Math.max(fovW / cam.w, fovH / cam.h);

    return {
      cam: cam,
      lens: lens,
      m: m,
      fReq: fReq,
      fovW: fovW,
      fovH: fovH,
      pxAcc: pxAcc,
      // 覆盖性由 m0 的构造保证，这里只需校验像素精度
      ok: pxAcc <= (inp.precision / (TASKS[inp.task] || TASKS.defect).k) * (1 + 1e-9)
    };
  }

  function selectOptics(inp, needW, needH, isColor) {
    var bitDepth = isColor ? 16 : 8;

    // 粗略估计该机型所需带宽（视野高用需求视野近似，用于判断接口是否够用）
    var estFps = inp.speed > 0 ? Math.max(1, Math.ceil((inp.speed / inp.fovH) * 1.2)) : 0;

    var pool = [];
    for (var i = 0; i < CAT.CAMERAS.length; i++) {
      var c = CAT.CAMERAS[i];
      if (c.w < needW || c.h < needH) continue;
      if (isColor ? c.color !== '彩色' : c.color !== '黑白') continue;
      if (inp.speed > 0 && c.shutter !== 'Global') continue;
      pool.push(c);
    }

    // 排序：像素最少优先 → 带宽放得下优先 → 接口越便宜越好
    pool.sort(function (a, b) {
      var pa = a.w * a.h;
      var pb = b.w * b.h;
      if (pa !== pb) return pa - pb;
      var fa = bandwidthFits(a), fb = bandwidthFits(b);
      if (fa !== fb) return fa ? -1 : 1;
      return (IFACE_RANK[a.iface] == null ? 9 : IFACE_RANK[a.iface]) -
        (IFACE_RANK[b.iface] == null ? 9 : IFACE_RANK[b.iface]);
    });

    function bandwidthFits(c) {
      var f = estFps > 0 ? estFps : Math.min(15, c.fps);
      var bw = (c.w * c.h * bitDepth * f) / 8 / 1e6;
      return bw <= (IFACE_BW[c.iface] || 350);
    }

    var best = null;
    for (var j = 0; j < pool.length; j++) {
      var cand = tryCamera(pool[j], inp);
      if (!cand) continue;
      if (cand.ok) return cand;
      if (!best || cand.pxAcc < best.pxAcc) best = cand;
    }
    return best;
  }

  /* ============================ 光源 ============================ */

  function buildLight(inp, ctx) {
    var mat = inp.material;
    var t = inp.task;

    var L = {
      type: 'ring',
      label: '环形光源',
      angle: '',
      size: '',
      color: '',
      colorName: '',
      wavelength: '',
      accessories: [],
      controller: '',
      reasons: [],
      alternates: [],
      series: '',
      seriesName: '',
      suffix: '',
      example: '',
      suffixNote: ''
    };

    /* ---- 1. 照明方式 ---- */
    if (t === 'measure' || t === 'precise_measure' || mat === 'glass') {
      L.type = 'backlight';
      L.label = (t === 'precise_measure' || mat === 'glass') ? '远心平行背光' : '平行背光（高均匀）';
      L.angle = '背光：光源—工件—镜头 三点一线，从工件背面打光';
      L.reasons.push('测量轮廓/尺寸时，背光形成纯黑剪影，边缘对比度最高，亚像素边缘最稳定');
      if (mat === 'glass') L.reasons.push('玻璃/透明件用背光可把划痕、气泡、内部杂质显影');
      if (t === 'precise_measure') L.reasons.push('远心平行背光光束近似平行，边缘衍射小，适合高精度测量');
      if (mat === 'glass') L.accessories.push('偏振片（检查内应力时配正交偏振）');
      L.size = '发光面 ≥ 视野 ×1.2 ≈ ' + Math.ceil(inp.fovW * 1.2) + ' × ' + Math.ceil(inp.fovH * 1.2) + ' mm';
    } else if (mat === 'metal_shiny') {
      if (t === 'surface' || t === 'defect') {
        L.type = 'bar_low';
        L.label = '低角度条形光（暗场）';
        L.angle = '低角度掠射 10°～25°，沿缺陷走向成组布置';
        L.reasons.push('金属抛光面镜面反射强：低角度掠射时平面反射光不进镜头，只有划痕/毛刺/凹坑等起伏才散射进光——暗场下缺陷发亮');
        L.accessories.push('偏振片（光源与镜头偏振正交），进一步压制镜面高光');
      } else {
        L.type = 'dome';
        L.label = '圆顶（球积分）光源';
        L.angle = '罩在工件上方，内壁漫反射形成无方向性的均匀照明';
        L.reasons.push('镜面 / 曲面工件用圆顶光可得无影均匀照明，消除局部反光和阴影');
      }
    } else if (t === 'ocr') {
      L.type = 'coaxial';
      L.label = '同轴光源';
      L.angle = '与镜头同轴，经半透半反镜垂直照向工件';
      L.reasons.push('同轴光垂直入射、垂直反射，能压平印刷面或金属刻字的反光，字符边缘最清晰');
    } else if (t === 'presence' || t === 'align') {
      L.type = 'ring_high';
      L.label = '高角度环形光源';
      L.angle = '环绕镜头，60°～90° 俯射';
      L.reasons.push('高角度环形光在工件表面形成均匀亮场，轮廓与装配缝隙清晰，适合有无 / 定位');
    } else if (t === 'defect' || t === 'surface') {
      L.type = 'bar_low';
      L.label = '低角度条形光（暗场）';
      L.angle = '低角度掠射 15°～30°，按缺陷方向布置 2～4 条';
      L.reasons.push('低角度掠射让平坦表面不反光、凸起或凹陷的缺陷发亮，是划痕 / 脏污 / 毛刺最通用的打光方式');
    } else if (t === 'color') {
      L.type = 'ring';
      L.label = '环形光源（单色）';
      L.angle = '环绕镜头 45°，配合单色光突出目标色';
      L.reasons.push('单色光照下目标色与其补色背景的灰度差最大，比彩色相机更稳定');
    } else {
      L.type = 'ring';
      L.label = '环形光源';
      L.angle = '环绕镜头 45°';
      L.reasons.push('环形光通用性好、结构简单，适合大多数中小视野照明');
    }

    /* ---- 2. 颜色 / 波长 ---- */
    var cm;
    var colorKey = 'red';
    if (inp.needColor) {
      cm = COLOR.white;
      colorKey = 'white';
      L.reasons.push('需要颜色区分或还原 → 配彩色相机，用白光保证色彩真实');
    } else if (inp.colorTarget && inp.colorTarget !== 'none' && COLOR[inp.colorTarget]) {
      cm = COLOR[inp.colorTarget];
      colorKey = inp.colorTarget === 'ir' ? 'ir' : inp.colorTarget;
      L.reasons.push(cm.why);
      L.reasons.push('同色光反射率最高 → 目标变亮、背景变暗；若要反过来压制该颜色，改用互补光 ' + cm.anti);
    } else if (L.type === 'backlight') {
      cm = COLOR.red;
      L.reasons.push('单色背光亮度高、可压暗多色背景，黑白相机下轮廓更干净');
    } else if (mat === 'metal_shiny') {
      cm = COLOR.blue;
      colorKey = 'blue';
      L.reasons.push('短波长在金属表面散射更强、镜面反射成分更弱，蓝光能提高金属细节对比度');
    } else if (mat === 'dark' || mat === 'textile') {
      cm = COLOR.red;
      L.reasons.push('长波长对深色 / 吸光材质更有利，红光下深色件与背景更易分开');
    } else {
      cm = COLOR.red;
      L.reasons.push('单色红光通用性好、可消除镜头色差、成本最低');
    }
    L.color = colorKey;
    L.colorName = cm.name;
    L.wavelength = cm.wl;

    /* ---- 3. 型号系列与后缀 ---- */
    var ser = LIGHT_SERIES[L.type] || LIGHT_SERIES.ring;
    var suf = COLOR_SUFFIX[colorKey] || COLOR_SUFFIX.red;
    L.series = ser.code;
    L.seriesName = ser.name;
    L.suffix = suf.suf;
    L.suffixNote = suf.note;
    L.example = ser.code + (L.type === 'backlight' ? '-{宽}-{高}' : L.type === 'bar_low' ? '-{长度}-{宽度}' : '-{尺寸}') + suf.suf;

    /* ---- 4. 尺寸建议 ---- */
    if (!L.size) {
      var longSide = Math.max(inp.fovW, inp.fovH);
      if (L.type === 'bar_low') {
        L.size = '条形光长度 ≥ 视野宽 ×1.2 ≈ ' + Math.ceil(inp.fovW * 1.2) + ' mm，2～4 条环绕布置';
      } else if (L.type === 'dome') {
        L.size = '穹顶内径 ≥ 视野长边 ×1.5 ≈ ' + Math.ceil(longSide * 1.5) + ' mm';
      } else if (L.type === 'coaxial') {
        L.size = '同轴模块通光口径 ≥ 镜头前端外径，按镜头接口（' + ctx.mount + '）选型';
      } else {
        L.size = '环形内径 ≥ 镜头前端外径，外径 ≈ 视野长边 ×1.2 ≈ ' + Math.ceil(longSide * 1.2) + ' mm';
      }
    }

    /* ---- 5. 控制器 ---- */
    var needStrobe = (isFinite(ctx.tMaxMs) && ctx.tMaxMs < 1) || ctx.speed > 300;
    L.controller = needStrobe
      ? '频闪控制器（与相机触发同步，脉冲宽度 < 曝光时间）'
      : '数字调光控制器（常亮，亮度可调）';

    /* ---- 6. 备选 ---- */
    var ALT = {
      backlight: ['同轴光（工件不能放背光时）', '带偏振的背光（透明/反光件）'],
      bar_low: ['低角度环形光（空间受限时）', '穹顶光 + 低角度补光（曲面件）'],
      dome: ['同轴光（平面镜面件）', '漫射板 + 环形光（小视野时）'],
      coaxial: ['环形光（非镜面印刷件）', '低角度条形光（刻字/激光打标）'],
      ring_high: ['穹顶光（高反光件）', '条形光对打（大视野）'],
      ring: ['条形光（大视野或长条工件）', '穹顶光（反光/曲面件）']
    };
    L.alternates = ALT[L.type] || [];

    return L;
  }

  /* ============================ 主流程 ============================ */

  function solve(raw) {
    var inp = normalizeInput(raw);
    if (!inp.ok) return { ok: false, error: inp.error };

    var task = TASKS[inp.task];
    var k = task.k;
    var pxAccReq = inp.precision / k;
    var needW = Math.ceil(inp.fovW / pxAccReq - 1e-9);
    var needH = Math.ceil(inp.fovH / pxAccReq - 1e-9);

    var warnings = [];
    var feasible = true;

    var pick = selectOptics(inp, needW, needH, !!(inp.needColor || inp.task === 'color'));

    if (!pick) {
      // 型号库里连一台相机都配不出镜头：退化为最大靶面机型，明确告知不可行
      var biggest = CAT.CAMERAS.slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; })[0];
      var anyLens = CAT.LENSES.slice().sort(function (a, b) { return b.focal - a.focal; })[0];
      pick = {
        cam: biggest, lens: anyLens, m: anyLens.focal / (inp.wd - anyLens.focal),
        fReq: anyLens.focal, fovW: biggest.sw / (anyLens.focal / (inp.wd - anyLens.focal)),
        fovH: biggest.sh / (anyLens.focal / (inp.wd - anyLens.focal)),
        pxAcc: 1, ok: false
      };
      pick.pxAcc = Math.max(pick.fovW / biggest.w, pick.fovH / biggest.h);
    }

    if (!pick.ok) {
      feasible = false;
      warnings.push({
        level: 'warn',
        text: '型号库内单相机方案无法满足：需要 ' + needW + ' × ' + needH + ' 像素（' +
          fmt(inp.fovW / pxAccReq) + ' mm/px）。建议线扫相机、多相机拼接，或把视野分段检测。'
      });
    }

    var cam = pick.cam;
    var lens = pick.lens;
    var m = pick.m;
    var pxAcc = pick.pxAcc;
    var fovW = pick.fovW;
    var fovH = pick.fovH;
    var pxSizeMM = cam.sh / cam.h;
    var isColor = cam.color === '彩色';
    var bitDepth = isColor ? 16 : 8;

    /* ---- 帧率 / 带宽 ---- */
    var fps;
    if (inp.speed > 0) fps = Math.max(1, Math.ceil((inp.speed / fovH) * 1.2));
    else fps = Math.min(15, cam.fps);            // 静态拍摄：按常用 15fps 估算，但不超出相机上限
    if (inp.cpm > 0) fps = Math.max(fps, Math.ceil(inp.cpm / 60));
    var bandwidth = (cam.w * cam.h * fps * bitDepth) / 8 / 1e6;
    var ifaceCap = IFACE_BW[cam.iface] || 350;

    /* ---- 曝光上限（运动模糊 ≤ 1 像素） ---- */
    var tMaxMs = inp.speed > 0 ? (pxAcc / inp.speed) * 1000 : Infinity;

    /* ---- 光圈 / 景深 ---- */
    var c = 2 * pxSizeMM;
    // 实用最小光圈取 F4：比全开更利于像质，再按景深需求逐级收小
    var apFloor = Math.max(4, lens.fmin || 2.8);
    var ladder = APERTURES.filter(function (f) {
      return f >= apFloor - 1e-9 && f <= (lens.fmax || 22) + 1e-9;
    });
    if (!ladder.length) ladder = [(lens.fmin || 2.8)];
    var ap = ladder[0];
    var dof = 0;
    var dofOK = false;
    for (var q = 0; q < ladder.length; q++) {
      var F = ladder[q];
      var d = (2 * F * c * (1 + m)) / (m * m);
      ap = F;
      dof = d;
      if (d >= inp.heightDiff) { dofOK = true; break; }
    }
    var airyUm = 2.44 * LAMBDA_UM * ap;
    var blurPx = airyUm / (pxSizeMM * 1000);

    /* ---- 风险提示 ---- */
    var margin = (pxAccReq - pxAcc) / pxAccReq;
    var fErr = Math.abs(lens.focal - pick.fReq) / pick.fReq;
    var fovOver = Math.max((fovW - inp.fovW) / inp.fovW, (fovH - inp.fovH) / inp.fovH);
    var diag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);

    if (feasible && margin < 0.15) {
      warnings.push({ level: 'warn', text: '精度余量仅 ' + Math.round(margin * 100) + '%（像素精度 ' + fmt(pxAcc) + ' vs 需求 ' + fmt(pxAccReq) + '），建议提高一档分辨率留余量。' });
    }
    if (!dofOK) {
      warnings.push({ level: 'warn', text: '景深 ' + fmt(dof) + ' mm 小于工件高度变化 ' + fmt(inp.heightDiff) + ' mm，建议用远心镜头、缩小光圈或减小高度差。' });
    }
    if (blurPx > 2.5) {
      warnings.push({ level: 'warn', text: '衍射极限约 ' + fmt(blurPx) + ' 像素（F' + ap + '），已影响分辨率；建议开大光圈或改用更大像元相机。' });
    }
    if (tMaxMs < 1) {
      warnings.push({ level: 'warn', text: '曝光上限 ' + fmt(tMaxMs) + ' ms，常亮光源亮度不够；必须用频闪光源 + 触发同步。' });
    }
    if (fps > cam.fps) {
      warnings.push({ level: 'warn', text: '需要 ' + fps + ' fps，所选相机最高 ' + cam.fps + ' fps，需降速或换更高帧率型号。' });
    }
    if (bandwidth > ifaceCap) {
      warnings.push({ level: 'warn', text: '数据带宽 ' + fmt(bandwidth) + ' MB/s 超过 ' + cam.iface + ' 接口能力（约 ' + ifaceCap + ' MB/s），需降帧率或换更高带宽接口。' });
    }
    if (fErr > 0.15) {
      warnings.push({ level: 'info', text: '所需焦距 ' + fmt(pick.fReq, 1) + ' mm，型号库最接近的是 ' + lens.focal + ' mm（差 ' + Math.round(fErr * 100) + '%），可通过微调工作距离补偿。' });
    }
    if (fovOver > 0.2) {
      warnings.push({ level: 'info', text: '实际视场比需求大 ' + Math.round(fovOver * 100) + '%，像素被"摊薄"；缩短工作距离或换更长焦距可提升有效精度。' });
    }
    if (lens.focal <= 8) {
      warnings.push({ level: 'info', text: '短焦镜头畸变较大，测量类任务建议改用低畸变镜头或远心镜头。' });
    }
    if (inp.speed > 0 && cam.shutter !== 'Global') {
      warnings.push({ level: 'warn', text: '运动拍摄需确认相机为全局快门（Global Shutter）；卷帘快门在高速下会产生果冻畸变。' });
    }
    if (inp.wd < lens.focal * 3) {
      warnings.push({ level: 'warn', text: '工作距离 ' + fmt(inp.wd) + ' mm 不到焦距的 3 倍，安装空间紧张且畸变偏大，建议加长 WD 或换短焦镜头。' });
    }
    if (lens.ic != null && lens.ic < diag + 0.2) {
      warnings.push({ level: 'info', text: '镜头像面 ' + lens.ic + ' mm 与靶面对角 ' + fmt(diag) + ' mm 基本持平，边缘可能有暗角，建议留 5% 余量。' });
    }

    /* ---- 光源 ---- */
    var light = buildLight(inp, { tMaxMs: tMaxMs, speed: inp.speed, mount: cam.mount });

    /* ---- 匹配度 ---- */
    var score = 100;
    if (!feasible) score -= 45;
    if (margin < 0.15) score -= 12;
    if (!dofOK) score -= 15;
    if (blurPx > 2.5) score -= 8;
    if (tMaxMs < 1) score -= 6;
    if (fErr > 0.15) score -= 8;
    if (fovOver > 0.2) score -= 6;
    if (fps > cam.fps) score -= 10;
    if (bandwidth > ifaceCap) score -= 10;
    score = Math.max(5, Math.min(100, Math.round(score)));

    /* ---- 验算过程 ---- */
    var calc = [
      { step: '① 所需像素精度', formula: 'δ / k = ' + fmt(inp.precision) + ' / ' + k, value: fmt(pxAccReq, 4), unit: 'mm/px' },
      { step: '② 所需分辨率', formula: '视野 / 像素精度', value: needW + ' × ' + needH, unit: 'px' },
      { step: '③ 所需放大倍率', formula: 'min(靶面宽/视野宽, 靶面高/视野高)', value: fmt(Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH), 4), unit: '×' },
      { step: '④ 所需焦距', formula: 'WD·m/(1+m)', value: fmt(pick.fReq, 2), unit: 'mm' },
      { step: '⑤ 实际放大倍率', formula: 'f / (WD − f) = ' + lens.focal + ' / (' + fmt(inp.wd) + ' − ' + lens.focal + ')', value: fmt(m, 4), unit: '×' },
      { step: '⑥ 实际视场', formula: '靶面 / 放大倍率', value: fmt(fovW) + ' × ' + fmt(fovH), unit: 'mm' },
      { step: '⑦ 有效像素精度', formula: '实际视场 / 像素数', value: fmt(pxAcc, 4), unit: 'mm/px' },
      { step: '⑧ 可分辨最小特征', formula: '像素精度 × k', value: fmt(pxAcc * k), unit: 'mm' },
      { step: '⑨ 景深', formula: '2·F·c·(1+m)/m²  (F' + ap + ', c=' + fmt(c * 1000, 1) + 'µm)', value: fmt(dof), unit: 'mm' },
      { step: '⑩ 曝光上限', formula: '像素精度 / 速度 (运动模糊 ≤ 1px)', value: isFinite(tMaxMs) ? fmt(tMaxMs, 3) : '无（静态）', unit: 'ms' },
      { step: '⑪ 帧率需求', formula: inp.speed > 0 ? '速度 / 视野高 × 1.2' : '静态拍摄默认', value: String(fps), unit: 'fps' },
      { step: '⑫ 数据带宽', formula: cam.w + '×' + cam.h + '×' + fps + 'fps×' + bitDepth + 'bit', value: fmt(bandwidth), unit: 'MB/s' }
    ];

    var summary = '相机 ' + cam.model + '（' + cam.w + '×' + cam.h + '，' + cam.iface + '）｜ 镜头 ' +
      lens.model + ' ' + lens.focal + 'mm F' + ap + ' ｜ 光源 ' + light.series + ' ' +
      light.seriesName + ' ' + light.colorName + ' ' + light.wavelength +
      ' ｜ 有效像素精度 ' + fmt(pxAcc, 4) + ' mm/px ｜ 景深 ' + fmt(dof) + ' mm';

    return {
      ok: true,
      feasible: feasible,
      score: score,
      margin: margin,
      input: inp,
      task: { key: inp.task, label: task.label, k: k },
      pxAccReq: pxAccReq,
      pxNeed: { w: needW, h: needH },
      camera: {
        model: cam.model,
        series: cam.series,
        w: cam.w,
        h: cam.h,
        sw: cam.sw,
        sh: cam.sh,
        pxUm: cam.pxUm,
        pixelSizeUm: round(pxSizeMM * 1000, 2),
        size: cam.size,
        mount: cam.mount,
        interface: cam.iface,
        fps: fps,
        maxFps: cam.fps,
        bandwidthMBps: round(bandwidth, 2),
        color: cam.color,
        shutter: cam.shutter === 'Global' ? '全局快门' : '卷帘快门',
        bitDepth: bitDepth,
        pxAcc: pxAcc,
        capability: pxAcc * k
      },
      lens: {
        model: lens.model,
        series: lens.series,
        f: lens.focal,
        fReq: pick.fReq,
        m: m,
        fovW: fovW,
        fovH: fovH,
        ic: lens.ic,
        mp: lens.mp,
        fmin: lens.fmin,
        fmax: lens.fmax,
        dist: lens.dist,
        minDist: lens.minDist,
        aperture: ap,
        dof: dof,
        mount: lens.mount === 'C' ? 'C' : lens.mount,
        blurPx: blurPx
      },
      exposure: { tMaxMs: tMaxMs },
      light: light,
      calc: calc,
      warnings: warnings,
      summary: summary
    };
  }

  return {
    solve: solve,
    TASKS: TASKS,
    MATERIALS: MATERIALS,
    COLOR: COLOR,
    LIGHT_SERIES: LIGHT_SERIES,
    COLOR_SUFFIX: COLOR_SUFFIX,
    CATALOG_META: CAT ? CAT.META : null,
    _internal: { tryCamera: tryCamera, selectOptics: selectOptics }
  };
});
