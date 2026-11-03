/**
 * 主库相机行 vs 官网参数对账修正（默认只出报告，--apply 才写文件）。
 *
 * 为什么不能照差异清单直接改：官网字段本身有坑——
 *   1) 最大帧率常写两种模式（如 CB060-10GM-C「19.1 fps Mono8 / 30.7 fps Mono8(80-bit)」），
 *      主库取的是第二模式，不是错值；分辨率同理（CH120-10CM「4096×3000(Full),3840×3000(80-bit)」）。
 *   2) 同裸名常有 V5/V2/PRO/NPOE 硬件版本行，两版参数不同（CS050-10UM 60fps，10UM V5 74fps），
 *      主库对上的可能是旧版。
 *   3) 接口串台要靠型号命名尾字母交叉验证（G网口 / U·V USB3 / N 2.5G / T万兆 /
 *      C CameraLink / X·Y CoaXPress / F XoFLink / A XoCLink），字母与官网一致才改。
 * 所以本脚本只在「单一取值 + 无版本冲突 + 命名字母印证」时才动手，其余进复核清单。
 *
 * 用法：
 *   node tools/apply-hikrobot-web-fixes.js            # 试运行，只看报告
 *   node tools/apply-hikrobot-web-fixes.js --apply    # 写回 hikrobot-catalog.js 并同步小程序 lib
 * 报告：tools/_cache/hikrobot_fixes.txt（已改）/ hikrobot_review.txt（复核清单）
 */
'use strict';
const fs = require('fs');

const CAT = 'hikrobot-catalog.js';
const MINIPROGRAM = '小程序项目/lib/' + CAT;
const RAW = 'tools/_cache/hikrobot_official_raw.json';
const APPLY = process.argv.indexOf('--apply') >= 0;

const official = JSON.parse(fs.readFileSync(RAW, 'utf8'));

const norm = (m) => String(m || '').toUpperCase().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');

/* ---------------- 官网侧：取值解析 + 版本分组 ---------------- */

const VERSION_TOKEN = /^(V\d+(\.\d+)?|PRO|EOL|BASE|OCT|NPOE)$/i;

/** MV-CS050-10UM V5 / MV-CS050-10UM / MV-CS050-10UM(NPOE) → 同一裸名分组 */
function baseOf(key) {
  return String(key).toUpperCase().replace(/[（）()]/g, '-')
    .split(/[\s\-]+/)
    .filter((t) => t && !VERSION_TOKEN.test(t))
    .join('-');
}
const groups = {};
Object.keys(official).forEach((k) => {
  const b = baseOf(k);
  (groups[b] = groups[b] || []).push(k);
});

