/**
 * 抓取海康机器人每个型号的详细参数（官网产品详情接口），
 * 补齐手册汇总表里没有的字段：动态范围、信噪比、曝光时间、供电/PoE、位深、镜头接口。
 * 相机、线扫、光源、光源控制器都抓。
 *
 * 用法：node tools/fetch-specs.js > specs.json
 */
'use strict';

const BASE = 'https://www.hikrobotics.com/cn/Api/Foreground/Vision/';
const HEADERS = {
  Referer: 'https://www.hikrobotics.com/cn/machinevision/visionproduct',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
};

const CAM_SERIES = [
  'CS系列工业面阵相机', 'CU系列工业面阵相机', 'CT系列工业面阵相机',
  'CH系列工业面阵相机', 'CB系列板级相机'
];
const LINE_SERIES = ['CL系列工业线阵相机'];
const LIGHT_SERIES = ['标准系列光源'];
const CTRL_SERIES = ['标准系列光源控制器'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + pathname, { headers: HEADERS });
      if (r.status === 429) { await sleep(800 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

/** 从参数数组 [{name,value}] 建字段字典 */
function toMap(data) {
  const m = {};
  for (const x of data || []) m[x.name] = x.value;
  return m;
}

const num = (s) => {
  const m = String(s || '').match(/-?[\d.]+/);
  return m ? +m[0] : null;
};

async function listSeries(names) {
  const out = [];
  for (const s of names) {
    const d = (await get('Cameras?seriesName=' + encodeURIComponent(s))).data || [];
    for (const x of d) out.push({ id: x.id, model: x.productModel, name: x.productName, series: s });
  }
  return out;
}

async function fetchConfigs(items, parse, label) {
  const out = {};
  const CONC = 6;
  let done = 0;
  for (let i = 0; i < items.length; i += CONC) {
    const batch = items.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (it) => {
        try {
          const data = (await get('VisionProductConfig?id=' + it.id)).data;
          if (data) out[it.model] = parse(toMap(data), it);
        } catch (e) {
          /* 单个失败不影响整体 */
        }
      })
    );
    done += batch.length;
    process.stderr.write(label + ' ' + done + '/' + items.length + '\n');
  }
  return out;
}

function parseCamera(m, it) {
  const expo = String(m['曝光时间'] || '');
  const expoNums = (expo.match(/[\d.]+\s*(?:μs|µs|us|ms|sec|s)\b/gi) || []).map((s) => {
    const v = parseFloat(s);
    return /ms/i.test(s) ? v * 1000 : /(sec|^s$)/i.test(s.replace(/^[\d.\s]+/, '')) ? v * 1e6 : v;
  });
  return {
    sensor: m['传感器型号'] || null,
    dynamicRange: num(m['动态范围']),
    snr: num(m['信噪比']),
    exposureMinUs: expoNums.length ? Math.min.apply(null, expoNums) : null,
    exposureMaxUs: expoNums.length ? Math.max.apply(null, expoNums) : null,
    poe: /PoE/i.test(String(m['供电'] || '')),
    bitDepth: (String(m['像素格式'] || '').match(/(\d{1,2})\s*(?:bit|位)/i) || [])[1] * 1 || null,
    mount: m['镜头接口'] || null,
    power: num(m['典型功耗']),
    weight: num(m['重量'])
  };
}

function parseLine(m) {
  return {
    sensor: m['传感器型号'] || null,
    lineRateKHz: num(m['最大行频']),
    mount: m['镜头接口'] || null,
    exposureMinUs: num(m['曝光时间']),
    dynamicRange: num(m['动态范围']),
    snr: num(m['信噪比']),
    power: num(m['典型功耗'])
  };
}

function parseLight(m, it) {
  return {
    power: num(m['功率']) || num(m['典型功耗']),
    color: m['颜色'] || null,
    wavelength: m['波长'] || null,
    angle: num(m['照射角度']),
    size: m['外形尺寸'] || null
  };
}

function parseCtrl(m) {
  return {
    channels: num(m['通道数']),
    powerPerChannel: num(m['单通道功率']),
    totalPower: num(m['总功率']) || num(m['功率']),
    mode: m['控制方式'] || m['调光方式'] || null,
    strobe: /频闪|脉冲|触发/i.test(JSON.stringify(m))
  };
}

(async () => {
  const result = { cameras: {}, linescan: {}, lights: {}, controllers: {} };

  const cams = await listSeries(CAM_SERIES);
  process.stderr.write('面阵型号 ' + cams.length + '\n');
  result.cameras = await fetchConfigs(cams, parseCamera, '面阵');

  const lines = await listSeries(LINE_SERIES);
  process.stderr.write('线扫型号 ' + lines.length + '\n');
  result.linescan = await fetchConfigs(lines, parseLine, '线扫');

  const lights = await listSeries(LIGHT_SERIES);
  process.stderr.write('光源型号 ' + lights.length + '\n');
  result.lights = await fetchConfigs(lights, parseLight, '光源');

  const ctrls = await listSeries(CTRL_SERIES);
  process.stderr.write('控制器型号 ' + ctrls.length + '\n');
  result.controllers = await fetchConfigs(ctrls, parseCtrl, '控制器');

  process.stdout.write(JSON.stringify(result));
  process.stderr.write(
    '完成：相机 ' + Object.keys(result.cameras).length +
    ' / 线扫 ' + Object.keys(result.linescan).length +
    ' / 光源 ' + Object.keys(result.lights).length +
    ' / 控制器 ' + Object.keys(result.controllers).length + '\n'
  );
})();
