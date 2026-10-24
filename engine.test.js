'use strict';

/**
 * 选型引擎测试：基于海康机器人真实型号库
 * 运行：node engine.test.js
 */

const assert = require('assert');
const Engine = require('./engine.js');
const CAT = require('./hikrobot-catalog.js');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ' :: ' + e.message);
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}

function near(actual, expected, tol, label) {
  if (typeof actual !== 'number' || Number.isNaN(actual)) {
    throw new Error((label || '') + ' 不是有效数字: ' + actual);
  }
  if (Math.abs(actual - expected) > tol) {
    throw new Error((label || '') + ' 期望 ' + expected + ' ±' + tol + '，实际 ' + actual);
  }
}

function base(over) {
  return Object.assign(
    {
      fovW: 50,
      fovH: 40,
      precision: 0.1,
      task: 'defect',
      wd: 300,
      material: 'metal_shiny',
      colorTarget: 'none',
      needColor: false,
      heightDiff: 1,
      speed: 0,
      cpm: 0,
    },
    over || {}
  );
}

const byModel = (m) => CAT.CAMERAS.find((c) => c.model === m);
const lensByModel = (m) => CAT.LENSES.find((l) => l.model === m);

console.log('\n[1] 型号库');
test('型号库已加载，相机 ≥ 200 台、镜头 ≥ 50 支', () => {
  assert.ok(CAT.CAMERAS.length >= 200, '相机 ' + CAT.CAMERAS.length);
  assert.ok(CAT.LENSES.length >= 50, '镜头 ' + CAT.LENSES.length);
});

test('每个型号的靶面宽度与 分辨率×像元 自洽', () => {
  const bad = CAT.CAMERAS.filter((c) => Math.abs((c.w * c.pxUm) / 1000 - c.sw) > 0.02);
  assert.deepStrictEqual(bad.map((c) => c.model).slice(0, 3), []);
});

console.log('\n[2] 相机与镜头：硬性约束');
test('选出的相机满足所需分辨率（两个方向都够）', () => {
  const r = Engine.solve(base());
  const c = byModel(r.camera.model);
  assert.ok(c, '相机型号必须来自型号库: ' + r.camera.model);
  assert.ok(c.w >= r.pxNeed.w, '宽像素 ' + c.w + ' < 需求 ' + r.pxNeed.w);
  assert.ok(c.h >= r.pxNeed.h, '高像素 ' + c.h + ' < 需求 ' + r.pxNeed.h);
});

test('有效像素精度不超标（≤ δ/k）', () => {
  const r = Engine.solve(base());
  assert.ok(r.camera.pxAcc <= r.pxAccReq * (1 + 1e-9), '实际 ' + r.camera.pxAcc + ' 需求 ' + r.pxAccReq);
});

test('镜头来自型号库，像面覆盖靶面、焦距不超过需求、接口匹配', () => {
  const r = Engine.solve(base());
  const l = lensByModel(r.lens.model);
  assert.ok(l, '镜头型号必须来自型号库: ' + r.lens.model);
  const cam = byModel(r.camera.model);
  const diag = Math.hypot(cam.sw, cam.sh);
  assert.ok(l.ic == null || l.ic >= diag * 0.97, '像面 ' + l.ic + ' 未覆盖靶面对角 ' + diag.toFixed(2));
  assert.ok(l.focal <= r.lens.fReq * 1.02, '焦距 ' + l.focal + ' 超过需求 ' + r.lens.fReq.toFixed(1));
  assert.ok(l.mount === cam.mount || (cam.mount === 'M42/F' && l.mount !== 'C'), '接口不匹配');
});

test('实际视场能覆盖需求视野', () => {
  const r = Engine.solve(base());
  assert.ok(r.lens.fovH >= 40 - 1e-6, '视场高 ' + r.lens.fovH);
  assert.ok(r.lens.fovW >= 50 - 1e-6, '视场宽 ' + r.lens.fovW);
});

console.log('\n[3] 选型偏好');
test('满足要求时选像素最少的可行相机（不浪费）', () => {
  const r = Engine.solve(base());
  const chosen = byModel(r.camera.model);
  const smaller = CAT.CAMERAS.filter(
    (c) =>
      c.color === chosen.color &&
      c.shutter === chosen.shutter &&
      c.w * c.h < chosen.w * chosen.h &&
      c.w >= r.pxNeed.w &&
      c.h >= r.pxNeed.h
  ).filter((c) => {
    const t = Engine._internal.tryCamera(c, r.input);
    return t && t.ok;
  });
  assert.deepStrictEqual(smaller.map((c) => c.model), [], '存在更小且可行的相机');
});

test('需要彩色时选彩色相机', () => {
  const r = Engine.solve(base({ needColor: true }));
  assert.strictEqual(r.camera.color, '彩色');
});

test('运动拍摄时选全局快门相机', () => {
  const r = Engine.solve(base({ speed: 200 }));
  assert.strictEqual(r.camera.shutter, '全局快门');
});

console.log('\n[4] 光学计算');
test('放大倍率 / 视场 / 像素精度互相自洽', () => {
  const r = Engine.solve(base());
  const c = byModel(r.camera.model);
  near(r.lens.m, r.lens.f / (r.input.wd - r.lens.f), 1e-9, '放大倍率');
  near(r.lens.fovH, c.sh / r.lens.m, 1e-6, '视场高');
  near(r.lens.fovW, c.sw / r.lens.m, 1e-6, '视场宽');
  near(r.camera.pxAcc, Math.max(r.lens.fovW / c.w, r.lens.fovH / c.h), 1e-9, '像素精度');
});

test('景深符合 2Fc(1+m)/m²', () => {
  const r = Engine.solve(base());
  const c = byModel(r.camera.model);
  const cc = 2 * (c.sh / c.h);
  const dof = (2 * r.lens.aperture * cc * (1 + r.lens.m)) / (r.lens.m * r.lens.m);
  near(r.lens.dof, dof, 0.05, '景深');
});

test('曝光上限 = 像素精度 / 速度', () => {
  const r = Engine.solve(base({ speed: 100 }));
  near(r.exposure.tMaxMs, (r.camera.pxAcc / 100) * 1000, 0.02, '曝光上限');
});

console.log('\n[5] 光源');
test('光源给出海康系列与颜色后缀', () => {
  const r = Engine.solve(base());
  assert.ok(/^MV-L/.test(r.light.series), '系列应为 MV-L 开头: ' + r.light.series);
  assert.ok(/^-[A-Z0-9]+$/.test(r.light.suffix), '后缀格式: ' + r.light.suffix);
});

test('金属高光面缺陷 → 条形光（MV-LLDS）', () => {
  const r = Engine.solve(base({ task: 'defect', material: 'metal_shiny' }));
  assert.strictEqual(r.light.type, 'bar_low');
  assert.ok(/MV-LLDS/.test(r.light.series), r.light.series);
});