const ifaceOf = (f) => {
  const t = String(f['数据接口'] || '') + ' ' + String(f['协议/标准'] || '');
  if (/2\.5\s*Gigabit|2500M/i.test(t)) return '2.5GigE';
  if (/10\s*Gigabit|万兆|10000M/i.test(t)) return '10GigE';
  if (/USB\s*3/i.test(t)) return 'USB3';
  if (/X\s*over\s*Fiber|XoFLink/i.test(t)) return 'XoFLink';
  if (/光纤|2LC|LC接口/i.test(t)) return 'XoFLink';
  if (/XoCLink/i.test(t)) return 'XoCLink';
  if (/Camera\s*Link/i.test(t)) return 'CameraLink';
  if (/CoaXPress/i.test(t)) return 'CoaXPress';
  if (/Gigabit Ethernet|1000M/i.test(t)) return 'GigE';
  return null;
};
const mountOf = (f) => {
  const t = String(f['镜头接口'] || '');
  if (/M12/i.test(t)) return 'M12';
  if (/M58/i.test(t)) return 'M58';
  if (/M72/i.test(t)) return 'M72';
  if (/M90/i.test(t)) return 'M90';
  if (/M42/i.test(t)) return /F口|F 口/.test(t) && !/M42\*1/.test(t) ? 'M42/F' : (/(F口|转接至F)/i.test(t) ? 'M42/F' : 'M42');
  if (/F[- ]?MOUNT|F口|F 口/i.test(t)) return 'F';
  if (/C[- ]?MOUNT|C-Mount|C口/i.test(t)) return 'C';
  if (/裸板|板级|BOARD/i.test(t)) return 'Bare';
  return null;
};
const colorOf = (f) => {
  const t = String(f['黑白/彩色'] || '');
  if (/近红外|NIR/i.test(t)) return '近红外';
  if (/偏振/i.test(t)) return '偏振';
  if (/彩色/i.test(t)) return '彩色';
  if (/黑白|mono/i.test(t)) return '黑白';
  return null;
};
/** 只在「整格只有一个值」时返回，多模式返回 {multi:true} */
function singleRes(f) {
  const m = String(f['分辨率'] || '').match(/\d{3,5}\s*[×x]\s*\d{3,5}/gi) || [];
  if (m.length !== 1) return { multi: m.length > 1 };
  const p = m[0].match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/i);
  return { value: [+p[1], +p[2]] };
}
function singlePx(f) {
  const m = String(f['像元尺寸'] || '').match(/([\d.]+)\s*[μu]/gi) || [];
  if (m.length !== 1) return { multi: m.length > 1 };
  return { value: +m[0].match(/([\d.]+)/)[1] };
}
function singleFps(f, line) {
  const s = String((line ? f['最大行频'] : f['最大帧率']) || '');
  const unit = line ? /([\d.]+)\s*kHz/gi : /([\d.]+)\s*fps/gi;
  const hits = s.match(unit) || [];
  if (hits.length !== 1) return { multi: hits.length > 1 };
  const val = +hits[0].match(/([\d.]+)/)[1];
  // fps 若绑定在某个 @分辨率 上，而该分辨率不是唯一的满幅分辨率 → 是子模式帧率，不用
  const at = s.match(/@\s*\d{3,5}\s*[×x]\s*\d{3,5}/i);
  const res = singleRes(f);
  if (!line && at && res.value) {
    const r = at[0].match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/i);
    if (+r[1] !== res.value[0] || +r[2] !== res.value[1]) return { multi: true };
  }
  return { value: val };
}
function sensorOf(f) {
  const raw = String(f['传感器型号'] || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') return null;
  const v = raw.replace(/^(Sony|Gpixel|OnSemi|Samsung)\s+/i, '').trim();
  if (/^IMX\d/i.test(v)) return 'Sony ' + v;
  if (/^GMAX\d/i.test(v)) return 'Gpixel ' + v;
  if (/^XGS\d/i.test(v)) return 'OnSemi ' + v;
  return v;
}

/** 型号命名尾段推断接口/感光：末段数字块里倒数第二个字母是接口、最后一个字母是感光 */
const L_IFACE = { G: 'GigE', U: 'USB3', V: 'USB3', N: '2.5GigE', T: '10GigE', C: 'CameraLink', X: 'CoaXPress', Y: 'CoaXPress', F: 'XoFLink', A: 'XoCLink' };
const L_COLOR = { M: 1, C: 1, N: 1, P: 1 };
function letterSpec(model) {
  const parts = norm(model).split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const p = parts[i];
    if (!/\d/.test(p)) continue;
    const letters = p.replace(/[^A-Z]/g, '');
    if (letters.length < 2) continue;
    const iface = letters[letters.length - 2], color = letters[letters.length - 1];
    if (!L_IFACE[iface] || !L_COLOR[color]) continue;
    return { iface: L_IFACE[iface], color: color };
  }
  return null;
}

