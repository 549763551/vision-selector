'use strict';

/**
 * 工程计算器公式测试：与选型引擎口径对齐 + 17 个公式的数值回归
 * 运行：node calc.test.js
 */

const assert = require('assert');
const C = require('./calc-engine.js');
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
function near(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= (eps == null ? 1e-6 : eps),
    (msg || '') + ' 期望 ' + b + '，实际 ' + a);
}
function calc(id, over) {
  return C.compute(id, Object.assign({}, C.defaults(id), over || {}));
}
function clean(o) {
  assert.ok(!/NaN|undefined|Infinity/.test(JSON.stringify(o)), '结果里不能出现 NaN / undefined / Infinity');
}

console.log('\n工程计算器公式测试\n' + '='.repeat(52));

/* ---------------- 元数据与计算器语义 ---------------- */

test('注册 17 个公式 / 4 个分组，id 唯一', () => {
  assert.strictEqual(C.FORMULAS.length, 17);
  assert.strictEqual(C.GROUPS.length, 4);
  const ids = C.FORMULAS.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  C.FORMULAS.forEach((f) => {
    assert.ok(C.GROUPS.some((g) => g.id === f.group), f.id + ' 分组未登记');
    assert.ok(f.title && f.sym && f.inputs.length, f.id + ' 元数据不全');
    assert.strictEqual(typeof f.run, 'function');
  });
});

test('空输入不计算：返回缺口清单，不带任何隐式默认值', () => {
  const o = C.compute('pxacc', {});
  assert.ok(o.incomplete && o.error);
  assert.deepStrictEqual(o.incomplete, ['最小特征 δ', '检测任务']);
  assert.ok(!o.steps, '缺参数时不应产生结果');
});

test('缺一项就拦住，填齐才出结果', () => {
  const partial = C.compute('pxacc', { precision: 0.15 });
  assert.ok(partial.incomplete, '缺 task 应拦住');
  assert.deepStrictEqual(partial.incomplete, ['检测任务']);
  const full = C.compute('pxacc', { precision: 0.15, task: 'defect' });
  assert.ok(!full.error && full.steps.length === 1);
});

test('复选项不勾选不算缺参数（默认 false）', () => {
  const o = C.compute('resolution', { fovW: 60, fovH: 45, precision: 0.15, task: 'defect' });
  assert.ok(!o.error, o.error);
  near(o.steps[1].raw, 1200, 1e-9, '黑白所需水平像素');
});

test('未知公式报错，不抛异常', () => {
  const o = C.compute('no_such_formula', {});
  assert.ok(o.error && /未知公式/.test(o.error));
});

test('每个公式都能算出「公式 / 代入 / 结果 / 单位」且无坏数字', () => {
  C.FORMULAS.forEach((f) => {
    const o = calc(f.id);
    assert.ok(!o.error, f.id + '：' + o.error);
    assert.ok(o.steps.length >= 1, f.id + ' 无步骤');
    assert.ok(o.text.indexOf(f.sym) >= 0, f.id + ' 文本缺公式');
    o.steps.forEach((s) => {
      assert.ok(s.label && s.sym !== undefined && s.value !== undefined, f.id + ' 步骤字段不全');
    });
    clean(o);
  });
});

/* ---------------- 与选型引擎口径一致 ---------------- */

test('k 表与 engine.js 完全一致', () => {
  Object.keys(C.CONST.TASKS).forEach((k) => {
    assert.ok(Engine.TASKS[k], 'engine 缺任务 ' + k);
    assert.strictEqual(C.CONST.TASKS[k].k, Engine.TASKS[k].k, k + ' 的 k 不一致');
  });
});

test('接口有效带宽 = 线速 × 0.85，与 engine.js 相同', () => {
  Object.keys(C.CONST.IFACE_BW).forEach((iface) => {
    assert.strictEqual(C.core.ifaceCap(iface), Engine._internal.ifaceCapOf(iface), iface);
  });
  assert.strictEqual(C.core.ifaceCap('GigE'), 93.5);
  assert.strictEqual(C.core.ifaceCap('10GigE'), 935);
  assert.strictEqual(C.core.ifaceCap('未知接口'), 350 * 0.85);
});

