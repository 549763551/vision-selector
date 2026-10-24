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
    root.VisionEngineFactory = factory; // 多品牌：传入合并后的目录即可重建引擎
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
    color:           { label: '颜色 / 材质区分', k: 2 },
    height:          { label: '高度 / 3D 轮廓测量', k: 4, hint: 'Z 向尺寸 / 平面度 / 段差，走 3D 轮廓传感器建议' }
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
      cpm: num(i.cpm, 0),
      space: num(i.space, 0),
      manualCamera: i.manualCamera || null,
      manualLens: i.manualLens || null,
      manualLight: i.manualLight || null,
      lineScanFirst: !!i.lineScanFirst
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
   * 相机卡口与镜头卡口的匹配等级：
   *   1 = 直接安装；2 = 经转接环安装（大口径相机配 C 口镜头）；0 = 不兼容。
   * 大口径机身（F/M42/M58/M72）同族镜头直接装；C 口镜头可经转接环安装
   * （工业现场常见，但法兰距与像面覆盖需另行确认，选型时按直接卡口优先）。
   */
  var BIG_MOUNT_FAMILY = { 'F': 'F', 'M42': 'F', 'M42/F': 'F', 'M58': 'M58', 'M72': 'M72' };
  function mountMatch(camMount, lensMount) {
    if (camMount === 'C') return lensMount === 'C' ? 1 : 0;
    if (camMount === 'M12') return lensMount === 'M12' ? 1 : 0;
    if (!camMount || camMount === 'Bare') return 0;          // 裸板无卡口
    var fam = BIG_MOUNT_FAMILY[camMount];
    if (!fam) return 0;                                       // 未知卡口保守判不兼容
    if (BIG_MOUNT_FAMILY[lensMount] === fam) return 1;        // 同族大口径镜头直接安装
    if (lensMount === 'C') return 2;                          // C 口镜头经转接环
    return 0;
  }

  /** 相机卡口与镜头卡口是否兼容（含转接环方案） */
  function mountCompatible(camMount, lensMount) {
    return mountMatch(camMount, lensMount) > 0;
  }

  /**
   * 单台相机 + 镜头可行性评估。
   * m0 取宽高两个方向所需倍率的较小值，保证两个方向都能覆盖整个视野。
   */
  function tryCamera(cam, inp) {
    if (cam.mount === 'Bare') return null;                      // 裸板式无镜头接口
    var m0 = Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH); // 覆盖视野所需最大倍率
    var fReq = (inp.wd * m0) / (1 + m0);                     // 对应焦距 f = WD·m/(1+m)
    var camMp = (cam.w * cam.h) / 1e6;
    var diag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);

    var pool = [];
    for (var i = 0; i < CAT.LENSES.length; i++) {
      var l = CAT.LENSES[i];
      if (!mountCompatible(cam.mount, l.mount)) continue;
      if (l.ic != null && l.ic < diag * 0.97) continue;          // 像面必须覆盖靶面
      if (l.mp != null && l.mp < camMp * 0.85) continue;         // 镜头解析力不能低于相机
      if (!(l.focal < inp.wd * 0.95)) continue;                  // 工作距离必须大于焦距
      if (l.minDist != null && l.minDist * 1000 > inp.wd) continue; // 工作距离必须 ≥ 最近摄距
      if (l.focal > fReq + 1e-9) continue;                       // 焦距过大则视场不足
      pool.push(l);
    }
    if (!pool.length) return null;

    // 直接卡口优先：大口径相机只要有能覆盖视场的原厂卡口镜头，就不为了焦距更接近而改用转接环；
    // 仅当直配镜头不满足像素精度、而转接镜头可以时才降级到转接（C 口镜头像面小，多数情况本就配不上）。
    function bestOf(list) {
      return list.slice().sort(function (a, b) {
        if (b.focal !== a.focal) return b.focal - a.focal;
        return (a.mp == null ? 25 : a.mp) - (b.mp == null ? 25 : b.mp);
      })[0];
    }
    function build(lens) {
      var mm = lens.focal / (inp.wd - lens.focal);
      var fw = cam.sw / mm, fh = cam.sh / mm;
      var pa = Math.max(fw / cam.w, fh / cam.h);
      return {
        cam: cam, lens: lens, m: mm, fReq: fReq, fovW: fw, fovH: fh, pxAcc: pa,
        adapter: mountMatch(cam.mount, lens.mount) === 2,
        // 覆盖性由 m0 的构造保证，这里只需校验像素精度
        ok: pa <= (inp.precision / (TASKS[inp.task] || TASKS.defect).k) * (1 + 1e-9)
      };
    }
    var direct = pool.filter(function (l) { return mountMatch(cam.mount, l.mount) === 1; });
    var viaRing = pool.filter(function (l) { return mountMatch(cam.mount, l.mount) === 2; });
    var dPick = direct.length ? build(bestOf(direct)) : null;
    var aPick = viaRing.length ? build(bestOf(viaRing)) : null;
    if (dPick && dPick.ok) return dPick;                 // 直配可行 → 优先直配
    if (aPick && aPick.ok) return aPick;                 // 直配精度不够但转接可行 → 用转接
    if (dPick && aPick) return dPick.pxAcc <= aPick.pxAcc ? dPick : aPick; // 都不达标取精度好的
    return dPick || aPick;
  }

  /**
   * 同一台相机的「备选镜头」：仍满足卡口 / 像面 / 解析力 / 工作距离约束，
   * 且像素精度达标，只是焦距档位或品牌不同——换的是镜头而不是相机。
   */
  function lensAlternates(cam, inp, chosenLens, limit) {
    if (!cam || cam.mount === 'Bare') return [];
    var pxAccReq = inp.precision / (TASKS[inp.task] || TASKS.defect).k;
    var camMp = (cam.w * cam.h) / 1e6;
    var diag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);
    var m0 = Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH);
    var fReq = (inp.wd * m0) / (1 + m0);
    var out = [];
    for (var i = 0; i < (CAT.LENSES || []).length; i++) {
      var l = CAT.LENSES[i];
      if (chosenLens && l.model === chosenLens.model && (l.brand || '') === (chosenLens.brand || '')) continue;
      var mm = mountMatch(cam.mount, l.mount);
      if (!mm) continue;
      if (l.ic != null && l.ic < diag * 0.97) continue;
      if (l.mp != null && l.mp < camMp * 0.85) continue;
      if (!(l.focal < inp.wd * 0.95)) continue;
      if (l.minDist != null && l.minDist * 1000 > inp.wd) continue;
      if (l.focal > fReq + 1e-9) continue;
      var lm = l.focal / (inp.wd - l.focal);
      var pa = Math.max((cam.sw / lm) / cam.w, (cam.sh / lm) / cam.h);
      if (pa > pxAccReq * (1 + 1e-9)) continue;        // 备选必须自身也达标，不能凑数
      out.push({ lens: l, pxAcc: pa, adapter: mm === 2 });
    }
    out.sort(function (a, b) {
      if (a.adapter !== b.adapter) return a.adapter ? 1 : -1;        // 直配优先
      if (b.lens.focal !== a.lens.focal) return b.lens.focal - a.lens.focal; // 焦距越长精度越好
      return (a.lens.mp == null ? 25 : a.lens.mp) - (b.lens.mp == null ? 25 : b.lens.mp);
    });
    var seen = {}, res = [];
    for (var k = 0; k < out.length && res.length < (limit || 3); k++) {
      var key = (out[k].lens.brand || '') + '::' + out[k].lens.model;
      if (seen[key]) continue;
      seen[key] = 1;
      res.push(out[k]);
    }
    return res;
  }

  /** 手动指定相机时：优先正常匹配镜头；匹配不到就取焦距最接近的可用镜头（标记不达标） */
  function forceCamera(cam, inp) {
    var t = tryCamera(cam, inp);
    if (t) return t;
    if (cam.mount === 'Bare') return null;

    var m0 = Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH);
    var fReq = (inp.wd * m0) / (1 + m0);
    var pool = [];
    for (var i = 0; i < CAT.LENSES.length; i++) {
      var l = CAT.LENSES[i];
      if (!mountCompatible(cam.mount, l.mount)) continue;
      if (!(l.focal < inp.wd * 0.95)) continue;
      pool.push(l);
    }
    if (!pool.length) return null;
    // 直配优先：先看同族大口径镜头，没有再考虑 C 口镜头转接
    var direct = pool.filter(function (l) { return mountMatch(cam.mount, l.mount) === 1; });
    var use = direct.length ? direct : pool;
    use.sort(function (a, b) {
      var da = Math.abs(a.focal - fReq), db = Math.abs(b.focal - fReq);
      if (da !== db) return da - db;
      return (a.mp == null ? 25 : a.mp) - (b.mp == null ? 25 : b.mp);
    });
    var lens = use[0];
    var m = lens.focal / (inp.wd - lens.focal);
    var fovW = cam.sw / m;
    var fovH = cam.sh / m;
    return {
      cam: cam,
      lens: lens,
      m: m,
      fReq: fReq,
      fovW: fovW,
      fovH: fovH,
      pxAcc: Math.max(fovW / cam.w, fovH / cam.h),
      adapter: mountMatch(cam.mount, lens.mount) === 2,
      ok: false,
      forced: true
    };
  }

  /** 把选定的光源型号/功率/控制器写回光源对象 */
  function attachLightSku(light, obj) {
    light.sku = obj.model;
    light.skuBrand = obj.brand || null;
    light.skuNote = obj.note || '';
    light.skuSize = obj.size;
    light.skuColor = obj.color;
    light.skuType = obj.type || null;          // 手动指定时可能与推荐照明方式不同，面板按实际型号分族
    light.power = obj.power == null ? null : obj.power;
    light.skuAlts = obj.alts || [];
    light.count = light.type === 'bar_low' ? 2 : 1;
    light.totalPower = light.power ? +(light.power * light.count).toFixed(1) : null;

    var ctrls = ((CAT && CAT.CONTROLLERS) || []).filter(function (c) {
      return (c.channels || 1) >= light.count;
    });
    // 同品牌优先：控制器须与光源的供电电压 / 接口匹配（如华睿 48V 线光源须配 48V 控制器，
    // 海康 24V 光源配海康 24V 控制器）；同品牌无可用规格时才跨品牌取通道数最少者。
    var sameBrand = light.skuBrand
      ? ctrls.filter(function (c) { return c.brand === light.skuBrand; })
      : [];
    var pool = sameBrand.length ? sameBrand : ctrls;
    pool.sort(function (a, b) { return (a.channels || 99) - (b.channels || 99); });
    if (pool.length) {
      light.controllerModel = pool[0].model;
      light.controllerChannels = pool[0].channels;
    }
  }

  /**
   * 候选方案的预估匹配分：扣分规则与 solve() 的「匹配度」逐条对齐
   * （精度余量 / 景深 / 衍射 / 曝光 / 焦距误差 / 视场过剩 / 帧率 / 带宽）。
   * 修改本函数请同步 solve() 中 score 计算，反之亦然。
   * 注：fps 用预估值（未含 cpm 修正），选优阶段近似，最终分数以 solve 为准。
   */
  function candScore(cand, inp, pxAccReq, estFps) {
    var cam = cand.cam, lens = cand.lens;
    var margin = (pxAccReq - cand.pxAcc) / pxAccReq;
    var fErr = Math.abs(lens.focal - cand.fReq) / cand.fReq;
    var fovOver = Math.max((cand.fovW - inp.fovW) / inp.fovW, (cand.fovH - inp.fovH) / inp.fovH);
    var bitDepth = cam.color === '彩色' ? 16 : 8;
    var fps = estFps > 0 ? estFps : Math.min(15, cam.fps);
    var bandwidth = (cam.w * cam.h * bitDepth * fps) / 8 / 1e6;
    var ifaceCap = IFACE_BW[cam.iface] || 350;
    var tMaxMs = inp.speed > 0 ? (cand.pxAcc / inp.speed) * 1000 : Infinity;
    // 大口径相机经转接环配 C 口镜头：可用但不如直接卡口（solve 的 score 计算需同步）
    var adapter = mountMatch(cam.mount, lens.mount) === 2;

    // 景深：与 solve 一致，从实用最小光圈起逐级收小至满足高度差
    var cc = 2 * (cam.sh / cam.h);
    var apFloor = Math.max(4, lens.fmin || 2.8);
    var ladder = APERTURES.filter(function (f) {
      return f >= apFloor - 1e-9 && f <= (lens.fmax || 22) + 1e-9;
    });
    if (!ladder.length) ladder = [lens.fmin || 2.8];
    var dofOK = false;
    for (var q = 0; q < ladder.length; q++) {
      if ((2 * ladder[q] * cc * (1 + cand.m)) / (cand.m * cand.m) >= inp.heightDiff) { dofOK = true; break; }
    }
    var blurPx = (2.44 * LAMBDA_UM * ladder[0]) / ((cam.sh / cam.h) * 1000);

    var s = 100;
    if (margin < 0.15) s -= 12;
    if (!dofOK) s -= 15;
    if (blurPx > 2.5) s -= 8;
    if (tMaxMs < 1) s -= 6;
    if (fErr > 0.15) s -= 8;
    if (fovOver > 0.2) s -= 6;
    if (fps > cam.fps) s -= 10;
    if (bandwidth > ifaceCap) s -= 10;
    // 曝光下限不足会拍不清（solve 以警告提示，选优阶段一并纳入）
    if (inp.speed > 0 && cam.expMinUs != null && tMaxMs * 1000 < cam.expMinUs) s -= 8;
    if (adapter) s -= 3;
    return s;
  }

  function selectOptics(inp, needW, needH, isColor) {
    var bitDepth = isColor ? 16 : 8;
    var pxAccReq = inp.precision / (TASKS[inp.task] || TASKS.defect).k;

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

    // 预排序：像素最少优先 → 带宽放得下优先 → 接口越便宜越好（同时作为同分时的 tie-break）
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

    // 遍历全部候选：收集所有达标方案按预估匹配分选最优，不再“第一个达标就返回”
    var best = null;   // 无一达标时的兜底（pxAcc 最小）
    var oks = [];
    for (var j = 0; j < pool.length; j++) {
      var cand = tryCamera(pool[j], inp);
      if (!cand) continue;
      if (cand.ok) { oks.push(cand); continue; }
      if (!best || cand.pxAcc < best.pxAcc) best = cand;
    }

    if (oks.length > 1) {
      oks.sort(function (a, b) {
        var sa = candScore(a, inp, pxAccReq, estFps);
        var sb = candScore(b, inp, pxAccReq, estFps);
        if (sb !== sa) return sb - sa;
        var pa = a.cam.w * a.cam.h, pb = b.cam.w * b.cam.h;
        if (pa !== pb) return pa - pb;
        var fa = bandwidthFits(a.cam), fb = bandwidthFits(b.cam);
        if (fa !== fb) return fa ? -1 : 1;
        return (IFACE_RANK[a.cam.iface] == null ? 9 : IFACE_RANK[a.cam.iface]) -
          (IFACE_RANK[b.cam.iface] == null ? 9 : IFACE_RANK[b.cam.iface]);
      });
    }
    var chosen = oks.length ? oks[0] : best;
    // 备选方案：与最优「成套方案」不同的另一台相机 + 其匹配镜头（换相机才算另一套，同相机换镜头不重复列），最多 3 套
    if (chosen && oks.length > 1) {
      var alts = [];
      for (var ai = 1; ai < oks.length && alts.length < 3; ai++) {
        var a = oks[ai];
        if (a.cam.model === chosen.cam.model && (a.cam.brand || '') === (chosen.cam.brand || '')) continue;
        var dup = alts.some(function (x) {
          return x.cam.model === a.cam.model && (x.cam.brand || '') === (a.cam.brand || '');
        });
        if (!dup) alts.push(a);
      }
      chosen.alternates = alts;
    }
    return chosen;
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

  /* ============================ 光源型号（SKU） ============================ */

  // 引擎的照明方式 -> 型号库里的光源子类
  var LIGHT_TYPE_MAP = {
    ring: 'ring', ring_low: 'ring', ring_high: 'ring',
    bar_low: 'bar',
    backlight: 'backlight_parallel',
    dome: 'dome',
    coaxial: 'coaxial'
  };

  var LIGHT_TYPE_LABEL = {
    ring: '环形光源', ring_dome: '环形无影光源', bar: '条形光源', bar_array: '组合条形光源',
    backlight: '面光源（背光）', backlight_parallel: '平行面光源', backlight_hole: '中孔面光源',
    backlight_side: '侧导面光源', dome: '穹顶光源', coaxial: '同轴光源',
    line: '线光源', line_high: '高亮线光源', line_focus: '聚光线光源', line_coax: '同轴线光源',
    point: '点光源', flat_shadowless: '平面无影光源'
  };

  /**
   * 光源「同族」：同一照明方式下的细分子类（平行面光 / 中孔面光 / 高亮线光…）
   * 在选型与备选里应互相可见，否则「海康平行背光」永远找不到「华睿普通背光」，
   * 多品牌库就白并了。同族之间尺寸够用即可替换，只是光学特性有优劣，故排序时同子类优先。
   */
  var LIGHT_TYPE_FAMILY = {
    ring: 'ring', ring_dome: 'ring',
    bar: 'bar', bar_array: 'bar',
    backlight: 'backlight', backlight_parallel: 'backlight',
    backlight_hole: 'backlight', backlight_side: 'backlight',
    dome: 'dome', flat_shadowless: 'dome',
    line: 'line', line_high: 'line', line_focus: 'line', line_coax: 'line',
    coaxial: 'coaxial', point: 'point'
  };

  function sameLightFamily(a, b) {
    if (!a || !b) return false;
    return (LIGHT_TYPE_FAMILY[a] || a) === (LIGHT_TYPE_FAMILY[b] || b);
  }

  function lightSizeNeed(inp, type) {
    var longSide = Math.max(inp.fovW, inp.fovH);
    if (type === 'bar_low') return { d: Math.ceil(inp.fovW * 1.15), axis: 'length' };
    if (type === 'backlight') return { w: Math.ceil(inp.fovW * 1.15), h: Math.ceil(inp.fovH * 1.15), axis: 'area' };
    if (type === 'dome') return { d: Math.ceil(longSide * 1.5), axis: 'diameter' };
    if (type === 'coaxial') return { d: Math.ceil(longSide * 1.15), axis: 'diameter' };
    return { d: Math.ceil(longSide * 1.3), axis: 'diameter' };
  }

  /**
   * 光源「备选型号」：同子类 + 同颜色、尺寸够用但不过分超配、型号不同。
   * 与镜头备选对称——换的是灯具本身，不打乱照明方式。
   */
  function lightAlternates(inp, ltype, lcolor, curModel, curBrand, lightType, limit) {
    var list = (CAT && CAT.LIGHTS) || [];
    if (!list.length) return [];
    var cap = limit || 3;
    var need = lightSizeNeed(inp, lightType);
    function metric(x) {
      if (need.axis === 'area') {
        return Math.min((x.size[0] || 0) / need.w, (x.size[1] || 0) / need.h);
      }
      return (x.size[0] || 0) / need.d;
    }
    // 当前型号自身尺寸：备选要「同一档规格」，而不是「刚好够用的最小型号」。
    // 当前型号常远大于视野所需（如 20×15 视野配 120×120 背光），
    // 若只按 metric 衡量会把 100×100 判成超配砍掉，只留下 27×27 这种不像替换件的规格。
    var cur = null;
    for (var ci = 0; ci < list.length; ci++) {
      if (list[ci].model === curModel && (list[ci].brand || '') === (curBrand || '')) { cur = list[ci]; break; }
    }
    function ratio(x) {
      if (!cur || !cur.size || !cur.size.length) return 1;
      if (need.axis === 'area') {
        var ax = (x.size[0] || 0) * (x.size[1] || 0);
        var bx = (cur.size[0] || 0) * (cur.size[1] || 0);
        return bx ? ax / bx : 1;
      }
      return (cur.size[0] || 0) ? (x.size[0] || 0) / cur.size[0] : 1;
    }
    var seen = {};
    var pool = list.filter(function (x) {
      if (!sameLightFamily(x.type, ltype) || x.color !== lcolor) return false;
      if (x.model === curModel && (x.brand || '') === (curBrand || '')) return false;
      if (metric(x) < 1) return false;                 // 备选也必须放得下视野
      if (ratio(x) < 0.65) return false;               // 明显偏小，照不满视野
      var k = (x.brand || '') + '::' + x.model;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
    if (!pool.length) return [];
    // 同子类优先（平行背光 > 中孔背光…），再按与当前规格最接近排序
    pool.sort(function (a, b) {
      var ta = a.type === ltype ? 0 : 1, tb = b.type === ltype ? 0 : 1;
      if (ta !== tb) return ta - tb;
      var da = Math.abs(ratio(a) - 1), db = Math.abs(ratio(b) - 1);
      if (Math.abs(da - db) > 1e-9) return da - db;
      return (a.brand || '').localeCompare(b.brand || '');
    });
    // 规格超配 3 倍以上的只作兜底，避免「50 mm 视野推荐 642 mm 灯管」
    var tight = pool.filter(function (x) { return ratio(x) <= 3; });
    if (!tight.length) tight = pool.slice(0, 6);
    // 品牌铺开：其他品牌各取最接近的一支 → 不足再补当前品牌的相邻档位
    var others = tight.filter(function (x) { return (x.brand || '') !== (curBrand || ''); });
    var same = tight.filter(function (x) { return (x.brand || '') === (curBrand || ''); });
    var res = [], usedBrand = {}, took = {};
    others.forEach(function (x) {
      var b = x.brand || '';
      if (res.length >= cap || usedBrand[b] || took[x.model]) return;
      usedBrand[b] = 1; took[x.model] = 1; res.push(x);
    });
    tight.forEach(function (x) {
      if (res.length >= cap || took[x.model]) return;
      took[x.model] = 1; res.push(x);
    });
    return res.slice(0, cap).map(function (x) {
      return {
        model: x.model, brand: x.brand || null, size: x.size, type: x.type,
        power: x.power == null ? null : x.power, color: x.color
      };
    });
  }

  /** 按 类型 + 颜色 + 视野尺寸 从光源型号库里挑具体型号 */
  function pickLightSku(inp, light) {
    var list = (CAT && CAT.LIGHTS) || [];
    if (!list.length) return null;

    var want = LIGHT_TYPE_MAP[light.type] || 'ring';
    var color = light.color;
    var note = '';
    var cands = list.filter(function (x) { return x.type === want && x.color === color; });

    if (!cands.length) {
      cands = list.filter(function (x) { return x.type === want && x.color === 'white'; });
      if (cands.length) note = '标准系列无' + light.colorName + '，先按白光选型；特定波长建议非标定制或咨询厂商';
    }
    if (!cands.length) {
      // 同族但细分不同：平行面光 ↔ 普通/中孔面光，高亮线光 ↔ 普通线光…
      // 多品牌合并后各家子类划分不一致，这一步保证「有货就能选到」。
      cands = list.filter(function (x) { return sameLightFamily(x.type, want) && x.color === color; });
      if (cands.length) {
        note = (want === 'backlight_parallel')
          ? '平行面光无对应规格，退回普通面光源'
          : '同系列无对应细分规格，改用同族「' + (LIGHT_TYPE_LABEL[cands[0].type] || cands[0].type) + '」';
      }
    }
    if (!cands.length) {
      cands = list.filter(function (x) { return sameLightFamily(x.type, want) && x.color === 'white'; });
      if (cands.length) note = '标准系列无' + light.colorName + '，先按白光选型；特定波长建议非标定制或咨询厂商';
    }
    if (!cands.length) return null;

    var need = lightSizeNeed(inp, light.type);

    function metric(x) {
      if (need.axis === 'area') {
        var w = x.size[0] || 0;
        var h = x.size[1] || 0;
        return Math.min(w / need.w, h / need.h); // >=1 表示够大
      }
      var d = x.size[0] || 0;
      return d / need.d;
    }

    var good = cands.filter(function (x) { return metric(x) >= 1; });
    var pick;
    if (good.length) {
      // 够用的里面挑最小（最便宜）
      pick = good.sort(function (a, b) { return metric(a) - metric(b); })[0];
    } else {
      // 平行面光没有够大规格时，同族「面光源」（海康 MV-LBSS / 华睿 PFM-DM）里再找
      var alt = [];
      if (want === 'backlight_parallel') {
        var inCands = {};
        cands.forEach(function (x) { inCands[x.model] = 1; });
        alt = list.filter(function (x) {
          return x.type === 'backlight' && (x.color === color || x.color === 'white') && !inCands[x.model];
        });
      }
      var altGood = alt.filter(function (x) { return metric(x) >= 1; });
      if (altGood.length) {
        pick = altGood.sort(function (a, b) { return metric(a) - metric(b); })[0];
        note = note || '平行面光无对应规格，选用普通面光源';
      } else {
        if (alt.length) cands = cands.concat(alt);   // 都不够大时跨类型取最大
        // 都不够大：取最大的并提示
        pick = cands.sort(function (a, b) { return metric(b) - metric(a); })[0];
        note = note || '型号库中该系列最大规格仍小于建议尺寸，可多灯拼接或选更大系列';
      }
    }

    return {
      model: pick.model,
      brand: pick.brand || null,
      type: want,
      color: pick.color,
      size: pick.size,
      power: pick.power || null,
      note: note,
      alts: lightAlternates(inp, want, pick.color, pick.model, pick.brand, light.type)
    };
  }

  /* ============================ 线扫 / 远心建议 ============================ */

  function suggestLineScan(inp, needW, pxAccReq, isColor) {
    var list = (CAT && CAT.LINESCAN) || [];
    if (!list.length) return null;

    var color = isColor ? '彩色' : '黑白';
    var needRate = inp.speed > 0 ? (inp.speed / pxAccReq) / 1000 : null; // kHz

    var pool = list.filter(function (x) { return x.w >= needW && x.color === color; });
    if (!pool.length) return null;
    if (needRate) {
      var rateOk = pool.filter(function (x) { return x.lineRate >= needRate * 1.2; });
      if (rateOk.length) pool = rateOk;
    }
    pool.sort(function (a, b) { return a.w - b.w || b.lineRate - a.lineRate; });
    var pick = pool[0];

    // 光学：像面宽 = 像素数 × 像元；倍率 m = 像面宽 / 视野宽；焦距 f = WD·m/(1+m)
    var sensorW = (pick.w * pick.pxH) / 1000;
    var m = sensorW / inp.fovW;
    var f = (inp.wd * m) / (1 + m);

    // 运动方向进度：每行前进距离 = 速度 / 行频
    var runPxAcc = needRate && inp.speed > 0 ? inp.speed / (pick.lineRate * 1000) : null;
    var tMaxMs = inp.speed > 0 ? (pxAccReq / inp.speed) * 1000 : Infinity;

    // 数据带宽（按需要的行频或相机常用行频估算）
    var useRate = needRate || Math.min(pick.lineRate, 20); // kHz
    var bitDepth = isColor ? 16 : 8;
    var bandwidth = (pick.w * bitDepth * useRate * 1000) / 8 / 1e6;
    var cap = IFACE_BW[pick.iface] || 350;

    // 线光源：长度 ≥ 视野宽
    var lineLights = (CAT && CAT.LIGHTS ? CAT.LIGHTS : []).filter(function (x) {
      return (x.type === 'line' || x.type === 'line_high') && x.color === 'white';
    }).sort(function (a, b) { return (a.size[0] || 0) - (b.size[0] || 0); });
    var llGood = lineLights.filter(function (x) { return (x.size[0] || 0) >= inp.fovW * 1.15; });
    var lineLight = llGood[0] || lineLights[lineLights.length - 1] || null;

    // 线扫镜头：直配卡口（线扫不做转接）；像面直径 ≥ 行传感器宽的一半（行方向是长边）；
    // 解析力 ≥ 行像素数/1000 MP；焦距取不超过理论焦距的最大档，没有时取最接近档并提示
    var needMp = pick.w / 1000;
    function lsLensBase(l) {
      return mountMatch(pick.mount, l.mount) === 1
        && (l.ic == null || l.ic >= sensorW / 2)
        && (l.mp == null || l.mp >= needMp * 0.9)
        && l.focal < inp.wd * 0.95
        && (l.minDist == null || l.minDist * 1000 <= inp.wd);
    }
    var lsLens = null, lsLensNote = '';
    var poolFit = (CAT.LENSES || []).filter(lsLensBase).filter(function (l) { return l.focal <= f + 1e-9; });
    if (poolFit.length) {
      poolFit.sort(function (a, b) {
        return b.focal - a.focal || (a.mp == null ? 25 : a.mp) - (b.mp == null ? 25 : b.mp);
      });
      lsLens = poolFit[0];
    } else {
      var poolNear = (CAT.LENSES || []).filter(lsLensBase);
      if (poolNear.length) {
        poolNear.sort(function (a, b) {
          return Math.abs(a.focal - f) - Math.abs(b.focal - f) ||
            (a.mp == null ? 25 : a.mp) - (b.mp == null ? 25 : b.mp);
        });
        lsLens = poolNear[0];
        lsLensNote = '焦距档位偏离理论值，视场会相应变化';
      }
    }
    var lsLensOut = null;
    if (lsLens) {
      var mAct = lsLens.focal / (inp.wd - lsLens.focal);
      lsLensOut = {
        model: lsLens.model,
        brand: lsLens.brand || null,
        focal: lsLens.focal,
        mount: lsLens.mount,
        ic: lsLens.ic,
        mp: lsLens.mp,
        m: mAct,
        fovW: sensorW / mAct,
        note: lsLensNote
      };
    }

    return {
      model: pick.model,
      w: pick.w,
      taps: pick.taps,
      pxH: pick.pxH,
      lineRate: pick.lineRate,
      iface: pick.iface,
      color: pick.color,
      mount: pick.mount,
      powerW: pick.powerW,
      needRate: needRate,
      useRate: useRate,
      optics: {
        sensorW: sensorW,
        m: m,
        f: f,
        note: lsLensOut
          ? '像面宽 ' + fmt(sensorW, 1) + ' mm，需 ' + fmt(m, 3) + '× 放大、理论焦距 ' +
            fmt(f, 1) + ' mm；线扫镜头选 ' + lsLensOut.model + '（' + lsLensOut.focal +
            ' mm，直配 ' + lsLensOut.mount + ' 口，行方向视场 ' + fmt(lsLensOut.fovW, 1) + ' mm）' +
            (lsLensOut.note ? '；' + lsLensOut.note : '')
          : '像面宽 ' + fmt(sensorW, 1) + ' mm，需 ' + fmt(m, 3) + '× 放大、焦距约 ' +
            fmt(f, 1) + ' mm 的线扫镜头（镜头库中无直配卡口且像面/解析力达标的型号，需按像面宽度另选）'
      },
      runPxAcc: runPxAcc,
      tMaxMs: tMaxMs,
      bandwidth: bandwidth,
      ifaceCap: cap,
      lineLight: lineLight ? { model: lineLight.model, size: lineLight.size, power: lineLight.power } : null,
      lens: lsLensOut,
      note: '线扫是面阵精度不足时的标准解法：' +
        (needRate ? '所需行频约 ' + fmt(needRate, 1) + ' kHz（' + pick.lineRate + ' kHz 可满足）；' : '') +
        '沿运动方向每行前进 ' + (runPxAcc ? fmt(runPxAcc, 4) : '—') + ' mm/px；' +
        '需编码器触发并与线光源同步。'
    };
  }

  function suggestTelecentric(inp, cam, m) {
    var list = (CAT && CAT.TELECENTRIC) || [];
    if (!list.length) return null;

    var diag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);
    function fmtFits(f) {
      if (/1\/1\.8/.test(f)) return diag <= 9.2;
      if (/2\/3/.test(f)) return diag <= 11.2;
      if (/1".*2"/.test(f)) return diag <= 32;
      return true;
    }
    function mountFits(t) {
      if (cam.mount === 'C') return t.mount === 'C';
      return t.mount !== 'C';
    }

    var candidates = list.filter(function (t) {
      if (!fmtFits(t.fmt) || !mountFits(t)) return false;
      return m >= t.magMin * 0.98 && m <= t.magMax * 1.02;
    });
    if (!candidates.length) return null;

    // 靶面刚好够用的优先
    candidates.sort(function (a, b) {
      return (a.magMax - a.magMin) - (b.magMax - b.magMin);
    });

    // 工作距离必须落在系列的 WD 区间内
    var inWd = candidates.filter(function (t) {
      return inp.wd >= t.wdMin && inp.wd <= t.wdMax;
    });
    var pick = inWd[0] || candidates[0];
    var feasible = inWd.length > 0;

    // 远心镜头工作光圈通常在 F8 左右，景深按此估算并标注
    var cc = 2 * (cam.sh / cam.h);
    var dofEst = (2 * 8 * cc * (1 + m)) / (m * m);

    return {
      feasible: feasible,
      series: pick.series,
      model: pick.model,
      mag: m,
      wdMin: pick.wdMin,
      wdMax: pick.wdMax,
      mount: pick.mount,
      coax: pick.coax,
      dofEst: dofEst,
      note: feasible
        ? '倍率 ' + fmt(m, 3) + '×，工作距离需在 ' + pick.wdMin + '~' + pick.wdMax +
          ' mm 内（当前 ' + fmt(inp.wd) + ' mm 符合）；景深按 F8 估算约 ' + fmt(dofEst, 2) +
          ' mm，具体以实型号参数为准。'
        : '当前工作距离 ' + fmt(inp.wd) + ' mm 不在 ' + pick.series + ' 允许的 ' +
          pick.wdMin + '~' + pick.wdMax + ' mm 内，需调整 WD 或改用其它系列，否则远心方案不成立。'
    };
  }

  /* ============================ 3D 轮廓传感器建议 ============================ */
  // 解析 "0.56µm" / "62mm" 这类规格字符串为数字
  function parseSpecNum(s) {
    if (s == null) return null;
    var m = String(s).match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  /**
   * 「高度 / 3D 轮廓测量」任务：从 3D 传感器库（MV-DP 激光轮廓传感器）里选
   * X 测量范围 ≥ 视野宽、Z 测量范围 ≥ 高度变化、Z 重复精度 ≤ 要求精度、参考距离匹配 WD 的最小够用型号。
   */
  function suggestProfile3D(inp) {
    var list = (CAT && CAT.PROFILERS) || [];
    if (!list.length) return null;

    var zReqUm = inp.precision * 1000;              // 要求的 Z 精度（µm）
    var zNeedMm = Math.max(inp.heightDiff * 2, 1);  // Z 测量范围需求（含余量，最少 1mm）

    function cand(p) {
      var xm = parseSpecNum(p.xRange), zm = parseSpecNum(p.zRange);
      var rp = parseSpecNum(p.zRepeat), rf = parseSpecNum(p.ref);
      return { p: p, xm: xm, zm: zm, rp: rp, rf: rf };
    }
    var all = list.map(cand);
    var ok = all.filter(function (c) {
      return c.xm != null && c.xm >= inp.fovW * 1.05 &&
        c.zm != null && c.zm >= zNeedMm &&
        c.rp != null && c.rp <= zReqUm &&
        c.rf != null && Math.abs(c.rf - inp.wd) / c.rf <= 0.3;
    });
    var relaxed = false;
    if (!ok.length) {
      // WD 不匹配常是主要原因：放宽距离约束再试一次
      ok = all.filter(function (c) {
        return c.xm != null && c.xm >= inp.fovW * 1.05 &&
          c.zm != null && c.zm >= zNeedMm &&
          c.rp != null && c.rp <= zReqUm;
      });
      relaxed = true;
    }
    if (!ok.length) return null;
    // 最小够用：X 范围小 → 点数少 → 参考距离接近
    ok.sort(function (a, b) {
      return a.xm - b.xm || (a.p.points || 0) - (b.p.points || 0) ||
        Math.abs(a.rf - inp.wd) - Math.abs(b.rf - inp.wd);
    });
    var c = ok[0], p = c.p;
    return {
      model: p.model,
      brand: p.brand || null,
      points: p.points,
      xRange: p.xRange, zRange: p.zRange, ref: p.ref,
      zRes: p.zRes, zRepeat: p.zRepeat, interval: p.interval,
      rate: p.rate, laser: p.laser,
      zReqUm: zReqUm, zNeedMm: zNeedMm,
      ok: !relaxed,
      note: '按「X ≥ 视野宽 ' + fmt(inp.fovW, 0) + ' mm、Z 范围 ≥ ' + fmt(zNeedMm, 1) + ' mm、重复精度 ≤ ' +
        fmt(zReqUm, 1) + ' µm」选最小够用型号' +
        (relaxed
          ? '；注意：无型号的参考距离与当前 WD ' + fmt(inp.wd, 0) + ' mm 匹配（该型号参考距离 ' + p.ref +
            '，近远端各有 ±30% 行程），安装距离需按手册调整'
          : '；参考距离 ' + p.ref + ' 与当前 WD 匹配') +
        '。需编码器触发逐行采集；Z 精度受标定与振动影响，现场以实测为准。'
    };
  }

  /* ============================ 同系列参数对比 ============================ */

  function buildSiblings(cam, lens, needW, needH, light, inp, fReq, altCamKeys, altLensKeys, altLightKeys) {
    // 相机「同系列」：同系列 + 同接口 + 同黑白彩色（便于换一档 / 换焦距）
    var camSeries = CAT.CAMERAS.filter(function (c) {
      return c.series === cam.series && c.iface === cam.iface && c.color === cam.color;
    });
    // 跨品牌等价替换：同分辨率(w×h) + 同接口 + 同黑白彩色，但不同品牌
    var camCross = CAT.CAMERAS.filter(function (c) {
      return c.brand !== cam.brand && c.color === cam.color &&
        c.iface === cam.iface && c.w === cam.w && c.h === cam.h;
    });

    var camItems = camSeries.map(function (c) {
      return {
        model: c.model,
        brand: c.brand || null,
        w: c.w,
        h: c.h,
        sw: c.sw,
        sh: c.sh,
        pxUm: c.pxUm,
        fps: c.fps,
        megs: round((c.w * c.h) / 1e6, 1),
        cur: c.model === cam.model && (c.brand || '') === (cam.brand || ''),
        meets: c.w >= needW && c.h >= needH,
        alt: !!(altCamKeys && altCamKeys[(c.brand || '') + '::' + c.model])
      };
    }).sort(function (a, b) {
      return a.model.localeCompare(b.model);
    });

    var crossItems = camCross.map(function (c) {
      return {
        model: c.model,
        brand: c.brand || null,
        w: c.w,
        h: c.h,
        fps: c.fps,
        megs: round((c.w * c.h) / 1e6, 1),
        cur: c.model === cam.model && (c.brand || '') === (cam.brand || ''),
        meets: c.w >= needW && c.h >= needH,
        alt: !!(altCamKeys && altCamKeys[(c.brand || '') + '::' + c.model])
      };
    }).sort(function (a, b) {
      return (a.brand || '').localeCompare(b.brand || '') || a.model.localeCompare(b.model);
    });

    // 镜头：同系列 + 同卡口，按焦距排序
    var lensAll = CAT.LENSES.filter(function (l) {
      return l.series === lens.series && l.mount === lens.mount;
    }).sort(function (a, b) { return a.focal - b.focal; });

    var lensItems = lensAll.map(function (l) {
      return {
        model: l.model,
        brand: l.brand || null,
        mount: l.mount,
        focal: l.focal,
        fmin: l.fmin,
        ic: l.ic,
        mp: l.mp,
        minDist: l.minDist,
        dist: l.dist,
        cur: l.model === lens.model && (l.brand || '') === (lens.brand || ''),
        alt: !!(altLensKeys && altLensKeys[(l.brand || '') + '::' + l.model])
      };
    });

    // 镜头跨品牌等价替换：同卡口 + 焦距接近（±12%）+ 与当前相机光学匹配的其他品牌镜头。
    // 与相机块的 crossBrand 对应——此前镜头侧只有同系列，导致"选不了其他品牌镜头"。
    var camMp = (cam.w * cam.h) / 1e6;
    var camDiag = Math.sqrt(cam.sw * cam.sw + cam.sh * cam.sh);
    var lensCrossAll = CAT.LENSES.filter(function (l) {
      if ((l.brand || '') === (lens.brand || '')) return false;        // 仅其他品牌
      if (l.mount !== lens.mount) return false;                        // 卡口一致
      if (l.focal > fReq + 1e-9) return false;                         // 焦距过大则视场不足
      if (Math.abs(l.focal - lens.focal) / lens.focal > 0.12) return false; // 焦距与当前接近
      if (l.ic != null && l.ic < camDiag * 0.97) return false;         // 像面必须覆盖靶面
      if (l.mp != null && l.mp < camMp * 0.85) return false;           // 解析力不能低于相机
      if (!(l.focal < inp.wd * 0.95)) return false;                    // 工作距离必须大于焦距
      if (l.minDist != null && l.minDist * 1000 > inp.wd) return false; // 工作距离 ≥ 最近摄距
      return true;
    }).sort(function (a, b) {
      return Math.abs(a.focal - lens.focal) - Math.abs(b.focal - lens.focal) ||
        (a.brand || '').localeCompare(b.brand || '') || a.model.localeCompare(b.model);
    }).slice(0, 12);

    var lensCrossItems = lensCrossAll.map(function (l) {
      return {
        model: l.model,
        brand: l.brand || null,
        mount: l.mount,
        focal: l.focal,
        fmin: l.fmin,
        ic: l.ic,
        mp: l.mp,
        minDist: l.minDist,
        dist: l.dist,
        cur: l.model === lens.model && (l.brand || '') === (lens.brand || ''),
        alt: !!(altLensKeys && altLensKeys[(l.brand || '') + '::' + l.model])
      };
    });

    // 光源：同族（含各品牌细分子类）+ 同颜色；当前型号置顶 → 同子类 → 小尺寸
    var recType = LIGHT_TYPE_MAP[light.type] || 'ring';
    var ltype = light.skuType || recType;   // 手动指定了别的照明方式时，按实际型号所在的子类列同族
    var lcolor = light.skuColor || light.color;
    function isCur(x) {
      return x.model === light.sku && (!light.skuBrand || (x.brand || '') === light.skuBrand);
    }
    var lightAll = ((CAT && CAT.LIGHTS) || []).filter(function (x) {
      return sameLightFamily(x.type, ltype) && x.color === lcolor;
    }).sort(function (a, b) {
      var ca = isCur(a) ? 0 : 1, cb = isCur(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      var ta = a.type === ltype ? 0 : 1, tb = b.type === ltype ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return (a.size[0] || 0) - (b.size[0] || 0) || (a.size[1] || 0) - (b.size[1] || 0);
    });

    var lightItems = lightAll.map(function (x) {
      return {
        model: x.model, size: x.size, power: x.power, brand: x.brand || null, type: x.type,
        cur: isCur(x),
        alt: !!(altLightKeys && altLightKeys[(x.brand || '') + '::' + x.model])
      };
    });

    return {
      camera: {
        label: cam.series + '　' + cam.iface + ' · ' + cam.color,
        items: camItems,
        total: camItems.length,
        crossBrand: crossItems,
        crossTotal: crossItems.length
      },
      lens: {
        label: lens.series + '　' + lens.mount + ' 口',
        items: lensItems,
        total: lensItems.length,
        crossBrand: lensCrossItems,
        crossTotal: lensCrossItems.length
      },
      light: {
        label: LIGHT_TYPE_LABEL[ltype] || ltype,
        items: lightItems,
        total: lightItems.length
      }
    };
  }

  /* ============================ 精度预算 ============================ */

  /**
   * 实际可达精度 = RSS(像素量化, 亚像素, 畸变残差, 标定与装夹)
   * 理论值只是"一个像素多大"，这里把工程误差也摊开。
   */
  function accuracyBudget(inp, lens, pxAcc, pxAccReq) {
    var px = pxAcc;
    var items = [];
    items.push({ name: '像素量化', mm: px, note: '1 像素对应的实际尺寸' });
    items.push({ name: '亚像素定位', mm: px * 0.3, note: '边缘/质心算法，按 0.3 像素估' });

    var distMm;
    if (lens.dist != null) {
      distMm = (Math.abs(lens.dist) / 100) * (Math.max(inp.fovW, inp.fovH) / 2) * 0.2;
      items.push({
        name: '镜头畸变残差',
        mm: distMm,
        note: '光学畸变 ' + lens.dist + '%，标定后残差按 20% 估'
      });
    } else {
      distMm = px * 0.5;
      items.push({ name: '镜头畸变残差', mm: distMm, note: '无畸变数据，按 0.5 像素估' });
    }
    items.push({ name: '标定与装夹', mm: px * 0.5, note: '棋盘格标定 + 夹具重复性，按 0.5 像素估' });

    var sq = 0;
    for (var i = 0; i < items.length; i++) sq += items[i].mm * items[i].mm;
    var total = Math.sqrt(sq);

    return {
      items: items,
      total: total,
      limit: pxAccReq,
      ratio: total / pxAccReq,
      pass: total <= pxAccReq
    };
  }

  /* ============================ 安装空间 ============================ */

  // 镜头长度手册未给，按系列取典型值（界面标注"估算"）
  var LENS_LEN_EST = {
    'M12 系列': 20,
    'HF-E 系列': 45, 'HF-P 系列': 45,
    'MF-E 系列': 50, 'MF-10MPE 系列': 50, 'MF-8MPS 系列': 50, 'MF 系列': 50,
    'KF-E 系列': 55, 'KF-P 系列': 55, 'KF-P 抗振系列': 55, 'KF 系列': 55,
    'AF 系列': 90, 'LF 系列': 120
  };

  // 转接环（大口径相机配 C 口镜头）的附加长度估计，mm
  var ADAPTER_RING_LEN = 12;

  /**
   * 镜头光心到安装面的长度。adapter=true 时加上转接环厚度
   * （C 口镜头装在 F/M42/M58/M72 机身上，接环约占 10~15 mm）。
   */
  function lensLength(lens, adapter) {
    var base = lens.len || (LENS_LEN_EST[lens.series] || 50);
    var extra = 0;
    // 手册给了真实总长就不再加大口径附加；缺长度按估算时，大口径镜头本身比 C 口长一截
    if (!lens.len && (lens.mount === 'M42' || lens.mount === 'M58' || lens.mount === 'M72' || lens.mount === 'F')) extra += 12;
    if (adapter) extra += ADAPTER_RING_LEN;   // C 口镜头经转接环装上大口径相机
    return base + extra;
  }

  /** 工件表面 → 相机尾部 需要的总长度；可用空间为 0 时只展示不判定 */
  function spaceCheck(inp, cam, lens) {
    var adapter = mountMatch(cam.mount, lens.mount) === 2;
    var lensLen = lensLength(lens, adapter);
    var hasDims = cam.dims && cam.dims.length === 3;
    var camDepth = hasDims ? cam.dims[2] : 45;
    var cable = 25;
    var need = inp.wd + lensLen + camDepth + cable;
    return {
      wd: inp.wd,
      lensLen: lensLen,
      camDepth: camDepth,
      cable: cable,
      need: need,
      available: inp.space > 0 ? inp.space : null,
      pass: inp.space > 0 ? need <= inp.space : null,
      over: inp.space > 0 ? need - inp.space : null,
      lensLenReal: !!lens.len,
      estimated: !hasDims,
      adapter: adapter
    };
  }

  /* ============================ 图示几何 ============================ */

  function buildGeometry(inp, cam, lens, light, dof, pxAcc) {
    var angleByType = { bar_low: 15, ring_low: 15, ring_high: 60, ring: 45, coaxial: 0, backlight: 0, dome: 0 };
    var adapter = mountMatch(cam.mount, lens.mount) === 2;
    return {
      fovW: inp.fovW,
      fovH: inp.fovH,
      wd: inp.wd,
      dof: dof,
      heightDiff: inp.heightDiff,
      lensLen: lensLength(lens, adapter),
      camDepth: cam.dims && cam.dims.length === 3 ? cam.dims[2] : 45,
      sensorW: cam.sw,
      sensorH: cam.sh,
      mount: lens.mount,
      adapter: adapter,
      lightType: light.type,
      lightAngle: angleByType[light.type] == null ? 45 : angleByType[light.type],
      pxAcc: pxAcc
    };
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
      var biggest = CAT.CAMERAS.length
        ? CAT.CAMERAS.slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; })[0]
        : null;
      var anyLens = (CAT.LENSES && CAT.LENSES.length)
        ? CAT.LENSES.slice().sort(function (a, b) { return b.focal - a.focal; })[0]
        : null;
      if (!biggest) return { ok: false, error: '相机型号库为空，无法选型' };
      if (!anyLens) return { ok: false, error: '镜头型号库为空，无法完成光学匹配' };
      pick = {
        cam: biggest, lens: anyLens, m: anyLens.focal / (inp.wd - anyLens.focal),
        fReq: anyLens.focal, fovW: biggest.sw / (anyLens.focal / (inp.wd - anyLens.focal)),
        fovH: biggest.sh / (anyLens.focal / (inp.wd - anyLens.focal)),
        pxAcc: 1, ok: false
      };
      pick.pxAcc = Math.max(pick.fovW / biggest.w, pick.fovH / biggest.h);
    }

    // 备选方案（自动选型的第 2/3 名完整方案）：供同系列表把对应设备标注为「备选」
    var autoAlts = (pick && pick.alternates) || [];
    var altCamKeys = {}, altLensKeys = {};
    var estFpsAlt = inp.speed > 0 ? Math.max(1, Math.ceil((inp.speed / inp.fovH) * 1.2)) : 0;
    autoAlts.forEach(function (a) {
      if (a.cam) altCamKeys[(a.cam.brand || '') + '::' + a.cam.model] = true;
      if (a.lens) altLensKeys[(a.lens.brand || '') + '::' + a.lens.model] = true;
    });

    /* ---- 手动指定型号（覆盖自动选型） ---- */
    var manual = { camera: false, lens: false, light: false };

    if (inp.manualCamera) {
      var mc = null;
      var mparts = String(inp.manualCamera).split('::');
      var mWantBrand = mparts.length > 1 ? mparts[0] : null;
      var mWantModel = mparts.length > 1 ? mparts[1] : mparts[0];
      for (var mi = 0; mi < CAT.CAMERAS.length; mi++) {
        var mcand = CAT.CAMERAS[mi];
        if (mcand.model !== mWantModel) continue;
        if (mWantBrand && !(mcand.brand && (mcand.brand === mWantBrand || mcand.brand.indexOf(mWantBrand) >= 0))) continue;
        mc = mcand; break;
      }
      if (mc) {
        var forcedPick = forceCamera(mc, inp);
        if (forcedPick) {
          pick = forcedPick;
          manual.camera = true;
        }
      }
    }

    if (inp.manualLens) {
      var ml = null;
      // 与手动相机一致：支持「品牌::型号」前缀消歧（跨品牌点选时必需）
      var lparts = String(inp.manualLens).split('::');
      var lWantBrand = lparts.length > 1 ? lparts[0] : null;
      var lWantModel = lparts.length > 1 ? lparts[1] : lparts[0];
      for (var li = 0; li < CAT.LENSES.length; li++) {
        var lcand = CAT.LENSES[li];
        if (lcand.model !== lWantModel) continue;
        if (lWantBrand && !(lcand.brand && (lcand.brand === lWantBrand || lcand.brand.indexOf(lWantBrand) >= 0))) continue;
        ml = lcand; break;
      }
      if (ml && mountCompatible(pick.cam.mount, ml.mount) && ml.focal < inp.wd * 0.95) {
        var lm = ml.focal / (inp.wd - ml.focal);
        var lfovW = pick.cam.sw / lm;
        var lfovH = pick.cam.sh / lm;
        pick = {
          cam: pick.cam,
          lens: ml,
          m: lm,
          fReq: pick.fReq,
          fovW: lfovW,
          fovH: lfovH,
          pxAcc: Math.max(lfovW / pick.cam.w, lfovH / pick.cam.h),
          forced: true
        };
        pick.ok = pick.pxAcc <= pxAccReq * (1 + 1e-9);
        manual.lens = true;
      } else if (ml) {
        // 找到了型号但不满足硬性约束：明确告知，而非静默忽略
        var why = !mountCompatible(pick.cam.mount, ml.mount)
          ? '镜头为 ' + ml.mount + ' 口，与相机 ' + pick.cam.mount + ' 口不匹配'
          : '焦距 ' + ml.focal + ' mm 不小于工作距离 ' + fmt(inp.wd) + ' mm';
        warnings.push({
          level: 'warn',
          text: '手动指定的镜头 ' + (lWantBrand ? lWantBrand + ' ' : '') + lWantModel +
            ' 无法采用：' + why + '，已回退为自动选型结果。'
        });
      } else {
        warnings.push({
          level: 'warn',
          text: '手动指定的镜头 ' + (lWantBrand ? lWantBrand + ' ' : '') + lWantModel +
            ' 不在当前型号库中（可能已被镜头品牌筛选排除），已回退为自动选型结果。'
        });
      }
    }

    if (!pick.ok) {
      feasible = false;
      if (manual.camera || manual.lens) {
        warnings.push({
          level: 'warn',
          text: '手动指定的型号不满足当前要求：像素精度 ' + fmt(pick.pxAcc) + ' mm/px，要求 ≤ ' +
            fmt(pxAccReq) + ' mm/px。可换更大靶面 / 更高分辨率，或放宽精度要求。'
        });
      } else {
        warnings.push({
          level: 'warn',
          text: '型号库内单相机方案无法满足：需要 ' + needW + ' × ' + needH + ' 像素（' +
            fmt(inp.fovW / pxAccReq) + ' mm/px）。建议线扫相机、多相机拼接，或把视野分段检测。'
        });
      }
    }

    if ((manual.camera || manual.lens) &&
        (pick.fovW < inp.fovW * 0.999 || pick.fovH < inp.fovH * 0.999)) {
      feasible = false;
      warnings.push({
        level: 'warn',
        text: '手动指定组合的实际视场 ' + fmt(pick.fovW) + ' × ' + fmt(pick.fovH) +
          ' mm 小于需求 ' + fmt(inp.fovW) + ' × ' + fmt(inp.fovH) + ' mm，会拍不全。'
      });
    }

    var cam = pick.cam;
    var lens = pick.lens;
    var adapter = mountMatch(cam.mount, lens.mount) === 2;   // C 口镜头经转接环装大口径相机
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

    /* ---- 精度预算 / 安装空间 ---- */
    var budget = accuracyBudget(inp, lens, pxAcc, pxAccReq);
    var space = spaceCheck(inp, cam, lens);

    if (space.pass === false) {
      warnings.push({
        level: 'warn',
        text: '安装空间不足：需要约 ' + fmt(space.need) + ' mm（WD ' + fmt(space.wd) + ' + 镜头 ' +
          space.lensLen + ' + 相机 ' + space.camDepth + ' + 线缆 ' + space.cable + '），可用只有 ' +
          fmt(space.available) + ' mm，超出 ' + fmt(space.over) + ' mm。'
      });
    }
    if (!budget.pass) {
      warnings.push({
        level: 'warn',
        text: '精度预算合成 ±' + fmt(budget.total, 4) + ' mm，已超过要求的像素精度 ' +
          fmt(budget.limit, 4) + ' mm（含畸变与标定误差），建议提高一档分辨率或加强标定。'
      });
    }

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
    if (lens.minDist != null && inp.wd < lens.minDist * 1000 * 1.15) {
      warnings.push({ level: 'warn', text: '工作距离 ' + fmt(inp.wd) + ' mm 接近镜头最近摄距 ' + lens.minDist * 1000 + ' mm，可能无法对焦，建议放大 WD 或换最近摄距更近的型号。' });
    }
    // 相机曝光能力校验
    if (isFinite(tMaxMs)) {
      var needExpUs = tMaxMs * 1000;
      if (cam.expMinUs != null && needExpUs < cam.expMinUs) {
        warnings.push({ level: 'warn', text: '所需曝光 ' + fmt(needExpUs, 0) + ' µs 小于该相机最短曝光 ' + cam.expMinUs + ' µs，当前速度下拍不清；需降速或换更短曝光机型。' });
      }
      if (cam.snr != null && needExpUs < 200 && cam.snr < 40) {
        warnings.push({ level: 'warn', text: '曝光仅 ' + fmt(needExpUs, 0) + ' µs，该相机信噪比 ' + cam.snr + ' dB 偏低，画面噪点会明显，建议提高照度或换高灵敏机型。' });
      }
    }
    if (lens.ic != null && lens.ic < diag + 0.2) {
      warnings.push({ level: 'info', text: '镜头像面 ' + lens.ic + ' mm 与靶面对角 ' + fmt(diag) + ' mm 基本持平，边缘可能有暗角，建议留 5% 余量。' });
    }
    if (adapter) {
      warnings.push({
        level: 'info',
        text: '镜头为 C 口、相机为 ' + cam.mount + ' 口，需加 ' + cam.mount + '→C 转接环（约 ' + ADAPTER_RING_LEN +
          ' mm，已计入安装空间）；同焦距如有 ' + cam.mount + ' 口原厂镜头建议优先直连。'
      });
    }

    /* ---- 光源 ---- */
    var light = buildLight(inp, { tMaxMs: tMaxMs, speed: inp.speed, mount: cam.mount });
    var lightSku = pickLightSku(inp, light);

    if (inp.manualLight) {
      var ml3 = null;
      for (var xi = 0; xi < ((CAT && CAT.LIGHTS) || []).length; xi++) {
        if (CAT.LIGHTS[xi].model === inp.manualLight) { ml3 = CAT.LIGHTS[xi]; break; }
      }
      if (ml3) {
        lightSku = {
          model: ml3.model, brand: ml3.brand || null, type: ml3.type, color: ml3.color,
          size: ml3.size, power: ml3.power, note: '手动指定型号',
          alts: lightAlternates(inp, ml3.type, ml3.color, ml3.model, ml3.brand, light.type)
        };
        manual.light = true;
        if (ml3.color !== light.color) {
          warnings.push({
            level: 'info',
            text: '手动选择的光源颜色与推荐不一致（推荐' + light.colorName + '），请确认打光效果。'
          });
        }
        if (!sameLightFamily(ml3.type, LIGHT_TYPE_MAP[light.type] || 'ring')) {
          warnings.push({
            level: 'info',
            text: '手动选择的光源照明方式与推荐不同（推荐' + light.label + '），下方同系列表已按实际型号的「' +
              (LIGHT_TYPE_LABEL[ml3.type] || ml3.type) + '」同族列出，请确认打光效果。'
          });
        }
      }
    }

    if (lightSku) attachLightSku(light, lightSku);

    // 镜头备选（同相机、换一支仍达标的镜头）与光源备选型号 → 交给同系列面板标注「备选」
    var lensAlts = lensAlternates(cam, inp, lens, 3);
    lensAlts.forEach(function (a) {
      altLensKeys[(a.lens.brand || '') + '::' + a.lens.model] = true;
    });
    var lightAltList = (light && light.skuAlts) || [];
    var altLightKeys = {};
    lightAltList.forEach(function (x) { altLightKeys[(x.brand || '') + '::' + x.model] = true; });

    // 同系列参数对比（换一档相机 / 换焦距 / 换光源尺寸时直接看）
    var siblings = buildSiblings(cam, lens, needW, needH, light, inp, pick.fReq, altCamKeys, altLensKeys, altLightKeys);
    var geometry = buildGeometry(inp, cam, lens, light, dof, pxAcc);

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
    if (adapter) score -= 3;   // 与 candScore 保持一致：转接方案略逊于直接卡口
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
      lens.model + ' ' + lens.focal + 'mm F' + ap + (adapter ? '（' + cam.mount + '→' + lens.mount + ' 转接环）' : '') +
      ' ｜ 光源 ' +
      (light.sku || (light.series + ' ' + light.seriesName)) + ' ' + light.colorName + ' ' + light.wavelength +
      ' ｜ 有效像素精度 ' + fmt(pxAcc, 4) + ' mm/px ｜ 景深 ' + fmt(dof) + ' mm';

    // 扩展建议：面阵搞不定（或用户勾选“优先线扫”）时给具体线扫型号；高精度/景深不足时给远心系列
    var m0 = Math.min(cam.sw / inp.fovW, cam.sh / inp.fovH);
    var lineScan = (!feasible || inp.lineScanFirst) ? suggestLineScan(inp, needW, pxAccReq, isColor) : null;
    if (lineScan && inp.lineScanFirst && feasible) {
      lineScan.note = '已按需求优先给出线扫方案（面阵方案：' + cam.model + ' 亦可满足精度 ' + fmt(pxAcc, 4) + ' mm/px）。' + (lineScan.note || '');
    }
    var telecentric =
      (inp.task === 'precise_measure' || !dofOK) && cam.mount !== 'Bare'
        ? suggestTelecentric(inp, cam, m0)
        : null;
    // 3D 轮廓测量任务：从 3D 传感器库（MV-DP 等）直接给方案建议
    var profile3D = inp.task === 'height' ? suggestProfile3D(inp) : null;

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
        brand: cam.brand == null ? null : cam.brand,
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
        capability: pxAcc * k,
        sensor: cam.sensor || null,
        dr: cam.dr == null ? null : cam.dr,
        snr: cam.snr == null ? null : cam.snr,
        expMinUs: cam.expMinUs == null ? null : cam.expMinUs,
        expMaxUs: cam.expMaxUs == null ? null : cam.expMaxUs,
        poe: cam.poe == null ? null : !!cam.poe,
        powerW: cam.powerW == null ? null : cam.powerW
      },
      lens: {
        model: lens.model,
        brand: lens.brand || null,
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
        // 满足景深的最大光圈：heightDiff=0 时即最大可用光圈；false 表示已收到最小光圈景深仍不足
        apMaxOk: dofOK,
        dof: dof,
        mount: lens.mount === 'C' ? 'C' : lens.mount,
        adapter: adapter,
        len: lens.len || null,
        lenEst: lensLength(lens, adapter),
        blurPx: blurPx
      },
      exposure: { tMaxMs: tMaxMs },
      light: light,
      siblings: siblings,
      alternates: autoAlts.map(function (a) {
        return {
          camera: (a.cam.brand ? '[' + a.cam.brand + '] ' : '') + a.cam.model,
          cameraKey: (a.cam.brand || '') + '::' + a.cam.model,
          lens: (a.lens.brand ? '[' + a.lens.brand + '] ' : '') + a.lens.model,
          lensKey: (a.lens.brand || '') + '::' + a.lens.model,
          megapixel: round((a.cam.w * a.cam.h) / 1e6, 1),
          pxAcc: a.pxAcc,
          adapter: !!a.adapter,
          score: candScore(a, inp, pxAccReq, estFpsAlt)
        };
      }),
      lensAlternates: lensAlts.map(function (a) {
        return {
          lens: (a.lens.brand ? '[' + a.lens.brand + '] ' : '') + a.lens.model,
          lensKey: (a.lens.brand || '') + '::' + a.lens.model,
          series: a.lens.series,
          focal: a.lens.focal,
          mount: a.lens.mount,
          pxAcc: a.pxAcc,
          adapter: !!a.adapter
        };
      }),
      lightAlternates: lightAltList.slice(),
      manual: manual,
      budget: budget,
      space: space,
      geometry: geometry,
      lineScan: lineScan,
      profile3D: profile3D,
      telecentric: telecentric,
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
    _internal: { tryCamera: tryCamera, selectOptics: selectOptics, mountMatch: mountMatch, lensLength: lensLength }
  };
});