test('尺寸测量 → 背光（MV-LB 系列）', () => {
  const r = Engine.solve(base({ task: 'measure', material: 'metal_matte' }));
  assert.strictEqual(r.light.type, 'backlight');
  assert.ok(/MV-LB/.test(r.light.series), r.light.series);
});

console.log('\n[6] 完整型号库');
test('型号库含线扫 / 远心 / 光源 / 板级相机', () => {
  assert.ok(CAT.LINESCAN && CAT.LINESCAN.length >= 10, '线扫 ' + (CAT.LINESCAN || []).length);
  assert.ok(CAT.TELECENTRIC && CAT.TELECENTRIC.length >= 5, '远心 ' + (CAT.TELECENTRIC || []).length);
  assert.ok(CAT.LIGHTS && CAT.LIGHTS.length >= 150, '光源 ' + (CAT.LIGHTS || []).length);
  assert.ok(CAT.CAMERAS.some((c) => c.kind === 'board'), '缺板级相机');
});

test('选型结果不会用裸板相机（无镜头接口）', () => {
  const r = Engine.solve(base());
  const c = byModel(r.camera.model);
  assert.notStrictEqual(c.mount, 'Bare');
});

test('光源给出型号库里的具体型号', () => {
  const r = Engine.solve(base());
  assert.ok(r.light.sku, '缺少光源型号');
  const hit = CAT.LIGHTS.find((x) => x.model === r.light.sku);
  assert.ok(hit, '光源型号不在库中: ' + r.light.sku);
  assert.strictEqual(hit.color, r.light.color);
});

test('面阵不可行时给出具体线扫型号建议', () => {
  const r = Engine.solve(base({ fovW: 100, fovH: 80, precision: 0.02, task: 'defect', speed: 200 }));
  assert.strictEqual(r.feasible, false, '该场景应超出面阵能力');
  assert.ok(r.lineScan, '缺少线扫建议');
  assert.ok(CAT.LINESCAN.some((x) => x.model === r.lineScan.model), '线扫型号不在库中');
});

test('精密测量时给出远心镜头系列建议', () => {
  const r = Engine.solve(base({ fovW: 20, fovH: 15, precision: 0.05, task: 'precise_measure', wd: 250 }));
  assert.ok(r.telecentric, '缺少远心建议');
  const hit = CAT.TELECENTRIC.find((t) => t.series === r.telecentric.series);
  assert.ok(hit, '远心系列不在库中: ' + r.telecentric.series);
  assert.ok(r.telecentric.mag >= hit.magMin * 0.98 && r.telecentric.mag <= hit.magMax * 1.02, '倍率超出系列范围');
});

console.log('\n[7] 同系列参数');
test('相机同系列：包含当前型号，且同系列同接口同颜色', () => {
  const r = Engine.solve(base());
  const cur = byModel(r.camera.model);
  const s = r.siblings.camera;
  assert.ok(s.items.some((x) => x.cur), '缺少当前型号');
  s.items.forEach((x) => {
    const c = byModel(x.model);
    assert.strictEqual(c.series, cur.series, x.model + ' 系列不同');
    assert.strictEqual(c.iface, cur.iface, x.model + ' 接口不同');
    assert.strictEqual(c.color, cur.color, x.model + ' 颜色不同');
  });
});

test('镜头同系列：按焦距升序，含当前型号', () => {
  const r = Engine.solve(base());
  const s = r.siblings.lens;
  assert.ok(s.items.some((x) => x.cur), '缺少当前镜头');
  for (let i = 1; i < s.items.length; i++) {
    assert.ok(s.items[i].focal >= s.items[i - 1].focal, '焦距未升序');
  }
  s.items.forEach((x) => {
    const l = lensByModel(x.model);
    assert.strictEqual(l.series, lensByModel(r.lens.model).series);
  });
});

test('光源同系列：同子类同颜色，含当前 SKU', () => {
  const r = Engine.solve(base());
  const s = r.siblings.light;
  assert.ok(s.items.some((x) => x.cur), '缺少当前光源');
  const color = r.light.skuColor || r.light.color;
  s.items.forEach((x) => {
    const hit = CAT.LIGHTS.find((l) => l.model === x.model);
    assert.ok(hit, x.model + ' 不在光源库');
    assert.strictEqual(hit.color, color);
  });
});

test('同系列列表返回全部型号（不截断）', () => {
  const r = Engine.solve(base());

  const curCam = byModel(r.camera.model);
  const wantCams = CAT.CAMERAS.filter(
    (c) => c.series === curCam.series && c.iface === curCam.iface && c.color === curCam.color
  ).length;
  assert.strictEqual(r.siblings.camera.items.length, wantCams, '相机列表被截断');
  assert.strictEqual(r.siblings.camera.total, wantCams);

  const curLens = lensByModel(r.lens.model);
  const wantLens = CAT.LENSES.filter((l) => l.series === curLens.series && l.mount === curLens.mount).length;
  assert.strictEqual(r.siblings.lens.items.length, wantLens, '镜头列表被截断');

  assert.ok(r.siblings.light.items.length >= 1, '光源列表为空');
  assert.strictEqual(r.siblings.light.items.length, r.siblings.light.total);
});

console.log('\n[8] P0 完善项');
test('镜头满足最近摄距：工作距离 ≥ 镜头最近摄距', () => {
  const r = Engine.solve(base());
  if (r.lens.minDist != null) {
    assert.ok(r.input.wd >= r.lens.minDist * 1000 - 1e-6,
      'WD ' + r.input.wd + ' < 最近摄距 ' + r.lens.minDist * 1000);
  }
});

test('相机带详细参数：动态范围 / 信噪比 / 曝光范围 / PoE', () => {
  const r = Engine.solve(base());
  assert.ok(r.camera.dr != null, '缺动态范围');
  assert.ok(r.camera.snr != null, '缺信噪比');
  assert.ok(r.camera.expMinUs != null, '缺最短曝光');
  assert.ok(typeof r.camera.poe === 'boolean', '缺 PoE 标识');
});

test('光源带功率，并匹配到具体控制器型号', () => {
  const r = Engine.solve(base());
  assert.ok(r.light.power != null, '缺光源功率');
  assert.ok(r.light.totalPower >= r.light.power, '总功率异常');
  assert.ok(r.light.controllerModel, '缺控制器型号');
  assert.ok(CAT.CONTROLLERS.some((c) => c.model === r.light.controllerModel), '控制器不在库中');
  assert.ok(r.light.count >= 1);
});

test('远心建议校验工作距离区间', () => {
  const ok = Engine.solve(base({ fovW: 20, fovH: 15, precision: 0.05, task: 'precise_measure', wd: 250 }));
  assert.ok(ok.telecentric, '缺远心建议');
  assert.strictEqual(ok.telecentric.feasible, true, 'WD 250 应可行');
  assert.ok(ok.telecentric.dofEst > 0, '缺景深估算');

  const bad = Engine.solve(base({ fovW: 20, fovH: 15, precision: 0.05, task: 'precise_measure', wd: 800 }));
  assert.ok(!bad.telecentric || bad.telecentric.feasible === false, 'WD 800 超出所有系列区间，应标记不可行');
});

