'use strict';

/**
 * 选型引擎测试：基于海康机器人真实型号库
 * 运行：node js/engine.test.js
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
  const fam = (m) => ({ 'C': 'C', 'M12': 'M12', 'F': 'F', 'M42': 'F', 'M42/F': 'F', 'M58': 'M58', 'M72': 'M72', 'M90': 'M90' })[m];
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

test('核查清单：常规需求 9 项全通过，与扣分项同源', () => {
  const r = Engine.solve(base());
  const chk = r.checks;
  assert.ok(Array.isArray(chk), 'checks 不是数组');
  // 「曝光上限」与「最短曝光」原本是同一件事的两条，已合并成一条（否则一项不足会扣两次分）
  assert.strictEqual(chk.length, 9, '核查项数 ' + chk.length);
  assert.strictEqual(chk.filter((c) => c.ok).length, 9, '全通过时应有 9 项 ok');
  assert.strictEqual(r.scoreItems.length, 0, '全通过时不应有扣分项');
  chk.forEach((c) => {
    assert.ok(typeof c.label === 'string' && c.label, '核查项缺少名称');
    assert.ok(c.label.indexOf('不足') < 0 && c.label.indexOf('超限') < 0,
      '核查项名称应为中性描述，实际 ' + c.label);
  });
});

test('曝光上限只跟相机最短曝光比：高速场景不因「< 1 ms」被判未通过', () => {
  // 0.0375 mm/px × 200 mm/s → 上限 0.19 ms，任何相机都达不到 1 ms；频闪要求归现场参数与风险提示
  const r = Engine.solve(base({ fovW: 60, fovH: 45, precision: 0.15, task: 'ocr', wd: 200, speed: 200 }));
  const ex = r.checks.filter((c) => c.label === '曝光上限')[0];
  assert.ok(ex, '应有曝光上限核查项');
  assert.ok(ex.ok, '高速短曝光不应判未通过，实际 ' + ex.detail);
  assert.ok(r.checks.filter((c) => c.label === '最短曝光').length === 0, '不应再有重复的「最短曝光」项');
  assert.strictEqual(r.checks.filter((c) => !c.ok).length, 0, '该场景应 9 项全通过');
  assert.ok(r.warnings.some((w) => /频闪/.test(w.text)), '频闪要求仍应在风险提示里');
});

test('衍射上限 3 px：收光圈换景深不再一律判未通过', () => {
  // 40 mm 幅面 + 1 mm 高度差：F5.6 才够景深，2.5 µm 像元下衍射 3.0 px
  const r = Engine.solve(base({ fovW: 40, fovH: 30, precision: 0.05, task: 'measure', wd: 260, material: 'glass', heightDiff: 1 }));
  const d = r.checks.filter((c) => c.label === '衍射')[0];
  assert.ok(d, '应有衍射核查项');
  assert.ok(d.ok, '3.0 px 应落在 3 px 上限内，实际：' + d.detail);
});

test('核查清单：不达标时扣分项与未通过项对得上', () => {
  // 精度要求远超型号库能力 → 必有未通过的核查项，且扣分项数量与之一致
  const r = Engine.solve(base({ precision: 0.0005 }));
  assert.ok(r.checks.length >= 9, '核查项数 ' + r.checks.length);
  const bad = r.checks.filter((c) => !c.ok).length;
  assert.strictEqual(bad, r.scoreItems.length, '未通过 ' + bad + ' 项，扣分项 ' + r.scoreItems.length + ' 项');
  assert.ok(bad > 0, '极端需求下应有未通过项');
});

// ---------------- 多品牌（华睿 + Basler） ----------------
// 引擎在 Node require 下只导出"绑定海康库的实例"，无法换目录重建；
// 多品牌需要工厂函数，故用 vm 在全局作用域加载（走浏览器分支，挂 VisionEngineFactory）。
const vm = require('vm');
const fs = require('fs');
function loadGlobal(f) { vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); }
loadGlobal('./js/brands.js');
loadGlobal('./js/hikrobot-catalog.js');
loadGlobal('./js/hikrobot-3d-catalog.js');
loadGlobal('./js/huarui-catalog.js');
loadGlobal('./js/basler-catalog.js');
loadGlobal('./js/daheng-catalog.js');
loadGlobal('./js/opt-catalog.js');
loadGlobal('./js/engine.js');
const EngineFactory = global.VisionEngineFactory;
const HIK = global.HikrobotCatalog;
const HIK3D = global.Hikrobot3DCatalog;
const HUA = global.HuaruiCatalog;
const BAS = global.BaslerCatalog;
const DAH = global.DahengCatalog;
const OPT = global.OptCatalog;

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
  if (brands.indexOf('opt') >= 0)
    OPT.CAMERAS.forEach((x) => cam.push(Object.assign({}, x, { brand: x.brand || '奥普特 OPT' })));
  // 镜头品牌：默认合并全部有镜头的品牌（与顶栏“镜头品牌筛选”默认全选一致）；可单独指定
  const lb = lensBrands || ['hikrobot', 'huarui', 'daheng'];
  let lenses = [];
  if (lb.indexOf('hikrobot') >= 0)
    lenses = lenses.concat(HIK.LENSES.map((x) => Object.assign({}, x, { brand: '海康机器人 HIKROBOT' })));
  if (lb.indexOf('huarui') >= 0)
    lenses = lenses.concat(HUA.LENSES.map((x) => Object.assign({}, x, { brand: '华睿' })));
  if (lb.indexOf('daheng') >= 0)
    lenses = lenses.concat(DAH.LENSES.map((x) => Object.assign({}, x, { brand: '大恒图像' })));
  // 线扫：与 app.js 一致，按品牌补齐 brand（引擎输出的线扫要能看出是谁家的）
  let linescan = [];
  const stamp = (arr, name) => arr.forEach((x) => { if (!x.brand) x.brand = name; linescan.push(x); });
  if (brands.indexOf('hikrobot') >= 0) stamp(HIK.LINESCAN, '海康机器人 HIKROBOT');
  if (brands.indexOf('huarui') >= 0) stamp(HUA.LINESCAN, '华睿');
  if (brands.indexOf('basler') >= 0) stamp(BAS.LINESCAN, 'Basler');
  if (brands.indexOf('opt') >= 0) stamp(OPT.LINESCAN, '奥普特 OPT');
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
  // 远心：海康手册 + 大恒型录（大恒远心按品牌标注，便于跨品牌等价对比）
  const tele = HIK.TELECENTRIC.map((x) => Object.assign({}, x, { brand: x.brand || '海康机器人 HIKROBOT' }))
    .concat(DAH.TELECENTRIC.map((x) => Object.assign({}, x, { brand: x.brand || '大恒图像' })));
  return {
    META: { brand: '多品牌' },
    CAMERAS: cam,
    LINESCAN: linescan,
    LENSES: lenses,
    TELECENTRIC: tele,
    LIGHTS: lights,
    CONTROLLERS: ctrls
  };
}

test('多品牌目录合并 = 海康406 + 华睿300 + Basler474 + 大恒688 + 奥普特118', () => {
  const CAT5 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng', 'opt']);
  assert.strictEqual(CAT5.CAMERAS.length, 1986, '合并后相机数');
  const byBrand = {};
  CAT5.CAMERAS.forEach((c) => { byBrand[c.brand] = (byBrand[c.brand] || 0) + 1; });
  assert.strictEqual(byBrand['海康机器人 HIKROBOT'], 406);
  assert.strictEqual(byBrand['华睿'], 300);
  assert.strictEqual(byBrand['Basler'], 474);
  assert.strictEqual(byBrand['大恒图像'], 688);
  assert.strictEqual(byBrand['奥普特 OPT'], 118);
});

test('奥普特型录：字段完整、靶面与像元×分辨率自洽、线阵行频齐全', () => {
  assert.strictEqual(OPT.CAMERAS.length, 118, '面阵数');
  assert.strictEqual(OPT.LINESCAN.length, 24, '线阵数');
  // 引擎算靶面对角线只用 sw/sh（不用 size 字符串），因此这两项必须齐全且与标称靶面一致
  const STD = { '1/4': 4, '1/3': 5.33, '1/2.9': 5.52, '1/2.8': 5.71, '1/2.7': 5.93, '1/2.5': 6.4,
    '1/2.3': 6.96, '1/2.2': 7.27, '1/2': 8, '1/1.8': 8.89, '1/1.7': 9.41, '1/1.6': 10,
    '1/1.4': 11.43, '1/1.2': 13.33, '2/3': 10.67, '1': 16, '1.1': 17.6, '1.2': 19.2,
    '4/3': 21.33, '1.8': 28.8, '2.3': 36.8 };
  OPT.CAMERAS.forEach((c) => {
    assert.ok(c.w > 0 && c.h > 0, c.model + ' 分辨率');
    assert.ok(c.pxUm > 0, c.model + ' 像元');
    assert.ok(c.sw > 0 && c.sh > 0, c.model + ' 传感器尺寸');
    assert.ok(Math.abs(c.sw - c.w * c.pxUm / 1000) < 0.01, c.model + ' sw 与 w×px 不符');
    assert.ok(['USB3', 'GigE', '10GigE', '2.5GigE', 'CoaXPress', 'CameraLink'].indexOf(c.iface) >= 0,
      c.model + ' 接口未归一：' + c.iface);
    assert.ok(c.mount && !/Mount/.test(c.mount), c.model + ' 镜头口未归一：' + c.mount);
    assert.ok(c.fps > 0, c.model + ' 帧率');
    if (c.size && c.size.indexOf('mm') < 0) {
      const k = c.size.replace(/"/g, '');
      const inch = (k.indexOf('/') >= 0 ? (function () { const p = k.split('/'); return p[0] / p[1]; })() : Number(k)) * 16;
      const diag = Math.sqrt(c.sw * c.sw + c.sh * c.sh);
      assert.ok(Math.abs(inch - diag) / Math.max(inch, diag) < 0.12,
        c.model + ' 靶面 ' + c.size + ' 与对角线 ' + diag.toFixed(2) + 'mm 差太多');
      assert.ok(STD[k] != null, c.model + ' 靶面档位不认识：' + k);
    }
  });
  OPT.LINESCAN.forEach((l) => {
    assert.ok(l.w >= 512 && l.pxH > 0 && l.lineRate > 0, l.model + ' 线阵基本字段');
    assert.ok(['GigE', '10GigE', 'CoaXPress', 'CameraLink'].indexOf(l.iface) >= 0,
      l.model + ' 线阵接口未归一：' + l.iface);
    assert.ok(l.mount && !/Mount/.test(l.mount), l.model + ' 线阵镜头口未归一');
  });
});

test('镜头库合并 = 海康101 + 华睿69 + 大恒578；线扫 = 海康33 + 华睿26 + Basler27', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  assert.strictEqual(CAT3.LENSES.length, 748, '合并后镜头数');
  assert.strictEqual(CAT3.LINESCAN.length, 86, '合并后线扫数');
  const lb = {};
  CAT3.LENSES.forEach((l) => { lb[l.brand] = (lb[l.brand] || 0) + 1; });
  assert.strictEqual(lb['海康机器人 HIKROBOT'], 101);
  assert.strictEqual(lb['华睿'], 69);
  assert.strictEqual(lb['大恒图像'], 578);
  // 镜头输出对象带 brand
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(base());
  assert.ok(r.lens.brand, '镜头输出应带 brand');
  assert.ok(r.light.skuBrand, '光源输出应带 brand');
  // 同系列面板镜头/光源行带品牌
  assert.ok(r.siblings.lens.items.every((x) => x.brand != null), '镜头 siblings 应带 brand');
  assert.ok(r.siblings.light.items.every((x) => x.brand != null), '光源 siblings 应带 brand');
});

test('大恒镜头字段合规（焦距/光圈/卡口/像面）', () => {
  DAH.LENSES.forEach((l) => {
    assert.ok(l.focal > 0, l.model + ' 焦距');
    // 手册 MPW2-R 等表只印最小光圈（F2.4），未印范围；引擎按 F22 兜底
    assert.ok(l.fmin > 0 && (l.fmax == null || l.fmax >= l.fmin), l.model + ' 光圈');
    assert.ok(['C', 'F', 'V38', 'M42'].indexOf(l.mount) >= 0, l.model + ' 卡口');
    // 像面直径只有部分系列印在手册里；未印时引擎按大靶面放行，这里只要求给了就必须是正数
    assert.ok(l.ic == null || l.ic > 0, l.model + ' 像面');
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
  assert.strictEqual(CATd.LENSES.length, 578, '仅大恒镜头');
  const Ed = EngineFactory(CATd);
  const r = Ed.solve(base());
  assert.ok(r.ok, '仅大恒镜头可解');
  assert.strictEqual(r.lens.brand, '大恒图像');
});

test('固定光圈镜头（手册只印一档）不推荐它做不到的光圈', () => {
  const fixed = DAH.LENSES.filter((l) => l.fmin != null && l.fmax == null);
  assert.ok(fixed.length > 100, '大恒固定光圈镜头应已入库，实际 ' + fixed.length);
  const sample = fixed.filter((l) => l.mount === 'C' && l.focal === 10.5)[0] || fixed[0];
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const E3 = EngineFactory(CAT3);
  const r = E3.solve(Object.assign(base(), { manualLens: '大恒图像::' + sample.model }));
  assert.ok(r.ok, '固定光圈镜头手动指定应可解：' + sample.model);
  assert.strictEqual(r.lens.model, sample.model, '应选中手动指定的镜头');
  assert.strictEqual(r.site.aperture.value, sample.fmin,
    '推荐光圈只能是手册那一档 F' + sample.fmin + '，实际 F' + r.site.aperture.value);
  assert.strictEqual(r.site.aperture.stop, null, '固定光圈没有「再收一档」');
  assert.ok(/固定光圈/.test(r.site.aperture.note), '现场说明应点明固定光圈，实际：' + r.site.aperture.note);
});

test('大恒相机核心字段齐全（分辨率/帧率/像元/接口/快门）', () => {
  DAH.CAMERAS.forEach((c) => {
    assert.ok(c.w > 0 && c.h > 0, c.model + ' 分辨率');
    assert.ok(c.fps > 0, c.model + ' 帧率');
    assert.ok(c.pxUm > 0, c.model + ' 像元');
    assert.ok(['GigE', '10GigE', 'USB3', 'CoaXPress', 'CameraLink', 'XoCLink', 'XoFLink', 'Serdes'].indexOf(c.iface) >= 0, c.model + ' 接口 ' + c.iface);
    assert.ok(['Global', 'Rolling'].indexOf(c.shutter) >= 0, c.model + ' 快门');
    assert.ok(['C', 'M42/F', 'M42', 'M12', 'Bare', 'M58', 'M72', 'M90', 'F'].indexOf(c.mount) >= 0, c.model + ' 卡口 ' + c.mount);
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
  assert.ok(r.siblings.lens.crossBrand.some((x) => x.brand === '大恒图像'), '应能给出大恒的等价镜头');
  r.siblings.lens.crossBrand.forEach((x) => {
    assert.notStrictEqual(x.brand, r.lens.brand, '候选应来自其他品牌');
    assert.strictEqual(x.mount, r.lens.mount, '候选应与当前镜头同卡口');
    assert.ok(Math.abs(x.focal - r.lens.f) / r.lens.f <= 0.12, '候选焦距应与当前接近');
  });
  // 华睿镜头入库后，跨品牌候选不止大恒一家；面板要按品牌铺开，不能让型号最多的一家占满
  const cb = {};
  r.siblings.lens.crossBrand.forEach((x) => { cb[x.brand] = (cb[x.brand] || 0) + 1; });
  assert.ok(Object.keys(cb).length >= 2, '跨品牌候选应覆盖至少两家，实际 ' + Object.keys(cb).join('/'));
  assert.ok(r.siblings.lens.crossBrand.length <= 12, '跨品牌面板总数不超过 12');
  // 每家 = 铺开 3 支 + 至多 3 支备选补位
  Object.keys(cb).forEach((b) => assert.ok(cb[b] <= 6, b + ' 单家最多 6 支，实际 ' + cb[b]));
});

test('推荐结果与运行环境 locale 无关（排序不得依赖 localeCompare）', () => {
  const CAT3 = mergeMulti(['hikrobot', 'huarui', 'basler', 'daheng']);
  const snap = (r) => JSON.stringify({
    cam: [r.camera.brand, r.camera.model],
    lens: [r.lens.brand, r.lens.model],
    cross: r.siblings.lens.crossBrand.map((x) => x.brand + '::' + x.model),
    alts: r.lensAlternates.map((x) => x.lensKey)
  });
  const orig = String.prototype.localeCompare;
  const zh = snap(EngineFactory(CAT3).solve(base()));
  // 中文系统按拼音排（大恒 < 华睿），英文/CI 环境按 root 序列（华睿 < 大恒）：
  // 若排序依赖 locale，同一需求在两台机器上会给出不同的镜头候选。
  String.prototype.localeCompare = function (b) {
    const s = String(this); b = String(b);
    return s < b ? -1 : s > b ? 1 : 0;
  };
  let ascii;
  try { ascii = snap(EngineFactory(CAT3).solve(base())); } finally { String.prototype.localeCompare = orig; }
  assert.strictEqual(ascii, zh, '换排序环境后推荐结果发生变化');
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
  // 反向：选定大恒镜头后，跨品牌表应给出其他品牌的等价候选（镜头池含海康/华睿/大恒）
  assert.ok(r.siblings.lens.crossTotal >= 1, '反向跨品牌候选应存在');
  assert.ok(r.siblings.lens.crossBrand.every((x) => x.brand !== '大恒图像'), '反向候选不应出现当前品牌自身');
  assert.ok(r.siblings.lens.crossBrand.some((x) => x.brand === '海康机器人 HIKROBOT'), '反向候选应含海康');
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
  assert.strictEqual(mm('M90', 'C'), 2, 'M90 相机（线扫大口径）可转接 C 口镜头');
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
  // 固定光圈镜头（手册只印一档）可收的「最小光圈」就是它自己那一档，没有 fmax 字段
  assert.strictEqual(rBig.lens.aperture, rBig.lens.fmax || rBig.lens.fmin || 22, '应收至镜头最小光圈');
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

console.log('\n[16] 自定义搭配评定（evaluateCombo）');

function comboOf(r) {
  return {
    camera: (r.camera.brand ? r.camera.brand + '::' : '') + r.camera.model,
    lens: (r.lens.brand ? r.lens.brand + '::' : '') + r.lens.model,
    light: r.light.sku ? (r.light.skuBrand ? r.light.skuBrand + '::' : '') + r.light.sku : null,
  };
}
function checkOf(ev, label) {
  return ev.checks.filter((c) => c.label === label)[0];
}

test('自动方案自评：分数与 solve 完全一致，等级 A', () => {
  [
    base(),
    base({ task: 'precise_measure', fovW: 20, fovH: 15, precision: 0.05, wd: 250, material: 'metal_matte', heightDiff: 0.5 }),
    base({ task: 'ocr', fovW: 60, fovH: 45, precision: 0.15, wd: 200, material: 'label', heightDiff: 0, speed: 200 }),
    base({ task: 'measure', fovW: 40, fovH: 30, precision: 0.05, wd: 260, material: 'glass' }),
  ].forEach((inp) => {
    const r = Engine.solve(inp);
    const ev = Engine.evaluateCombo(inp, comboOf(r));
    assert.ok(ev.ok, '评定应成功');
    assert.strictEqual(ev.score, r.score, '同一条搭配的分数必须与 solve 一致');
    assert.deepStrictEqual(ev.scoreItems, r.scoreItems, '扣分项也应一致');
  });
  const r = Engine.solve(base());
  const ev = Engine.evaluateCombo(base(), comboOf(r));
  assert.strictEqual(ev.feasible, true);
  assert.strictEqual(ev.grade, 'A', '默认场景应为 A，实际 ' + ev.grade);
  assert.strictEqual(ev.checks.filter((c) => c.level === 'fail').length, 0);
});

test('逐项评定覆盖相机 / 镜头 / 系统 / 光源，且每项都有要求与实际值', () => {
  const r = Engine.solve(base());
  const ev = Engine.evaluateCombo(base(), comboOf(r));
  const groups = {};
  ev.checks.forEach((c) => {
    groups[c.group] = 1;
    assert.ok(c.label && c.need && c.actual != null, '检查项字段不完整: ' + JSON.stringify(c));
    assert.ok(['pass', 'warn', 'fail'].indexOf(c.level) >= 0, '未知结论: ' + c.level);
  });
  ['相机', '镜头', '系统', '光源'].forEach((g) => assert.ok(groups[g], '缺少「' + g + '」分组'));
  assert.ok(checkOf(ev, '卡口匹配'), '缺卡口检查');
  assert.ok(checkOf(ev, '像素精度'), '缺像素精度检查');
  assert.ok(checkOf(ev, '照明方式'), '缺照明方式检查');
  assert.ok(ev.req.pxAccReq > 0 && ev.req.needW > 0 && ev.req.needH > 0, 'req 应含精度与分辨率需求');
});

test('卡口不匹配：判 fail、分数显著下降，并给出可直配的替换镜头', () => {
  const m42 = CAT.LENSES.filter((l) => l.mount === 'M42' || l.mount === 'F')[0];
  const cam = byModel('MV-CS032-60GM');
  assert.ok(m42 && cam, '测试型号缺失');
  const ev = Engine.evaluateCombo(base(), { camera: cam.model, lens: m42.model, light: null });
  assert.strictEqual(ev.feasible, false, 'C 口相机装 M42 镜头应判不可行');
  const mountCheck = checkOf(ev, '卡口匹配');
  assert.strictEqual(mountCheck.level, 'fail');
  assert.ok(ev.suggestions.some((s) => s.action && s.action.kind === 'lens'), '应给出替换镜头建议');
  const firstLens = ev.suggestions.filter((s) => s.action && s.action.kind === 'lens')[0];
  const sugLens = lensByModel(firstLens.action.key.split('::').pop());
  assert.ok(sugLens && sugLens.mount === cam.mount, '建议镜头应能直配相机卡口');
});

test('像素精度不足：判 fail，并建议更高分辨率相机', () => {
  const cam = byModel('MV-CS032-60GM');
  const l6 = CAT.LENSES.filter((l) => l.mount === 'C' && l.focal <= 8)[0];
  assert.ok(cam && l6, '测试型号缺失');
  const ev = Engine.evaluateCombo(base(), { camera: cam.model, lens: l6.model, light: null });
  assert.strictEqual(ev.feasible, false, '短焦覆盖大视场时精度应不达标');
  assert.strictEqual(checkOf(ev, '像素精度').level, 'fail');
  const camSug = ev.suggestions.filter((s) => s.action && s.action.kind === 'camera');
  assert.ok(camSug.length >= 1, '应给出更高分辨率相机建议');
  const model = camSug[0].action.key.split('::').pop();
  const c2 = byModel(model);
  assert.ok(c2 && c2.w >= ev.req.needW && c2.h >= ev.req.needH, '建议相机应满足所需分辨率');
});

test('光源照明方式不符：给 warn 并扣分，同时推荐同族正确光源', () => {
  const r = Engine.solve(base());
  const ring = CAT.LIGHTS.filter((x) => x.type === 'ring' && x.color === r.light.color)[0];
  assert.ok(ring, '缺少环形光源测试型号');
  const ev = Engine.evaluateCombo(base(), {
    camera: comboOf(r).camera,
    lens: comboOf(r).lens,
    light: ring.model,
  });
  const lightCheck = checkOf(ev, '照明方式');
  assert.strictEqual(lightCheck.level, 'warn', '环形光 ≠ 推荐条形光，应给警告');
  assert.ok(ev.score < 100, '照明方式不符应扣分');
  const item = ev.scoreItems.filter((x) => x.label === '照明方式不同')[0];
  assert.ok(item && item.penalty > 0, '评分构成应包含照明方式扣分');
  const sug = ev.suggestions.filter((s) => s.action && s.action.kind === 'light')[0];
  assert.ok(sug, '应给出正确光源建议');
  const sugLight = CAT.LIGHTS.filter((x) => x.model === sug.action.key.split('::').pop())[0];
  assert.ok(sugLight && (sugLight.type === 'bar' || sugLight.type === 'bar_array'), '建议应是条形光源');
});

test('光源颜色不符：扣分并说明推荐颜色', () => {
  const r = Engine.solve(base());
  const redBar = CAT.LIGHTS.filter((x) => (x.type === 'bar' || x.type === 'bar_array') && x.color === 'red')[0];
  assert.ok(redBar, '缺少红色条形光测试型号');
  const ev = Engine.evaluateCombo(base(), {
    camera: comboOf(r).camera,
    lens: comboOf(r).lens,
    light: redBar.model,
  });
  assert.strictEqual(checkOf(ev, '光源颜色').level, 'warn');
  assert.ok(ev.scoreItems.some((x) => x.label === '光源颜色不符'), '应记录颜色扣分');
});

test('未选光源：扣 10 分并给出推荐型号', () => {
  const r = Engine.solve(base());
  const ev = Engine.evaluateCombo(base(), { camera: comboOf(r).camera, lens: comboOf(r).lens, light: null });
  const item = ev.scoreItems.filter((x) => x.label === '未选光源')[0];
  assert.ok(item && item.penalty === 10, '未选光源应扣 10 分');
  assert.strictEqual(checkOf(ev, '光源型号').level, 'warn');
  assert.ok(ev.suggestions.some((s) => s.action && s.action.kind === 'light'), '应推荐光源型号');
});

test('评分自洽：总分 = 100 - 各项扣分（下限 5）', () => {
  const r = Engine.solve(base());
  const ring = CAT.LIGHTS.filter((x) => x.type === 'ring')[0];
  const ev = Engine.evaluateCombo(base(), { camera: comboOf(r).camera, lens: comboOf(r).lens, light: ring.model });
  const sum = ev.scoreItems.reduce((a, x) => a + x.penalty, 0);
  assert.strictEqual(ev.score, Math.max(5, Math.min(100, 100 - sum)), '总分与扣分不自洽');
});

test('运动拍摄 + 卷帘快门：给 warn', () => {
  const rolling = CAT.CAMERAS.filter((c) => c.shutter !== 'Global' && c.mount === 'C')[0];
  if (!rolling) return;
  const r = Engine.solve(base());
  const ev = Engine.evaluateCombo(base({ speed: 200 }), {
    camera: rolling.model,
    lens: comboOf(r).lens,
    light: comboOf(r).light,
  });
  const c = checkOf(ev, '快门类型');
  assert.ok(c && c.level === 'warn', '卷帘快门在运动场景应给警告');
});

test('手动搭配不达标时独立判定，不沿用 solve 的自动回退结果', () => {
  const m42 = CAT.LENSES.filter((l) => l.mount === 'M42' || l.mount === 'F')[0];
  const cam = byModel('MV-CS032-60GM');
  const solved = Engine.solve(base({ manualCamera: cam.model, manualLens: m42.model }));
  assert.ok(solved.ok && solved.feasible, 'solve 对手动不匹配组合会回退到自动方案');
  assert.ok(solved.warnings.some((w) => /无法采用/.test(w.text)), 'solve 应提示已回退');
  const ev = Engine.evaluateCombo(base(), { camera: cam.model, lens: m42.model, light: null });
  assert.strictEqual(ev.feasible, false, 'evaluateCombo 必须独立指出卡口问题');
  assert.ok(ev.picked.lens.indexOf(m42.model) >= 0, '评定的就是用户所选镜头');
});

console.log('\n[17] 现场参数 / 安装配套 / 验收复核 / 选型依据');

test('现场参数：光圈在镜头范围内，静态给起始曝光、不给上限', () => {
  const r = Engine.solve(base());
  assert.ok(r.site && r.site.aperture && r.site.exposure && r.site.trigger, '缺少现场参数字段');
  const ap = r.site.aperture;
  // 固定光圈（手册只印一档）的上限就是它自己那一档，不能按 F22 放行
  const apCeil = r.lens.fmax != null ? r.lens.fmax : r.lens.fmin;
  assert.ok(ap.value >= r.lens.fmin - 1e-9 && ap.value <= apCeil + 1e-9, '光圈超出镜头可用范围: F' + ap.value);
  assert.ok(ap.dof > 0 && ap.blurPx > 0, '光圈档应带景深与衍射');
  if (ap.stop) {
    assert.ok(ap.stop > ap.value, '收小一档的光圈值必须更大');
    assert.ok(ap.stopDof > ap.dof, '收小一档景深应变大');
  }
  assert.strictEqual(r.site.exposure.upperMs, null, '静态拍摄不应有曝光上限');
  assert.ok(r.site.exposure.startMs > 0, '静态也要给起始曝光值');
  assert.ok(/软触发|连续/.test(r.site.trigger.mode), '静态应为软触发 / 连续采集');
  assert.ok(r.site.light && r.site.light.controller, '有光源型号时应给出调光控制器');
  assert.strictEqual(r.site.light.strobe, !!r.light.controllerStrobe, '频闪能力应与控制器一致');
});

test('现场参数：运动时硬触发 + 曝光上限，需要频闪时明确提示', () => {
  const r = Engine.solve(base({ speed: 300 }));
  const s = r.site;
  assert.ok(isFinite(s.exposure.upperMs) && s.exposure.upperMs > 0, '运动拍摄应有曝光上限');
  assert.ok(/硬触发/.test(s.trigger.mode), '运动拍摄应为硬触发');
  assert.ok(s.trigger.freqHz >= 1, '硬触发频率应 ≥ 1 Hz');
  if (s.exposure.upperMs < 1) {
    assert.strictEqual(s.light.needStrobe, true, '曝光 < 1 ms 必须标注需要频闪');
    assert.ok(/频闪/.test(s.light.note), '说明里应提到频闪');
  }
  assert.ok(s.exposure.startMs > 0 && s.exposure.startMs <= s.exposure.upperMs, '起始曝光不得超出上限');
});

test('安装配套：尺寸链与可用空间判定一致，关键项齐全', () => {
  const r = Engine.solve(base({ space: 380 }));
  const k = r.install;
  near(k.needAll, r.space.need + k.bracket + k.clearance, 1e-6, '含支架余量的总长');
  assert.strictEqual(k.pass, 380 >= k.needAll, 'pass 必须与可用空间一致');
  const names = k.items.map((x) => x.name);
  ['尺寸链', '数据线', '触发 / IO 线', '镜头附件', '光源安装', '光源控制器', '供电功率'].forEach((n) => {
    assert.ok(names.indexOf(n) >= 0, '缺少配套项：' + n);
  });
  const dataLine = k.items.filter((x) => x.name === '数据线')[0];
  assert.ok(dataLine.value.length > 0, '数据线应给出接口对应线型');
  const power = k.items.filter((x) => x.name === '供电功率')[0];
  assert.ok(/1\.5/.test(power.note), '电源应给出 1.5 倍预留提示');
});

test('安装配套：未填可用空间时只展示、不判定', () => {
  const r = Engine.solve(base());
  assert.strictEqual(r.install.pass, null, '未填空间不应给出通过/不通过');
  assert.strictEqual(r.install.available, null, '未填空间不应有可用值');
});

test('验收清单：五项固定检查，焦点随指标变化', () => {
  const r = Engine.solve(base());
  assert.deepStrictEqual(r.acceptance.items.map((x) => x.name), ['重复性', '测量偏差', '图像对比度', '节拍', '环境']);
  const repeat = r.acceptance.items[0];
  near(parseFloat(String(repeat.target).replace(/[^\d.]/g, '')), r.camera.pxAcc * 0.3, 0.0002, '重复性 0.3 像素');
  assert.ok(r.acceptance.focus.some((x) => /精度预算/.test(x)), '预算占比高时应提示先复核');
  const fast = Engine.solve(base({ speed: 300 }));
  if (fast.site.exposure.upperMs < 1) {
    assert.ok(fast.acceptance.focus.some((x) => /曝光/.test(x)), '短曝光应进重点项');
  }
});

test('选型依据：给出次优整机、六项对比，且判定与数值自洽', () => {
  const r = Engine.solve(base());
  const q = r.rationale;
  assert.ok(!q.none && !q.manual, '自动选型应有对比结论');
  assert.strictEqual(q.rows.length, 6, '应为六个对比维度');
  assert.deepStrictEqual(q.rows.map((x) => x.k), ['匹配度', '相机', '像素精度', '精度余量', '接口 / 带宽', '镜头']);
  assert.ok(q.summary.indexOf('次优') >= 0, '结论应点名次优方案');
  assert.ok(q.altScore >= 5 && q.altScore <= 100, '次优分数应在 5~100');
  const scoreRow = q.rows.filter((x) => x.k === '匹配度')[0];
  const want = r.score === q.altScore ? 'tie' : (r.score > q.altScore ? 'win' : 'lose');
  assert.strictEqual(scoreRow.cmp, want, '匹配度判定与分数不一致');
  assert.ok(CAT.CAMERAS.some((c) => q.altCamera.indexOf(c.model) >= 0), '次优相机必须来自型号库');
  assert.ok(CAT.LENSES.some((l) => q.altLens.indexOf(l.model) >= 0), '次优镜头必须来自型号库');
  q.rows.forEach((x) => {
    assert.ok(['win', 'lose', 'tie'].indexOf(x.cmp) >= 0, '对比判定取值非法：' + x.cmp);
    assert.ok(x.a && x.b, '每一项都要有本方案与次优的取值');
  });
});

test('选型依据：次优按同一口径重新算分（不受备选选优近似影响）', () => {
  // 该场景主方案因停档后衍射扣 8 分；备选若仍按最宽光圈估分就会虚高
  const r = Engine.solve(base({
    fovW: 120, fovH: 90, precision: 0.05, task: 'presence', needColor: true, heightDiff: 3, cpm: 60
  }));
  assert.ok(r.rationale.rows, '应有对比');
  assert.ok(r.rationale.altScore <= r.score, '次优分数不应高于首选：' + r.score + ' vs ' + r.rationale.altScore);
});

test('选型依据：手动指定 / 无备选时给出说明而非空表', () => {
  const cam = byModel('MV-CS032-60GM');
  const manual = Engine.solve(base({ manualCamera: cam.model }));
  assert.strictEqual(manual.rationale.manual, true, '手动指定应标记 manual');
  assert.ok(!manual.rationale.rows && manual.rationale.note, '手动指定应给说明文字');

  const hard = Engine.solve(base({ precision: 0.01 }));
  assert.strictEqual(hard.feasible, false, '该需求应不可行');
  if (!hard.rationale.rows) {
    assert.strictEqual(hard.rationale.none, true, '无备选时应标记 none');
    assert.ok(/调|线扫|远心/.test(hard.rationale.note), '说明里应给出下一步方向');
  }
});

console.log('\n[18] 评分口径统一 / 连续扣分 / 位深与硬约束');
const I = Engine._internal;

function baseMetrics(over) {
  return Object.assign({
    feasible: true, feasibleWhy: '', margin: 0.2,
    dofOK: true, dof: 10, heightDiff: 2,
    blurPx: 1, ap: 4, tMaxMs: Infinity, expMinGap: 0,
    fErr: 0.05, fovOver: 0.05,
    fps: 10, camFps: 30,
    bandwidth: 10, ifaceCap: 93.5, camIface: 'GigE', adapter: false
  }, over || {});
}

test('扣分连续：阈值两侧不再跳变，越界越远扣得越多', () => {
  const a = I.scoreOf(baseMetrics({ margin: 0.1501 }));
  const b = I.scoreOf(baseMetrics({ margin: 0.1499 }));
  const far = I.scoreOf(baseMetrics({ margin: 0 }));
  assert.ok(Math.abs(a.score - b.score) <= 1, '余量阈值两侧不应跳变: ' + a.score + ' vs ' + b.score);
  assert.ok(far.score <= b.score, '偏离越大分数不应更高: ' + far.score + ' vs ' + b.score);
  const bw1 = I.scoreOf(baseMetrics({ bandwidth: 94 }));
  const bw2 = I.scoreOf(baseMetrics({ bandwidth: 190 }));
  assert.ok(bw2.score <= bw1.score, '带宽超得越多扣得越多');
});

test('连续扣分仍满足「总分 = 100 − 各项扣分」', () => {
  const sc = I.scoreOf(baseMetrics({ margin: 0.02, blurPx: 4, fErr: 0.4, fps: 45, bandwidth: 150 }));
  const sum = sc.items.reduce((a, x) => a + x.penalty, 0);
  assert.strictEqual(sc.score, Math.max(5, Math.min(100, 100 - sum)));
  assert.ok(sc.items.every((x) => x.penalty > 0), '扣分项不应含 0 分噪声');
});

test('位深：彩色 Bayer 按单通道 8bit，带宽不再凭空翻倍', () => {
  assert.strictEqual(I.bitDepthOf({ color: '彩色' }), 8);
  assert.strictEqual(I.bitDepthOf({ color: '黑白' }), 8);
  assert.strictEqual(I.bitDepthOf({ bitDepth: 12 }), 12, '型录逐型号位深优先');
  const col = Engine.solve(base({ needColor: true }));
  assert.strictEqual(col.camera.bitDepth, 8, '彩色方案链路位深应为 8bit');
  assert.ok(col.camera.bandwidthMBps <= col.camera.w * col.camera.h * col.camera.fps * 8 / 8 / 1e6 + 0.01);
});

test('接口有效带宽扣除协议开销；镜头解析力需求随像元尺寸调档', () => {
  assert.ok(I.ifaceCapOf('GigE') < 110 && I.ifaceCapOf('GigE') > 90, '应低于理论线速');
  const small = I.lensMpNeed({ w: 2448, h: 2048, pxUm: 2 });
  const large = I.lensMpNeed({ w: 2448, h: 2048, pxUm: 5.5 });
  assert.ok(small > large, '小像元相机对镜头解析力要求更高');
});

test('彩色 Bayer 留 20% 所需像素余量', () => {
  const bw = Engine.solve(base());
  const col = Engine.solve(base({ needColor: true }));
  assert.ok(col.pxNeed.w > bw.pxNeed.w && col.pxNeed.h > bw.pxNeed.h,
    '彩色所需分辨率应高于黑白: ' + JSON.stringify(col.pxNeed) + ' vs ' + JSON.stringify(bw.pxNeed));
});

test('选优分数与页面最终展示的分数是同一把尺子', () => {
  [base(), base({ speed: 200 }), base({ needColor: true })].forEach((inp) => {
    const r = Engine.solve(inp);
    if (!r.ok) return;
    const chosen = I.selectOptics(inp, r.pxNeed.w, r.pxNeed.h, !!(inp.needColor || inp.task === 'color'));
    assert.ok(chosen, '应能重新选出方案');
    const sc = I.scoreOf(I.metricsFromCand(chosen, inp, r.pxAccReq, r.feasible));
    assert.strictEqual(sc.score, r.score,
      '选优 ' + sc.score + ' 与展示 ' + r.score + ' 不一致（' + r.camera.model + '）');
  });
});

test('硬约束：自动推荐机型帧率与链路带宽跑得动', () => {
  const inp = base({ speed: 400, cpm: 60 });
  const r = Engine.solve(inp);
  if (!r.ok || !r.feasible) return;
  assert.ok(r.camera.fps <= r.camera.maxFps,
    '需要 ' + r.camera.fps + ' fps 但相机只有 ' + r.camera.maxFps + ' fps');
  assert.ok(r.camera.bandwidthMBps <= I.ifaceCapOf(r.camera.interface) + 0.02,
    '带宽 ' + r.camera.bandwidthMBps + ' 超过有效带宽 ' + I.ifaceCapOf(r.camera.interface));
});

/* ---------------- 选型链全量在售目录（selection-catalog.js） ---------------- */
console.log('\n[选型链全量在售目录]');
const SEL = require('./selection-catalog.js');
const SEL_WIN = {};
[
  ['HikrobotCatalog', 'hikrobot-catalog.js'],
  ['Hikrobot3DCatalog', 'hikrobot-3d-catalog.js'],
  ['HuaruiCatalog', 'huarui-catalog.js'],
  ['BaslerCatalog', 'basler-catalog.js'],
  ['BaslerLensCatalog', 'basler-lens-catalog.js'],
  ['BaslerLightCatalog', 'basler-light-catalog.js'],
  ['DahengCatalog', 'daheng-catalog.js'],
  ['OptCatalog', 'opt-catalog.js'],
  ['OptLensCatalog', 'opt-lens-catalog.js'],
  ['OptLightCatalog', 'opt-light-catalog.js'],
  ['OptCtrlCatalog', 'opt-ctrl-catalog.js'],
  ['CstCatalog', 'cst-catalog.js']
].forEach(([g, f]) => { SEL_WIN[g] = require('./' + f); });
Object.assign(SEL_WIN, require('./brands.js'));
Object.assign(SEL_WIN, require('./retired-catalog.js'));
const SEL_CAT = SEL.merge(SEL_WIN);