/** 库型号 → 官网候选：精确优先，其次「裸名 + 后缀/版本」 */
function candidates(model) {
  const n = norm(model);
  const exact = Object.keys(official).filter((k) => norm(k) === n);
  if (exact.length) return { list: exact, how: 'exact' };
  const pre = Object.keys(official).filter((k) => {
    const o = norm(k);
    return o.length > n.length && o.startsWith(n) && /^[-V0-9(|]/.test(o[n.length]);
  });
  return pre.length ? { list: pre, how: 'prefix' + pre.length } : null;
}

/** 该字段在官网是否可信：候选一致 + 无版本行冲突 */
function consensus(keys, getter) {
  const vals = keys.map((k) => getter(official[k])).filter((v) => v != null);
  if (!vals.length) return null;
  const uniq = [];
  vals.forEach((v) => { if (uniq.indexOf(v) < 0) uniq.push(v); });
  if (uniq.length !== 1) return null;
  // 版本行冲突：同裸名分组里存在别的 SKU，且该字段取值不同
  const base = baseOf(keys[0]);
  const twin = (groups[base] || []).filter((k) => keys.indexOf(k) < 0);
  for (let i = 0; i < twin.length; i++) {
    const tv = getter(official[twin[i]]);
    if (tv != null && tv !== uniq[0]) return null;
  }
  return uniq[0];
}

/* ---------------- 逐行修正 ---------------- */

const IFACE_WORD = { GigE: 'GigE', '2.5GigE': 'GigE', USB3: 'USB3.0', '10GigE': '万兆网', CameraLink: 'Camera Link', CoaXPress: 'CoaXPress', XoFLink: 'XoFLink', XoCLink: 'XoCLink' };

const applied = [];
const review = [];
function logFix(model, field, from, to, basis) {
  applied.push(model.padEnd(24) + ' ' + field.padEnd(7) + ' ' + String(from) + ' → ' + String(to) + '   [' + basis + ']');
}
function logReview(model, field, from, to, why) {
  review.push(model.padEnd(24) + ' ' + field.padEnd(7) + ' ' + String(from) + ' ≠ ' + String(to) + '   因：' + why);
}

/** 把一行记录的某个字符串字段改掉（行内 JSON 只有一层，键名唯一） */
function setStr(line, key, val) {
  const re = new RegExp('"' + key + '":(?:null|"[^"]*")');
  if (!re.test(line)) return null;
  return line.replace(re, '"' + key + '":' + JSON.stringify(val));
}
function setNum(line, key, val) {
  const re = new RegExp('"' + key + '":([\\d.]+)');
  if (!re.test(line)) return null;
  return line.replace(re, '"' + key + '":' + val);
}

function fixLine(line) {
  const mm = line.match(/^\s*\{"model":"([^"]+)"/);
  if (!mm) return line;
  const model = mm[1];
  const rec = JSON.parse(line.trim().replace(/,$/, ''));
  const isLine = rec.w != null && rec.h == null;
  let out = line;

  /** 改一个字段；键不存在时返回 false，不误报成「已修正」。fill=true 允许把 null 补成官网值 */
  function set(key, val, fill) {
    if (rec[key] == null && !fill) return false;
    const next = typeof val === 'number' ? setNum(out, key, val) : setStr(out, key, val);
    if (next == null) return false;
    out = next;
    rec[key] = val;
    return true;
  }

  const cand = candidates(model);
  if (!cand) {
    if (rec.series === 'C 系列 GigE') fixSeriesFamily(model, rec, set);
    return out;
  }
  const keys = cand.list;
  const spec = letterSpec(model);

  /* 接口 */
  const oIf = consensus(keys, ifaceOf);
  if (oIf && oIf !== rec.iface) {
    const letterOk = !spec || spec.iface === null || spec.iface === oIf;
    if (letterOk) {
      const from = rec.iface;
      if (set('iface', oIf)) {
        logFix(model, 'iface', from, oIf, cand.how + (spec && spec.iface ? ' + 字母' + spec.iface : ''));
        /* 系列名里的接口词跟着改；万兆网/2.5G 属家族标签，不动 */
        const oldWord = IFACE_WORD[from], newWord = IFACE_WORD[oIf];
        if (rec.series && oldWord !== newWord && oldWord !== '万兆网' &&
            from !== 'GigE' && oIf !== '2.5GigE' && rec.series.indexOf(oldWord) >= 0) {
          const s = rec.series.replace(oldWord, newWord);
          if (set('series', s)) logFix(model, 'series', oldWord, newWord, '随接口');
        }
      }
    } else {
      logReview(model, 'iface', rec.iface, oIf, '命名字母判为 ' + spec.iface + '，与官网不一致');
    }
  } else if (!oIf) {
    const seen = Array.from(new Set(keys.map((k) => ifaceOf(official[k])).filter(Boolean)));
    if (seen.length > 1) logReview(model, 'iface', rec.iface, seen.join('/'), '官网候选接口不一致');
  }

  /* 传感器：主库是残缺/脏值时才采用官网；厂商前缀差异（IMX297 vs Sony IMX297）不算错，不动 */
  const oSen = consensus(keys, sensorOf);
  if (oSen && oSen !== rec.sensor) {
    const cur = String(rec.sensor == null ? '' : rec.sensor);
    const bare = (s) => String(s).replace(/^(Sony|Gpixel|OnSemi|Samsung)\s+/i, '').trim();
    /** 手册常把「IMX304 1/1.1″」挤进传感器格，丢掉纯数字/分数碎片后才是型号本体 */
    const head = cur.split(/\s+/).filter((t) => !/^\d+([.\/]\d+)*\.?[″"’']*$/.test(t)).join(' ').trim();
    const prefixOnly = cur && bare(cur) === bare(oSen);
    const sameSensor = cur && bare(head) === bare(oSen);
    const junk = !cur || cur.length <= 4 || /^\d+(\.\d+)?\s*(mm|m|″|"|'')?$/i.test(cur) ||
      oSen.toUpperCase().indexOf(bare(head).toUpperCase()) >= 0 ||
      bare(head).toUpperCase().indexOf(oSen.toUpperCase().replace(/\s/g, '')) >= 0;
    if (!prefixOnly && (sameSensor || junk)) {
      if (set('sensor', oSen, !cur)) logFix(model, 'sensor', cur || '(空)', oSen, cand.how + (sameSensor ? ' 清洗脏尾' : ''));
    } else if (cur && !prefixOnly) {
      logReview(model, 'sensor', cur, oSen, '主库值是另一颗传感器，需人工判');
    }
  }

  /* 卡口 / 感光：只认精确同名 */
  if (cand.how === 'exact') {
    const oMn = consensus(keys, mountOf);
    if (oMn && oMn !== rec.mount) { const from = rec.mount; if (set('mount', oMn)) logFix(model, 'mount', from, oMn, 'exact'); }
    const oCo = consensus(keys, colorOf);
    if (oCo && oCo !== rec.color) { const from = rec.color; if (set('color', oCo)) logFix(model, 'color', from, oCo, 'exact'); }
  }

  /* 数值：分辨率 / 像元 / 帧率行频 —— 单一取值 + 无版本冲突 + 精确或唯一候选 */
  const singleCand = cand.how === 'exact' || keys.length === 1;
  if (singleCand && !isLine) {
    const r = singleRes(official[keys[0]]);
    if (r.value && (r.value[0] !== rec.w || r.value[1] !== rec.h)) {
      const g = consensus(keys, (f) => { const x = singleRes(f); return x.value ? x.value.join('×') : null; });
      if (g) {
        const from = rec.w + '×' + rec.h, px = rec.pxUm;
        const ok = set('w', r.value[0]) && set('h', r.value[1]);
        if (px) {
          set('sw', Math.round(r.value[0] * px) / 1000);
          set('sh', Math.round(r.value[1] * px) / 1000);
        }
        if (ok) logFix(model, '分辨率', from, r.value.join('×'), cand.how + '（sw/sh 同步重算）');
      } else logReview(model, '分辨率', rec.w + '×' + rec.h, '官网另一值', '同裸名的版本行取值冲突');
    } else if (r.multi) {
      logReview(model, '分辨率', rec.w + '×' + rec.h, '官网多模式', '官方一格列了两种输出模式');
    }
  }
  if (singleCand) {
    const key = isLine ? 'lineRate' : 'fps';
    const fr = singleFps(official[keys[0]], isLine);
    const cur = rec[key];
    if (fr.value && cur != null && Math.abs(cur - fr.value) / fr.value > 0.03) {
      const g = consensus(keys, (f) => singleFps(f, isLine).value);
      if (g) { if (set(key, fr.value)) logFix(model, isLine ? '行频' : '帧率', cur, fr.value, cand.how); }
      else logReview(model, isLine ? '行频' : '帧率', cur, fr.value, '同裸名的版本行/多模式冲突');
    } else if (fr.multi && cur != null) {
      logReview(model, isLine ? '行频' : '帧率', cur, '官网多模式', '官方一格列了两种帧率模式，主库取其中一种');
    }
    const p = singlePx(official[keys[0]]);
    if (p.value && rec.pxUm != null && Math.abs(rec.pxUm - p.value) > 0.02) {
      const g = consensus(keys, (f) => singlePx(f).value);
      if (g) {
        const from = rec.pxUm, w = rec.w, h = rec.h;
        if (set('pxUm', p.value)) {
          if (w && h) { set('sw', Math.round(w * p.value) / 1000); set('sh', Math.round(h * p.value) / 1000); }
          logFix(model, 'pxUm', from, p.value, cand.how);
        }
      }
    }
  }

  /* 系列名：手册章节标签把 CH 写成 "C 系列 GigE"，按型号家族修正 */
  if (rec.series === 'C 系列 GigE') fixSeriesFamily(model, rec, set);
  else if (/系列 万兆网$/.test(rec.series || '')) {
    const from = rec.series, s = from.replace('系列 万兆网', '系列万兆网');
    if (set('series', s)) logFix(model, 'series', from, s, '并入既有万兆网系列分组');
  }
  return out;
}

function fixSeriesFamily(model, rec, set) {
  const from = rec.series, s = familyOf(model) + ' 系列 GigE';
  if (set('series', s)) logFix(model, 'series', from, s, '手册章节名漏了子系列字母');
}

function familyOf(model) {
  const m = norm(model).match(/^MV-(C[STHBLDR]|CL\d?)/);
  if (!m) return 'C';
  const s = m[1];
  if (s.length > 2) return s.slice(0, 2);
  return s;
}

const text = fs.readFileSync(CAT, 'utf8');
let nEdit = 0;
const lines = text.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*\{"model":"/.test(lines[i])) continue;
  if (!/"kind":"(area|board)"/.test(lines[i]) && !/"taps":/.test(lines[i])) continue;
  const fixed = fixLine(lines[i]);
  if (fixed !== lines[i]) {
    try { JSON.parse(fixed.trim().replace(/,$/, '')); }
    catch (e) { console.log('!! 改坏行，跳过 ' + lines[i].trim().slice(0, 60) + ' → ' + e.message); continue; }
    nEdit++; lines[i] = fixed;
  }
}
const result = lines.join('\n');

applied.sort(); review.sort();
fs.writeFileSync('tools/_cache/hikrobot_fixes.txt',
  '官网对账修正 ' + new Date().toISOString().slice(0, 10) + '  共 ' + nEdit + ' 行 / ' + applied.length + ' 处\n' +
  '='.repeat(100) + '\n' + applied.join('\n') + '\n');
fs.writeFileSync('tools/_cache/hikrobot_review.txt',
  '未自动修改的官网差异（复核清单）共 ' + review.length + ' 处\n' +
  '判定规则：官网一格多模式 / V5·V2 版本行取值冲突 / 命名字母与官网不符，都不自动改。\n' +
  '='.repeat(100) + '\n' + review.join('\n') + '\n');

console.log('改动行数 ' + nEdit + '，修正项 ' + applied.length + '，复核项 ' + review.length);
const byField = {};
applied.forEach((a) => { const k = a.trim().split(/\s+/)[1]; byField[k] = (byField[k] || 0) + 1; });
console.log('按字段', JSON.stringify(byField));

if (APPLY) {
  fs.writeFileSync(CAT, result);
  fs.writeFileSync(MINIPROGRAM, result);
  console.log('已写回 ' + CAT + ' 并同步 ' + MINIPROGRAM);
} else {
  console.log('试运行（未写文件）：加 --apply 生效');
}
