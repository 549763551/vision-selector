/**
 * 机器视觉智能选型引擎
 * ---------------------------------------------------------------
 * 纯计算模块，无 DOM 依赖：
 *   - 浏览器：<script src="engine.js"></script> → window.VisionEngine
 *   - Node  ：const VisionEngine = require('./engine.js')
 *
 * 输入（单位统一 mm / fps / 件每分钟）：
 *   { fovW, fovH,         视野宽高
 *     precision,          需要分辨的最小特征 / 公差
 *     task,               检测任务类型（决定"每个特征占几个像素"）
 *     wd,                 工作距离（镜头到工件）
 *     material,           被测物材质
 *     colorTarget,        目标主色（选单色光）
 *     needColor,          是否需要彩色相机
 *     heightDiff,         工件沿光轴的高度变化（决定景深）
 *     speed,              工件/相机相对运动速度（0 = 静态拍摄）
 *     cpm }               生产节拍（件/分钟，可选）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisionEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================ 数据表 ============================ */

  // k = 每个最小特征需要占用的像素数。测量要亚像素拟合所以最严；纯有无判断可以放宽。
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

  // 常用工业面阵相机：分辨率 × 靶面，按像素数升序
  var SENSORS = [
    { model: '0.4MP 1/3"',   w: 752,  h: 480,  sw: 4.80,  sh: 3.60 },
    { model: '0.5MP 1/2.5"', w: 800,  h: 600,  sw: 5.76,  sh: 4.32 },
    { model: '1.3MP 1/3"',   w: 1280, h: 960,  sw: 4.80,  sh: 3.60 },
    { model: '1.3MP 1/2"',   w: 1280, h: 1024, sw: 6.40,  sh: 4.80 },
    { model: '2MP 1/2.8"',   w: 1920, h: 1080, sw: 5.57,  sh: 3.13 },
    { model: '2MP 1/1.8"',   w: 1624, h: 1234, sw: 7.20,  sh: 5.40 },
    { model: '3MP 1/1.8"',   w: 2048, h: 1536, sw: 7.20,  sh: 5.40 },
    { model: '5MP 2/3"',     w: 2448, h: 2048, sw: 8.40,  sh: 7.10 },
    { model: '5MP 1/2.5"',   w: 2592, h: 1944, sw: 5.70,  sh: 4.28 },
    { model: '6MP 1/1.8"',   w: 3072, h: 2048, sw: 7.20,  sh: 5.40 },
    { model: '8MP 1/1.8"',   w: 3840, h: 2160, sw: 7.68,  sh: 4.32 },
    { model: '12MP 1.1"',    w: 4096, h: 3000, sw: 14.13, sh: 10.35 },
    { model: '20MP 1"',      w: 5472, h: 3648, sw: 13.13, sh: 8.76 }
  ];

  var FOCALS = [4, 6, 8, 12, 16, 20, 25, 35, 50, 75, 100];
  var APERTURES = [4, 5.6, 8, 11, 16];
  var LAMBDA_UM = 0.55;

  var COLOR = {
    white:  { name: '白光',        wl: '5500K', anti: '—',           why: '白光可还原真实颜色，需彩色还原时必选' },
    red:    { name: '红光',        wl: '625nm', anti: '青光 490nm',  why: '红色特征在红光下反射率最高，且单色光可消除镜头色差' },
    yellow: { name: '黄光（琥珀）', wl: '590nm', anti: '蓝光 450nm',  why: '黄 / 铜 / 金等暖色特征在黄光下反射率最高，目标明显变亮' },
    green:  { name: '绿光',        wl: '525nm', anti: '红光 625nm',  why: '绿色特征在绿光下反射率最高，绿光传感器量子效率高、成像锐利' },
    blue:   { name: '蓝光',        wl: '450nm', anti: '黄光 590nm',  why: '蓝色特征在蓝光下反射率最高，短波长对细节分辨更有利' },
    ir:     { name: '红外光',      wl: '850nm', anti: '白光',        why: '深色 / 黑色工件对可见光吸收强，红外波段反射更高，可拉开与背景的灰度差' },
    cyan:   { name: '青光',        wl: '490nm', anti: '红光 625nm',  why: '青色特征在青光下反射率最高' }
  };

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

  function mountOf(sw) {
    if (sw <= 11.0) return 'C';
    if (sw <= 17.0) return 'C / F';
    return 'F / M42';
  }

  function interfaceOf(mbps) {
    if (mbps <= 110) return '千兆网 GigE';
    if (mbps <= 350) return 'USB3.0';
    if (mbps <= 1000) return '万兆网 10GigE';
    return 'Camera Link / CoaXPress';
  }

  /** 不大于 fReq 的最大标准焦距（保证视场不会小于要求） */
  function pickFocal(fReq) {
    var best = null;
    for (var i = 0; i < FOCALS.length; i++) {
      if (FOCALS[i] <= fReq + 1e-9) best = FOCALS[i];
    }
    return best;
  }

  function nearestFocal(f) {
    var best = FOCALS[0];
    var d = Math.abs(f - best);
    for (var i = 1; i < FOCALS.length; i++) {
      var dd = Math.abs(f - FOCALS[i]);
      if (dd < d) { d = dd; best = FOCALS[i]; }
    }
    return best;
  }

  /* ============================ 输入处理 ============================ */

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

  /* ============================ 相机 + 镜头 ============================ */

  /**
   * 给定相机靶面，反算满足视场的焦距，再按标准焦距取整，
   * 返回实际放大倍率 / 视场 / 像素精度。
   */
  function trySensor(s, inp) {
    var m0 = s.sh / inp.fovH;                 // 成像满视场所需放大倍率
    var fReq = (inp.wd * m0) / (1 + m0);      // f = WD·m/(1+m)
    var f = pickFocal(fReq);
    if (f == null) return null;               // 焦距需求小于 4mm，无标准镜头
    if (inp.wd <= f * 1.02) return null;      // 工作距离必须大于焦距

    var m = f / (inp.wd - f);                 // 实际放大倍率
    var fovH = s.sh / m;
    var fovW = s.sw / m;
    var pxAcc = Math.max(fovW / s.w, fovH / s.h);

    return { s: s, fReq: fReq, f: f, m: m, fovW: fovW, fovH: fovH, pxAcc: pxAcc };
  }

  /** 两个方向都覆盖所需视场，且像素精度达标 */
  function isGood(pick, inp, pxAccReq) {
    if (pick.fovH < inp.fovH * (1 - 1e-9)) return false;
    if (pick.fovW < inp.fovW * (1 - 1e-9)) return false;
    return pick.pxAcc <= pxAccReq * (1 + 1e-9);
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
      alternates: []
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
    if (inp.needColor) {
      cm = COLOR.white;
      L.reasons.push('需要颜色区分或还原 → 配彩色相机，用白光保证色彩真实');
    } else if (inp.colorTarget && inp.colorTarget !== 'none' && COLOR[inp.colorTarget]) {
      cm = COLOR[inp.colorTarget];
      L.reasons.push(cm.why);
      L.reasons.push('同色光反射率最高 → 目标变亮、背景变暗；若要反过来压制该颜色，改用互补光 ' + cm.anti);
    } else if (L.type === 'backlight') {
      cm = COLOR.red;
      L.reasons.push('单色背光亮度高、可压暗多色背景，黑白相机下轮廓更干净');
    } else if (mat === 'metal_shiny') {
      cm = COLOR.blue;
      L.reasons.push('短波长在金属表面散射更强、镜面反射成分更弱，蓝光能提高金属细节对比度');
    } else if (mat === 'dark' || mat === 'textile') {
      cm = COLOR.red;
      L.reasons.push('长波长对深色 / 吸光材质更有利，红光下深色件与背景更易分开');
    } else {
      cm = COLOR.red;
      L.reasons.push('单色红光通用性好、可消除镜头色差、成本最低');
    }
    L.color = inp.needColor ? 'white' : (COLOR[inp.colorTarget] ? inp.colorTarget : (cm === COLOR.blue ? 'blue' : 'red'));
    L.colorName = cm.name;
    L.wavelength = cm.wl;

    /* ---- 3. 尺寸建议 ---- */
    if (!L.size) {
      var longSide = Math.max(inp.fovW, inp.fovH);
      if (L.type === 'bar_low') {
        L.size = '条形光长度 ≥ 视野宽 ×1.2 ≈ ' + Math.ceil(inp.fovW * 1.2) + ' mm，2～4 条环绕布置';
      } else if (L.type === 'dome') {
        L.size = '圆顶内径 ≥ 视野长边 ×1.5 ≈ ' + Math.ceil(longSide * 1.5) + ' mm';
      } else if (L.type === 'coaxial') {
        L.size = '同轴模块通光口径 ≥ 镜头前端外径，按镜头接口（' + ctx.mount + '）选型';
      } else {
        L.size = '环形内径 ≥ 镜头前端外径，外径 ≈ 视野长边 ×1.2 ≈ ' + Math.ceil(longSide * 1.2) + ' mm';
      }
    }

    /* ---- 4. 控制器 ---- */
    var needStrobe = (isFinite(ctx.tMaxMs) && ctx.tMaxMs < 1) || ctx.speed > 300;
    L.controller = needStrobe
      ? '频闪控制器（与相机触发同步，脉冲宽度 < 曝光时间）'
      : '数字调光控制器（常亮，亮度可调）';

    /* ---- 5. 备选 ---- */
    var ALT = {
      backlight: ['同轴光（工件不能放背光时）', '带偏振的背光（透明/反光件）'],
      bar_low: ['低角度环形光（空间受限时）', '圆顶光 + 低角度补光（曲面件）'],
      dome: ['同轴光（平面镜面件）', '漫射板 + 环形光（小视野时）'],
      coaxial: ['环形光（非镜面印刷件）', '低角度条形光（刻字/激光打标）'],
      ring_high: ['圆顶光（高反光件）', '条形光对打（大视野）'],
      ring: ['条形光（大视野或长条工件）', '圆顶光（反光/曲面件）']
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

    /* ---- 相机 + 镜头 ---- */
    var pick = null;
    for (var i = 0; i < SENSORS.length; i++) {
      var s = SENSORS[i];
      if (s.w < needW || s.h < needH) continue;
      var cand = trySensor(s, inp);
      if (cand && isGood(cand, inp, pxAccReq)) { pick = cand; break; }
    }

    if (!pick) {
      feasible = false;
      var big = SENSORS[SENSORS.length - 1];
      var m0 = big.sh / inp.fovH;
      var fReq0 = (inp.wd * m0) / (1 + m0);
      var f0 = Math.max(4, Math.min(100, nearestFocal(fReq0)));
      f0 = Math.min(f0, inp.wd * 0.8);
      var mm = f0 / (inp.wd - f0);
      pick = {
        s: big,
        fReq: fReq0,
        f: f0,
        m: mm,
        fovW: big.sw / mm,
        fovH: big.sh / mm
      };
      pick.pxAcc = Math.max(pick.fovW / big.w, pick.fovH / big.h);
      warnings.push({
        level: 'warn',
        text: '单相机方案无法满足精度要求：需要 ' + needW + ' × ' + needH + ' 像素。建议改用线扫相机、多相机拼接，或把大视野分段检测。'
      });
    }

    var s2 = pick.s;
    var m = pick.m;
    var pxAcc = pick.pxAcc;
    var fovW = pick.fovW;
    var fovH = pick.fovH;
    var pxSizeMM = s2.sh / s2.h;
    var isColor = !!(inp.needColor || inp.task === 'color');
    var bitDepth = isColor ? 16 : 8;
    var mount = mountOf(s2.sw);

    /* ---- 帧率 / 带宽 ---- */
    var fps;
    if (inp.speed > 0) fps = Math.max(1, Math.ceil((inp.speed / fovH) * 1.2));
    else fps = 15;
    if (inp.cpm > 0) fps = Math.max(fps, Math.ceil(inp.cpm / 60));
    var bandwidth = (s2.w * s2.h * fps * bitDepth) / 8 / 1e6;

    /* ---- 曝光上限（运动模糊 ≤ 1 像素） ---- */
    var tMaxMs = inp.speed > 0 ? (pxAcc / inp.speed) * 1000 : Infinity;

    /* ---- 光圈 / 景深 ---- */
    var c = 2 * pxSizeMM;
    var ap = APERTURES[0];
    var dof = 0;
    var dofOK = false;
    for (var j = 0; j < APERTURES.length; j++) {
      var F = APERTURES[j];
      var d = (2 * F * c * (1 + m)) / (m * m);
      ap = F;
      dof = d;
      if (d >= inp.heightDiff) { dofOK = true; break; }
    }
    var airyUm = 2.44 * LAMBDA_UM * ap;
    var blurPx = airyUm / (pxSizeMM * 1000);

    /* ---- 风险提示 ---- */
    var margin = (pxAccReq - pxAcc) / pxAccReq;
    var fErr = Math.abs(pick.f - pick.fReq) / pick.fReq;
    var fovOver = Math.max((fovW - inp.fovW) / inp.fovW, (fovH - inp.fovH) / inp.fovH);

    if (!feasible && pick.pxAcc > pxAccReq) {
      warnings.push({ level: 'warn', text: '最大靶面相机在此视野下像素精度为 ' + fmt(pxAcc) + ' mm/px，仍达不到 ' + fmt(pxAccReq) + ' mm/px 的要求。' });
    }
    if (feasible && margin < 0.15) {
      warnings.push({ level: 'warn', text: '精度余量仅 ' + Math.round(margin * 100) + '%（像素精度 ' + fmt(pxAcc) + ' vs 需求 ' + fmt(pxAccReq) + '），建议提高一档分辨率留余量。' });
    }
    if (!dofOK) {
      warnings.push({ level: 'warn', text: '景深 ' + fmt(dof) + ' mm 小于工件高度变化 ' + fmt(inp.heightDiff) + ' mm，全开光圈也可能失焦；建议用远心镜头、缩小光圈或减小高度差。' });
    }
    if (blurPx > 2.5) {
      warnings.push({ level: 'warn', text: '衍射极限约 ' + fmt(blurPx) + ' 像素（F' + ap + '），已影响分辨率；建议开大光圈或改用更大像元相机。' });
    }
    if (tMaxMs < 1) {
      warnings.push({ level: 'warn', text: '曝光上限 ' + fmt(tMaxMs) + ' ms，普通常亮光源亮度不够；必须用频闪光源 + 触发同步。' });
    }
    if (fErr > 0.15) {
      warnings.push({ level: 'info', text: '计算焦距 ' + fmt(pick.fReq) + ' mm 与标准焦距 ' + pick.f + ' mm 相差 ' + Math.round(fErr * 100) + '%，可通过微调工作距离补偿（目标 WD ≈ ' + fmt((pick.f * (1 / m)) + pick.f) + ' mm）。' });
    }
    if (fovOver > 0.2) {
      warnings.push({ level: 'info', text: '实际视场比需求大 ' + Math.round(fovOver * 100) + '%，像素被"摊薄"；缩短工作距离或换更长焦距可提升有效精度。' });
    }
    if (pick.f <= 8) {
      warnings.push({ level: 'info', text: '短焦镜头畸变较大，测量类任务建议改用低畸变镜头或远心镜头。' });
    }
    if (pick.f > 75) {
      warnings.push({ level: 'info', text: '长焦 + 长工作距离的组合，建议评估远心镜头，避免透视误差影响测量。' });
    }
    if (inp.wd < pick.f * 3) {
      warnings.push({ level: 'warn', text: '工作距离 ' + fmt(inp.wd) + ' mm 不到焦距的 3 倍，安装空间紧张且畸变偏大，建议加长 WD 或换短焦镜头。' });
    }

    /* ---- 光源 ---- */
    var light = buildLight(inp, { tMaxMs: tMaxMs, speed: inp.speed, mount: mount });

    /* ---- 匹配度 ---- */
    var score = 100;
    if (!feasible) score -= 45;
    if (margin < 0.15) score -= 12;
    if (!dofOK) score -= 15;
    if (blurPx > 2.5) score -= 8;
    if (tMaxMs < 1) score -= 6;
    if (fErr > 0.15) score -= 8;
    if (fovOver > 0.2) score -= 6;
    score = Math.max(5, Math.min(100, Math.round(score)));

    /* ---- 验算过程 ---- */
    var calc = [
      { step: '① 所需像素精度', formula: 'δ / k = ' + fmt(inp.precision) + ' / ' + k, value: fmt(pxAccReq, 4), unit: 'mm/px' },
      { step: '② 所需分辨率', formula: '视野 / 像素精度', value: needW + ' × ' + needH, unit: 'px' },
      { step: '③ 实际放大倍率', formula: 'f / (WD − f) = ' + pick.f + ' / (' + fmt(inp.wd) + ' − ' + pick.f + ')', value: fmt(m, 4), unit: '×' },
      { step: '④ 实际视场', formula: '靶面 / 放大倍率', value: fmt(fovW) + ' × ' + fmt(fovH), unit: 'mm' },
      { step: '⑤ 有效像素精度', formula: '实际视场 / 像素数', value: fmt(pxAcc, 4), unit: 'mm/px' },
      { step: '⑥ 可分辨最小特征', formula: '像素精度 × k', value: fmt(pxAcc * k), unit: 'mm' },
      { step: '⑦ 景深', formula: '2·F·c·(1+m)/m²  (F' + ap + ', c=' + fmt(c * 1000, 1) + 'µm)', value: fmt(dof), unit: 'mm' },
      { step: '⑧ 曝光上限', formula: '像素精度 / 速度 (运动模糊 ≤ 1px)', value: isFinite(tMaxMs) ? fmt(tMaxMs, 3) : '无（静态）', unit: 'ms' },
      { step: '⑨ 帧率需求', formula: inp.speed > 0 ? '速度 / 视野高 × 1.2' : '静态拍摄默认', value: String(fps), unit: 'fps' },
      { step: '⑩ 数据带宽', formula: s2.w + '×' + s2.h + '×' + fps + 'fps×' + bitDepth + 'bit', value: fmt(bandwidth), unit: 'MB/s' }
    ];

    /* ---- 一句话方案 ---- */
    var summary = '相机 ' + s2.model + ' ' + s2.w + '×' + s2.h +
      '（' + mount + '口）｜ 镜头 ' + pick.f + 'mm F' + ap +
      ' ｜ 光源 ' + light.label + ' ' + light.colorName + ' ' + light.wavelength +
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
        model: s2.model,
        w: s2.w,
        h: s2.h,
        sw: s2.sw,
        sh: s2.sh,
        pixelSizeUm: round(pxSizeMM * 1000, 2),
        mount: mount,
        interface: interfaceOf(bandwidth),
        fps: fps,
        bandwidthMBps: round(bandwidth, 2),
        color: isColor ? '彩色' : '黑白',
        bitDepth: bitDepth,
        pxAcc: pxAcc,
        capability: pxAcc * k
      },
      lens: {
        f: pick.f,
        fReq: pick.fReq,
        m: m,
        fovW: fovW,
        fovH: fovH,
        aperture: ap,
        dof: dof,
        mount: mount,
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
    SENSORS: SENSORS,
    COLOR: COLOR,
    FOCALS: FOCALS,
    _internal: { pickFocal: pickFocal, nearestFocal: nearestFocal, interfaceOf: interfaceOf, mountOf: mountOf }
  };
});
