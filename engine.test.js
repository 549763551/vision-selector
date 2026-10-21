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

console.log('\n[7] 边界');
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