test('线扫方案给出光学参数与线光源型号', () => {
  const r = Engine.solve(base({ fovW: 100, fovH: 80, precision: 0.02, task: 'defect', speed: 200 }));
  assert.ok(r.lineScan, '缺线扫方案');
  assert.ok(r.lineScan.optics && r.lineScan.optics.f > 0, '缺焦距');
  assert.ok(r.lineScan.optics.m > 0, '缺放大倍率');
  assert.ok(r.lineScan.lineLight && r.lineScan.lineLight.model, '缺线光源');
  assert.ok(r.lineScan.bandwidth > 0, '缺带宽估算');
  assert.ok(r.lineScan.needRate > 0, '缺行频需求');
});

test('线扫方案接入直配线扫镜头（卡口同族 + 像面覆盖行宽 + 焦距不超理论值）', () => {
  const r = Engine.solve(base({ fovW: 100, fovH: 80, precision: 0.02, task: 'defect', speed: 200 }));
  const ls = r.lineScan;
  assert.ok(ls, '缺线扫方案');
  if (!ls.lens) return; // 库内无直配镜头时保持“需另选”提示，不算失败
  const lensInCat = CAT.LENSES.find((x) => x.model === ls.lens.model);
  assert.ok(lensInCat, '线扫镜头不在库中');
  const fam = (m) => ({ 'C': 'C', 'M12': 'M12', 'F': 'F', 'M42': 'F', 'M42/F': 'F', 'M58': 'M58', 'M72': 'M72' })[m];
  assert.strictEqual(fam(ls.mount), fam(lensInCat.mount), '线扫镜头必须直配卡口');
  assert.ok(lensInCat.ic == null || lensInCat.ic >= ls.optics.sensorW / 2 - 1e-9, '像面必须覆盖行传感器宽的一半');
  assert.ok(lensInCat.focal <= ls.optics.f + 1e-9, '焦距不能超理论焦距（否则视场不足）');
  assert.ok(/线扫镜头选/.test(ls.optics.note), 'optics.note 应写明所选镜头');
  // 实际行方向视场 = 像面宽 / 实际倍率
  assert.ok(Math.abs(ls.lens.fovW - ls.optics.sensorW / ls.lens.m) < 1e-6, '行方向视场换算错误');
});

console.log('\n[9] 手动指定型号');
test('手动指定相机后按该型号出方案', () => {
  const r = Engine.solve(base({ manualCamera: 'MV-CS050-10GM' }));
  assert.strictEqual(r.camera.model, 'MV-CS050-10GM');
  assert.strictEqual(r.manual.camera, true);
});

test('手动指定镜头后按该镜头出方案', () => {
  const r = Engine.solve(base({ manualLens: 'MVL-MF5028M-5MPE' }));
  assert.strictEqual(r.lens.model, 'MVL-MF5028M-5MPE');
  assert.strictEqual(r.manual.lens, true);
});

test('手动指定光源后按该型号出方案，控制器照常匹配', () => {
  const r = Engine.solve(base({ manualLight: 'MV-LRDS-132-20-W' }));
  assert.strictEqual(r.light.sku, 'MV-LRDS-132-20-W');
  assert.strictEqual(r.manual.light, true);
  assert.ok(r.light.controllerModel, '应仍匹配控制器');
});

test('手动指定不达标相机 → 标记不可行并给出告警', () => {
  const r = Engine.solve(base({ manualCamera: 'MV-CS016-11GM' }));
  assert.strictEqual(r.feasible, false);
  assert.ok(r.warnings.some((w) => /手动指定/.test(w.text)), '缺少手动告警');
});

test('不传手动参数时行为与自动选型一致', () => {
  const a = Engine.solve(base());
  const b = Engine.solve(base({ manualCamera: null, manualLens: null, manualLight: null }));
  assert.strictEqual(a.camera.model, b.camera.model);
  assert.strictEqual(a.lens.model, b.lens.model);
});

console.log('\n[10] 精度预算 / 安装空间 / 图示');
test('精度预算：4 项误差 + RSS 合成 + 判定', () => {
  const r = Engine.solve(base());
  assert.ok(r.budget, '缺预算');
  assert.ok(r.budget.items.length >= 4, '误差项不足');
  const sq = Math.sqrt(r.budget.items.reduce((s, x) => s + x.mm * x.mm, 0));
  assert.ok(Math.abs(sq - r.budget.total) < 1e-9, 'RSS 合成不一致');
  assert.ok(r.budget.total > 0);
  assert.strictEqual(r.budget.limit, 0.1 / 3);
  assert.strictEqual(typeof r.budget.pass, 'boolean');
});

test('可用安装空间不足 → 告警；充足 → 不告警', () => {
  const tight = Engine.solve(base({ space: 150 }));
  assert.strictEqual(tight.space.pass, false);
  assert.ok(tight.warnings.some((w) => /安装空间不足/.test(w.text)), '缺安装空间告警');
  const loose = Engine.solve(base({ space: 1200 }));
  assert.strictEqual(loose.space.pass, true);
  assert.ok(!loose.warnings.some((w) => /安装空间不足/.test(w.text)));
});

test('未填可用空间时不判定，只给出总长', () => {
  const r = Engine.solve(base());
  assert.strictEqual(r.space.available, null);
  assert.strictEqual(r.space.pass, null);
  assert.ok(r.space.need > r.space.wd, '总长应大于 WD');
});

test('手册尺寸图长度：型号库带真实总长，且用于安装空间', () => {
  const withLen = CAT.LENSES.filter((l) => l.len);
  assert.ok(withLen.length >= 20, '真实长度型号太少: ' + withLen.length);
  const sample = CAT.LENSES.find((l) => l.model === 'MVL-HF0628M-6MPE');
  assert.ok(sample && sample.len > 20 && sample.len < 80, 'HF-E 6mm 长度异常');

  const r = Engine.solve(base());
  if (r.lens.len) {
    assert.strictEqual(r.space.lensLen, r.lens.len, '安装空间未使用真实长度');
    assert.strictEqual(r.space.lensLenReal, true);
  }
});

test('图示几何包含视场 / 景深 / 镜头与相机尺寸', () => {
  const r = Engine.solve(base());
  const g = r.geometry;
  assert.ok(g, '缺 geometry');
  assert.strictEqual(g.fovW, r.input.fovW);
  assert.ok(g.dof > 0);
  assert.ok(g.lensLen > 0 && g.camDepth > 0);
  assert.ok(g.lightType);
});

console.log('\n[11] 边界');
test('超出单相机能力 → feasible=false 并建议升级', () => {
  const r = Engine.solve(base({ fovW: 900, fovH: 700, precision: 0.01 }));
  assert.strictEqual(r.feasible, false);
  assert.ok(r.warnings.some((w) => /线扫|多相机|拼接/.test(w.text)));
});

test('非法输入返回错误', () => {
  const r = Engine.solve(base({ precision: 0 }));
  assert.strictEqual(r.ok, false);
  assert.ok(/精度/.test(r.error));
});

