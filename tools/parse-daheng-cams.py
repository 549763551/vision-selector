# -*- coding: utf-8 -*-
"""从《大恒图像产品型录.pdf》解析工业相机，生成 tools/_cache/daheng_cams.json。
v4 混合策略：
  - 列区间用 pymupdf find_tables 的 cells（跨全表取每列 x0/x1）——列归属可靠；
  - 行用“型号”span 锚点 + y∈[y0-2, y0+13] 窗口（部分页 find_tables 行 rect 跨行合并，不可用）；
  - 字段值取 span 原文（find_tables 重组文本会丢小数点：61.50 → 6150）。
"""
import fitz, re, json, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PDF = 'manuals/大恒图像产品型录.pdf'
CACHE = 'tools/_cache/daheng_cams.json'

MODEL_RE = re.compile(r'^(MER3?|ME2[SCPL]|MARS|SIR[MS]|VE2S|VEN|POLS)-\d{2,4}-\d{1,3}[A-Z0-9.\-/]*$')

IFACE_MAP = [
    (re.compile(r'10\s*GigE', re.I), '10GigE'),
    (re.compile(r'2\.5\s*GigE', re.I), 'GigE'),
    (re.compile(r'GigE', re.I), 'GigE'),
    (re.compile(r'CXP|CoaXPress', re.I), 'CoaXPress'),
    (re.compile(r'CameraLink', re.I), 'CameraLink'),
    (re.compile(r'USB\s*3', re.I), 'USB3'),
    (re.compile(r'USB', re.I), 'USB3'),
]

COL_NAMES = [
    ('型号', 'model'), ('接口', 'iface'), ('相机接口', 'iface'), ('分辨率', 'res'), ('帧率', 'fps'),
    ('传感器', 'sensor'), ('像元', 'px'), ('像素深度', 'depth'), ('黑白', 'color'),
    ('制冷', 'cooling'), ('散热', 'cooling'), ('镜头接口', 'mount'), ('机械尺寸', 'dims'),
]

FAMILY_SERIES = {
    'MER3': '水星三代', 'MER2': '水星二代', 'ME2C': '水星二代', 'ME2S': '水星二代',
    'ME2P': '水星二代', 'ME2L': '水星二代', 'SIRM': '天狼星', 'SIRS': '天狼星',
    'MARS': '火星', 'VEN': '金星', 'VE2S': '金星',
}
BOARD_FAMILY = {'VEN', 'VE2S'}


def norm_iface(text):
    for rx, v in IFACE_MAP:
        if rx.search(text or ''):
            return v
    return None


def clean(s):
    return re.sub(r'\s+', '', s or '')


def spans_of(page):
    out = []
    d = page.get_text('dict')
    for b in d['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    out.append({'y': s['bbox'][1], 'x': s['bbox'][0],
                                'x1': s['bbox'][2], 't': t})
    return out


def col_ranges(tab):
    """每列 x 区间（跨全表 cells 取 min/max）"""
    cols = {}
    for r in tab.rows:
        for i, c in enumerate(r.cells):
            if c is None:
                continue
            rr = fitz.Rect(c)
            if i in cols:
                cols[i] = (min(cols[i][0], rr.x0), max(cols[i][1], rr.x1))
            else:
                cols[i] = (rr.x0, rr.x1)
    return cols


def ranges_overlap(ranges):
    """非首列是否相邻重叠（首列 cell 常跨全表但 bucket 取最紧列可容错；后续列重叠才不可信）"""
    xs = sorted(ranges.items())
    for (i1, (a0, a1)), (i2, (b0, b1)) in zip(xs[1:], xs[2:]):
        if a1 > b0 + 5:
            return True
    return False


def header_x_ranges_UNUSED():
    pass


def header_cols(tab, spans):
    """表头行文本 → 列名→索引；并返回“型号”表头 span 的 y。
    注意：find_tables 的 bbox 可能不含表头（向上扩 30px 找）；行 rect 可能跨行，不能用其 y1。"""
    if not tab.rows:
        return None, None
    r0 = tab.rows[0]
    texts = []
    for c in r0.cells:
        if c is None:
            texts.append('')
            continue
        rr = fitz.Rect(c)
        rr.y0 -= 1.5; rr.y1 += 1.5; rr.x0 -= 1.5; rr.x1 += 1.5
        hit = [s for s in spans if fitz.Rect(s['x'], s['y'], s['x1'], s['y'] + 10).intersects(rr)]
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
    # 表头 y：tab bbox 内或其上方 30px 内、文本以“型号”开头的 span
    tb = fitz.Rect(tab.bbox)
    cand = [s for s in spans
            if s['t'].replace(' ', '').startswith('型号')
            and tb.x0 - 2 <= s['x'] <= tb.x1 + 2
            and tb.y0 - 30 <= s['y'] <= tb.y1 + 2]
    hy = min((s['y'] for s in cand), default=0)
    return col_idx, hy