test('共用合并模块：六品牌型录全部加载，筛选条品牌键正确', () => {
  const keys = SEL.allBrandKeys(SEL_WIN);
  assert.deepStrictEqual(keys.camera, ['hikrobot', 'huarui', 'basler', 'daheng', 'opt', 'cst']);
  assert.deepStrictEqual(keys.lens, ['hikrobot', 'huarui', 'daheng', 'cst', 'basler', 'opt']);
  assert.deepStrictEqual(keys.light, ['hikrobot', 'huarui', 'cst', 'basler', 'opt']);
});

test('共用合并模块：全量在售型号池（清洗后）', () => {
  assert.strictEqual(SEL_CAT.CAMERAS.length, 1982, '面阵相机');
  assert.strictEqual(SEL_CAT.LINESCAN.length, 118, '线阵相机');
  assert.strictEqual(SEL_CAT.LENSES.length, 1144, '定焦镜头');
  assert.strictEqual(SEL_CAT.TELECENTRIC.length, 922, '远心镜头');
  assert.strictEqual(SEL_CAT.LIGHTS.length, 4066, '光源');
  assert.strictEqual(SEL_CAT.CONTROLLERS.length, 114, '光源控制器');
  assert.strictEqual(SEL_CAT.PROFILERS.length, 72, '3D 轮廓传感器');
});