test('匹配度 0~100', () => {
  const r = Engine.solve(base());
  assert.ok(r.score >= 0 && r.score <= 100, 'score=' + r.score);
});

// ---------------- 多品牌（华睿 + Basler） ----------------
// 引擎在 Node require 下只导出"绑定海康库的实例"，无法换目录重建；
// 多品牌需要工厂函数，故用 vm 在全局作用域加载（走浏览器分支，挂 VisionEngineFactory）。
const vm = require('vm');
const fs = require('fs');
function loadGlobal(f) { vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); }
loadGlobal('./brands.js');
loadGlobal('./hikrobot-catalog.js');
loadGlobal('./hikrobot-3d-catalog.js');
loadGlobal('./huarui-catalog.js');
loadGlobal('./basler-catalog.js');
loadGlobal('./daheng-catalog.js');
loadGlobal('./engine.js');
const EngineFactory = global.VisionEngineFactory;
const HIK = global.HikrobotCatalog;
const HIK3D = global.Hikrobot3DCatalog;
const HUA = global.HuaruiCatalog;
const BAS = global.BaslerCatalog;
const DAH = global.DahengCatalog;

function mergeMulti(brands, lensBrands) {
  const cam = [];
  if (brands.indexOf('hikrobot') >= 0)
    HIK.CAMERAS.forEach((x) => cam.push(Object.assign({}, x, { brand: x.brand || '海康机器人 HIKROBOT' })));
  if (brands.indexOf('huarui') >= 0)
    HUA.CAMERAS.forEach((x) => cam.push(Object.assign({}, x, { brand: x.brand || '华睿' })));
  if (brands.indexOf('basler') >= 0)
    BAS.CAMERAS.forEach((x) => cam.push(Object.assign({}, x, { brand: x.brand || 'Basler' })));
  if (brands.indexOf('daheng') >= 0)
    DAH.CAMERAS.forEach((x) => cam.push(Object.assign({}, x, { brand: x.brand || '大恒图像' })));
  // 镜头品牌：默认合并全部有镜头的品牌（与顶栏“镜头品牌筛选”默认全选一致）；可单独指定
  const lb = lensBrands || ['hikrobot', 'daheng'];
  let lenses = [];
  if (lb.indexOf('hikrobot') >= 0)
    lenses = lenses.concat(HIK.LENSES.map((x) => Object.assign({}, x, { brand: '海康机器人 HIKROBOT' })));
  if (lb.indexOf('daheng') >= 0)
    lenses = lenses.concat(DAH.LENSES.map((x) => Object.assign({}, x, { brand: '大恒图像' })));
  let linescan = [];
  if (brands.indexOf('hikrobot') >= 0) linescan = linescan.concat(HIK.LINESCAN);
  if (brands.indexOf('huarui') >= 0) linescan = linescan.concat(HUA.LINESCAN);
  // 光源 / 控制器：海康 + 华睿（华睿型录含独立光源与光源控制器章节）
  let lights = [];
  if (brands.indexOf('hikrobot') >= 0)
    lights = lights.concat(HIK.LIGHTS.map((x) => Object.assign({}, x, { brand: '海康机器人 HIKROBOT' })));
  if (brands.indexOf('huarui') >= 0)
    lights = lights.concat(HUA.LIGHTS.map((x) => Object.assign({}, x, { brand: '华睿' })));
  let ctrls = [];
  if (brands.indexOf('hikrobot') >= 0)
    ctrls = ctrls.concat(HIK.CONTROLLERS.map((x) => Object.assign({}, x, { brand: '海康机器人 HIKROBOT' })));
  if (brands.indexOf('huarui') >= 0)
    ctrls = ctrls.concat(HUA.CONTROLLERS.map((x) => Object.assign({}, x, { brand: '华睿' })));
  return {
    META: { brand: '多品牌' },
    CAMERAS: cam,
    LINESCAN: linescan,
    LENSES: lenses,
    TELECENTRIC: HIK.TELECENTRIC,
    LIGHTS: lights,
    CONTROLLERS: ctrls
  };
}

test('多品牌目录合并 = 海康300 + 华睿288 + Basler86 + 大恒275', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  assert.strictEqual(CAT3.CAMERAS.length, 949, '合并后相机数');
  const byBrand = {};
  CAT3.CAMERAS.forEach((c) => { byBrand[c.brand] = (byBrand[c.brand] || 0) + 1; });
  assert.strictEqual(byBrand['海康机器人 HIKROBOT'], 300);
  assert.strictEqual(byBrand['华睿'], 288);
  assert.strictEqual(byBrand['Basler'], 86);
  assert.strictEqual(byBrand['大恒图像'], 275);
});

test('镜头库合并 = 海康85 + 大恒71；线扫 = 海康18 + 华睿26', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  assert.strictEqual(CAT3.LENSES.length, 156, '合并后镜头数');
  assert.strictEqual(CAT3.LINESCAN.length, 44, '合并后线扫数');
  const lb = {};
  CAT3.LENSES.forEach((l) => { lb[l.brand] = (lb[l.brand] || 0) + 1; });
  assert.strictEqual(lb['海康机器人 HIKROBOT'], 85);
  assert.strictEqual(lb['大恒图像'], 71);
  // 镜头输出对象带 brand
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.lens.brand, '镜头输出应带 brand');
  assert.ok(r.light.skuBrand, '光源输出应带 brand');
  // 同系列面板镜头/光源行带品牌
  assert.ok(r.siblings.lens.items.every((x) => x.brand != null), '镜头 siblings 应带 brand');
  assert.ok(r.siblings.light.items.every((x) => x.brand != null), '光源 siblings 应带 brand');
});

test('大恒 HN 镜头字段合规（焦距/光圈/卡口/像面）', () => {
  DAH.LENSES.forEach((l) => {
    assert.ok(l.focal > 0, l.model + ' 焦距');
    assert.ok(l.fmin > 0 && l.fmax >= l.fmin, l.model + ' 光圈');
    assert.ok(['C', 'F', 'V38'].indexOf(l.mount) >= 0, l.model + ' 卡口');
    assert.ok(l.ic > 0, l.model + ' 像面');
    assert.ok(l.brand === '大恒图像', l.model + ' brand');
  });
  // C 口覆盖主要焦距段
  const focals = new Set(DAH.LENSES.filter((l) => l.mount === 'C').map((l) => l.focal));
  [6, 8, 12, 16, 25, 35, 50].forEach((f) => assert.ok(focals.has(f), 'C 口缺焦距 ' + f));
});

test('华睿线阵入库：26 台、字段合规、含 16K 与 10GigE', () => {
  assert.strictEqual(HUA.LINESCAN.length, 26, '华睿线阵台数');
  HUA.LINESCAN.forEach((x) => {
    assert.ok(x.w >= 2048, x.model + ' 宽度');
    assert.ok(x.pxH > 0 && x.lineRate > 0, x.model + ' 像元/行频');
    assert.ok(['GigE', '10GigE', 'CameraLink', 'CoaXPress'].indexOf(x.iface) >= 0, x.model + ' 接口');
    assert.ok(['黑白', '彩色'].indexOf(x.color) >= 0, x.model + ' 颜色');
    assert.ok(x.brand === '华睿', x.model + ' brand');
  });
  assert.ok(HUA.LINESCAN.some((x) => x.w === 16384), '应含 16K 线阵');
  assert.ok(HUA.LINESCAN.some((x) => x.iface === '10GigE'), '应含 10GigE 线阵');
});