def header_span_cols(tab, spans, hy):
    """用表头区（hy 上 8px ~ 下 6px，容纳表头文字垂直错位）内主列名 span 的 x0 重建列映射与列区间"""
    if hy <= 0:
        return {}, {}
    tb = fitz.Rect(tab.bbox)
    found = {}
    for s in spans:
        if not (hy - 8 <= s['y'] <= hy + 6):
            continue
        if not (tb.x0 - 2 <= s['x'] <= tb.x1 + 2):
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


def parse_page(page):
    spans = spans_of(page)
    recs = []
    for tab in page.find_tables().tables:
        col_idx, hy = header_cols(tab, spans)
        if not col_idx or 'model' not in col_idx or hy <= 0:
            continue
        ranges = col_ranges(tab)
        # cells 列区间不可信（跨列重叠）或表头 texts 合并（多列名同索引）时，用表头 span x0 重建
        idx_conflict = len(set(col_idx.values())) < len(col_idx)
        if ranges_overlap(ranges) or idx_conflict:
            alt_idx, alt_ranges = header_span_cols(tab, spans, hy)
            if len(alt_ranges) >= 5:
                col_idx, ranges = alt_idx, alt_ranges
        tb = fitz.Rect(tab.bbox)
        tb.y0 -= 2; tb.y1 += 2; tb.x0 -= 2; tb.x1 += 2

        def bucket(s):
            cx = (s['x'] + s['x1']) / 2.0
            best = None
            for i, (x0, x1) in ranges.items():
                if x0 - 4 <= cx <= x1 + 4:
                    # 取最靠左匹配（列区间可能重叠时）
                    if best is None or x0 > ranges[best][0]:
                        best = i
            return best

        # 表内型号锚点（表头之下）
        anchors = []
        for s in spans:
            if s['y'] < hy + 4:
                continue
            if not (tb.x0 <= s['x'] <= tb.x1 and tb.y0 <= s['y'] <= tb.y1):
                continue
            if bucket(s) != col_idx['model']:
                continue
            if not MODEL_RE.match(clean(s['t'])):
                continue
            anchors.append(s)
        anchors.sort(key=lambda s: s['y'])

        for ai, a in enumerate(anchors):
            y_next = anchors[ai + 1]['y'] if ai + 1 < len(anchors) else a['y'] + 16
            y_hi = min(a['y'] + 13, y_next - 2)
            rec = {'model': clean(a['t'])}
            for s in spans:
                # 窗口上界取 -7：部分页（如金星 VEN）单元格文本垂直居中，偏上约 5px
                if not (a['y'] - 7 <= s['y'] <= y_hi):
                    continue
                if s is a:
                    continue
                b = bucket(s)
                if b is None:
                    continue
                name = None
                for k, v in col_idx.items():
                    if v == b:
                        name = k
                        break
                if not name or name == 'model':
                    continue
                rec.setdefault(name, []).append(s['t'])
            for k in list(rec.keys()):
                if k == 'model':
                    continue
                rec[k] = ' '.join(rec[k])
            # fps 桶清洗：帧率数据左偏时会混入传感器文本，提取数字后把剩余文本并回 sensor 桶
            if rec.get('fps'):
                fm2 = re.search(r'(\d+(?:\.\d+)?)', rec['fps'])
                if fm2:
                    rest = rec['fps'][fm2.end():].strip(' ，,')
                    rec['fps'] = fm2.group(1)
                    if rest:
                        rec['sensor'] = (rec.get('sensor', '') + ' ' + rest).strip()
            recs.append(rec)
    return recs


