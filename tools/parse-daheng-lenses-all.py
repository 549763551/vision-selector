#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大恒《工业视觉产品型录 —— 镜头篇》(manuals/大恒镜头产品型录.pdf, 全 58 页) 镜头全量抽取

用法:
    python tools/parse-daheng-lenses-all.py            # 抽取并写 JSON
    python tools/parse-daheng-lenses-all.py <诊断文件>  # 额外把逐页/逐族诊断(UTF-8)写到该路径

输出 tools/_cache/daheng_lenses_full.json:
    {"lenses": [...], "tele": [...], "unresolved": ["型号 — 原因", ...], "families": {"FTV": 51, ...}}

解析思路（字段语义与 tools/parse-daheng-lenses.py 一致）：
  1. pymupdf 取词级坐标 → 按 y 中心聚成视觉行 → 行内按 x 间隙聚成单元格（手册表格是
     「一行一条型号」的排版，直接用 get_text() 会把相邻行串行，所以必须走坐标）；
  2. 含「型号」的行当表头，表头单元格的关键词给出各列的候选语义与 x 范围；
  3. 数据单元格按 x 归到列，列语义再用「该列数据能被哪个解析器吃下」投票确认
     （手册里「畸变率(%) 工作距离(mm)」这类挤在一个表头格里，只能靠数据反推）；
  4. 章节标题含「远心」→ tele（放大倍率 + 工作距离）；含「滤镜/扩展环/增倍/转接/配件」
     → 非镜头表，丢弃；
  5. 一行多卡口 / 多倍率变体（无型号的子行）→ 拆成多条记录，model 用手册原文写法；
  6. 未知数值一律省略字段；卡口只保留引擎词表 C/F/M42/M58/M72/M12/V38，其余省略并记 unresolved。