test('线扫建议：面阵幅面不够时给出线阵（海康或华睿）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  // 幅面高度需求远超最大面阵（21280px），线扫幅面无限
  const r = E3.solve(Object.assign(base(), { fovW: 200, fovH: 1000, precision: 0.1, wd: 600 }));
  assert.ok(r.lineScan, '应给线扫建议');
  assert.ok(!r.feasible, '面阵应不可行');
  assert.ok(r.lineScan.w >= 2048 && r.lineScan.lineRate > 0, '线扫参数应齐全');
});

test('勾选“优先线扫”后面阵可行场景也给出线扫方案', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(Object.assign(base(), { lineScanFirst: true }));
  assert.ok(r.lineScan, '勾选后应给线扫方案');
  assert.ok(r.feasible, '面阵仍可行');
  assert.ok(/优先/.test(r.lineScan.note), 'note 应说明优先线扫');
});

test('镜头品牌筛选：仅大恒时镜头全部来自大恒', () => {
  const CATd = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng'], ['daheng']);
  assert.strictEqual(CATd.LENSES.length, 71, '仅大恒镜头');
  const Ed = EngineFactory(CATd);
  const r = Ed.solve(base());
  assert.ok(r.ok, '仅大恒镜头可解');
  assert.strictEqual(r.lens.brand, '大恒图像');
});

test('大恒相机核心字段齐全（分辨率/帧率/像元/接口/快门）', () => {
  DAH.CAMERAS.forEach((c) => {
    assert.ok(c.w > 0 && c.h > 0, c.model + ' 分辨率');
    assert.ok(c.fps > 0, c.model + ' 帧率');
    assert.ok(c.pxUm > 0, c.model + ' 像元');
    assert.ok(['GigE', '10GigE', 'USB3', 'CoaXPress', 'CameraLink'].indexOf(c.iface) >= 0, c.model + ' 接口 ' + c.iface);
    assert.ok(['Global', 'Rolling'].indexOf(c.shutter) >= 0, c.model + ' 快门');
    assert.ok(['C', 'M42/F', 'M12', 'Bare'].indexOf(c.mount) >= 0, c.model + ' 卡口 ' + c.mount);
    assert.ok(Math.abs(c.w * c.pxUm / 1000 - c.sw) < 0.01, c.model + ' 靶面宽与像元不一致');
  });
});

test('仅大恒：相机来自大恒且镜头（海康库）仍可用', () => {
  const CATd = mergeMulti(['daheng']);
  const Ed = EngineFactory(CATd);
  const r = Ed.solve(base());
  assert.ok(r.ok, '仅大恒可解');
  assert.strictEqual(r.camera.brand, '大恒图像');
  assert.ok(r.lens && r.lens.model, '镜头仍被选（海康库）');
});

test('存在海康×大恒 同分辨率同接口同彩色机型（跨品牌等价组）', () => {
  const key = (c) => c.w + '-' + c.h + '-' + c.iface + '-' + c.color;
  const hikSet = new Set(HIK.CAMERAS.map(key));
  const overlap = DAH.CAMERAS.filter((c) => hikSet.has(key(c)));
  assert.ok(overlap.length > 0, '未找到海康与大恒的跨品牌等价机型');
});

test('存在海康×Basler 同分辨率同接口同彩色机型（跨品牌等价组）', () => {
  const key = (c) => c.w + '-' + c.h + '-' + c.iface + '-' + c.color;
  const hikSet = new Set(HIK.CAMERAS.map(key));
  const overlap = BAS.CAMERAS.filter((c) => hikSet.has(key(c)));
  assert.ok(overlap.length > 0, '未找到海康与 Basler 的跨品牌等价机型');
});

test('仅 Basler：相机来自 Basler 且镜头（海康库）仍可用', () => {
  const CATb = mergeMulti(['basler']);
  const Eb = EngineFactory(CATb);
  const r = Eb.solve(base());
  assert.ok(r.ok, '仅 Basler 可解');
  assert.strictEqual(r.camera.brand, 'Basler');
  assert.ok(r.lens && r.lens.model, '镜头仍被选（海康库）');
  assert.ok(r.siblings.camera.items.length >= 1, 'Basler 单系列机型数');
});

test('手动指定 品牌::型号 解析', () => {
  const CATm = mergeMulti(['hikrobot', 'basler']);
  const Em = EngineFactory(CATm);
  const inp = Object.assign(base(), { manualCamera: 'Basler::a2A2448-75uc' });
  const r = Em.solve(inp);
  assert.ok(r.ok, '手动指定可解');
  assert.strictEqual(r.camera.model, 'a2A2448-75uc');
  assert.strictEqual(r.camera.brand, 'Basler');
});

test('跨品牌等价替换出现在同系列面板', () => {
  const key = (c) => c.w + '-' + c.h + '-' + c.iface + '-' + c.color;
  const hikSet = new Set(HIK.CAMERAS.map(key));
  let pick = null;
  for (const c of BAS.CAMERAS) { if (hikSet.has(key(c))) { pick = c; break; } }
  assert.ok(pick, '应存在与海康等价的 Basler 机型');
  const CATm = mergeMulti(['hikrobot', 'basler']);
  const Em = EngineFactory(CATm);
  const inp = Object.assign(base(), { manualCamera: 'Basler::' + pick.model });
  const r = Em.solve(inp);
  assert.ok(r.ok);
  assert.strictEqual(r.camera.model, pick.model);
  assert.ok(r.siblings.camera.crossTotal >= 1, '面板应展示跨品牌等价替换');
});

// ---------------- 镜头跨品牌选型（同系列面板此前只有当前品牌系列） ----------------
test('镜头同系列面板出现跨品牌等价替换（海康镜头场景 → 大恒候选）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.ok);
  assert.strictEqual(r.lens.brand, '海康机器人 HIKROBOT', '默认应选海康镜头');
  assert.ok(r.siblings.lens.crossTotal >= 1, '镜头面板应展示跨品牌等价替换');
  r.siblings.lens.crossBrand.forEach((x) => {
    assert.strictEqual(x.brand, '大恒图像', '候选应来自其他品牌');
    assert.strictEqual(x.mount, r.lens.mount, '候选应与当前镜头同卡口');
    assert.ok(Math.abs(x.focal - r.lens.f) / r.lens.f <= 0.12, '候选焦距应与当前接近');
  });
});