def to_cameras(rec):
    model = rec['model']
    fam = model.split('-')[0]
    if fam == 'POLS':
        return None, 'framegrabber'

    mm = re.search(r'(\d+)\s*×\s*(\d+)', rec.get('res', ''))
    if not mm:
        nums = re.findall(r'\d+', rec.get('res', ''))
        if len(nums) < 2:
            return None, 'no-res'
        w, h = int(nums[0]), int(nums[1])
    else:
        w, h = int(mm.group(1)), int(mm.group(2))

    fm = re.search(r'(\d+(?:\.\d+)?)', rec.get('fps', ''))
    if not fm:
        return None, 'no-fps'
    fps = float(fm.group(1))

    pm = re.search(r'(\d+(?:\.\d+)?)', rec.get('px', ''))
    if not pm:
        return None, 'no-px'
    pxUm = float(pm.group(1))

    sensor_txt = rec.get('sensor', '')
    shutter = 'Rolling' if '行曝光' in sensor_txt else 'Global'
    # 靶面：2/3" / 1.1"（PDF 偶见双单引号 1.1''）/ 11.1 mm（大靶面页用 mm）
    sm = re.search(r'(\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?\s*(?:"|\'\'|\'|mm))', sensor_txt)
    size = sm.group(1) if sm else None
    # 传感器名：去掉所有靶面字样与工艺词（并桶后靶面可能在中间）
    sensor_name = re.sub(r'\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?\s*(?:"|\'\'|\'|mm)', '', sensor_txt)
    sensor_name = re.sub(r'(帧|行)曝光|CMOS|堆栈式BSI|堆栈式|BSI', '', sensor_name).strip(' ，,') or None

    iface = norm_iface(rec.get('iface', ''))
    if not iface:
        if 'GT' in model:
            iface = '10GigE'
        elif re.search(r'G\d?[MC]', model) or 'GM' in model or 'G2' in model:
            iface = 'GigE'
        elif 'U3' in model:
            iface = 'USB3'
        elif 'X2' in model:
            iface = 'CoaXPress'
        else:
            return None, 'no-iface'

    # 镜头接口 → mount：F/M42 大靶面口；其余按 C 口（C/CS/S/No-mount、C/M42 均可转 C）
    mount_txt = rec.get('mount', '')
    if ('F' in mount_txt or 'M42' in mount_txt) and not mount_txt.lstrip().startswith('C'):
        mount = 'M42/F'
    else:
        mount = 'C'

    color_txt = rec.get('color', '').replace(' ', '')
    swir = 'SWIR' in model or '-SWIR' in model
    # 仅当型号本身含 M/C 时才拆黑白/彩色双 SKU；无 M/C 的（如 -V 版）按黑白入库
    if swir or '紫外' in color_txt or 'NIR' in model or 'M/C' not in model:
        variants = [('黑白', model)]
    elif '彩色' in color_txt:
        base = re.sub(r'M/C', 'M', model, count=1)
        colorized = re.sub(r'M/C', 'C', model, count=1)
        variants = [('黑白', base), ('彩色', colorized)]
    else:
        variants = [('黑白', model)]

    # 系列码：族-像素码-帧率码(数字)-接口码(字母开头)，如 MER3-126-61G3M-P → MER3-G3
    sm2 = re.match(r'^([A-Z0-9]+?)-\d{2,4}-(\d{1,4})([A-Z].*)?$', model)
    iface_code = None
    if sm2:
        rest = sm2.group(3) or ''
        cm = re.match(r'^(GT|G3|G2|G\d|U3D?|X2)', rest)
        iface_code = cm.group(1) if cm else rest[:1]
    series = (fam + '-' + iface_code) if iface_code else fam

    kind = '板级' if fam in BOARD_FAMILY else '面阵'
    out = []
    for color, mdl in variants:
        out.append({
            'model': mdl,
            'brand': '大恒图像',
            'series': series,
            'seriesName': FAMILY_SERIES.get(fam, fam),
            'w': w, 'h': h,
            'sw': round(w * pxUm / 1000.0, 3),
            'sh': round(h * pxUm / 1000.0, 3),
            'pxUm': pxUm,
            'size': size,
            'fps': fps,
            'shutter': shutter,
            'iface': iface,
            'color': color,
            'mount': mount,
            'kind': kind,
            'sensor': sensor_name,
        })
    return out, None


def main():
    doc = fitz.open(PDF)
    recs = []
    for pno in range(doc.page_count):
        recs.extend(parse_page(doc[pno]))

    cams, bad = [], []
    for r in recs:
        out, err = to_cameras(r)
        if out is None:
            bad.append((r['model'], err))
            continue
        cams.extend(out)

    seen, uniq = set(), []
    for c in cams:
        k = (c['model'], c['color'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(c)
    uniq.sort(key=lambda c: (c['series'], c['model'], c['color']))

    os.makedirs('tools/_cache', exist_ok=True)
    with open(CACHE, 'w', encoding='utf-8') as f:
        json.dump(uniq, f, ensure_ascii=False, indent=1)

    print('解析行:', len(recs), '→ 相机:', len(uniq))
    if bad:
        print('跳过:', len(bad), bad[:10])
    by_iface, by_color, by_kind, by_series = {}, {}, {}, {}
    for c in uniq:
        by_iface[c['iface']] = by_iface.get(c['iface'], 0) + 1
        by_color[c['color']] = by_color.get(c['color'], 0) + 1
        by_kind[c['kind']] = by_kind.get(c['kind'], 0) + 1
        by_series[c['series']] = by_series.get(c['series'], 0) + 1
    print('接口:', by_iface)
    print('颜色:', by_color)
    print('类型:', by_kind)
    print('系列:', dict(sorted(by_series.items())))
    miss = [c['model'] for c in uniq if not c['size'] or not c['sensor'] or not c['fps']]
    print('缺字段:', len(miss), miss[:12])
    # 快门统计
    by_sh = {}
    for c in uniq:
        by_sh[c['shutter']] = by_sh.get(c['shutter'], 0) + 1
    print('快门:', by_sh)
    for c in uniq[:2] + uniq[-2:]:
        print(' ', json.dumps(c, ensure_ascii=False))


if __name__ == '__main__':
    main()
