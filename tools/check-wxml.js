/**
 * WXML 静态检查（不依赖微信开发者工具）
 *   1. 标签是否配平
 *   2. wx:else / wx:elif 前面必须有同级的 wx:if / wx:elif（去年踩过：删掉说明文字把 wx:else 变孤儿）
 *   3. <text> 里不能出现 <block> / <view>（text 只允许文本与嵌套 text，否则编译或渲染异常）
 *   4. {{ }} 是否配平
 * 用法：node tools/check-wxml.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '小程序项目', 'pages');
// 小程序的 canvas / video / camera / map 都要显式闭合，不能当作 void
const VOID = new Set(['image', 'input', 'icon', 'progress', 'switch', 'slider', 'import', 'include', 'wxs']);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    // 找标签结束的 '>'，跳过引号内的内容（wx:if="{{a > b}}" 很常见）
    let j = lt + 1, q = null;
    while (j < src.length) {
      const c = src[j];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    const raw = src.slice(lt + 1, j);
    const line = src.slice(0, lt).split('\n').length;
    const closing = raw[0] === '/';
    const selfClose = raw.endsWith('/');
    const name = (closing ? raw.slice(1) : raw).trim().split(/[\s/>]/)[0];
    const attrs = {};
    if (!closing) {
      const body = raw.replace(/\/$/, '');
      const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')|([\w:.-]+)/g;
      let m;
      while ((m = re.exec(body))) {
        const k = m[1] || m[5];
        if (!k || k === name) continue;
        attrs[k] = m[1] ? (m[3] !== undefined ? m[3] : m[4]) : true;
      }
    }
    out.push({ name, closing, selfClose, attrs, line });
    i = j + 1;
  }
  return out;
}

const problems = [];
function err(file, line, msg) { problems.push(file + ':' + line + '  ' + msg); }

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(__dirname, '..'), file);

  // {{ }} 配平
  const opens = (src.match(/\{\{/g) || []).length;
  const closes = (src.match(/\}\}/g) || []).length;
  if (opens !== closes) err(rel, 1, `{{ }} 不配平：{{ ×${opens} / }} ×${closes}`);

  const toks = tokenize(src);
  const stack = [];       // { name, line, hasIfSibling }
  for (const t of toks) {
    if (t.closing) {
      const top = stack.pop();
      if (!top) { err(rel, t.line, `多余的结束标签 </${t.name}>`); continue; }
      if (top.name !== t.name) err(rel, t.line, `标签未配平：<${top.name}>(第 ${top.line} 行) 被 </${t.name}> 关闭`);
      continue;
    }
    const parent = stack[stack.length - 1];
    const insideText = stack.some(x => x.name === 'text');

    if (insideText && (t.name === 'block' || t.name === 'view')) {
      err(rel, t.line, `<text> 里不能放 <${t.name}>，只能用文本或嵌套 <text>`);
    }

    const isCond = t.attrs['wx:if'] !== undefined || t.attrs['wx:elif'] !== undefined;
    if (t.attrs['wx:else'] !== undefined || t.attrs['wx:elif'] !== undefined) {
      const kind = t.attrs['wx:else'] !== undefined ? 'wx:else' : 'wx:elif';
      if (!parent || !parent.hasIfSibling) err(rel, t.line, `${kind} 前面没有同级的 wx:if / wx:elif`);
    }
    if (parent) parent.hasIfSibling = isCond;

    if (!t.selfClose && !VOID.has(t.name)) stack.push({ name: t.name, line: t.line, hasIfSibling: false });
    else if (parent) parent.hasIfSibling = isCond;
  }
  while (stack.length) {
    const t = stack.pop();
    err(rel, t.line, `未闭合的 <${t.name}>`);
  }
}

const arg = process.argv[2];
let scanned = 0;
if (arg) {
  checkFile(path.resolve(arg));           // 指定单个文件（便于调试检查器本身）
  scanned = 1;
} else {
  const pages = fs.readdirSync(ROOT).filter(d => fs.statSync(path.join(ROOT, d)).isDirectory());
  pages.forEach(d => {
    const f = path.join(ROOT, d, d + '.wxml');
    if (fs.existsSync(f)) { checkFile(f); scanned++; }
  });
}

if (problems.length) {
  console.log('WXML 检查发现问题：');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
console.log('WXML 检查通过：' + scanned + ' 个文件（标签配平 / wx:else 配对 / text 嵌套 / {{}} 配平）');