test('手动指定 品牌::镜头型号 生效（跨品牌点选镜头）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const inp = Object.assign(base(), { manualLens: '大恒图像::HN-2516-5M-C2/3X' });
  const r = E3.solve(inp);
  assert.ok(r.ok);
  assert.strictEqual(r.lens.model, 'HN-2516-5M-C2/3X');
  assert.strictEqual(r.lens.brand, '大恒图像');
  assert.strictEqual(r.manual.lens, true, '应标记为手动指定');
  assert.strictEqual(r.lens.f, 25, '焦距应为 25 mm');
  // 反向：选定大恒镜头后，跨品牌表应给出海康候选
  assert.ok(r.siblings.lens.crossTotal >= 1, '反向跨品牌候选应存在');
  assert.ok(r.siblings.lens.crossBrand.every((x) => x.brand === '海康机器人 HIKROBOT'), '反向候选应为海康');
  // 同系列表当前行应高亮大恒这支
  const cur = r.siblings.lens.items.filter((x) => x.cur);
  assert.strictEqual(cur.length, 1);
  assert.strictEqual(cur[0].model, 'HN-2516-5M-C2/3X');
});

test('手动指定镜头裸型号（无品牌前缀）也能匹配', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(Object.assign(base(), { manualLens: 'HN-2516-5M-C2/3X' }));
  assert.ok(r.ok);
  assert.strictEqual(r.manual.lens, true);
  assert.strictEqual(r.lens.model, 'HN-2516-5M-C2/3X');
});

test('手动指定镜头卡口不符时给出警告（不再静默忽略）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const m12 = CAT3.CAMERAS.find((c) => c.mount === 'M12');
  assert.ok(m12, '库内应有 M12 口相机');
  const r = E3.solve(Object.assign(base(), {
    manualCamera: m12.brand + '::' + m12.model,
    manualLens: '大恒图像::HN-2516-5M-C2/3X' // C 口镜头配 M12 相机
  }));
  assert.ok(r.ok);
  assert.strictEqual(r.manual.lens, false, '不应采用卡口不符的镜头');
  const warn = r.warnings.find((w) => /手动指定的镜头/.test(w.text));
  assert.ok(warn, '应提示手动镜头无法采用');
  assert.ok(/不匹配/.test(warn.text), '警告应说明卡口不匹配');
});

test('手动指定镜头被品牌筛掉时给出警告', () => {
  // 镜头库只留大恒，但手动指定海康镜头 → 应提示不在库内并回退
  const CATd = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng'], ['daheng']);
  const Ed = EngineFactory(CATd);
  const r = Ed.solve(Object.assign(base(), { manualLens: '海康机器人 HIKROBOT::MVL-MF3518M-5MPE' }));
  assert.ok(r.ok);
  assert.strictEqual(r.manual.lens, false, '不应采用不在库内的镜头');
  assert.strictEqual(r.lens.brand, '大恒图像', '应回退为大恒镜头');
  const warn = r.warnings.find((w) => /不在当前型号库/.test(w.text));
  assert.ok(warn, '应提示镜头不在当前型号库');
});

// ---------------- 大口径相机转接环 + 景深光圈 ----------------
test('mountMatch 分级：直配 / 转接 / 不兼容', () => {
  const E3 = EngineFactory(mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']));
  const mm = E3._internal.mountMatch;
  assert.strictEqual(mm('C', 'C'), 1, 'C 配 C 直连');
  assert.strictEqual(mm('C', 'M58'), 0, 'C 相机不能装大口径镜头');
  assert.strictEqual(mm('M12', 'M12'), 1, 'M12 配 M12 直连');
  assert.strictEqual(mm('M12', 'C'), 0, 'M12 相机不能配 C 口镜头');
  assert.strictEqual(mm('M58', 'M58'), 1, '同族大口径直连');
  assert.strictEqual(mm('M58', 'C'), 2, '大口径相机经转接环配 C 口镜头');
  assert.strictEqual(mm('F', 'C'), 2, 'F 口相机可转接 C 口镜头');
  assert.strictEqual(mm('F', 'F'), 1, 'F 配 F 直连');
  assert.strictEqual(mm('M42/F', 'M42'), 1, 'M42/F 相机可直连 M42 镜头');
  assert.strictEqual(mm('M58', 'M42'), 0, 'M58 与 M42 螺纹不通');
  assert.strictEqual(mm('M72', 'C'), 2, 'M72 相机可转接 C 口镜头');
  assert.strictEqual(mm('Bare', 'C'), 0, '裸板无卡口');
});

test('F 口相机可解（修复前 mountCompatible 对 F 直接判不兼容）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const fCam = CAT3.CAMERAS.find((c) => c.mount === 'F');
  assert.ok(fCam, '库内应有 F 口相机（华睿 AX5 系列）');
  const r = E3.solve(Object.assign(base(), { manualCamera: fCam.brand + '::' + fCam.model }));
  assert.ok(r.ok, 'F 口相机应可解');
  assert.strictEqual(r.manual.camera, true);
  assert.strictEqual(r.camera.mount, 'F');
  assert.ok(r.lens && r.lens.model, '应配到镜头');
  assert.strictEqual(r.lens.adapter, false, '有 F 口原厂镜头时应直配');
  assert.strictEqual(r.lens.mount, 'F');
});

test('大口径相机直配优先：有同族镜头时不改用 C 口转接', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const m58 = CAT3.CAMERAS.find((c) => c.mount === 'M58' && (c.brand || '').indexOf('海康') >= 0);
  assert.ok(m58, '库内应有海康 M58 口相机');
  const r = E3.solve(Object.assign(base(), { manualCamera: m58.brand + '::' + m58.model }));
  assert.ok(r.ok);
  assert.strictEqual(r.lens.mount, 'M58', '应选 M58 口镜头');
  assert.strictEqual(r.lens.adapter, false, '不应使用转接环');
  // 转接只在不降级精度时发生：拉高精度要求使直配不达标 → 允许降级 C 口转接
  const r2 = E3.solve(Object.assign(base(), {
    manualCamera: m58.brand + '::' + m58.model,
    fovW: m58.sw, fovH: m58.sh, precision: 0.005, task: 'precise_measure', wd: 200
  }));
  assert.ok(r2.lens && r2.lens.model, '高精度场景仍应给出镜头');
  if (r2.lens.mount === 'C') {
    assert.strictEqual(r2.lens.adapter, true, 'C 口镜头应标记转接');
  }
});

test('转接环：F 口相机 + 手动 C 口镜头 → adapter 标记 + 警告 + 安装空间含接环', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const fCam = CAT3.CAMERAS.find((c) => c.mount === 'F');
  const cLens = HIK.LENSES.find((l) => l.mount === 'C' && l.focal >= 20 && l.focal <= 30);
  assert.ok(cLens, '库内应有 20~30mm C 口镜头');
  const r = E3.solve(Object.assign(base(), {
    manualCamera: fCam.brand + '::' + fCam.model,
    manualLens: '海康机器人 HIKROBOT::' + cLens.model
  }));
  assert.ok(r.ok);
  assert.strictEqual(r.manual.lens, true, 'C 口镜头应能被 F 口相机采用');
  assert.strictEqual(r.lens.adapter, true, '应标记需要转接环');
  assert.strictEqual(r.lens.mount, 'C');
  const warn = r.warnings.find((w) => /转接环/.test(w.text));
  assert.ok(warn, '应提示转接环');
  assert.ok(/F→C/.test(warn.text), '警告应写明 F→C');
  assert.strictEqual(r.space.adapter, true, '安装空间应计入接环');
  assert.strictEqual(r.space.lensLen, (cLens.len || 0) + 12, '镜头长度应加 12mm 接环');
  assert.ok(/转接环/.test(r.summary), '摘要应标注转接环');
});