test('共用合并模块：退市型号不进选型池', () => {
  assert.strictEqual(SEL_CAT._stats.retired, 4, '应排除 4 款与退市库重名的在售条目');
  ['MV-CH089-10GM', 'MV-CH089-10GC', 'acA2000-165um', 'acA2000-165uc'].forEach((m) => {
    assert.ok(!SEL_CAT.CAMERAS.some((x) => x.model === m), m + ' 仍在选型池里');
  });
});

test('共用合并模块：必要参数缺失型号不进选型池', () => {
  const kinds = [
    ['CAMERAS', 'CAMERAS'], ['LINESCAN', 'LINESCAN'], ['LENSES', 'LENSES'],
    ['TELECENTRIC', 'TELECENTRIC'], ['LIGHTS', 'LIGHTS'], ['CONTROLLERS', 'CONTROLLERS']
  ];
  kinds.forEach(([listKey, rule]) => {
    const bad = SEL_CAT[listKey].filter((x) => !SEL.isValid(rule, x));
    assert.strictEqual(bad.length, 0, listKey + ' 仍有 ' + bad.length + ' 条缺必要参数：' + bad.slice(0, 3).map((x) => x.model));
  });
});

test('共用合并模块：清洗统计与等价字段补齐', () => {
  assert.deepStrictEqual(SEL_CAT._stats.invalid, {
    TELECENTRIC: 1, CAMERAS: 53, LENSES: 19, LIGHTS: 251
  });
  assert.deepStrictEqual(SEL_CAT._stats.filled, { pxH: 8, wdMax: 619 });
  // 康视达面阵相机官网未给卡口，必须被挡掉；线阵用 pxUm 补 pxH 后照常参与
  assert.strictEqual(SEL_CAT.CAMERAS.filter((x) => /^CST-/.test(x.model)).length, 0);
  assert.strictEqual(SEL_CAT.LINESCAN.filter((x) => /^CST-/.test(x.model)).length, 8);
  assert.ok(SEL_CAT.TELECENTRIC.filter((x) => /^OPT-/.test(x.model)).every((x) => x.wdMax > 0));
});

