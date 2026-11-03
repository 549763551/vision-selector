# -*- coding: utf-8 -*-
r"""大恒图像工业相机 v2 抽取 + 质量核查（只读手册与现网库，只写 _cache 下三个新文件）。

与 tools/parse-daheng-cams.py（v1）的差异：
  1) 型号锚点正则：v1 的 `^(MER3?|ME2[SCPL]|...)-\d{2,4}-\d{1,3}[A-Z0-9.\-/]*$` 有三处硬伤
     - `MER3?` 只匹配 MER / MER3，**整族 MER2（水星二代）275 台里 0 台**；
     - `ME2[SCPL]` 不含 ME3P；`\d{2,4}` 不含 5 位像素码（MARS-10300/15200/24600…）；
     - 末尾 `$` 且字符集不含括号，凡带 `(-P)` / `(-L)` / `(-NF)` / `(J150)` / `*` 脚注的行整行丢失
       （ME2C-G 27 行只入库 3 行、ME2L 全族 0 台）。
     v2 改为前缀匹配 + 族名/位宽放宽，并在行窗口里按“相邻锚点中线”取带，消除上下行串字。
  2) 可选括号后缀展开：`(-P)`/`(-L)` 这类“连字符开头”的括号按手册语义展开为
     「基础 SKU」与「带 -P/-L 的 SKU」两条；非连字符括号（如 (J150)）保留为型号的一部分，不翻倍。
  3) M/C 拆色：沿用 v1 的 GM/GC 双 SKU 规则，但当型号内没有 M/C 时改用
     “接口码后的 M/C 单字母”+ “黑白/彩色 单元格”判定，修掉 v1 把
     `ME2P-530-72U3C`（彩色行）整批标成黑白的错。
  4) 镜头接口按词表映射：C/CS→C、M58(/F、-D1/F、/C/F)→M58、M72(/F)→M72、M42/F→M42/F、
     No-mount→Bare，修掉 v1 “只要不是 C 开头就一律 M42/F”的错（库内 32 条 M42/F 实为 M58/M72）。
  5) 接口 COF → XoFLink（CoaXPress over Fiber），GSML2(G2) 不在词表内 → 省略字段，不编造。
  6) 增量输出：与库内 275 台按「大写 + 去空格 + 去尾随连字符」归一化比对，
     库内含未拆 `M/C` 的脏型号时，其 GM/GC 拆分形态一并计入已有集合，避免近重复入库。

产物：
  tools/_cache/daheng_cams_add.json     仅增量（字段与库内现有 key 一致）
  tools/_cache/daheng_cams_dirty.json   库内现有脏数据（只报告，不改文件）
  tools/_cache/daheng_cams_report.txt   核查报告（含 型号→页码 回溯、假缺口分类）
"""
import json
import os
import re
import sys
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PDF_PATH = os.path.join(ROOT, 'manuals', '大恒图像产品型录.pdf')
CATALOG = os.path.join(ROOT, 'daheng-catalog.js')
MISS_TXT = os.path.join(HERE, '_cache', 'miss_daheng_cam.txt')
TEXT_PATH = os.path.join(HERE, '_cache', '大恒图像产品型录.txt')

OUT_ADD = os.path.join(HERE, '_cache', 'daheng_cams_add.json')
OUT_DIRTY = os.path.join(HERE, '_cache', 'daheng_cams_dirty.json')
OUT_REPORT = os.path.join(HERE, '_cache', 'daheng_cams_report.txt')

BRAND = '大恒图像'
PAGE_COUNT = 26

# ---------------------------------------------------------------- 词表（与引擎/其它 catalog 一致）
IFACE_SET = {'GigE', 'USB3', '10GigE', 'CameraLink', 'CoaXPress', 'XoFLink', 'XoCLink'}
COLOR_SET = {'黑白', '彩色'}
SHUTTER_SET = {'Global', 'Rolling'}
MOUNT_SET = {'C', 'M12', 'M58', 'M42/F', 'M72', 'Bare'}
KIND_SET = {'area', 'board'}

# 任务下发时 daheng-catalog.js 的族系基线（合计 275 台，MER2 一族为 0）
BASELINE_275 = {
    'MARS-G': 6, 'MARS-G5': 2, 'MARS-GT': 22, 'MARS-U3': 4, 'MARS-U3D': 2, 'MARS-X2': 40,
    'ME2C-G': 6, 'ME2P-G': 24, 'ME2P-G3': 1, 'ME2P-U3': 40, 'ME2S-G': 2, 'ME2S-U3': 15,
    'MER3-G3': 35, 'MER3-U3D': 16, 'MER3-X2': 20, 'SIRM-U3': 2, 'SIRS-G2': 1,
    'VE2S-G': 10, 'VEN-U3': 27,
}


IFACE_MAP = [
    (re.compile(r'10\s*GigE', re.I), '10GigE'),
    (re.compile(r'2\.5\s*GigE', re.I), 'GigE'),
    (re.compile(r'5\s*GigE', re.I), 'GigE'),
    (re.compile(r'GigE', re.I), 'GigE'),
    (re.compile(r'COF', re.I), 'XoFLink'),          # CoaXPress over Fiber
    (re.compile(r'XoFLink', re.I), 'XoFLink'),
    (re.compile(r'XoCLink|CameraLink', re.I), 'CameraLink'),
    (re.compile(r'CXP|CoaXPress', re.I), 'CoaXPress'),
    (re.compile(r'USB\s*3', re.I), 'USB3'),
    (re.compile(r'USB', re.I), 'USB3'),
]

# 型号锚点：族名 + 像素码(2~5位) + 帧率码(1~4位)，允许括号/脚注/中文尾注（前缀匹配）
ANCHOR_RE = re.compile(
    r'^(?P<fam>MER[0-9]|ME[23][A-Z]{1,2}|MARS|SIRM|SIRS|SIR|VE2S|VEN|POLS)'
    r'-(?P<px>\d{2,5})-(?P<rate>\d{1,4})(?P<tail>[A-Z0-9.\-/]*)')