test('光圈档 / 焦距档 / 波长 / 弥散圆常量与文档一致', () => {
  assert.deepStrictEqual(C.CONST.APERTURES, [2.8, 4, 5.6, 8, 11, 16, 22]);
  assert.deepStrictEqual(C.CONST.FOCAL_LADDER, [6, 8, 12, 16, 20, 25, 35, 50, 75, 100]);
  assert.strictEqual(C.CONST.LAMBDA_UM, 0.55);
  assert.strictEqual(C.CONST.COC_PIXELS, 2);
  assert.strictEqual(C.CONST.BAYER_FACTOR, 1.2);
  assert.strictEqual(C.CONST.IFACE_EFF, 0.85);
});

test('底层口径：像素精度 / 倍率 / 焦距 / 实际视场', () => {
  const p = { precision: 0.15, task: 'defect', fovW: 60, fovH: 45, wd: 250, sw: 7.2, sh: 5.4 };
  near(C.core.pxAccReqOf(p), 0.05);
  near(C.core.magNeedOf(p).m, 0.12);
  assert.strictEqual(C.core.magNeedOf(p).limitedBy, '宽');
  near(C.core.focalReqOf(0.12, 250), 250 * 0.12 / 1.12);
  near(C.core.magActualOf(25, 250), 25 / 225);
  assert.strictEqual(C.core.magActualOf(300, 250), null, 'WD ≤ f 应为 null');
  const m = C.core.magActualOf(25, 250);
  const fov = C.core.fovActualOf(p, m);
  near(fov.w, 64.8); near(fov.h, 48.6);
});

test('标准焦距档：取 ≤ 理论值的最大档，边界有标记', () => {
  assert.strictEqual(C.core.ladderOf(26.78).pick, 25);
  assert.strictEqual(C.core.ladderOf(5).pick, 6);
  assert.strictEqual(C.core.ladderOf(5).belowMin, true);
  assert.strictEqual(C.core.ladderOf(120).pick, 100);
  assert.strictEqual(C.core.ladderOf(120).aboveMax, true);
});

/* ---------------- 逐式数值回归 ---------------- */

test('① 像素精度：δ/k = 0.15/3 = 0.05 mm/px', () => {
  const o = calc('pxacc');
  near(o.result.value, 0.05);
  assert.strictEqual(o.result.unit, 'mm/px');
  assert.strictEqual(o.steps[0].ok, true);
});

test('② 所需分辨率：1200 × 900 px（彩色 ×1.2 → 1440 × 1080）', () => {
  const o = calc('resolution');
  assert.strictEqual(o.steps[1].raw, 1200);
  assert.strictEqual(o.steps[2].raw, 900);
  near(o.result.value, 1.08);
  const color = calc('resolution', { needColor: true });
  assert.strictEqual(color.steps[1].raw, 1440);
  assert.strictEqual(color.steps[2].raw, 1080);
});

test('③ 所需放大倍率：min(靶面/视野)，取受限边', () => {
  const o = calc('magnification');
  near(o.result.value, 0.12);
  assert.ok(/宽/.test(o.verdict));
});

test('④ 所需焦距：WD·m/(1+m) → 26.79mm，选 25mm 标准档', () => {
  const o = calc('focal');
  near(o.steps[1].raw, 26.7857142857, 1e-8);
  assert.strictEqual(o.result.value, 25);
});

test('⑤ 实际视场：f/(WD−f) 反算 64.8 × 48.6 mm', () => {
  const o = calc('fov');
  near(o.steps[1].raw, 64.8);
  near(o.steps[2].raw, 48.6);
  assert.strictEqual(o.tone, 'ok', '默认工况应覆盖需求视野');
});

test('⑤b 工作距离不大于焦距时明确判不可行', () => {
  const o = calc('fov', { focal: 300, wd: 250 });
  assert.strictEqual(o.tone, 'bad');
  assert.strictEqual(o.steps[0].ok, false);
});

test('⑥ 有效像素精度与余量：0.02647 mm/px，余量 47%', () => {
  const o = calc('pxeff');
  near(o.result.value, 0.0264705882, 1e-8);
  near(o.steps[4].raw, 47.0588235, 1e-6);
  assert.strictEqual(o.steps[3].ok, true);
});

test('⑦ 工作距离反算：f·(1+m)/m = 233.33mm', () => {
  const o = calc('wd');
  near(o.result.value, 233.3333333, 1e-6);
});

test('⑧ 景深与衍射：2·F·c·(1+m)/m² 与 2.44λF/像元', () => {
  const o = calc('dof');
  near(o.steps[0].raw, 0.0069, 1e-9, '弥散圆 mm');
  near(o.result.value, 6.96843438, 1e-6);
  near(o.steps[2].raw, 2.17831884, 1e-6, '艾里斑 px');
  assert.ok(o.steps.some((s) => /收一档/.test(s.label)), '应给出下一档光圈');
});