test('参数复核回归：官网已公布尺寸 / 颜色 / 通道数的型号不再被误排除', () => {
  // 奥普特光纤光源官网「尺寸(mm) 124 × 141 × 178 / LED颜色 白色」
  // 多光谱无影光源官网「尺寸(mm) 275×200×50 / LED颜色 多光谱」
  // 程控图案光源官网「尺寸(mm) 328 × 208 × 70」，无 LED颜色 列，型号 -W 为白光
  ['OPT-DOFP10HA-W', 'OPT-RIPM275', 'OPT-PCP290160-W'].forEach((m) => {
    const x = SEL_CAT.LIGHTS.find((y) => y.model === m);
    assert.ok(x, m + ' 官网已给尺寸，应进入选型池');
    assert.ok(Array.isArray(x.size) && x.size[0] > 0, m + ' 尺寸应为有效数值');
    assert.ok(x.color, m + ' 颜色应为有效值');
  });
  assert.strictEqual(SEL_CAT.LIGHTS.find((x) => x.model === 'OPT-RIPM275').color, 'multi');
  // Basler 控制器型号里的 2C / 4C 是厂商明示的通道数
  const bc = SEL_CAT.CONTROLLERS.filter((x) => /Light Controller/.test(x.model));
  assert.strictEqual(bc.length, 2);
  assert.deepStrictEqual(bc.map((x) => x.channels).sort(), [2, 4]);
  // 康视达该款光源官网分类表尺寸列全空、系列型录只有共用示意图 → 仍应排除
  assert.ok(!SEL_CAT.LIGHTS.some((x) => x.model === 'CST-2BS10238-IR850'));
});