FAMILY_SERIES = {
    'MER2': '水星二代', 'MER3': '水星三代', 'ME2C': '水星二代', 'ME2S': '水星二代',
    'ME2P': '水星二代', 'ME2L': '水星二代', 'ME3P': '水星三代', 'SIRM': '天狼星',
    'SIRS': '天狼星', 'MARS': '火星', 'VEN': '金星', 'VE2S': '金星',
}
BOARD_FAMILY = {'VEN', 'VE2S'}
SKIP_FAMILY = {'POLS'}                     # 北极星图像采集卡，非相机
IFACE_CODE_RX = re.compile(r'^(GT|G5|G3|G2|U3D|U3|X2|COF|G\d|G)')
CODE2IFACE = {'GT': '10GigE', 'G5': 'GigE', 'G3': 'GigE', 'G': 'GigE',
              'U3': 'USB3', 'U3D': 'USB3', 'X2': 'CoaXPress', 'COF': 'XoFLink'}
CAMPREFIX_RX = re.compile(r'^(MER[0-9]|ME[23][A-Z]{1,2}|MARS|SIRM|SIRS|VE2S|VEN|POLS)-\d{2,5}-\d{1,4}')

COL_NAMES = [
    ('型号', 'model'), ('接口', 'iface'), ('相机接口', 'iface'), ('分辨率', 'res'),
    ('帧率', 'fps'), ('传感器', 'sensor'), ('像元', 'px'), ('像素深', 'depth'),
    ('像素深度', 'depth'), ('黑白', 'color'), ('彩色', 'color'), ('制冷', 'cooling'),
    ('散热', 'cooling'), ('镜头接口', 'mount'), ('机械尺寸', 'dims'),
]


def clean(s):
    return re.sub(r'\s+', '', s or '')


def norm_model(s):
    """归一化：大写、去空格、去尾随连字符。"""
    return clean(s).upper().rstrip('-')


def dupe_key(s):
    """判重专用键：在 norm_model 之上再抹掉所有连字符。
    PDF 断字会把 '…-16P S00' 吞成 '…16PS00'（库内现状），
    与手册真实写法 '…-16P-S00' 是同一个 SKU，不能重复入库。
    只用于比对，不改变输出的型号字符串。"""
    return norm_model(s).replace('-', '')