test('完全不兼容卡口仍被拒绝（M12 相机 + M58 镜头）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const m12 = CAT3.CAMERAS.find((c) => c.mount === 'M12');
  const r = E3.solve(Object.assign(base(), {
    manualCamera: m12.brand + '::' + m12.model,
    manualLens: '海康机器人 HIKROBOT::MVL-AF3528M-M42'
  }));
  assert.ok(r.ok);
  assert.strictEqual(r.manual.lens, false, 'M58 镜头不能用于 M12 相机');
  const warn = r.warnings.find((w) => /无法采用/.test(w.text));
  assert.ok(warn && /不匹配/.test(warn.text), '应提示卡口不匹配');
});

test('满足景深的最大光圈：heightDiff=0 取最大光圈；极大高度差标记不足', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r0 = E3.solve(Object.assign(base(), { heightDiff: 0 }));
  assert.strictEqual(r0.lens.apMaxOk, true, '无高度差时任何光圈都够');
  assert.ok(r0.lens.aperture >= 4, '应从实用光圈 F4 起');
  const rBig = E3.solve(Object.assign(base(), { heightDiff: 100000 }));
  assert.strictEqual(rBig.lens.apMaxOk, false, '最小光圈也达不到巨大景深需求');
  assert.strictEqual(rBig.lens.aperture, rBig.lens.fmax || 22, '应收至镜头最小光圈');
  // 中等高度差：光圈应收小到刚好覆盖，且仍标记可行
  const rMid = E3.solve(Object.assign(base(), { heightDiff: 5 }));
  assert.strictEqual(rMid.lens.apMaxOk, true, '中等高度差应能收到合适光圈');
  assert.ok(rMid.lens.aperture >= r0.lens.aperture, '高度差越大光圈应收得越小');
  assert.ok(rMid.lens.dof >= 5, '景深应覆盖高度差');
});

test('lensLength：转接环加 12mm，大口径估算规则不变', () => {
  const E3 = EngineFactory(mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']));
  const ll = E3._internal.lensLength;
  const cLens = HIK.LENSES.find((l) => l.mount === 'C');
  assert.strictEqual(ll(cLens, true), ll(cLens, false) + 12, '转接应加 12mm');
  const big = HIK.LENSES.find((l) => l.mount === 'M72' || l.mount === 'M58');
  if (big && !big.len) assert.strictEqual(ll(big, false), (50 + 12), '缺长度的大口径镜头按系列典型值 +12');
});

// 数据完备性：所有品牌相机都必须带 mount（引擎对空 mount 判不兼容，缺了会被静默排除）
test('四品牌相机 mount 完备（无缺失，华睿单板补 C 口）', () => {
  const all = [].concat(HIK.CAMERAS, HUA.CAMERAS, BAS.CAMERAS, DAH.CAMERAS);
  const noMount = all.filter((c) => !c.mount);
  assert.strictEqual(noMount.length, 0, '缺 mount 的相机：' + noMount.slice(0, 5).map((c) => c.brand + ':' + c.model).join(', '));
  const board = HUA.CAMERAS.filter((c) => (c.series || '').indexOf('单板') >= 0);
  assert.ok(board.length > 0, '应有华睿单板相机');
  assert.ok(board.every((c) => c.mount === 'C'), '华睿单板相机应为 C 口');
});

test('手动指定华睿单板相机可解（修复前因无 mount 被静默排除）', () => {
  const CATm = mergeMulti(['hikrobot', 'huarui']);
  const Em = EngineFactory(CATm);
  const board = HUA.CAMERAS.find((c) => (c.series || '').indexOf('单板') >= 0);
  assert.ok(board, '应存在华睿单板相机');
  const inp = Object.assign(base(), { manualCamera: '华睿::' + board.model });
  const r = Em.solve(inp);
  assert.ok(r.ok, '手动指定单板相机应可解');
  assert.strictEqual(r.camera.model, board.model);
  assert.ok(r.lens && r.lens.model, '应配到镜头');
  assert.strictEqual(r.lens.mount, 'C', '应配 C 口镜头');
});

// 选优回归：自动推荐必须是库内可行方案中匹配分最高的（修复“第一个达标就返回”）
test('自动推荐的匹配分 ≥ 库内任何其他可行单相机方案', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const cases = [
    base(),
    Object.assign(base(), { task: 'precise_measure', precision: 0.02, wd: 250 }),
    Object.assign(base(), { speed: 400, heightDiff: 2, cpm: 60 })
  ];
  cases.forEach((inp) => {
    const r = E3.solve(inp);
    if (!r.ok || !r.feasible) return;
    let maxOther = 0, other = '';
    CAT3.CAMERAS.forEach((c) => {
      if (c.w < r.pxNeed.w || c.h < r.pxNeed.h) return;
      const rr = E3.solve(Object.assign({}, inp, { manualCamera: (c.brand ? c.brand + '::' : '') + c.model }));
      if (rr.ok && rr.feasible && rr.score > maxOther) { maxOther = rr.score; other = c.model; }
    });
    assert.ok(r.score >= maxOther,
      '推荐 ' + r.camera.model + ' score=' + r.score + ' 低于 ' + other + ' score=' + maxOther);
  });
});

console.log('\n[15] 备选方案与「备选」标注');
test('产出 ≤3 套备选方案，均为不同于最优的可行相机', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.ok && r.feasible, '默认场景应可行');
  assert.ok(Array.isArray(r.alternates), 'alternates 应为数组');
  assert.ok(r.alternates.length <= 3, '最多 3 套备选，实际 ' + r.alternates.length);
  const bestKey = (r.camera.brand || '') + '::' + r.camera.model;
  const pxAccReq = 0.1 / 3; // base(): precision 0.1, task defect k=3
  r.alternates.forEach((a) => {
    assert.notStrictEqual(a.cameraKey, bestKey, '备选不应等于最优相机');
    assert.ok(a.lensKey && a.lensKey.indexOf('::') >= 0, '备选应含「品牌::镜头」');
    assert.ok(a.pxAcc <= pxAccReq + 1e-6, '备选应满足像素精度，实际 ' + a.pxAcc);
  });
});