test('康视达型号补充：红外 850nm 同规格派生与用户补充型号', () => {
  const L = SEL_WIN.CstCatalog.LIGHTS;
  const find = (m) => L.find((x) => x.model === m);
  // 官网红外单品页「光源波长可定制 850、940 等」：17 款 -IR940 各派生一款 -IR850
  const derived = L.filter((x) => /-IR850$/.test(x.model) && /定制波长变体/.test(x.note || ''));
  assert.strictEqual(derived.length, 17, '应派生 17 款 850nm 变体');
  ['CST-RS7460-IR850', 'CST-RS7430-IR850', 'CST-BS14020-IR850'].forEach((m) => {
    const d = find(m), src = find(m.replace('-IR850', '-IR940'));
    assert.ok(d && src, m + ' 与源型号都应存在');
    assert.deepStrictEqual(d.size, src.size, m + ' 尺寸应与源型号一致');
    assert.strictEqual(d.power, src.power, m + ' 功率应与源型号一致');
    assert.ok(/规格同 /.test(d.note || ''), m + ' 应注明派生来源');
  });
  // 用户补充型号：只登记型号与类别，官网未公布规格的字段留空，不进选型池
  const extra = find('CST-2BS10238-UV365-D28');
  assert.ok(extra, '用户补充型号应在产品库');
  assert.strictEqual(extra.type, 'uv');
  assert.ok(!SEL_CAT.LIGHTS.some((x) => x.model === 'CST-2BS10238-UV365-D28'), '无尺寸不进选型池');
  const extra2 = find('CST-CP80M80-W');
  assert.ok(extra2, '第二个用户补充型号应在产品库');
  assert.strictEqual(extra2.color, 'white');
  assert.ok(!extra2.type && !extra2.size, '官网未收录时类型与规格不臆造');
  assert.ok(!SEL_CAT.LIGHTS.some((x) => x.model === 'CST-CP80M80-W'), '类型/尺寸缺失不进选型池');
  // 16 款派生变体有尺寸进池，CST-DS175-IR850 无尺寸被硬门槛挡住
  assert.ok(SEL_CAT.LIGHTS.some((x) => x.model === 'CST-RS7460-IR850'));
  assert.ok(!SEL_CAT.LIGHTS.some((x) => x.model === 'CST-DS175-IR850'));
});

