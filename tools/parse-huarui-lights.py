# -*- coding: utf-8 -*-
"""
华睿光源 / 光源控制器解析器：从《机器视觉产品手册中文版V20260901》p66-78 解析。
策略：span 流 + 表头列名 x 边界定桶（与 parse-huarui-linescan.py 相同，find_tables 会污染文本不可用）。
要点：
  1) 每页按「产品型号」表头 span 切分为多个 section（p75 同页含「无影圆顶光源」与「模拟恒压控制器」两张表）；
  2) 表头**所有**列都登记为桶边界（只提取需要的字段），否则相邻列数据会落进目标桶污染单元格
     （如 p68 无「照射角度」列时 24V 会落进型号桶、控制器 PWM 值会落进亮度控制桶）；
  3) 行归属用「锚点行」法：以合规型号 span 为锚，其余 span 归属其上方最近的锚点行，
     兼容 PDF 行内 y 抖动与单元格换行（如「可变电流控制 / 面板按键 /」+「RS232」两行）；
  4) 一级表头「功率 (W)」跳过，由二级 (R) / (G/B/W) 定列（两档功率分列）。
颜色按 A 方案拆分：型号尾 W/R/B（个别 W/R/G/B）→ 逐色独立型号；
      红灯取「功率 (R)」列，白/蓝/绿灯取「功率 (G/B/W)」列。
输出：tools/_cache/huarui_lights.json、tools/_cache/huarui_controllers.json
      由 tools/parse-huarui.py 读入并生成 huarui-catalog.js 的 LIGHTS / CONTROLLERS 段。
"""
import fitz, re, json, os

PDF = 'manuals/机器视觉产品手册中文版V20260901.pdf'

# 页 → (光源子类 type, 中文名)
#   ring       环形光源      size=[直径, 照射角]
#   ring_dome  环形无影光源  size=[直径]
#   bar        条形光源      size=[长, 宽]（外形尺寸前两值）
#   backlight  面光源        size=[发光面 w, h]
#   coaxial    同轴光源      size=[发光面 w, h]
#   line       线光源        size=[发光长]
#   point      点光源        size=[发光面直径, 外形直径]
#   dome       无影圆顶光源  size=[直径]
LIGHT_PAGES = {
    66: ('ring', '环形光源'),
    68: ('ring_dome', '环形无影光源'),
    69: ('bar', '条形光源'),
    70: ('bar', '条形光源'),
    71: ('backlight', '面光源'),
    72: ('coaxial', '同轴光源'),
    73: ('line', '线光源'),
    74: ('point', '点光源'),
    75: ('dome', '无影圆顶光源'),
}
CTRL_PAGES = [75, 76, 78]  # 75=模拟恒压 76=数字恒压 78=恒流（控制器表均为所在页最后一张表）

# 表头列名关键词 → 字段名（全部登记为桶边界；未用字段只参与定界，防止邻列数据污染）
LIGHT_COLS = [
    ('产品型号', 'model'), ('工作电压', 'volt'), ('照射角度', 'angle'),
    ('供电接口类型', 'iface'), ('供电线长度', 'cable'),
    ('(R)', 'powerR'), ('(G/B/W)', 'powerGBW'), ('灯珠排数', 'led'),
    ('外形尺寸', 'dims'), ('外形直径', 'diameter'), ('孔径', 'aperture'),
    ('发光面', 'emissive'), ('光源线数量', 'lines'), ('漫射板', 'diff'),
    ('结构尺寸图', 'fig'), ('结构示意图', 'fig'),
    ('延长线配套', 'ext'), ('推荐控制器', 'recctrl'),
]
CTRL_COLS = [
    ('产品型号', 'model'), ('亮度控制', 'mode'), ('PWM', 'pwm'),
    ('输入电压', 'vin'), ('通道数', 'channels'), ('输出电压', 'vout'),
    ('最大输出电流', 'imax'), ('输出总电流', 'itot'), ('总功率', 'power'),
    ('触发方式', 'trig'), ('外触发电压', 'vtrig'), ('触发延迟', 'delay'),
    ('供电接口', 'conn'), ('产品尺寸', 'dims'), ('冷却方式', 'cool'),
    ('外接电源', 'ext'),
]

FOOTER_RE = re.compile(r'^-\d+-$')
# 数据区内的节标题 / 页面装饰 span（会落在型号列 x 上污染末行，须整条剔除）
FURNITURE = {
    '外观尺寸图', '技术参数', '结构尺寸图', '结构示意图', '产品丰富, 设计紧凑', '产品丰富，设计紧凑',
    '机器视觉产品手册', '机器视觉光源',
    '环形光源', '环形无影光源', '条形光源', '面光源', '同轴光源', '线光源', '点光源', '无影圆顶光源',
    '模拟恒压控制器', '数字恒压控制器', '恒流控制器',
}
MODEL_RE = re.compile(r'(PFM-[A-Z0-9]+?)W/R(?:/G)?/B')
CTRL_MODEL_RE = re.compile(r'^LC-[A-Z0-9\-]+$')
NUM = r'\d+(?:\.\d+)?'
DIMS_RE = re.compile(r'φ?\s*(' + NUM + r')(?:\s*\*\s*φ?\s*(' + NUM + r'))?(?:\s*\*\s*φ?\s*(' + NUM + r'))?')
COLOR_MAP = {'W': 'white', 'R': 'red', 'B': 'blue', 'G': 'green'}