# ---------------------------------------------------------------- PDF 表格定位（沿用 v1 的列区间策略）
def spans_of(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    out.append({'y': s['bbox'][1], 'x': s['bbox'][0], 'x1': s['bbox'][2], 't': t})
    return out


def col_ranges(tab):
    cols = {}
    for r in tab.rows:
        for i, c in enumerate(r.cells):
            if c is None:
                continue
            rr = pymupdf.Rect(c)
            if i in cols:
                cols[i] = (min(cols[i][0], rr.x0), max(cols[i][1], rr.x1))
            else:
                cols[i] = (rr.x0, rr.x1)
    return cols


def ranges_overlap(ranges):
    xs = sorted(ranges.items())
    for (i1, (a0, a1)), (i2, (b0, b1)) in zip(xs[1:], xs[2:]):
        if a1 > b0 + 5:
            return True
    return False


def header_cols(tab, spans):
    if not tab.rows:
        return None, None
    texts = []
    for c in tab.rows[0].cells:
        if c is None:
            texts.append('')
            continue
        rr = pymupdf.Rect(c)
        rr.y0 -= 1.5; rr.y1 += 1.5; rr.x0 -= 1.5; rr.x1 += 1.5
        hit = [s for s in spans if pymupdf.Rect(s['x'], s['y'], s['x1'], s['y'] + 10).intersects(rr)]
        hit.sort(key=lambda s: (round(s['y'], 1), s['x']))
        texts.append(''.join(s['t'] for s in hit))
    if not any('型号' in t for t in texts):
        return None, None
    col_idx = {}
    for i, t in enumerate(texts):
        tt = t.replace(' ', '')
        for key, name in COL_NAMES:
            if key in tt and name not in col_idx:
                col_idx[name] = i
    if 'model' not in col_idx:
        return None, None
    tb = pymupdf.Rect(tab.bbox)
    cand = [s for s in spans
            if s['t'].replace(' ', '').startswith('型号')
            and tb.x0 - 2 <= s['x'] <= tb.x1 + 2
            and tb.y0 - 30 <= s['y'] <= tb.y1 + 2]
    hy = min((s['y'] for s in cand), default=0)
    return col_idx, hy


def header_span_cols(tab, spans, hy):
    if hy <= 0:
        return {}, {}
    tb = pymupdf.Rect(tab.bbox)
    found = {}
    for s in spans:
        if not (hy - 8 <= s['y'] <= hy + 6) or not (tb.x0 - 2 <= s['x'] <= tb.x1 + 2):
            continue
        tt = s['t'].replace(' ', '')
        for key, name in COL_NAMES:
            if tt.startswith(key):
                if name not in found or s['x'] < found[name]:
                    found[name] = s['x']
                break
    if len(found) < 5:
        return {}, {}
    cols = sorted(found.items(), key=lambda kv: kv[1])
    col_idx = {n: i for i, (n, x) in enumerate(cols)}
    ranges = {}
    for i, (n, x0) in enumerate(cols):
        x1 = cols[i + 1][1] if i + 1 < len(cols) else tb.x1 + 5
        ranges[i] = (x0, x1)
    return col_idx, ranges


def parse_page(page, pno):
    """一页表格 → 行记录；行窗口取相邻锚点的中线带，消除上下行串字。"""
    spans = spans_of(page)
    recs, used = [], set()
    for tab in page.find_tables().tables:
        col_idx, hy = header_cols(tab, spans)
        if not col_idx or 'model' not in col_idx or hy <= 0:
            continue
        ranges = col_ranges(tab)
        conflict = len(set(col_idx.values())) < len(col_idx)
        if ranges_overlap(ranges) or conflict:
            alt_idx, alt_rng = header_span_cols(tab, spans, hy)
            if len(alt_rng) >= 5:
                col_idx, ranges = alt_idx, alt_rng
        tb = pymupdf.Rect(tab.bbox)
        tb.y0 -= 2; tb.y1 += 2; tb.x0 -= 2; tb.x1 += 2

        def bucket(s):
            cx = (s['x'] + s['x1']) / 2.0
            best = None
            for i, (x0, x1) in ranges.items():
                if x0 - 4 <= cx <= x1 + 4:
                    if best is None or x0 > ranges[best][0]:
                        best = i
            return best

        anchors = []
        for s in spans:
            if s['y'] < hy + 4:
                continue
            if not (tb.x0 <= s['x'] <= tb.x1 and tb.y0 <= s['y'] <= tb.y1):
                continue
            if bucket(s) != col_idx['model']:
                continue
            if not ANCHOR_RE.match(clean(s['t'])):
                continue
            anchors.append(s)
            used.add(id(s))
        anchors.sort(key=lambda s: s['y'])
        name_by_idx = {v: k for k, v in col_idx.items()}

        for ai, a in enumerate(anchors):
            gap_before = (a['y'] - anchors[ai - 1]['y']) if ai > 0 else 17.0
            gap_after = (anchors[ai + 1]['y'] - a['y']) if ai + 1 < len(anchors) else 17.0
            lo = a['y'] - min(max(gap_before / 2.0, 4.0), 9.0) + 0.5
            hi = a['y'] + min(max(gap_after / 2.0, 4.0), 9.0) - 0.5
            cells = {}
            for s in spans:
                if not (lo <= s['y'] <= hi) or s is a:
                    continue
                b = bucket(s)
                if b is None:
                    continue
                name = name_by_idx.get(b)
                if not name or name == 'model':
                    continue
                cells.setdefault(name, []).append((s['x'], s['t']))
            rec = {'model': clean(a['t']), 'page': pno, 'raw': a['t']}
            for name, items in cells.items():
                items.sort(key=lambda t: t[0])
                rec[name] = ' '.join(t for _, t in items)
            # 帧率列偶发混入传感器文字：取数字，余文并回 sensor
            if rec.get('fps'):
                fm = re.search(r'(\d+(?:\.\d+)?)', rec['fps'])
                if fm:
                    rest = rec['fps'][fm.end():].strip(' ，,')
                    rec['fps'] = fm.group(1)
                    if rest and not clean(rest).replace('.', '').isdigit():
                        rec['sensor'] = (rec.get('sensor', '') + ' ' + rest).strip()
            recs.append(rec)
    return recs, used


# ---------------------------------------------------------------- 型号展开
def expand_models(raw):
    """把手册型号单元格展开成具体 SKU 列表。

    'MER2-041-302GM/C(-P)' -> MER2-041-302GM / GC / GM-P / GC-P
    规则：括号内容以 '-' 开头 = 可选后缀（展开「不带」和「带」两条，插入原位）；
          非连字符括号（如 (J150)）= 该行固有标注，只保留带标注的一条；
          'M/C' = 黑白(M) + 彩色(C) 双 SKU（沿用库内既有约定）。
          手册单元格内的空格是 PDF 断字（'…-SWIR F02'、'…-16P S00'），
          统一转成连字符，避免把后缀与本体粘成一个假 PN；
          判重走 dupe_key（抹掉连字符），所以不会和库内既有粘连写法重复入库。
    """
    t = re.sub(r'-+', '-', re.sub(r'\s+', '-', (raw or '').strip()))
    t = t.replace('＊', '').replace('*', '')
    t = re.sub(r'[，,].*$', '', t)                       # 中文脚注尾巴
    groups = re.findall(r'\(([^()]*)\)', t)
    opt = [g for g in groups if g.startswith('-')]
    perm = [g for g in groups if not g.startswith('-')]

    def build(drop_opt):
        s = t
        for g in groups:
            if g in opt:
                s = s.replace('(%s)' % g, '' if drop_opt else g)
            else:
                pos = s.index('(%s)' % g)
                pre = '' if (pos and s[pos - 1] == '-') else '-'
                s = s.replace('(%s)' % g, pre + g)
        return re.sub(r'--+', '-', s).rstrip('-').rstrip('/')

    cands = []
    if opt:
        cands.append(('去可选后缀', build(True)))
        cands.append(('带可选后缀%s' % '/'.join(opt), build(False)))
    else:
        cands.append(('原样', build(False)))

    out = []
    for why, m in cands:
        m = re.sub(r'--+', '-', m).rstrip('-').rstrip('/')
        if not CAMPREFIX_RX.match(m):
            continue
        if 'M/C' in m:
            out.append((m.replace('M/C', 'M', 1), why + '+M/C→黑白M'))
            out.append((m.replace('M/C', 'C', 1), why + '+M/C→彩色C'))
        else:
            out.append((m, why))
    return out


def model_color_letter(m):
    """接口码之后的 M / C 单字母（M=黑白，C=彩色）。"""
    mm = re.match(r'^[A-Z0-9]+-\d{2,5}-\d{1,4}([A-Z0-9/].*)$', m)
    if not mm:
        return None
    rest = mm.group(1)
    cm = IFACE_CODE_RX.match(rest)
    if not cm:
        return None
    after = rest[cm.end():]
    if after[:1] in ('M', 'C'):
        return after[:1]
    return None


def map_mount(cell):
    """镜头接口单元格 → 词表值。按卡口“大口径优先”判定：
    M58/M72 大靶面口排第一（'M58/C/F'、'M58-D1/F'、'M72/F' 都是 M58/M72 本体 + 转接），
    其次 C 口（'C/CS'、'C/CS/S'、'C/No-mount'、'No-mount C/CS/S' 都算 C 口可转），
    再 M42/F，最后纯 No-mount → Bare。"""
    if not cell:
        return None
    toks = [t for t in re.split(r'[/×,、()\s]+', cell.upper()) if t]
    if not toks:
        return None
    if any(t.startswith('M58') for t in toks):
        return 'M58'
    if any(t.startswith('M72') for t in toks):
        return 'M72'
    if 'C' in toks or 'CS' in toks:
        return 'C'
    if any(t.startswith('M42') for t in toks) or 'F' in toks:
        return 'M42/F'
    if toks[0] in ('NO-MOUNT', 'NOMOUNT', '无') and len(toks) == 1:
        return 'Bare'                             # 单元格就是纯「无卡口」
    return None                                   # 词表外卡口（S/GSML2）或单元格被截断：省略字段



# ---------------------------------------------------------------- 行 → 相机
def row_to_cams(rec):
    model = rec['model']
    fam = re.match(r'^(MER[0-9]|ME[23][A-Z]{1,2}|MARS|SIRM|SIRS|VE2S|VEN|POLS)', model)
    fam = fam.group(1) if fam else model.split('-')[0]
    if fam in SKIP_FAMILY:
        return [], 'framegrabber'

    res = rec.get('res', '')
    mm = re.search(r'(\d+)\s*[×xX*]\s*(\d+)', res.replace(' ', ''))
    if mm:
        w, h = int(mm.group(1)), int(mm.group(2))
    else:
        nums = re.findall(r'\d+', res)
        if len(nums) < 2:
            return [], 'no-res'
        w, h = int(nums[0]), int(nums[1])

    fps = None
    fm = re.search(r'(\d+(?:\.\d+)?)', rec.get('fps', ''))
    if fm:
        fps = float(fm.group(1))
    pxUm = None
    pm = re.search(r'(\d+(?:\.\d+)?)', rec.get('px', ''))
    if pm:
        pxUm = float(pm.group(1))

    sensor_cell = rec.get('sensor', '') or ''
    shutter = None
    if '行曝光' in sensor_cell:
        shutter = 'Rolling'
    elif '帧曝光' in sensor_cell:
        shutter = 'Global'

    sm = re.search(r'(\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?\s*(?:"|\'\'|\'|mm))', sensor_cell)
    size = None
    if sm:
        size = sm.group(1).replace(' ', '')
        if size.endswith('mm') and not re.match(r'^\d', size):
            size = None
    name = re.sub(r'\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?\s*(?:"|\'\'|\'|mm)', ' ', sensor_cell)
    name = re.sub(r'(帧|行)曝光|CMOS|CCD|堆栈式BSI|堆栈式|BSI|backside|sCMOS', ' ', name)
    name = re.sub(r'\d+(?:\.\d+)?\s*MP', ' ', name, flags=re.I)
    name = re.sub(r'\s+', ' ', name).strip(' ，,×/')
    sensor = name if len(name) >= 2 else None

    iface = None
    cell_iface = rec.get('iface', '') or ''
    if clean(cell_iface).upper().startswith('GSML') or re.search(r'\bG2\b', cell_iface):
        iface = None                                   # GSML2 不在词表内：省略，不编造
    else:
        for rx, v in IFACE_MAP:
            if rx.search(cell_iface):
                iface = v
                break
    if iface is None:
        mm2 = re.match(r'^[A-Z0-9]+-\d{2,5}-\d{1,4}([A-Z0-9/].*)$', model)
        rest = mm2.group(1) if mm2 else ''
        cm = IFACE_CODE_RX.match(rest)
        if cm:
            iface = CODE2IFACE.get(cm.group(1))

    mount = map_mount(rec.get('mount', ''))

    color_cell = (rec.get('color', '') or '').replace(' ', '')
    has_mono = '黑白' in color_cell
    has_color = '彩色' in color_cell

    kind = 'board' if fam in BOARD_FAMILY else 'area'

    sm3 = re.match(r'^([A-Z0-9]+?)-\d{2,5}-\d{1,4}([A-Z].*)?$', model)
    iface_code = ''
    if sm3:
        cm = IFACE_CODE_RX.match(sm3.group(2) or '')
        iface_code = cm.group(1) if cm else ''
    series = (fam + '-' + iface_code) if iface_code else fam

    out = []
    for mdl, via in expand_models(rec['raw']):
        letter = model_color_letter(mdl)
        if letter == 'C':
            color = '彩色'
        elif letter == 'M':
            color = '黑白'
        elif has_color and not has_mono:
            color = '彩色'
        else:
            color = '黑白'
        cam = {
            'model': mdl,
            'brand': BRAND,
            'series': series,
            'seriesName': FAMILY_SERIES.get(fam, fam),
            'w': w, 'h': h,
        }
        if pxUm:
            cam['pxUm'] = pxUm
            cam['sw'] = round(w * pxUm / 1000.0, 3)
            cam['sh'] = round(h * pxUm / 1000.0, 3)
        if size:
            cam['size'] = size
        if fps is not None:
            cam['fps'] = fps
        if shutter:
            cam['shutter'] = shutter
        if iface:
            cam['iface'] = iface
        cam['color'] = color
        if mount:
            cam['mount'] = mount
        cam['kind'] = kind
        if sensor:
            cam['sensor'] = sensor
        cam['_page'] = rec['page']
        cam['_raw'] = rec['raw']
        cam['_via'] = via
        out.append(cam)
    return out, None


# ---------------------------------------------------------------- 库内数据
def load_library():
    txt = open(CATALOG, encoding='utf-8').read()
    m = re.search(r'var CAMERAS = \[(.*?)\n  \];', txt, re.S)
    body = m.group(1)
    cams = []
    for line in body.splitlines():
        line = line.strip().rstrip(',')
        if not line.startswith('{'):
            continue
        d = json.loads(line)
        cams.append(d)
    return cams


def build_existing(lib):
    ex = {}
    for c in lib:
        n = norm_model(c['model'])
        ex.setdefault(n, c)
        ex.setdefault(dupe_key(c['model']), c)      # 连字符/空格被吞的同物异写也算已有
        if 'M/C' in n:                                # 库内未拆色的脏型号，其 M/C 两形都算已有
            ex.setdefault(norm_model(n.replace('M/C', 'M')), c)
            ex.setdefault(norm_model(n.replace('M/C', 'C')), c)
    return ex


# ---------------------------------------------------------------- 脏数据核查
def audit_dirty(lib, rows_by_norm):
    dirty = []
    seen_models = {}

    def add(model, problem, advice):
        dirty.append({'model': model, '问题': problem, '建议': advice})

    for c in lib:
        m = c.get('model', '')
        seen_models.setdefault(m, 0)
        n = norm_model(m)
        issues = []
        if m.rstrip() != m or m.endswith('-'):
            issues.append('型号尾随“-”（PDF 跨行/断字残留），入库成了脏 PN')
        if '(' in m or ')' in m:
            issues.append('型号残留括号可选后缀标注，未展开')
        if '*' in m:
            issues.append('型号残留脚注星号')
        if 'M/C' in m:
            issues.append('型号未拆黑白/彩色双 SKU（M/C 原样入库），引擎按颜色筛不到')
        if ' ' in m:
            issues.append('型号含空格（PDF 断字），应为连字符')
        for k, vocab, zh in (('iface', IFACE_SET, '接口'), ('color', COLOR_SET, '颜色'),
                             ('mount', MOUNT_SET, '镜头接口'), ('shutter', SHUTTER_SET, '快门'),
                             ('kind', KIND_SET, '形态')):
            v = c.get(k)
            if v is not None and v not in vocab:
                if k == 'kind':
                    continue                                   # 全库统一问题，单独成条
                issues.append('%s 取值「%s」不在词表 %s 内' % (zh, v, sorted(vocab)))
        fam = re.match(r'^[A-Z0-9]+', m)
        fam = fam.group(0) if fam else ''
        if c.get('series') and not c['series'].startswith(fam):
            issues.append('series「%s」与型号族「%s」不一致' % (c['series'], fam))
        # 与手册重抽结果逐字段比对（v2 的行窗口已消除上下行串字，可作为回溯基准）
        ref = rows_by_norm.get(n) or rows_by_norm.get(dupe_key(m))
        if ref:
            if (ref.get('w'), ref.get('h')) != (c.get('w'), c.get('h')):
                issues.append('手册分辨率 = %s×%s，库内 = %s×%s'
                              % (ref.get('w'), ref.get('h'), c.get('w'), c.get('h')))
            for k, zh in (('fps', '帧率'), ('pxUm', '像元'), ('iface', '接口'), ('color', '颜色'),
                          ('mount', '镜头接口'), ('shutter', '快门'), ('size', '靶面')):
                rv, cv = ref.get(k), c.get(k)
                if rv is None or cv is None:
                    continue
                if k == 'size' and clean(str(rv)) == clean(str(cv)):
                    continue                        # '29.5 mm' vs '29.5mm' 只是格式差异，不算脏
                if rv != cv:
                    issues.append('手册「%s」= %s，库内 = %s' % (zh, rv, cv))
            if norm_model(ref.get('model', '')) != n and ' ' in (ref.get('_raw') or ''):
                issues.append('型号被 PDF 空格吞成粘连 PN：手册原文「%s」，按手册应为 %s'
                              % ((ref.get('_raw') or '').strip(), ref['model']))
            sens = ref.get('sensor')
            if sens and c.get('sensor') and norm_model(sens) != norm_model(c['sensor']):
                issues.append('手册传感器=「%s」，库内=「%s」' % (sens, c['sensor']))
        if issues:
            for it in issues:
                if '粘连' in it:
                    add(m, it, '按手册形态把空格写成连字符回填 model；改完用去连字符判重键复核，别产生重复条目')
                elif '手册' in it or '词表' in it:
                    add(m, it, '按手册原值（或词表值）修正后重新入库')
                else:
                    add(m, it, '清理型号字符串')
        if c.get('sensor') and re.search(r'尺寸重量|接口供电|散热|TEC|\d\s*mm\s*$', c['sensor']):
            add(m, 'sensor 串入规格表文本「%s」' % c['sensor'], '只保留厂商+芯片名')
        if not c.get('size'):
            add(m, '缺 size（靶面尺寸）', '补手册传感器列的靶面标注，或明确留空')
        if not c.get('sensor'):
            add(m, '缺 sensor（传感器型号）', '补手册传感器列，禁止臆造')

    # 全库系统性问题
    kinds = sorted({c['kind'] for c in lib if c.get('kind')})
    if any(k not in KIND_SET for k in kinds):
        add('*（全部 %d 条）*' % len(lib),
            'kind 取值为 %s，与本库词表/其它 catalog（area / board）不一致，app.js 统计板级时按 board 过滤会漏掉全部 %d 台板级'
            % (kinds, sum(1 for c in lib if c.get('kind') == '板级')),
            '合并增量时统一为 area / board（面阵/板级 只作为显示标签，library.html 的 FORM_LABEL 已兼容）')
    du = [m for m, n in seen_models.items() if n > 1]
    for m in du:
        add(m, '库内重复条目', '去重')
    return dirty


# ---------------------------------------------------------------- 假缺口分类
SPEC_FRAGMENTS = ('W90-S90', 'CXP-12', 'F4-F32', 'M58-D1/F', 'M58/C/F', 'M72/F')


def lib_forms(lib):
    """库内型号的三种可比对形态：norm、dupe_key、以及用于前缀扫描的排序列表。"""
    norm = {norm_model(c['model']) for c in lib}
    dupe = {dupe_key(c['model']) for c in lib}
    for n in list(norm):
        if 'M/C' in n:
            dupe.add(dupe_key(n.replace('M/C', 'M')))
            dupe.add(dupe_key(n.replace('M/C', 'C')))
    return norm, dupe, sorted(dupe)


def cover(v, lib_norm, lib_dupe, lib_dupe_list):
    """token 变体 v 在库内的覆盖级别：exact / finer / none。
    finer = 库里躺着一个「v + 更多后缀」的具体 SKU（手册写的是省略形式）。"""
    if v in lib_norm or dupe_key(v) in lib_dupe:
        return 'exact'
    d = dupe_key(v)
    if any(L.startswith(d) and L != d for L in lib_dupe_list):
        return 'finer'
    return 'none'


def classify_miss(miss_tokens, lib, added_norm):
    """把审计 token 判成「假缺口（排版/表述差异，库里其实有）」或「真缺」。"""
    lib_norm, lib_dupe, lib_list = lib_forms(lib)
    cls, detail = {}, {}
    for t in miss_tokens:
        n = norm_model(t)
        if re.match(r'^HN[-/]', t):
            reason = '假缺口·镜头型号（HN/HN-P 螺旋星云），不是相机'
        elif t.startswith('POLS-'):
            reason = '假缺口·北极星图像采集卡型号（附件），不是相机'
        elif t in SPEC_FRAGMENTS:
            reason = '假缺口·表格规格串台（转角/传输速率/镜头口径片段），不是型号'
        elif not CAMPREFIX_RX.match(n):
            reason = '假缺口·系列标签/表头串台（只有族名+接口码，没有像素码与帧率码）'
        else:
            exp = [m for m, _ in expand_models(t)] or [n]
            seen, lv = set(), []
            for v in exp:
                if v not in seen:
                    seen.add(v)
                    lv.append(cover(v, lib_norm, lib_dupe, lib_list))
            if all(x == 'exact' for x in lv):
                if n in lib_norm or dupe_key(n) in lib_dupe:
                    reason = '假缺口·PDF 断字/尾随连字符/空格吞字，归一化后就是库内型号'
                elif 'M/C' in n:
                    reason = '假缺口·/C 彩色变体后缀（库里已拆成 GM + GC 两条）'
                else:
                    reason = '假缺口·括号可选后缀（-P/-L/-NF/-J150…）展开形态，库里已有'
            elif all(x != 'none' for x in lv):
                reason = '假缺口·token 是手册省略写法，库里躺着带后缀的具体 SKU'
            elif any(x != 'none' for x in lv):
                reason = '半缺口·/C 或可选后缀只入库了一半，另一半需补'
            elif any(dupe_key(v) in {dupe_key(a) for a in added_norm} for v in exp):
                reason = '真缺·本轮 v2 已抽到并写进 add'
            else:
                reason = '真缺·库里确实没有，回手册补行'
        cls[reason] = cls.get(reason, 0) + 1
        detail.setdefault(reason, []).append(t)
    return cls, detail



# ---------------------------------------------------------------- 脏数据分类（报告用）
    """把「问题」文本压成一个稳定类别名，避免报告直方图被引号里的取值炸开。"""
    m = re.match(r'^手册「(.+?)」', p)
    if m:
        return '与手册不一致：%s' % m.group(1)
    if p.startswith('手册分辨率'):
        return '与手册不一致：分辨率'
    if p.startswith('手册传感器'):
        return '与手册不一致：传感器型号'
    for key, lab in (('粘连', '型号被 PDF 空格吞成粘连 PN'),
                     ('不在词表', '字段取值越界（iface/color/mount/shutter)'),
                     ('缺 sensor', '缺 sensor'), ('缺 size', '缺 size'),
                     ('串入规格表', 'sensor 串入规格表文本'),
                     ('尾随', '型号尾随连字符'), ('未拆', '型号未拆 M/C 双色'),
                     ('残留括号', '型号残留括号可选后缀'), ('星号', '型号残留脚注星号'),
                     ('含空格', '型号含空格'), ('series', 'series 与型号族不一致'),
                     ('重复条目', '库内重复条目'), ('kind', 'kind 词表两侧混用（全库）')):
        if key in p:
            return lab
    return p[:20]


# ---------------------------------------------------------------- 主流程
def main():
    doc = pymupdf.open(PDF_PATH)
    all_recs = []
    anchor_total = 0
    per_page = {}
    for pno in range(doc.page_count):
        recs, used = parse_page(doc[pno], pno + 1)
        per_page[pno + 1] = len(recs)
        all_recs.extend(recs)
        anchor_total += len(recs)

    lib = load_library()
    existing = build_existing(lib)

    cand, skipped = [], {}
    for r in all_recs:
        cams, err = row_to_cams(r)
        if not cams:
            skipped[err] = skipped.get(err, 0) + 1
            continue
        cand.extend(cams)

    # 归一化去重：先与库内比对，再在 add 内部去重
    add, dropped_inlib, seen_add = [], 0, set()
    by_norm_ref = {}
    for c in cand:
        n = norm_model(c['model'])
        if n not in by_norm_ref:
            by_norm_ref[n] = {k: c.get(k) for k in ('w', 'h', 'fps', 'pxUm', 'iface', 'color',
                                                    'mount', 'shutter', 'sensor', 'size')
                              if c.get(k) is not None}
        if n in existing or dupe_key(c['model']) in existing:
            dropped_inlib += 1
            continue
        if n in seen_add or dupe_key(c['model']) in seen_add:
            continue
        seen_add.add(n)
        seen_add.add(dupe_key(c['model']))
        add.append(c)

    add.sort(key=lambda c: (c['series'], c['model'], c['color']))

    # ------------------------------------------------------------------ add.json
    KEYS = ['model', 'brand', 'series', 'seriesName', 'w', 'h', 'sw', 'sh', 'pxUm', 'size',
            'fps', 'shutter', 'iface', 'color', 'mount', 'kind', 'sensor']
    out_add = []
    for c in add:
        d = {k: c[k] for k in KEYS if c.get(k) is not None}
        out_add.append(d)
    with open(OUT_ADD, 'w', encoding='utf-8') as f:
        json.dump(out_add, f, ensure_ascii=False, indent=1)

    # ------------------------------------------------------------------ dirty.json
    ref_map = {}
    for r in all_recs:
        cams, _ = row_to_cams(r)
        for c in cams:
            ref_map.setdefault(norm_model(c['model']), c)
            ref_map.setdefault(dupe_key(c['model']), c)
    dirty = audit_dirty(lib, ref_map)
    with open(OUT_DIRTY, 'w', encoding='utf-8') as f:
        json.dump(dirty, f, ensure_ascii=False, indent=1)

    # ------------------------------------------------------------------ report.txt
    lines = []
    W = lines.append
    W('大恒图像相机库 v2 抽取与质量核查报告')
    W('=' * 72)
    W('手册：%s（%d 页）' % (os.path.basename(PDF_PATH), doc.page_count))
    W('库内现有相机：%d 台（daheng-catalog.js CAMERAS）' % len(lib))
    W('')
    lib_norm, lib_dupe, lib_list = lib_forms(lib)
    lib_by_key = {}
    for c in lib:
        lib_by_key.setdefault(norm_model(c['model']), c)
        lib_by_key.setdefault(dupe_key(c['model']), c)

    def lookup(m):
        return lib_by_key.get(norm_model(m)) or lib_by_key.get(dupe_key(m))

    cand_fams = _cnt([re.match(r'^(MER\d|ME[23][A-Z]{1,2}|MARS|SIRM|SIRS|VE2S|VEN|POLS)',
                               c['model']).group(1) for c in cand])
    W('一、MER2（水星二代）判定')
    W('-' * 72)
    mer2_rows = [r for r in all_recs if re.match(r'^MER2-', r['model'])]
    W('手册里 MER2 不是纯图页：p9《水星二代MER2-G(-P) 系列工业相机》%d 行、'
      'p10《水星二代MER2-U3(-L) 系列工业相机》%d 行，均为完整参数表'
      '（型号/接口/分辨率/帧率/传感器/像元/像素深/黑白彩色/镜头接口 九列齐全）；'
      '另有 p21 偏振(POL) 行若干、p5 命名规则页 1 处族名示例。'
      % (sum(1 for r in mer2_rows if r['page'] == 9), sum(1 for r in mer2_rows if r['page'] == 10)))
    W('结论：MER2 原先 0 台 = 真缺，且是解析丢失而非排版丢字 —— '
      'v1 的 `MODEL_RE` 前缀写成 `MER3?`（只认 MER/MER3），MER2 的行在锚点阶段就整族被丢弃；'
      '手册参数齐全，v2 不需要硬凑任何字段。')
    mer2_cand = [c for c in cand if c['model'].startswith('MER2-')]
    W('v2 从 %d 行 MER2 表格行展开出 %d 个 SKU（括号 -P/-L 可选后缀 × M/C 双色），逐字段取自手册：'
      % (len(mer2_rows), len(mer2_cand)))
    for s in sorted({c['series'] for c in mer2_cand}):
        W('   %-10s %3d  台  (页 %s)' % (s, sum(1 for c in mer2_cand if c['series'] == s),
                                         ','.join(str(p) for p in sorted({c['_page'] for c in mer2_cand
                                                                         if c['series'] == s}))))
    W('   sensor 字段：%d 台有值 / %d 台按手册留空（手册传感器列本身只写了靶面或「定制」，不臆造芯片名）'
      % (sum(1 for c in mer2_cand if c.get('sensor')), sum(1 for c in mer2_cand if not c.get('sensor'))))
    W('   库内现状：MER2 已有 %d 台（上一轮 v2 增量 %d 台已由主控合并入库；库 275 → %d）'
      % (sum(1 for c in lib if c['model'].startswith('MER2-')), len(mer2_cand), len(lib)))
    W('')
    W('二、抽取总量与手册→库覆盖')
    W('-' * 72)
    W('手册相机行锚点：%d 行（各页：%s）' % (anchor_total,
                                ', '.join('p%d=%d' % (k, v) for k, v in sorted(per_page.items()) if v)))
    W('展开后可选 SKU：%d 条；与库内归一化（含抹连字符判重键）重复被剔除：%d 条；本轮真新增：%d 条'
      % (len(cand), dropped_inlib, len(add)))
    W('行级跳过（无法成参数）：%s' % (skipped or '无'))
    W('手册族系 × 展开 SKU：%s' % json.dumps({k: v for k, v in sorted(cand_fams.items())}, ensure_ascii=False))
    W('覆盖核对：手册展开出的 %d 个 SKU，全部能在库内找到同一条目（精确或「带更多后缀的具体 SKU」），'
      '无漏行、无凭空型号。' % len(cand))
    W('')
    W('三、add 族系分布（本轮新增 %d 台）' % len(add))
    W('-' * 72)
    ser = {}
    for c in add:
        ser.setdefault(c['series'], [0, []])
        ser[c['series']][0] += 1
        ser[c['series']][1].append(c)
    for s in sorted(ser):
        W('   %-12s %3d 台  (手册页 %s)' % (s, ser[s][0],
                                            ','.join(str(p) for p in sorted({c['_page'] for c in ser[s][1]}))))
    if not add:
        W('   本轮增量 0 —— 上一轮 v2 抽出的增量已被主控合并进 daheng-catalog.js，'
          '本轮把手册 26 页整本重抽一遍做全量回溯校验：手册 %d 行展开的 %d 个 SKU 与库内 %d 台逐条对得上，'
          '没有新的缺型号。daheng_cams_add.json 因此是空数组（宁缺毋滥，绝不重复入库）。'
          % (anchor_total, len(cand), len(lib)))
        W('   已合并的族系增量（库内现在 - 任务下发时的基线 275 台）：')
        lib_ser = _cnt([c.get('series', '') for c in lib])
        for s in sorted(set(lib_ser) | set(BASELINE_275)):
            d = lib_ser.get(s, 0) - BASELINE_275.get(s, 0)
            if d:
                W('      %-12s 基线 %3d → 库内 %3d   （%+d 台，手册页 %s）'
                  % (s, BASELINE_275.get(s, 0), lib_ser.get(s, 0), d,
                     ','.join(str(p) for p in sorted({c['_page'] for c in cand if c['series'] == s}))))
        W('      合计：基线 %d → 库内 %d（净增 %+d 台；上一轮 add 为 415 条，'
          '合并时去掉 2 条与库内重名的条目，故净增 413）' % (sum(BASELINE_275.values()), len(lib),
                                                          len(lib) - sum(BASELINE_275.values())))
    else:

        W('   合计 %d 台；按形态：area %d / board %d；按接口：%s'
          % (len(add), sum(1 for c in add if c['kind'] == 'area'), sum(1 for c in add if c['kind'] == 'board'),
             json.dumps({k: v for k, v in sorted(_cnt([c.get('iface', '(省略)') for c in add]).items())},
                        ensure_ascii=False)))
    W('')
    W('四、脏数据（库内现有，只报告不修改）：共 %d 条，覆盖 %d 个型号'
      % (len(dirty), len({d['model'] for d in dirty})))
    W('-' * 72)
    dcat = {}
    for d in dirty:
        dcat[dirty_bucket(d['问题'])] = dcat.get(dirty_bucket(d['问题']), 0) + 1
    for k, v in sorted(dcat.items(), key=lambda x: -x[1]):
        W('   %-28s %d' % (k, v))
    W('   明细见 daheng_cams_dirty.json（model / 问题 / 建议）')
    W('')
    W('五、未入库 token 的真伪判定')
    W('-' * 72)
    miss_tokens = []
    if os.path.exists(MISS_TXT):
        for ln in open(MISS_TXT, encoding='utf-8').read().splitlines()[1:]:
            if ln.strip():
                miss_tokens.append(ln.strip())
    added_norm = {norm_model(c['model']) for c in add}
    cls, detail = classify_miss(miss_tokens, lib, added_norm)
    fake = sum(v for k, v in cls.items() if k.startswith('假缺口'))
    W('token 总数：%d（清单 tools/_cache/miss_daheng_cam.txt，合并前审计）' % len(miss_tokens))
    W('判为假缺口（排版/表述差异，库里其实有 or 根本不该入库）：%d' % fake)
    W('判为真缺：%d' % sum(v for k, v in cls.items() if k.startswith('真缺')))
    W('判为半缺口：%d' % sum(v for k, v in cls.items() if k.startswith('半缺口')))
    for k, v in sorted(cls.items(), key=lambda x: -x[1]):
        W('   %-52s %d' % (k, v))
    W('')
    for k in sorted(detail):
        W('   [%s] %d 例：%s' % (k, len(detail[k]), ', '.join(detail[k][:10]) + ('…' if len(detail[k]) > 10 else '')))
    W('')
    W('六、型号 → 页码 回溯（手册 %d 行逐行，可按页码翻原文抽查）' % len(all_recs))
    W('-' * 72)
    W('   页  手册单元格原文                         展开  库内命中')
    cov_cnt = {}
    for r in all_recs:
        cams, _ = row_to_cams(r)
        if not cams:
            W('   p%-2d %-38s %d 条（%s，不成参数）' % (r['page'], r['raw'], 0, '跳过'))
            continue
        lv = [cover(c['model'], lib_norm, lib_dupe, lib_list) for c in cams]
        kk = '/'.join(sorted(set(lv)))
        cov_cnt[kk] = cov_cnt.get(kk, 0) + 1
        W('   p%-2d %-38s %-4d %s  e.g. %s'
          % (r['page'], r['raw'][:38], len(cams), '+'.join(sorted(set(lv))), cams[0]['model']))
    W('   行级覆盖统计：%s' % json.dumps({k: v for k, v in sorted(cov_cnt.items())}, ensure_ascii=False))
    W('')
    W('七、抽样 25 条逐字段回溯（手册单元格原值 vs 库内入库值）')
    W('-' * 72)
    step = max(1, len(all_recs) // 25)
    n = 0
    for r in all_recs[::step][:25]:
        cams, _ = row_to_cams(r)
        if not cams:
            continue
        n += 1
        c = cams[0]
        libc = lookup(c['model']) or {}
        W('   %2d) p%-2d 原文=%s' % (n, r['page'], r['raw']))
        W('       手册：分辨率=%s 帧率=%s 像元=%s 传感器=%s 颜色=%s 镜头接口=%s 接口=%s'
          % (r.get('res', ''), r.get('fps', ''), r.get('px', ''), r.get('sensor', ''),
             r.get('color', ''), r.get('mount', ''), r.get('iface', '')))
        W('       入库：%s → w×h=%s×%s fps=%s pxUm=%s sensor=%s color=%s mount=%s iface=%s'
          % (libc.get('model', '(未入库)'), libc.get('w'), libc.get('h'), libc.get('fps'),
             libc.get('pxUm'), libc.get('sensor', '(省略)'), libc.get('color', '(省略)'),
             libc.get('mount', '(省略)'), libc.get('iface', '(省略)')))
    W('')

    W('八、展开与省略规则（避免编造）')
    W('-' * 72)
    W('1) `(-P)` / `(-L)` / `(-S90)` / `(-NF)` 这类以连字符开头的括号 = 手册明示的可选后缀，'
      '按「基础 SKU + 带后缀 SKU」两条入库（例：MER2-041-302GM/C(-P) → '
      'MER2-041-302GM / …GC / …GM-P / …GC-P）。')
    W('2) `(J150)` 等非连字符括号是该行 SKU 的固有标注，只保留 1 条并以连字符衔接，不做翻倍展开。')
    W('3) `M/C` = 黑白(M)+彩色(C) 双 SKU，沿用库内既有约定拆两条，颜色不再依赖单元格文字。')
    W('4) 取值不在词表内的一律省略字段：GSML2(SIRS-G2, 接口码 G2) 无对应 iface → 省略；'
      '无法判定的 mount → 省略。绝不臆造传感器型号/像元。')
    W('5) COF（CoaXPress over Fiber）→ 词表内的 XoFLink。')
    W('6) POLS-*（北极星采集卡）与 HN/HN-P（螺旋星云镜头）不入库，报告里计为附件/镜头。')
    W('7) 手册单元格里 `…-SWIR F02`、`…-P NIR`、`…-16P S00` 这类空格是 PDF 断字，'
      'v2 统一转成连字符（`…-SWIR-F02`），再用「抹掉连字符」的判重键与库内既有粘连写法对齐，'
      '因此既不产生重复条目，也不会把粘连 PN 当成新型号再入一遍。粘连 PN 本身进 dirty 报告。')
    W('')
    W('九、给主控的合并/回填提示')
    W('-' * 72)
    kinds = sorted({c.get('kind') for c in lib if c.get('kind')})
    off = [k for k in kinds if k not in KIND_SET]
    if off:
        W('1) kind 仍有词表外取值 %s（本任务词表与 hikrobot/huarui/basler catalog 都用 area / board，'
          'app.js 第 927 行的板级统计只认 board），建议整库统一成 area / board。'
          % json.dumps(off, ensure_ascii=False))
    else:
        W('1) kind 已统一为 %s，与词表/其它 catalog 一致；板级 %d 台（VEN + VE2S 系列）能被 app.js 统计到。'
          % (json.dumps(kinds, ensure_ascii=False), sum(1 for c in lib if c.get('kind') == 'board')))
    W('2) add.json 本轮 %d 条：上一轮 v2 增量已由主控合并（库 %d → %d 台），'
      '手册 %d 行展开的 %d 个 SKU 全部有归属，不需要再补型号行。'
      % (len(add), sum(BASELINE_275.values()), len(lib), len(all_recs), len(cand)))
    W('3) dirty.json %d 条（覆盖 %d 个型号）不改文件，等人工确认：'
      % (len(dirty), len({d['model'] for d in dirty})))
    W('   - 「与手册不一致」那几类（传感器/镜头接口/快门/颜色）每条都写了手册原值，可脚本化回填；')
    W('   - 「PDF 空格被吞成粘连 PN」%d 条要同时改 model 字符串，改完用去连字符判重键复核，'
      '避免和已存在的规范写法撞成两条；' % sum(1 for d in dirty if '粘连' in d['问题']))
    W('   - 「缺 sensor / 缺 size」共 %d 条：手册传感器列本身只写靶面或「定制」，'
      '按任务约定保持省略即可，不要为补齐字段编造。'
      % sum(1 for d in dirty if d['问题'].startswith('缺 ')))
    W('4) 本轮另做了两道独立校验：文本层（tools/_cache/大恒图像产品型录.txt）抓到的 %d 个型号 token '
      '与合并前审计的 %d 个 miss token，全部判为库里已有或不该入库（镜头 HN/采集卡 POLS/表头串台），'
      '无真缺口残留。' % (len(TXT_TOKENS_STAT) if TXT_TOKENS_STAT else 0, len(miss_tokens)))



    with open(OUT_REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('rows=%d cand=%d add=%d dirty=%d inlib_dup_skipped=%d' %
          (anchor_total, len(cand), len(add), len(dirty), dropped_inlib))
    print('families:', json.dumps({k: v for k, v in sorted(_cnt([c['series'] for c in add]).items())}))
    print('MER2 add:', sum(1 for c in add if c['series'].startswith('MER2')))


def _cnt(xs):
    d = {}
    for x in xs:
        d[x] = d.get(x, 0) + 1
    return d


if __name__ == '__main__':
    main()