test('必要参数规则：缺卡口 / 定焦距 / 尺寸 / 倍率的条目一律判否', () => {
  const cam = { model: 'X', w: 640, h: 480, pxUm: 5, sw: 3.2, sh: 2.4, fps: 30, iface: 'GigE', mount: 'C', color: '黑白' };
  assert.ok(SEL.isValid('CAMERAS', cam), '完整相机应通过');
  assert.strictEqual(SEL.isValid('CAMERAS', Object.assign({}, cam, { mount: null })), false, '缺卡口');
  assert.strictEqual(SEL.isValid('CAMERAS', Object.assign({}, cam, { sw: 0 })), false, '靶面为 0');
  assert.strictEqual(SEL.isValid('CAMERAS', Object.assign({}, cam, { fps: null })), false, '缺帧率');
  const lens = { model: 'L', focal: 25, mount: 'C', fmin: 2.8 };
  assert.ok(SEL.isValid('LENSES', lens));
  assert.strictEqual(SEL.isValid('LENSES', Object.assign({}, lens, { focal: null })), false, '变倍镜头无定焦距');
  assert.strictEqual(SEL.isValid('LIGHTS', { model: 'S', type: 'ring', color: 'white', size: null }), false, '光源缺尺寸');
  assert.ok(SEL.isValid('LIGHTS', { model: 'S', type: 'ring', color: 'white', size: [100, 90] }));
  const tele = { model: 'T', mount: 'C', magMin: 0.5, magMax: 0.5, wdMin: 110, wdMax: 110 };
  assert.ok(SEL.isValid('TELECENTRIC', tele));
  assert.strictEqual(SEL.isValid('TELECENTRIC', Object.assign({}, tele, { wdMax: null })), false, '远心缺工作距离上界');
});

