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

console.log('\n' + '='.repeat(52));
console.log(pass + ' 通过, ' + fail + ' 失败');
if (fail > 0) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(52) + '\n');
process.exit(fail > 0 ? 1 : 0);