test('备选相机在同系列/跨品牌表被标 alt，最优相机不标', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  if (!r.alternates.length) return; // 无备选则无可标注
  const altKeys = r.alternates.map((a) => a.cameraKey);
  const bestKey = (r.camera.brand || '') + '::' + r.camera.model;
  const allCamRows = r.siblings.camera.items.concat(r.siblings.camera.crossBrand || []);
  const bestRow = allCamRows.find((x) => (x.brand || '') + '::' + x.model === bestKey);
  if (bestRow) assert.strictEqual(bestRow.alt, false, '最优相机不应标「备选」');
  const altMarked = allCamRows.filter((x) => x.alt);
  assert.ok(altMarked.length >= 1, '默认场景至少一个备选相机出现在面板并被标注');
  altMarked.forEach((x) =>
    assert.ok(altKeys.indexOf((x.brand || '') + '::' + x.model) >= 0, '标注的必须是备选相机，不能误标'));
});

test('手动指定相机后仍保留自动选型的备选（供对照）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const auto = E3.solve(base());
  const r = E3.solve(Object.assign(base(), { manualCamera: (auto.camera.brand || '') + '::' + auto.camera.model }));
  assert.strictEqual(r.manual.camera, true, '应处于手动指定状态');
  assert.strictEqual(r.alternates.length, auto.alternates.length, '手动指定不应清备空备选');
});

test('镜头备选：同相机、仍达标、与当前镜头不同，并出现在面板中被标注', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.ok && r.feasible);
  assert.ok(Array.isArray(r.lensAlternates), 'lensAlternates 应为数组');
  assert.ok(r.lensAlternates.length >= 1, '默认场景应有至少一支备选镜头');
  assert.ok(r.lensAlternates.length <= 3, '镜头备选最多 3 支');
  const curKey = (r.lens.brand || '') + '::' + r.lens.model;
  const pxAccReq = 0.1 / 3;
  r.lensAlternates.forEach((a) => {
    assert.notStrictEqual(a.lensKey, curKey, '备选镜头不应等于当前镜头');
    assert.ok(a.focal < 300 * 0.95, '备选镜头焦距须小于工作距离');
    assert.ok(a.pxAcc <= pxAccReq + 1e-6, '备选镜头自身也要满足像素精度，实际 ' + a.pxAcc);
  });
  // 面板标注：标 alt 的镜头必须来自备选集合，当前镜头不标
  const keys = r.lensAlternates.map((a) => a.lensKey);
  const rows = r.siblings.lens.items.concat(r.siblings.lens.crossBrand || []);
  rows.filter((x) => x.alt && !x.cur).forEach((x) =>
    assert.ok(keys.indexOf((x.brand || '') + '::' + x.model) >= 0, '标注的镜头必须在备选集合内'));
  assert.ok(rows.filter((x) => x.alt && !x.cur).length >= 1, '默认场景至少一支备选镜头出现在面板');
});

test('光源备选：同子类同颜色、尺寸够用不过分超配，并在面板被标注', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.lightAlternates), 'lightAlternates 应为数组');
  assert.ok(r.lightAlternates.length >= 1, '默认场景应有至少一款备选光源');
  assert.ok(r.lightAlternates.length <= 3, '光源备选最多 3 款');
  assert.ok(r.light.skuAlts && r.light.skuAlts.length === r.lightAlternates.length, '光源对象应带 skuAlts');
  const cur = r.light.sku;
  r.lightAlternates.forEach((a) => {
    assert.notStrictEqual(a.model, cur, '备选光源不应是当前型号');
    assert.ok(a.size && a.size[0] > 0, '备选光源应有尺寸');
  });
  // 面板标注
  const keys = r.lightAlternates.map((a) => (a.brand || '') + '::' + a.model);
  const marked = r.siblings.light.items.filter((x) => x.alt && !x.cur);
  assert.ok(marked.length >= 1, '光源表应有被标注的备选行');
  marked.forEach((x) => assert.ok(keys.indexOf((x.brand || '') + '::' + x.model) >= 0, '标注的光源必须在备选集合内'));
  // 当前光源行不标备选
  const curRows = r.siblings.light.items.filter((x) => x.cur);
  curRows.forEach((x) => assert.ok(!x.alt, '当前光源不应标备选'));
});

test('手动指定光源后按手动型号重新算备选', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const manualModel = 'PFM-HX10090CO40W';
  const r = E3.solve(Object.assign(base(), { manualLight: manualModel }));
  assert.strictEqual(r.manual.light, true, '应处于手动光源状态');
  assert.strictEqual(r.light.sku, manualModel);
  assert.ok(r.lightAlternates.every((a) => a.model !== manualModel), '备选不含当前手动型号');
});

test('手动指定别族光源时，同系列表按实际型号分族并标出备选', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  // 默认推荐条形光（bar_low），手动改成环形光 → 面板应切到环形光源同族
  const r = E3.solve(Object.assign(base(), { manualLight: 'PFM-HX10090CO40W' }));
  assert.strictEqual(r.manual.light, true);
  assert.strictEqual(r.siblings.light.label, '环形光源', '面板应按手动型号的子类分族，实际 ' + r.siblings.light.label);
  const curRow = r.siblings.light.items.find((x) => x.cur);
  assert.ok(curRow && curRow.model === 'PFM-HX10090CO40W', '当前型号应出现在表内');
  assert.ok(r.warnings.some((w) => /照明方式与推荐不同/.test(w.text)), '应提示照明方式与推荐不同');
  assert.ok(r.siblings.light.items.filter((x) => x.alt && !x.cur).length >= 1, '表内应有备选灯具');
});

console.log('\n[14] 3D 轮廓测量建议（高度 / 平面度任务）');
const CAT3D = Object.assign({}, HIK, { PROFILERS: HIK3D.PROFILERS });
const E3D = EngineFactory(CAT3D);
test('height 任务给出 3D 轮廓传感器建议且约束全部满足', () => {
  // 视野 60mm、精度 0.01mm(10µm)、WD 62mm（贴近 DP1060 参考距离 62? 实际 ref=35 或 62 系列）
  const r = E3D.solve(base({ task: 'height', fovW: 60, fovH: 20, precision: 0.01, wd: 190, heightDiff: 2 }));
  assert.ok(r.profile3D, '缺 3D 建议');
  const p = r.profile3D;
  const rec = HIK3D.PROFILERS.find((x) => x.model === p.model);
  assert.ok(rec, '推荐型号不在 3D 库中');
  const xm = parseFloat(rec.xRange), rp = parseFloat(rec.zRepeat);
  assert.ok(xm >= 60, 'X 测量范围应 ≥ 视野宽');
  assert.ok(rp <= 10, 'Z 重复精度应 ≤ 要求 10µm');
});
test('非 height 任务不产生 3D 建议', () => {
  const r = E3D.solve(base({ task: 'defect' }));
  assert.strictEqual(r.profile3D, null);
});
test('库内无 3D 目录时 height 任务不报错且建议为空', () => {
  const r = EngineFactory(HIK).solve(base({ task: 'height' }));
  assert.strictEqual(r.profile3D, null);
});

console.log('\n' + '='.repeat(52));
console.log(pass + ' 通过, ' + fail + ' 失败');
if (fail > 0) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(52) + '\n');
process.exit(fail > 0 ? 1 : 0);