test('品牌开关：镜头与光源按类目独立启停', () => {
  const noOptLens = SEL.merge(SEL_WIN, { lens: SEL.brandKeys(SEL_WIN, 'lens').filter((k) => k !== 'opt') });
  assert.strictEqual(noOptLens.LENSES.length, 884);
  assert.strictEqual(noOptLens.TELECENTRIC.length, 303);
  assert.strictEqual(noOptLens.CAMERAS.length, SEL_CAT.CAMERAS.length, '关镜头品牌不应影响相机');
  const noHuaLight = SEL.merge(SEL_WIN, { light: SEL.brandKeys(SEL_WIN, 'light').filter((k) => k !== 'huarui') });
  assert.strictEqual(noHuaLight.LIGHTS.length, 3804);
  assert.strictEqual(noHuaLight.CONTROLLERS.length, 94);
  assert.strictEqual(noHuaLight.LENSES.length, SEL_CAT.LENSES.length, '关光源品牌不应影响镜头');
});

test('全量在售池可解出可行方案', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const r = E.solve(base());
  assert.strictEqual(r.ok, true);
  assert.ok(r.camera && r.camera.model && r.lens && r.lens.model, '应给出相机与镜头型号');
  assert.ok(r.score > 0);
  assert.ok(SEL_CAT.CAMERAS.some((c) => c.model === r.camera.model), '推荐相机必须来自在售池');
  assert.ok(SEL_CAT.LENSES.some((l) => l.model === r.lens.model), '推荐镜头必须来自在售池');
});

