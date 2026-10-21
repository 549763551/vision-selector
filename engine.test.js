'use strict';

/**
 * 选型引擎测试（先写测试，再写实现）
 * 运行：node engine.test.js
 */

const assert = require('assert');
const Engine = require('./engine.js');

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

/** 基准场景：50×40mm 视野、0.1mm 最小缺陷、缺陷检测、WD300、金属高光面 */
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

console.log('\n[1] 精度换算与所需分辨率');
test('缺陷检测 k=3：像素精度 = δ/3，所需像素 1500×1200', () => {
  const r = Engine.solve(base());
  near(r.pxAccReq, 0.1 / 3, 1e-9, 'pxAccReq');
  assert.strictEqual(r.pxNeed.w, 1500);
  assert.strictEqual(r.pxNeed.h, 1200);
});

console.log('\n[2] 相机选型');
test('选到首个满足精度的相机：3MP 1/1.8" 2048×1536', () => {
  const r = Engine.solve(base());
  assert.match(r.camera.model, /3MP/);
  assert.strictEqual(r.camera.w, 2048);
  assert.strictEqual(r.camera.h, 1536);
  near(r.camera.pxAcc, 0.026618, 0.0001, '有效像素精度');
});

console.log('\n[3] 镜头选型');
test('焦距取 35mm，并反算放大倍率与实际视场', () => {
  const r = Engine.solve(base());
  assert.strictEqual(r.lens.f, 35);
  near(r.lens.fReq, 35.683, 0.02, '需求焦距');
  near(r.lens.m, 0.132075, 1e-5, '实际放大倍率');
  near(r.lens.fovH, 40.886, 0.01, '实际视场高');
  near(r.lens.fovW, 54.514, 0.01, '实际视场宽');
});

console.log('\n[4] 景深与光圈');
test('高度差 1mm → 光圈 F4，景深约 3.65mm', () => {
  const r = Engine.solve(base());
  assert.strictEqual(r.lens.aperture, 4);
  near(r.lens.dof, 3.65, 0.02, '景深');
});

console.log('\n[5] 曝光与运动模糊');
test('100mm/s → 曝光上限 0.266ms，光源需频闪', () => {
  const r = Engine.solve(base({ speed: 100 }));
  near(r.exposure.tMaxMs, 0.266, 0.005, '最大曝光');
  assert.match(r.light.controller, /频闪/);
});

console.log('\n[6] 帧率与数据带宽');
test('3fps、9.44MB/s → 千兆网接口', () => {
  const r = Engine.solve(base({ speed: 100 }));
  assert.strictEqual(r.camera.fps, 3);
  near(r.camera.bandwidthMBps, 9.437, 0.01, '带宽');
  assert.match(r.camera.interface, /GigE|千兆/);
});

console.log('\n[7] 精度系数随任务变化');
test('精密测量 k=5：20×15mm 视野选到 6MP', () => {
  const r = Engine.solve(base({ fovW: 20, fovH: 15, precision: 0.05, task: 'precise_measure' }));
  assert.match(r.camera.model, /6MP/);
  assert.ok(r.camera.pxAcc <= 0.01 + 1e-9, '像素精度应 ≤ 0.01mm/px，实际 ' + r.camera.pxAcc);
});

console.log('\n[8] 光源选型');
test('尺寸测量 → 背光', () => {
  const r = Engine.solve(base({ task: 'measure', material: 'metal_matte' }));
  assert.strictEqual(r.light.type, 'backlight');
});

test('金属高光面缺陷 → 低角度条形暗场 + 短波蓝光 + 偏振', () => {
  const r = Engine.solve(base({ task: 'defect', material: 'metal_shiny' }));
  assert.strictEqual(r.light.type, 'bar_low');
  assert.match(r.light.wavelength, /450nm/);
  assert.ok(r.light.accessories.some((a) => /偏振/.test(a)), '应建议偏振片');
});

test('镜面件做有无判断 → 圆顶无影光', () => {
  const r = Engine.solve(base({ task: 'presence', material: 'metal_shiny' }));
  assert.strictEqual(r.light.type, 'dome');
});

test('OCR → 同轴光', () => {
  const r = Engine.solve(base({ task: 'ocr', material: 'plastic' }));
  assert.strictEqual(r.light.type, 'coaxial');
});

test('目标颜色为黄 → 同色黄光提亮（590nm）', () => {
  const r = Engine.solve(base({ colorTarget: 'yellow' }));
  assert.match(r.light.wavelength, /590nm/);
});

test('需要彩色还原 → 白光', () => {
  const r = Engine.solve(base({ needColor: true }));
  assert.match(r.light.wavelength, /5500K/);
});

console.log('\n[9] 输出字段');
test('输出精度余量（相对需求像素精度的富余比例）', () => {
  const r = Engine.solve(base());
  near(r.margin, 0.2015, 0.001, '精度余量');
});

console.log('\n[10] 边界与异常');
test('超出单相机能力 → feasible=false 并建议线扫/多相机', () => {
  const r = Engine.solve(base({ fovW: 500, fovH: 400, precision: 0.01 }));
  assert.strictEqual(r.feasible, false);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.warnings.some((w) => /线扫|多相机|拼接/.test(w.text)), '应给出升级建议');
});

test('非法输入（精度为 0）返回明确错误而不崩溃', () => {
  const r = Engine.solve(base({ precision: 0 }));
  assert.strictEqual(r.ok, false);
  assert.ok(/精度/.test(r.error), '错误信息应指明精度问题');
});

test('匹配度落在 0~100 之间', () => {
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