"""
import io
import json
import os
import re
import sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, 'manuals', u'大恒镜头产品型录.pdf')
OUT = os.path.join(ROOT, 'tools', '_cache', 'daheng_lenses_full.json')

BRAND = u'大恒图像'
MOUNTS = ('C', 'F', 'M42', 'M58', 'M72', 'M12', 'V38')

# ------------------------------------------------------------------ 文本清洗
TRANS = {
    u'”': '"', u'“': '"', u'〞': '"', u'ˮ': '"',
    u'～': '~', u'‐': '-', u'‑': '-', u'–': '-', u'—': '-', u'−': '-',
    u'（': '(', u'）': ')', u'％': '%', u'Ⅰ': 'I', u'Ⅱ': 'II', u'Φ': u'Φ',
}


def norm(s):
    for k, v in TRANS.items():
        s = s.replace(k, v)
    return re.sub(r'\s+', ' ', s).strip()


# ------------------------------------------------------------------ 行重建
def page_rows(page, tol=4.0, gap=4.5):
    items = []
    for w in page.get_text('words'):
        t = norm(w[4])
        if t:
            items.append((w[0], w[2], (w[1] + w[3]) / 2.0, t))
    items.sort(key=lambda i: (i[2], i[0]))
    groups = []
    for x0, x1, yc, t in items:
        hit = None
        for g in groups:
            if abs(g[0] - yc) <= tol:
                hit = g
                break
        if hit is None:
            groups.append([yc, []])
            hit = groups[-1]
        hit[1].append((x0, x1, t))
    rows = []
    for yc, ws in sorted(groups, key=lambda g: g[0]):
        ws.sort()
        cells = []
        for x0, x1, t in ws:
            if cells and x0 - cells[-1][1] < gap:
                cells[-1][2] += ' ' + t
                cells[-1][1] = max(cells[-1][1], x1)
            else:
                cells.append([x0, x1, t])
        rows.append((yc, [tuple(c) for c in cells]))
    return rows


# ------------------------------------------------------------------ 数值解析
NUM = r'\d+(?:[.,]\d+)?'
DASH = r'(?:-|~)'


def fnum(s):
    try:
        return float(str(s).replace(',', '.'))
    except Exception:
        return None


FMT_CANON = {'1/3': '1/3"', '1/2.8': '1/2.8"', '1/2.7': '1/2.7"', '1/2.5': '1/2.5"',
             '1/2.4': '1/2.4"', '1/2.3': '1/2.3"', '1/2': '1/2"', '1/1.9': '1/1.9"',
             '1/1.8': '1/1.8"', '1/1.7': '1/1.7"', '1/1.6': '1/1.6"', '1/1.5': '1/1.5"',
             '1/1.4': '1/1.4"', '1/1.3': '1/1.3"', '1/1.2': '1/1.2"', '1/1.1': '1/1.1"',
             '2/3': '2/3"', '3/4': '3/4"', '4/3': '4/3"', '16/9': '16/9"',
             '1': '1"', '1.1': '1.1"', '1.2': '1.2"', '1.3': '1.3"', '1.4': '1.4"',
             '1.5': '1.5"', '1.6': '1.6"', '1.7': '1.7"', '1.8': '1.8"', '1.9': '1.9"',
             '2': '2"', '2.5': '2.5"', '3': '3"'}
IC_BY_FMT = {'1/3"': 6.0, '1/2.8"': 6.4, '1/2.7"': 6.6, '1/2.5"': 7.2, '1/2.4"': 7.4,
             '1/2.3"': 7.7, '1/2"': 8.0, '1/1.9"': 8.4, '1/1.8"': 8.9, '1/1.7"': 9.4,
             '1/1.6"': 10.0, '1/1.5"': 10.6, '1/1.4"': 11.3, '1/1.3"': 12.2,
             '1/1.2"': 13.3, '1/1.1"': 14.5, '2/3"': 11.0, '3/4"': 12.0, '1"': 16.0,
             '1.1"': 18.0, '1.2"': 19.3, '1.3"': 20.5, '1.4"': 22.0, '1.5"': 23.2,
             '1.6"': 24.4, '1.7"': 26.3, '1.8"': 28.5, '1.9"': 30.0, '2"': 32.0,
             '2.5"': 40.0, '3"': 48.0, '4/3"': 21.6, '16/9"': 17.0}


def parse_fmt(text):
    t = norm(text).replace(' ', '')
    t = re.sub(r'(?i)(ccd|cmos|cid|senser|sensor)$', '', t)
    m = re.match(r'^(\d+(?:/\d+(?:\.\d+)?)?(?:\.\d+)?)["\']?$', t)
    if m:
        key = m.group(1)
        fmt = FMT_CANON.get(key, key + '"')
        return fmt, IC_BY_FMT.get(fmt)
    m = re.match(r'^(?:Φ|Ø|φ)?\s*(%s)\s*(?:mm|MM)$' % NUM, t)
    if m:
        d = fnum(m.group(1))
        if d is not None and 3.0 <= d <= 200.0:
            return u'%smm' % m.group(1), d
    return None


def parse_focal(text):
    t = norm(text)
    m = re.match(r'^(%s)(?:%s(%s))?(?:\s*mm)?$' % (NUM, DASH, NUM), t)
    if not m:
        return None
    a = fnum(m.group(1))
    b = fnum(m.group(2)) if m.group(2) else None
    if a is None or a <= 0 or a > 2000:
        return None
    if b is not None and (b <= 0 or b > 2000):
        return None
    return [a] if b is None else [a, b]


def parse_aper(text):
    t = norm(text).replace(' ', '')
    m = re.match(r'^[FfTt](%s)(?:%s(?:[Ff]?(%s)|[Cc]lose))[A-Za-z]*$' % (NUM, DASH, NUM), t)
    if m:
        lo = fnum(m.group(1))
        hi = fnum(m.group(2)) if m.group(2) else None
        if hi and lo and lo > hi:
            lo, hi = hi, lo
        return lo, hi
    m = re.match(r'^[FfTt](%s)[A-Za-z]*$' % NUM, t)
    if m:
        return fnum(m.group(1)), None
    return None


def parse_mag(text):
    t = norm(text).replace(' ', '')
    m = re.match(r'^(%s)[Xx×]?(?:%s(%s)[Xx×]?)?$' % (NUM, DASH, NUM), t)
    if not m:
        return None
    a = fnum(m.group(1))
    b = fnum(m.group(2)) if m.group(2) else None
    if a is None or a <= 0 or a > 300:
        return None
    if b is None:
        # 单值：只有明确带 ×/X 或值 <10 才当倍率，否则更像焦距
        return (a, a)
    return (a, b) if a <= b else (b, a)


def parse_dist(text):
    t = norm(text).replace('%', '').replace('*', '').replace(' ', '')
    m = re.match(r'^([±]?)\s*(%s)$' % NUM, t)
    if not m:
        return None
    v = fnum(m.group(2))
    if v is None or v > 300:
        return None
    neg = t.startswith('-')
    return -v if neg else v


def parse_wd(text):
    """-> (minDist[米], wdMin[毫米], wdMax[毫米])"""
    t = norm(text).replace(' ', '')
    m = re.match(r'^(%s)(m|mm)?-%s(?:inf|无限远)$' % (NUM, DASH), t)
    m = m or re.match(r'^(%s)(m|mm)?-∞$' % NUM, t)
    if m:
        v = fnum(m.group(1))
        return (v if m.group(2) == 'm' else v / 1000.0), None, None
    m = re.match(r'^(%s)(?:mm)?%s(%s)(?:mm)?$' % (NUM, DASH, NUM), t)
    if m:
        a, b = fnum(m.group(1)), fnum(m.group(2))
        return None, a, b
    m = re.match(r'^>?(%s)(?:mm)?-?$' % NUM, t)
    if m:
        v = fnum(m.group(1))
        if v >= 3:
            return None, v, v
    return None


def parse_dims(text):
    t = norm(text)
    m = re.match(r'^(?:Φ|Ø|φ)?\s*(%s)\s*[×xX*]\s*(%s)(?:\s*/\s*(%s))?(?:\s*mm)?(?:\s*/\s*(?:L|D))?$'
                 % (NUM, NUM, NUM), t)
    if not m:
        return None
    return fnum(m.group(1)), fnum(m.group(2)), fnum(m.group(3))


def parse_filter(text):
    t = norm(text).replace(' ', '')
    if re.match(r'^M\d+(?:\.\d+)?[×x]\d+(?:\.\d+)?$', t):
        return t
    return None


# 手册表格里「接口」列与页码/脚注同处一行时常被聚成同一单元格：C 5 / F 39 / TFL 45 → C / F / TFL；
# 重复写法 C C → C。只对以字母结尾的卡口词生效，避免把 M52、V38 这类带数字的词尾削掉。
MOUNT_FOOTNOTE = re.compile(r'^(C|CS|F|TFL)\d{1,3}$')
MOUNT_DOUBLE = re.compile(r'^(C|F)(?:\1)$')


def parse_mounts(text):
    t = norm(text).replace(' ', '')
    if not t:
        return []
    out = []
    for part in re.split(r'[/、,()]+', t):
        p = part.strip()
        # 页码/脚注号常被并进「接口」单元格（C 5、F 39、TFL 45、C C）：先剥掉再匹配
        p = MOUNT_FOOTNOTE.sub(r'\1', p)
        p = MOUNT_DOUBLE.sub(r'\1', p)
        if not p:
            continue
        m = re.match(r'^(C|CS|F|M12|M42|M42\.?5|M52|M58|M72|M90|M95|V38|V48|V65|V70|V90|V110|TFL|C mount)$', p)
        if not m:
            m = re.match(r'^(C|CS|F|M12|M42|M58|M72|V38)(?:[×x].*)?$', p)
        if not m:
            continue
        v = m.group(1)
        if v in ('CS', 'C mount'):
            v = 'C'
        if v in MOUNTS and v not in out:
            out.append(v)
    return out


def mp_from_model(model):
    m = re.search(r'[-/](\d{1,2})M[A-Za-z0-9]*(?:[-/]|$)', model, re.I)
    if m:
        v = float(m.group(1))
        if 0.3 <= v <= 65:
            return v
    return None


# ------------------------------------------------------------------ 型号识别
RE_TOKEN = re.compile(r'^[A-Za-z][A-Za-z0-9.+/\-]*$')
# 明显是规格值而不是型号片段的词（从型号单元格里剔掉，防止串列）
SPEC_TOKEN = re.compile(
    r'''^(?:
          [ΦØφ]?\d+(?:\.\d+)?[×x\*]\d+(?:\.\d+)?      # 外形尺寸 Φ38×47
        | [FT]\d+(?:\.\d+)?(?:[-~]\d+(?:\.\d+)?|[Cc]lose)?  # 光圈 F2.8-F16
        | \d+(?:/\d+(?:\.\d+)?)?["']                   # 靶面 1/2" 2/3"
        | \d+(?:\.\d+)?(mm|MM|%)                       # 带单位数值
        | \d+(?:\.\d+)?[-~]\d+(?:\.\d+)?               # 范围 150-300
        | \d+(?:\.\d+)?[-~](?:∞|inf|无限远)
        | \d+(?:\.\d+)?[×xX]                          # 倍率 0.5×
        | [Mm]\d+(?:\.\d+)?[×x]\d+(?:\.\d+)?           # 螺纹 M30.5×0.5
        | [Kk]\d+MP|\d+MP|MP\d+                       # 像素
        | [\(（\[］\)]|[-–—~|/·.]+
        | mm|%|％|μm
      )$''', re.X)
PLACEHOLDER = re.compile(r'[□■△◇――—]+')
# 施耐特/Qioptiq 的型号本身就是「光圈/焦距」数字段，如 2.8/16、5.6/120/0.5x、0.01/0.1x
RE_MODEL_NUM = re.compile(r'^\d+(?:\.\d+)?/\d+(?:\.\d+)?[xX]?(?:/\d+(?:\.\d+)?[xX]?)?$')


RE_BARE_MOUNT = re.compile(r'(?i)^(?:C|CS|F|M12|M42(?:\.5)?|M52|M58|M72|M90|M95|V38|V48|V64|V70|V90|V110|TFL)$')


def clean_model(raw):
    """型号单元格 -> (手册原文型号, 是否含占位符)；非型号返回 (None, False)"""
    t = norm(raw)
    if RE_BARE_MOUNT.match(t):      # 单元格里只剩一个裸卡口词：不是型号
        return None, False
    had_ph = bool(PLACEHOLDER.search(t))
    t = PLACEHOLDER.sub(' ', t)
    t = re.sub(r'[（(]\s*(?:手动变焦|自动对焦|可选)?\s*[)）]', ' ', t)
    parts = []
    for tok in t.split(' '):
        tok = tok.strip('().*')
        if not tok:
            continue
        if RE_MODEL_NUM.match(tok):          # 2.8/16 这类数字段本身属于型号
            parts.append(tok)
            continue
        if SPEC_TOKEN.match(tok):
            continue
        if not RE_TOKEN.match(tok):        # 含中文/μ/×等非 ASCII 的一律不是型号片段
            continue
        parts.append(tok)
    if not parts:
        return None, had_ph
    m = ' '.join(parts)
    m = re.sub(r'\s+', ' ', m).strip(u' -/\u3000')
    if RE_BARE_MOUNT.match(m):        # 「● V38 口」这类脚注行：只剩裸卡口词
        return None, had_ph
    if len(m) < 3 or not re.search(r'[A-Za-z]', m):
        return None, had_ph
    if not re.search(r'\d', m) and not re.match(r'^(?:d\.fine|inspec|Macro|Rodagon|Rogonar|Apo)', m, re.I):
        return None, had_ph
    return m, had_ph


def is_model(raw):
    m, _ = clean_model(raw)
    return m is not None


def family(model):
    t = model.split(' ')[0]
    if re.search(r'\d', t):
        m = re.match(r'^([A-Za-z][A-Za-z.]*?(?:-[A-Za-z][A-Za-z.]*?)?)(?=[-\d/+]|$)', t)
        f = (m.group(1) if m and m.group(1) else re.split(r'[\d/+]', t)[0]).rstrip('-/')
        return (f or t)[:16]
    toks = model.split(' ')
    f = toks[0]
    if len(toks) > 1 and re.fullmatch(r'[A-Za-z][A-Za-z.]{0,8}', toks[1]):
        f = f + ' ' + toks[1]
    return f[:18]


# ------------------------------------------------------------------ 列语义
COL_PATTERNS = [
    (re.compile(u'型号|货号|订货号|订购码', re.I), 'model'),
    (re.compile(u'靶面|像面|传感器尺寸|成像尺寸|Format', re.I), 'fmt'),
    (re.compile(u'焦距|焦长', re.I), 'focal'),
    (re.compile(u'光圈', re.I), 'aper'),
    (re.compile(u'视场', re.I), 'fov'),
    (re.compile(u'畸变', re.I), 'dist'),
    (re.compile(u'工作距离|摄距|物距', re.I), 'wd'),
    (re.compile(u'放大倍率|倍率', re.I), 'mag'),
    (re.compile(u'滤镜', re.I), 'filter'),
    (re.compile(u'尺寸|外形|D×L', re.I), 'dims'),
    (re.compile(u'接口|卡口|Mount', re.I), 'mount'),
    (re.compile(u'像素|像元|分辨率', re.I), 'pix'),
    (re.compile(u'孔径|NA', re.I), 'na'),
    (re.compile(u'螺纹', re.I), 'filter'),
    (re.compile(u'规格', re.I), 'spec'),
    (re.compile(u'线扫描|区域传感', re.I), 'sensor'),
    (re.compile(u'调焦范围|响应时间|可重复性|涂层|波前', re.I), 'other'),
]

PARSERS = {
    'fmt': lambda t: parse_fmt(t) is not None,
    'focal': lambda t: bool(parse_focal(t)) and len(parse_focal(t)) == 1,
    'aper': lambda t: parse_aper(t) is not None,
    'dist': lambda t: parse_dist(t) is not None,
    'wd': lambda t: parse_wd(t) is not None,
    'mag': lambda t: parse_mag(t) is not None and (u'×' in t or re.search(r'[Xx]', t) or float(re.findall(NUM, t or '')[0] or 9) < 1),
    'dims': lambda t: parse_dims(t) is not None,
    'filter': lambda t: parse_filter(t) is not None,
    'mount': lambda t: bool(parse_mounts(t)) and len(t) <= 14,
    'pix': lambda t: bool(re.search(u'万|M[Pp]', t)),
    'model': lambda t: is_model(t),
    'fov': lambda t: bool(re.match(r'^%s\s*[×x]\s*%s' % (NUM, NUM), t)),
    'na': lambda t: False,
    'sensor': lambda t: True,
    'other': lambda t: False,
    'spec': lambda t: False,
}

KIND_CONF = {'model': 9, 'aper': 9, 'dims': 9, 'filter': 9, 'fmt': 8, 'wd': 8,
             'mag': 6, 'focal': 5, 'dist': 4, 'mount': 7, 'pix': 8, 'fov': 9,
             'na': 1, 'sensor': 1, 'other': 1, 'spec': 1}

# 判定「这是镜头参数表」的最小集合：只有滤镜/螺纹/规格列的表是配件表
LENS_SPEC_KINDS = {'fmt', 'focal', 'aper', 'fov', 'dist', 'wd', 'mag',
                   'mount', 'pix', 'sensor'}


def classify_cell(text):
    """表头单元格 -> 候选列语义（相邻关键词算同一个标签）"""
    cands = []
    last_end = -99
    for pat, kind in COL_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        if cands and m.start() - last_end <= 5:
            last_end = max(last_end, m.end())
            continue
        cands.append(kind)
        last_end = m.end()
    seen = []
    for c in cands:
        if c not in seen:
            seen.append(c)
    return seen


def score(kind, texts):
    fn = PARSERS.get(kind)
    if not fn:
        return 0.0
    hit = sum(1 for t in texts if t and safe(fn, t))
    return hit / max(1.0, len(texts))


def safe(fn, t):
    try:
        return bool(fn(t))
    except Exception:
        return False


# ------------------------------------------------------------------ 表格对象
class Table(object):
    def __init__(self, page, title, tele, module):
        self.page = page
        self.title = title
        self.tele = tele
        self.module = module
        self.bands = []       # [(x0, x1, [候选kinds], 定名kind)]
        self.last_models = []
        self.rows = 0
        self.recs = 0

    def band_of(self, x0, x1):
        xc = (x0 + x1) / 2.0
        for i, (bx0, bx1, kinds, kind) in enumerate(self.bands):
            if bx0 - 12 <= xc <= bx1 + 12:
                return i
        # 落在两列之间：归到最近的列
        best, bd = None, 1e9
        for i, (bx0, bx1, kinds, kind) in enumerate(self.bands):
            d = min(abs(xc - bx0), abs(xc - bx1))
            if d < bd:
                best, bd = i, d
        return best if bd < 40 else None


class Ctx(object):
    def __init__(self):
        self.lenses = []
        self.tele = []
        self.unresolved = []
        self.seen = set()
        self.seen_t = set()
        self.diag = []
        self.page_recs = {}

    def unp(self, model, why):
        s = u'%s — %s' % (model, why)
        if s not in self.unresolved:
            self.unresolved.append(s)


# ------------------------------------------------------------------ 章节标题
SKIP_KEYS = [u'滤镜', u'滤光', u'扩展环', u'增倍', u'转接', u'配件', u'光源', u'相机', u'支架', u'标定', u'系统组成', u'公司', u'介绍', u'目录', u'服务']
TELE_KEYS = [u'远心']
MODULE_KEYS = [u'电调液态透镜', u'手动调校液态透镜', u'液体镜头模组']


def dedupe_title(t):
    n = len(t)
    if n >= 6 and n % 2 == 0 and t[:n // 2] == t[n // 2:]:
        return t[:n // 2]
    return t


# ------------------------------------------------------------------ 行 -> 记录
def row_sides(tb, cells):
    """一行按「型号列」切成左右半栏，每栏返回 {kind: 文本}；没有型号的栏返回 models=[]"""
    mxs = sorted((x0 + x1) / 2.0 for x0, x1, kinds, kind in tb.bands if kind == 'model')
    sides = [{}] if len(mxs) < 2 else [{} for _ in mxs]
    for x0, x1, t in cells:
        xc = (x0 + x1) / 2.0
        bi = tb.band_of(x0, x1)
        if bi is None:
            continue
        kind = tb.bands[bi][3]
        si = 0
        if len(mxs) >= 2:
            dists = [abs(xc - m) for m in mxs]
            si = dists.index(min(dists))
        sides[si].setdefault(kind, []).append((x0, t))
    out = []
    for d in sides:
        if not d:
            continue
        for k in d:
            d[k].sort()
        models, ph = [], False
        for _, m in d.get('model', []):
            cm, had_ph = clean_model(m)
            if cm:
                models.append(cm)
                ph = ph or had_ph
        rec = {'models': models, 'placeholder': ph}
        for k, v in d.items():
            if k != 'model':
                rec[k] = ' '.join(t for _, t in v).strip()
        out.append(rec)
    return out


def specs_of(rec):
    return dict((k, v) for k, v in rec.items() if k not in ('models', 'placeholder'))


def get_fmt(rec):
    v = rec.get('fmt')
    if not v:
        return None
    best = None
    for part in re.split(r'\s*(?:~|/|、|,)\s*', v):
        r = parse_fmt(part)
        if not r:
            continue
        if r[1] is None:
            if best is None:
                best = r
            continue
        if best is None or (best[1] is not None and r[1] > best[1]):
            best = r
    return best


def build_lens(rec, tb, ctx):
    models = rec['models']
    fmtic = get_fmt(rec)
    focal = parse_focal(rec.get('focal', '')) if rec.get('focal') else None
    mag = parse_mag(rec.get('mag', '')) if rec.get('mag') else None
    if focal is None and rec.get('focal'):
        mm = parse_mag(rec['focal'])
        if mm and mm[0] < 1 and (u'×' in rec['focal'] or re.search(r'[Xx]', rec['focal'])):
            mag = mag or mm
    aper = parse_aper(rec.get('aper', '')) if rec.get('aper') else None
    dist = parse_dist(rec.get('dist', '')) if rec.get('dist') else None
    wd = parse_wd(rec.get('wd', '')) if rec.get('wd') else None
    dims = parse_dims(rec.get('dims', '')) if rec.get('dims') else None
    mounts = parse_mounts(rec.get('mount', '')) if rec.get('mount') else []
    pix = None
    if rec.get('pix'):
        m = re.search(r'(\d{1,4}(?:\.\d+)?)\s*(万|M[Pp])', rec['pix'])
        if m:
            v = fnum(m.group(1))
            pix = round(v / 100.0 if u'万' in m.group(2) else v, 2)
    for model in models:
        base = {'model': model, 'brand': BRAND, 'series': family(model) + u' 系列'}
        if fmtic:
            if fmtic[0]:
                base['fmt'] = fmtic[0]
            if fmtic[1] is not None:
                base['ic'] = round(fmtic[1], 1)
        if focal and len(focal) == 1:
            base['focal'] = focal[0]
        if aper:
            if aper[0] is not None:
                base['fmin'] = aper[0]
            if aper[1] is not None:
                base['fmax'] = aper[1]
        if pix is not None:
            base['mp'] = pix
        else:
            mp = mp_from_model(model)
            if mp is not None:
                base['mp'] = mp
        if dist is not None:
            base['dist'] = dist
        if wd and wd[0] is not None:
            base['minDist'] = round(wd[0], 4)
        if dims:
            base['len'] = round(dims[2] or dims[1], 2)
        if mounts:
            mlist = list(mounts)
        else:
            mlist = [None]
            raw = rec.get('mount', '')
            if raw and not re.match(r'^(?:[□■]|―+|-+|TBD|TDB|—+)$', raw):
                ctx.unp(model, u'卡口写法 %s 不在引擎词表(C/F/M42/M58/M72/M12/V38)' % raw)
            else:
                ctx.unp(model, u'手册该行无卡口信息')
        for mm in mlist:
            r = dict(base)
            if mm:
                r['mount'] = mm
            key = (r['model'], r.get('mount'), r.get('focal'), r.get('fmt'), r.get('minDist'))
            if key in ctx.seen:
                continue
            ctx.seen.add(key)
            if 'focal' not in r:
                if focal and len(focal) > 1:
                    ctx.unp(r['model'], u'变焦镜头焦距是范围 %s，单值 focal 无法表达' % rec.get('focal'))
                elif mag:
                    ctx.unp(r['model'], u'微距/变倍镜头只给放大倍率 %s，无焦距' % rec.get('mag', rec.get('focal', '')))
                else:
                    ctx.unp(r['model'], u'该行无焦距数据')
            ctx.lenses.append(r)
            ctx.recs += 1


def build_tele(rec, tb, ctx):
    models = rec['models']
    fmtic = get_fmt(rec)
    mag = parse_mag(rec.get('mag', '')) if rec.get('mag') else None
    if mag is None and rec.get('focal'):
        mag = parse_mag(rec['focal'])
    wd = parse_wd(rec.get('wd', '')) if rec.get('wd') else None
    mounts = parse_mounts(rec.get('mount', '')) if rec.get('mount') else []
    for model in models:
        base = {'series': family(model), 'model': model, 'brand': BRAND}
        if mag:
            base['magMin'] = mag[0]
            base['magMax'] = mag[1]
        if wd:
            if wd[0] is not None:
                base['wdMin'] = round(wd[0] * 1000, 2)
                base['wdMax'] = round(wd[0] * 1000, 2)
            elif wd[1] is not None:
                base['wdMin'] = wd[1]
                base['wdMax'] = wd[2] if wd[2] is not None else wd[1]
        if fmtic and fmtic[0]:
            base['fmt'] = fmtic[0]
        mlist = mounts or [None]
        if not mounts:
            raw = rec.get('mount', '')
            if raw and not re.match(r'^(?:[□■]|―+|-+|TBD|TDB|—+)$', raw):
                ctx.unp(model, u'远心：卡口写法 %s 不在引擎词表' % raw)
        for mm in mlist:
            r = dict(base)
            if mm:
                r['mount'] = mm
            r['coax'] = False
            r['kind'] = 'tele'
            key = (r['model'], r.get('mount'), r.get('magMin'), r.get('wdMin'), r.get('fmt'))
            if key in ctx.seen_t:
                continue
            ctx.seen_t.add(key)
            if 'magMin' not in r:
                ctx.unp(model, u'远心表格该行没有放大倍率数据')
            ctx.tele.append(r)
            ctx.recs += 1


def is_header(cells):
    return any(u'型号' in t or u'订货号' in t or u'货号' in t for _, _, t in cells)


def new_section(txt):
    """返回 (title, tele, module, skip)"""
    t = dedupe_title(norm(txt.replace(u'▎', u'')))
    tele = any(k in t for k in TELE_KEYS)
    module = any(k in t for k in MODULE_KEYS)
    has_lens = (u'镜头' in t) or tele
    skip = (any(k in t for k in SKIP_KEYS) and not has_lens) or (module and not tele)
    return t, tele, module, skip


def run():
    doc = pymupdf.open(PDF)
    ctx = Ctx()
    ctx.recs = 0
    page_lens = []
    tables = []
    tb = None
    pending = []
    title, tele, module, skip = u'', False, False, False

    for pno in range(1, doc.page_count + 1):
        page = doc[pno - 1]
        page_lens.append(len(page.get_text()))
        rows = page_rows(page)
        i = 0
        while i < len(rows):
            yc, cells = rows[i]
            txt = u' '.join(t for _, _, t in cells)
            if u'▎' in txt:
                if tb is not None and pending:
                    finalize(tb, pending, ctx)
                tb, pending = None, []
                title, tele, module, skip = new_section(txt)
                i += 1
                continue
            if is_header(cells):
                if tb is not None and pending:
                    finalize(tb, pending, ctx)
                pending = []
                # 表头分区合并：手册表头常拆成上下两行（标签/单位各一行），
                # 把 ±20pt 内「带列语义」的单元格并进表头再建列。
                # 注意：窗口放宽到 ±4 行 / ±34pt 会把同页相邻表的表头并进来，实测反而
                # 丢掉 55 条镜头、12 条远心记录（整表被判为配件表），所以维持 ±2 行 / ±20pt，
                # 工作距离/最小摄距缺失留给 tools/curate-daheng-lenses.py 按手册行窗口补录。
                hcells = list(cells)
                for j in range(max(0, i - 2), min(len(rows), i + 3)):
                    if j == i:
                        continue
                    yj, cj = rows[j]
                    if abs(yj - yc) > 20:
                        continue
                    for x0, x1, t in cj:
                        if classify_cell(t) and not re.search(r'\d', t):
                            hcells.append((x0, x1, t))
                look = [c for _, c in rows[i + 1:i + 15]]
                cand = Table(pno, title, tele, module)
                cand.bands = bands_of(hcells, look)
                if len([b for b in cand.bands if b[3] != 'model']) >= 2 and \
                        any(b[3] in LENS_SPEC_KINDS for b in cand.bands):
                    tb = cand
                    tables.append(tb)
                else:
                    tb = None       # 配件/滤镜表：列不够或无镜头规格列，整表丢弃
                i += 1
                continue
            if tb is not None and not skip:
                pending.append(cells)
            i += 1
    if tb is not None and pending:
        finalize(tb, pending, ctx)

    # p29 电调/手调液态透镜模组（Opto）：手册给的是驱动电压/通光孔径/接口圈
    # 等参数，不属于镜头入库字段，无法入库 → 全部记 unresolved。
    emitted = set(r['model'] for r in ctx.lenses) | set(r['model'] for r in ctx.tele)
    if doc.page_count >= 29:
        toks = set(t.rstrip('-') for t in
                   re.findall(r'(?:EL|ML)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', doc[28].get_text()))
        for mm in sorted(toks):
            if mm in emitted:
                continue
            ctx.unp(mm, u'p29 电调/手调液态透镜模组，型录参数为驱动电压/通光孔径等，非镜头字段，未入库')

    # p36 「▎H85014-F大孔径镜头」仅为章节标题，产品表型号印作 HB5014-F（已入库）。
    if u'H85014-F' not in emitted:
        ctx.unp(u'H85014-F', u'p36 仅作为章节标题「▎H85014-F大孔径镜头」出现，产品表型号印作 HB5014-F，已按该写法入库')

    # 逐页记录数（诊断用）
    ctx.page_recs = {}
    for t in tables:
        ctx.page_recs[t.page] = ctx.page_recs.get(t.page, 0) + getattr(t, 'made', 0)
    ctx.tables = tables
    ctx.page_lens = page_lens
    return ctx, page_lens, doc


def bands_of(header_cells, look_rows):
    raw = []
    for x0, x1, t in sorted(header_cells):
        kinds = classify_cell(t)
        if not kinds:
            continue
        if raw and x0 - raw[-1][1] < 6 and len(kinds) == 1 and raw[-1][2] == kinds:
            raw[-1][1] = max(raw[-1][1], x1)
            continue
        raw.append([x0, x1, kinds])
    bands = []
    for x0, x1, kinds in raw:
        if len(kinds) == 1:
            bands.append([x0, x1, kinds, kinds[0]])
            continue
        # 一个表头格里挤了多列：按该 x 区间内数据的 x 聚簇切分
        pts = []
        for cells in look_rows:
            for a, b, t in cells:
                xc = (a + b) / 2.0
                if x0 - 14 <= xc <= x1 + 14:
                    pts.append((xc, t))
        pts.sort()
        groups = []
        for xc, t in pts:
            if groups and xc - groups[-1][-1][0] <= 24:
                groups[-1].append((xc, t))
            else:
                groups.append([(xc, t)])
        if len(groups) <= 1:
            texts = [t for _, t in pts] or ['']
            kind = max(kinds, key=lambda k: score(k, texts) * KIND_CONF.get(k, 1) + KIND_CONF.get(k, 1) * 0.05)
            bands.append([x0, x1, kinds, kind])
            continue
        used, assigned = set(), {}
        for k in sorted(kinds, key=lambda k: -KIND_CONF.get(k, 1)):
            bi, bs = None, 0.0
            for gi, g in enumerate(groups):
                if gi in used:
                    continue
                s = score(k, [t for _, t in g]) * KIND_CONF.get(k, 1)
                if s > bs:
                    bi, bs = gi, s
            if bi is not None:
                assigned[bi] = k
                used.add(bi)
        for gi, g in enumerate(groups):
            xs = [xc for xc, _ in g]
            kind = assigned.get(gi)
            if kind is None:
                rest = [k for k in kinds if k not in assigned.values()]
                kind = rest[0] if rest else 'other'
            bands.append([min(xs) - 13, max(xs) + 13, [kind], kind])
    bands.sort()
    # 去重：同 kind 且 x 相邻（表头被拆成两个词）
    clean = []
    for b in bands:
        if clean and clean[-1][3] == b[3] and b[0] - clean[-1][1] < 10:
            clean[-1][1] = max(clean[-1][1], b[1])
            continue
        if clean and b[3] != 'other' and clean[-1][3] == 'other' and b[0] - clean[-1][1] < 10:
            clean[-1] = [clean[-1][0], b[1], b[2], b[3]]
            continue
        clean.append(list(b))
    return [tuple(b) for b in clean]


def finalize(tb, pending, ctx):
    if not tb.bands:
        tb.made = 0
        return
    before = ctx.recs
    held = []          # 「型号一行、参数在相邻行」的手册排版：暂待合并的型号行

    def emit(rec):
        if rec.get('placeholder'):
            for mm in rec['models']:
                ctx.unp(mm, u'手册型号里带 □/―― 占位符（口径或卡口变体未印全），已按去掉占位符的写法入库')
        if tb.tele:
            build_tele(rec, tb, ctx)
        else:
            build_lens(rec, tb, ctx)

    def flush():
        for rec in held:
            if rec['models']:
                emit(rec)
        del held[:]

    for cells in pending:
        sides = row_sides(tb, cells)
        mods = [s for s in sides if s['models']]
        cont = [s for s in sides if not s['models'] and specs_of(s)]
        if mods:
            flush()
            held = sides
        elif cont and len(cont) == len(held):
            # 参数续行（倍率/∞/螺纹/尺寸等）并入同栏上一条型号行
            for p, c in zip(held, cont):
                for k, v in specs_of(c).items():
                    cur = p.get(k, '')
                    if not cur:
                        p[k] = v
                    elif v and v not in cur.split():
                        p[k] = cur + ' ' + v
        elif not mods and not cont:
            flush()
    flush()
    tb.made = ctx.recs - before


# ------------------------------------------------------------------ 报告
def fam_counts(ctx):
    fam = {}
    for r in ctx.lenses:
        fam.setdefault(family(r['model']), 0)
        fam[family(r['model'])] += 1
    for r in ctx.tele:
        fam.setdefault(family(r['model']), 0)
        fam[family(r['model'])] += 1
    return dict(sorted(fam.items(), key=lambda kv: (-kv[1], kv[0])))


def report(ctx, doc, diag_path=None):
    out = {'lenses': ctx.lenses, 'tele': ctx.tele,
           'unresolved': ctx.unresolved, 'families': fam_counts(ctx)}
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    lines = []
    lines.append(u'合计 lenses=%d tele=%d unresolved=%d' %
                 (len(ctx.lenses), len(ctx.tele), len(ctx.unresolved)))
    lines.append(u'每页文字层长度: ' + u', '.join(u'p%d=%d' % (i + 1, n)
                                              for i, n in enumerate(ctx.page_lens)))
    lines.append(u'文字层 <200 字的页码: %s' % [i + 1 for i, n in enumerate(ctx.page_lens) if n < 200])
    lines.append(u'')
    lines.append(u'== 逐表 (页/是否远心/章节标题/列语义/记录数) ==')
    for t in ctx.tables:
        lines.append(u'p%-2d %-5s %-42s %-58s -> %d' %
                     (t.page, u'远心' if t.tele else u'镜头', (t.title or u'')[:42],
                      u','.join(b[3] for b in t.bands), getattr(t, 'made', 0)))
    lines.append(u'')
    lines.append(u'== 族系计数 ==')
    for k, v in out['families'].items():
        lines.append(u'%s: %d' % (k, v))
    lines.append(u'')
    lines.append(u'== 每族 2 条样例 ==')
    byf = {}
    for r in ctx.lenses + ctx.tele:
        byf.setdefault(family(r['model']), []).append(r)
    for k in sorted(byf):
        lines.append(u'--- %s (%d) ---' % (k, len(byf[k])))
        for r in byf[k][:2]:
            lines.append(u'  ' + json.dumps(r, ensure_ascii=False))
    if diag_path:
        with io.open(diag_path, 'w', encoding='utf-8') as f:
            f.write(u'\n'.join(lines))
    for s in lines[:3]:
        sys.stdout.write(s.encode('ascii', 'backslashreplace').decode('ascii') + '\n')
    fams = out['families']
    sys.stdout.write(('families=%d  ' % len(fams)) +
                     ' '.join('%s:%d' % (k, v) for k, v in list(fams.items())[:60]) + '\n')
    sys.stdout.write('diag -> %s\n' % (diag_path or ''))
    return out


if __name__ == '__main__':
    c, pl, d = run()
    report(c, d, sys.argv[1] if len(sys.argv) > 1 else None)