console.log('\n[19] 线扫多机拼接（幅面超单台能力）');

function stitchBase(over) {
  return base(Object.assign({ fovW: 1200, fovH: 900, precision: 0.05, wd: 400, speed: 200, lineScanFirst: true }, over || {}));
}

test('单台线扫够用 / 面阵可行时不推拼接', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const one = E.solve(stitchBase({ fovW: 300, fovH: 200, precision: 0.2 }));
  assert.ok(one.lineScan, '300 mm 幅面应能单台线扫覆盖');
  assert.strictEqual(one.lineScanStitch, null, '单台够用不应给拼接');
  const normal = E.solve(base({ fovW: 300, fovH: 200, precision: 0.2 }));
  assert.strictEqual(normal.lineScanStitch, null, '未勾线扫优先且面阵可行时不应出现拼接');
  // 面阵不可行不等于要拼线扫：没勾就当没这回事，但在风险提示里指路
  const huge = E.solve(base({ fovW: 1200, fovH: 900, precision: 0.05, wd: 400, speed: 200 }));
  assert.strictEqual(huge.feasible, false, '该幅面面阵应不可行');
  assert.strictEqual(huge.lineScanStitch, null, '未勾线扫优先时面阵不可行也不应出现拼接');
  assert.ok(huge.warnings.some((w) => /优先线扫/.test(w.text)), '不可行提示应指向「优先线扫」勾选');
  const on = E.solve(base({ fovW: 1200, fovH: 900, precision: 0.05, wd: 400, speed: 200, lineScanFirst: true }));
  assert.ok(on.lineScanStitch && on.lineScanStitch.ok, '勾选后应给拼接方案');
});

test('幅面超单台时给多机方案：覆盖 / 精度 / 像素 / 行频自洽', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const r = E.solve(stitchBase());
  const s = r.lineScanStitch;
  assert.ok(s && s.ok, '1200 mm / 0.05 mm 应给拼接方案');
  assert.strictEqual(r.lineScan, null, '单台覆盖不了时 lineScan 应为空');
  assert.ok(s.plans.length >= 1, '至少一档方案');
  assert.ok(s.plans.some((p) => p.accOk), '至少一档精度达标');
  s.plans.forEach((p) => {
    assert.ok(p.n >= 2 && p.n <= s.maxCams, '台数应在 2..上限，实际 ' + p.n);
    // 单台视场由镜头焦距档决定，不一定等于按重叠率算出的设计值，所以用「间距 + 重叠」闭环
    near(p.pitch * (p.n - 1) + p.fovPer, 1200, 1e-6, p.n + ' 台总覆盖');
    near(p.pitch + p.overlapW, p.fovPer, 1e-9, '间距 + 重叠 = 单台视场');
    assert.ok(p.pitch > 0 && p.overlapW > 0, '间距与重叠都必须为正');
    near(p.overlapPx, Math.round(p.overlapW / p.pxAcc), 0.6, '重叠像素');
    near(p.bandwidthTotal, p.bandwidth * p.n, 1e-6, '总带宽');
    // 接口上限必须按接口查表，传错参数会静默退化成默认 350 MB/s，把好链路判成不够
    assert.ok(p.ifaceCap > 350, '接口带宽上限应按接口取值，实际 ' + p.ifaceCap);
    // 线扫型录没有位深字段，按 8 bit 估会把带宽算低 25%，必须按 10 bit 估并标 assumed
    assert.ok(p.bitDepth >= 10, '缺位深时应按 ≥10 bit 估，实际 ' + p.bitDepth);
    if (p.bitAssumed) near(p.bandwidth, (p.camera.w * 10 * p.rate * 1000) / 8 / 1e6, 1e-6, '按 10 bit 的带宽');
    assert.ok(p.camera.w >= p.wNeed, '像素数应不少于需求');
    assert.ok(p.rateOk, '行频应满足');
    // 精度：达标的档必须真的达标；不达标的档要如实标出来，不能悄悄当达标
    if (p.accOk) assert.ok(p.pxAcc <= s.pxAccReq + 1e-9, p.n + ' 台标了达标但精度不够');
    else assert.ok(p.pxAcc > s.pxAccReq, p.n + ' 台标了超差但精度其实够');
  });
});

test('头号方案装得起来：有镜头且精度达标，且同档台数最少', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const s = E.solve(stitchBase()).lineScanStitch;
  const p = s.best;
  // 精度达标但库里没这支镜头，和方案不可交付是一回事，所以首选必须有镜头
  assert.ok(p.lens && p.lens.model, '头号方案必须配得上线扫镜头（卡口 + 像面 + 摄距）');
  assert.ok(p.accOk, '头号方案精度必须达标，实际 ' + p.pxAcc.toFixed(4) + ' vs ' + s.pxAccReq.toFixed(4));
  const sameGrade = s.plans.filter((x) => x.accOk && x.lens);
  assert.strictEqual(p.n, Math.min.apply(null, sameGrade.map((x) => x.n)), '同档里应取最少台数');
  if (p.lens.ic != null) assert.ok(p.lens.ic >= p.sensorW / 2 - 1e-9, '镜头像面直径应覆盖行传感器');
  assert.ok(p.light && p.light.count >= 1, '应给线光源');
  assert.ok(p.light.len * p.light.count >= 1200 * 1.05 - 1e-6, '光源总长应覆盖整幅');
  assert.ok(s.notes.length >= 4, '应给出同步 / 标定 / 亮度 / 链路要点');
});

test('台数上限不够时给原因与所需台数', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const s = E.solve(stitchBase({ stitchMaxCams: 2 })).lineScanStitch;
  assert.ok(s && !s.ok, '2 台上限应判不可行');
  assert.ok(/覆盖不了|至少需要/.test(s.reason), '应说明原因，实际：' + s.reason);
  assert.ok(s.needCams >= 3, '应算出至少需要的台数，实际 ' + s.needCams);
  assert.strictEqual(s.plans.length, 0);
});

test('重叠率可调，且按公式改变单台视场', () => {
  const E = Engine.VisionEngineFactory(SEL_CAT);
  const sa = E.solve(stitchBase({ fovW: 800, stitchOverlap: 10 })).lineScanStitch;
  const sb = E.solve(stitchBase({ fovW: 800, stitchOverlap: 20 })).lineScanStitch;
  // 设计视场逐档按公式核：重叠率变大 → 单台要铺更宽 → 台数往往随之上台阶，不能直接拿 best 比大小
  [[sa, 0.1], [sb, 0.2]].forEach(([s, ov]) => {
    s.plans.forEach((p) => {
      near(p.fovDesign, 800 / (p.n - (p.n - 1) * ov), 1e-6, p.n + ' 台设计视场（重叠 ' + ov * 100 + '%）');
    });
  });
  // 同一台数下重叠率大则设计视场大
  const na = sa.plans[0].n;
  const pb = sb.plans.filter((p) => p.n === na)[0];
  if (pb) assert.ok(pb.fovDesign > sa.plans[0].fovDesign, '同台数下重叠率大则设计视场大');
  const best = sa.best;
  assert.ok(best.overlapPct > 0 && best.overlapPx >= 50,
    '重叠区应够做标定，实际 ' + best.overlapPx + ' px / ' + (best.overlapPct * 100).toFixed(1) + '%');
});

console.log('\n' + '='.repeat(52));
console.log(pass + ' 通过, ' + fail + ' 失败');
if (fail > 0) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(52) + '\n');
process.exit(fail > 0 ? 1 : 0);