def norm(t):
    return t.replace(' ', '').replace('　', '')


def page_spans(page):
    d = page.get_text('dict')
    out = []
    for b in d['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if not t or FOOTER_RE.match(t):
                    continue
                out.append({'x': s['bbox'][0], 'xc': (s['bbox'][0] + s['bbox'][2]) / 2,
                            'y': s['bbox'][1], 't': t})
    return out


def match_cols(header_spans, coldefs):
    """表头 span → {字段: x}。一级『功率 (W)』表头跳过（由二级 (R)/(G/B/W) 定列）。"""
    cols = {}
    for s in header_spans:
        nt = norm(s['t'])
        if nt in ('功率(W)', '功率（W)', '功率(W)(R)', '功率(W)(G/B/W)'):
            continue
        for key, field in coldefs:
            if key in nt and field not in cols:
                cols[field] = s['x']
                break
    return cols


def make_bucket(cols):
    items = sorted(cols.items(), key=lambda kv: kv[1])
    bounds = []
    for i, (f, x) in enumerate(items):
        x_next = items[i + 1][1] if i + 1 < len(items) else None
        hi = (x + x_next) / 2 + 8 if x_next is not None else 9999
        bounds.append((f, x - 8, hi))

    def bucket(xc):
        for f, lo, hi in bounds:
            if lo <= xc <= hi:
                return f
        return None
    return bucket


def header_band(spans, yh):
    return [s for s in spans if yh - 10 <= s['y'] <= yh + 16]


def sections(spans):
    """所有『产品型号』表头的 y（一页可能有多张表）"""
    return sorted(s['y'] for s in spans if '产品型号' in norm(s['t']))


def anchor_rows(spans, yh, y_end, bucket, model_ok):
    """
    以「合规型号」span 为锚点行；其余 span 归属其上方最近（y ≤ 自身 y + 5）的锚点。
    兼容：① 行内 y 抖动（0.1~0.6px）；② 多行单元格的第二行（换行，低于本行 ~10px）；
          ③ 部分列整体比型号列高 3~5px（两行单元格的垂直对齐差异，见 p76 亮度控制列）。
    """
    band = [s for s in spans if yh + 16 < s['y'] < y_end and s['t'].strip() not in FURNITURE]
    anchors = []
    for s in sorted(band, key=lambda s: (s['y'], s['x'])):
        if bucket(s['xc']) == 'model' and model_ok(s['t']):
            if anchors and s['y'] - anchors[-1]['y'] < 2:
                continue                      # 同行的重复文本层
            anchors.append(s)
    rows = {id(a): [a] for a in anchors}
    for s in band:
        owner = None
        for a in anchors:
            if a['y'] <= s['y'] + 5:
                owner = a
            else:
                break
        if owner is None or owner is s:
            continue
        rows[id(owner)].append(s)
    return [rows[id(a)] for a in anchors]


def row_cells(spans, bucket):
    cells = {}
    for s in sorted(spans, key=lambda s: s['x']):
        b = bucket(s['xc'])
        if not b:
            continue
        cells.setdefault(b, [])
        if s['t'] not in cells[b]:            # 桶内去重（PDF 重复文本层）
            cells[b].append(s['t'])
    return {k: ''.join(v) for k, v in cells.items()}


def fnum(txt):
    t = txt.strip()
    if not t or t in ('—', '-', '–'):
        return None
    m = re.fullmatch(NUM, t)
    return float(m.group(0)) if m else None


def dims_list(txt):
    m = DIMS_RE.search(txt)
    if not m:
        return []
    return [float(g) for g in m.groups() if g]


def one_num(txt):
    m = re.search(r'φ?\s*(' + NUM + r')', txt)
    return float(m.group(1)) if m else None


def split_colors(base, suffixes, power_r, power_gbw):
    """A 方案：W/R/B（或 W/R/G/B）→ 逐色型号；红灯取 (R) 功率，其余取 (G/B/W)"""
    out = []
    for c in suffixes:
        power = power_r if c == 'R' else power_gbw
        if power is None:                     # 个别型号 R 功率标 '—'，按 G/B/W 档兜底
            power = power_gbw
        out.append((base + c, COLOR_MAP[c], power))
    return out


def parse_light_row(cells, ltype, lname):
    mtxt = cells.get('model', '')
    m = MODEL_RE.search(mtxt)
    if not m:
        return None
    base = m.group(1)
    suffixes = re.findall(r'[WRBG]', mtxt[m.start() + len(base):m.end()])
    power_r, power_gbw = fnum(cells.get('powerR', '')), fnum(cells.get('powerGBW', ''))
    diameter = one_num(cells.get('diameter', '')) if cells.get('diameter') else None
    dims = dims_list(cells.get('dims', ''))
    emissive = dims_list(cells.get('emissive', ''))
    angle_txt = cells.get('angle', '')
    am = re.search(NUM, angle_txt)
    angle = float(am.group(0)) if am else None

    if diameter is None and dims:             # 无「外形直径」列时从外形尺寸取第一值
        diameter = dims[0]

    if ltype == 'ring':
        size = [diameter, angle]
    elif ltype in ('ring_dome', 'dome'):
        size = [diameter]
    elif ltype == 'bar':
        size = dims[:2]
    elif ltype in ('backlight', 'coaxial'):
        size = emissive[:2] if emissive else dims[:2]
    elif ltype == 'line':
        size = [emissive[0]] if emissive else [dims[0]]
    elif ltype == 'point':
        size = [emissive[0] if emissive else None, diameter]
    else:
        size = dims[:2]

    if ltype != 'ring' and (not size or not size[0]):
        print('    ! 尺寸缺失: %s cells=%s' % (base, cells))
        return None

    recs = []
    for model, color, power in split_colors(base, suffixes, power_r, power_gbw):
        recs.append({
            'model': model,
            'type': ltype,
            'color': color,
            'size': size,
            'name': lname + model,
            'power': power,
            'angle': angle if ltype == 'ring' else None,
        })
    return recs


def parse_ctrl_row(cells):
    mtxt = cells.get('model', '').strip()
    if not CTRL_MODEL_RE.match(mtxt):
        return None
    cm = re.search(r'\d+', cells.get('channels', ''))
    if not cm:
        print('    ! 控制器缺通道数: %s cells=%s' % (mtxt, cells))
        return None
    return {
        'model': mtxt,
        'channels': int(cm.group(0)),
        'mode': cells.get('mode', '').strip() or None,
        'strobe': '触发' in cells.get('trig', ''),
    }


def main():
    doc = fitz.open(PDF)
    lights, ctrls = [], []
    problems = []

    for pno in sorted(set(list(LIGHT_PAGES) + CTRL_PAGES)):
        page = doc[pno - 1]
        spans = page_spans(page)
        heads = sections(spans)
        if not heads:
            problems.append('p%d 未找到表头' % pno)
            continue
        for idx, yh in enumerate(heads):
            is_last = idx == len(heads) - 1
            is_ctrl = pno in CTRL_PAGES and is_last
            y_end = heads[idx + 1] - 25 if idx + 1 < len(heads) else 9999
            coldefs = CTRL_COLS if is_ctrl else LIGHT_COLS
            cols = match_cols(header_band(spans, yh), coldefs)
            if 'model' not in cols:
                problems.append('p%d#%d 表头缺型号列: %s' % (pno, idx, cols))
                continue
            bucket = make_bucket(cols)
            if is_ctrl:
                model_ok = lambda t: bool(CTRL_MODEL_RE.match(t.strip()))
            else:
                model_ok = lambda t: bool(MODEL_RE.search(t))
            rows = anchor_rows(spans, yh, y_end, bucket, model_ok)
            n_ok = 0
            for ss in rows:
                cells = row_cells(ss, bucket)
                if is_ctrl:
                    rec = parse_ctrl_row(cells)
                    if rec:
                        ctrls.append(rec)
                        n_ok += 1
                else:
                    ltype, lname = LIGHT_PAGES[pno]
                    recs = parse_light_row(cells, ltype, lname)
                    if recs:
                        lights.extend(recs)
                        n_ok += 1
            print('p%-3d %-6s %-11s 行数=%d' % (pno, '控制器' if is_ctrl else '光源',
                                               ('ctrl' if is_ctrl else ltype), n_ok))

    doc.close()

    def dedup(recs, key):
        seen, out = set(), []
        for r in recs:
            if r[key] in seen:
                continue
            seen.add(r[key])
            out.append(r)
        return out

    lights = dedup(lights, 'model')
    ctrls = dedup(ctrls, 'model')

    os.makedirs('tools/_cache', exist_ok=True)
    json.dump(lights, open('tools/_cache/huarui_lights.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(ctrls, open('tools/_cache/huarui_controllers.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    base_cnt = len(set(re.sub(r'[WRBG]$', '', l['model']) for l in lights))
    print('\n光源 %d 个型号（%d 个基型号 × 颜色拆分），控制器 %d 台' % (len(lights), base_cnt, len(ctrls)))
    by_type, by_color = {}, {}
    for l in lights:
        by_type[l['type']] = by_type.get(l['type'], 0) + 1
        by_color[l['color']] = by_color.get(l['color'], 0) + 1
    print('光源按类型:', by_type)
    print('光源按颜色:', by_color)
    if problems:
        print('问题:', problems)

    print('\n--- 光源清单 ---')
    for l in sorted(lights, key=lambda x: (x['type'], x['size'][0] or 0, x['model'])):
        print('  %-26s %-11s %-6s %-14s power=%s angle=%s' % (
            l['model'], l['type'], l['color'], l['size'], l['power'], l['angle']))
    print('\n--- 控制器清单 ---')
    for c in sorted(ctrls, key=lambda x: x['model']):
        print('  %-20s ch=%d strobe=%s mode=%s' % (c['model'], c['channels'], c['strobe'], c['mode']))


if __name__ == '__main__':
    main()