test('⑨ 曝光上限：像素精度 / 速度 × 1000，模糊 ≤ 1px', () => {
  const o = calc('exposure');
  near(o.result.value, 0.265, 1e-9);
  near(o.steps[2].raw, 1, 1e-9, '该曝光下模糊量');
  assert.ok(o.tone === 'warn', '< 1ms 应提示频闪');
  const still = calc('exposure', { speed: 0 });
  assert.ok(/静态/.test(still.verdict));
  assert.strictEqual(still.result.value, null);
});

test('⑩ 帧率：运动按 v/视场高 ×1.2，静态默认 15fps', () => {
  const o = calc('fps');
  assert.strictEqual(o.result.value, 3);
  near(o.steps[2].raw, 1, 1e-9, '60 件/分 = 1 件/s');
  assert.strictEqual(calc('fps', { speed: 0, cpm: 0 }).result.value, 15);
});

test('⑪ 精度预算：四项均方根合成，无畸变数据按 0.5px 估', () => {
  const o = calc('budget');
  near(o.result.value, 0.0334152286, 1e-8);
  assert.strictEqual(o.steps.length, 6);
  assert.strictEqual(o.tone, 'ok');
  const worse = calc('budget', { pxAcc: 0.09 });
  assert.strictEqual(worse.tone, 'bad', '超差应判不可行');
});

test('⑫ 带宽：75.20256 MB/s ≤ GigE 有效 93.5 MB/s', () => {
  const o = calc('bandwidth');
  near(o.result.value, 75.20256, 1e-6);
  near(o.steps[2].raw, 93.5, 1e-9);
  assert.strictEqual(o.tone, 'ok');
  const over = calc('bandwidth', { fps: 60 });
  assert.strictEqual(over.tone, 'bad');
  assert.ok(over.warnings.length > 0);
});

test('⑬ 安装空间：WD + 镜头 + 相机 + 25 线缆', () => {
  const o = calc('space');
  assert.strictEqual(o.result.value, 370);
  assert.strictEqual(o.steps[2].raw, 420, '含支架 40 + 调整 10');
  assert.strictEqual(calc('space', { freeSpace: 300 }).tone, 'bad');
});

test('⑭ 线扫行频：v/(δ/k)/1000 = 10kHz，含余量 12kHz', () => {
  const o = calc('linescan');
  near(o.result.value, 10, 1e-9);
  near(o.steps[2].raw, 12, 1e-9);
  near(o.steps[3].raw, 57.67168, 1e-5, '像面宽 mm');
});

test('⑮ 远心倍率：0.24×，WD 区间越界判不可行', () => {
  const o = calc('telecentric');
  near(o.result.value, 0.24);
  assert.strictEqual(o.steps[3].ok, null, '未填区间不判定');
  const bad = calc('telecentric', { wdMin: 60, wdMax: 100 });
  assert.strictEqual(bad.tone, 'bad');
  assert.strictEqual(bad.steps[3].ok, false);
});

test('⑯ 照明规则表：金属高光 + 缺陷 → 暗场条形光 + 偏振', () => {
  const o = calc('lighting');
  assert.ok(/低角度条形光/.test(o.result.value));
  assert.ok(/蓝光 450nm/.test(o.steps[1].value));
  const red = calc('lighting', { colorTarget: 'red' });
  assert.ok(/红光 625nm/.test(red.steps[1].value));
  assert.ok(/青光 490nm/.test(red.steps[2].value));
});

test('⑰ 单位速查：0.05mm = 50µm = 1px', () => {
  const o = calc('unit');
  near(o.steps[1].raw, 50, 1e-9);
  near(o.steps[4].raw, 1, 1e-9);
  near(o.steps[5].raw, 1000 / 30, 1e-9);
  near(o.steps[6].raw, 1800, 1e-9);
});

test('复制文本：含公式、代入、结果与结论，可直接贴方案', () => {
  const o = calc('bandwidth');
  assert.ok(o.text.indexOf(o.sym) >= 0 || o.text.indexOf('公式') >= 0);
  assert.ok(/75\.2026|75\.2/.test(o.text), '文本应含结果');
  assert.ok(/结论/.test(o.text));
  assert.ok(o.text.indexOf('输入：') >= 0, '文本应含输入摘要');
});

console.log('\n' + '='.repeat(52));
console.log(pass + ' 通过, ' + fail + ' 失败');
if (fail > 0) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(52) + '\n');
process.exit(fail > 0 ? 1 : 0);
