# -*- coding: utf-8 -*-
"""
华睿线阵相机解析器：从《机器视觉产品手册中文版V20260901》p27-29 解析线阵相机。
策略：span 流 + 表头列名 x 边界定桶（find_tables 重组会污染文本，不可用）。
输出：huarui-catalog.js 的 LINESCAN 段由 parse-huarui.py 统一生成，这里产中间 JSON。
"""
import fitz, re, json, os

PDF = 'manuals/机器视觉产品手册中文版V20260901.pdf'
PAGES = {27: 'GigE', 28: 'CameraLink', 29: 'CoaXPress'}

MODEL_RE = re.compile(r'^\*?L\d{3,4}[A-Z]{1,2}\d{2,4}$')

# 每桶字段模式校验：剔除 PDF 重复文本层跨列污染（如 px 桶混入 'CMOS'）
BUCKET_VALIDATORS = {
    'model': lambda t: bool(re.fullmatch(r'\*?L\d{3,4}[A-Z0-9]{2,8}', t)),
    'res': lambda t: bool(re.search(r'\d+\s*[x*×]\s*\d+', t)),
    'rate': lambda t: bool(re.search(r'\d', t)),
    'px': lambda t: bool(re.fullmatch(r'\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?', t.strip())),
    'color': lambda t: t in ('黑白', '彩色'),
    'expo': lambda t: bool(re.search(r'\d', t)),
    'iface': lambda t: bool(re.search(r'GIGE|CXP|CAMERALINK|^CL$|USB', t.upper())),
    'mount': lambda t: bool(re.match(r'^[CMF]', t)),
    'stype': lambda t: 'CMOS' in t,
}

# 列名关键词 → 字段名（按页表头 span 匹配）
COL_KEYS = [
    ('产品型号', 'model'), ('分辨率', 'res'), ('行频', 'rate'), ('位深', 'bit'),
    ('类型', 'stype'), ('像元', 'px'), ('颜色', 'color'), ('曝光时间', 'expo'),
    ('传输接口', 'iface'), ('相机尺寸', 'dim'), ('镜头接口', 'mount'),
    ('供电', 'power'), ('结构尺寸图', 'fig'),
]


def page_spans(page):
    d = page.get_text('dict')
    out = []
    for b in d['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    out.append({'x': s['bbox'][0], 'xc': (s['bbox'][0] + s['bbox'][2]) / 2,
                                'y': s['bbox'][1], 't': t})
    return out


def parse_page(doc, pno, iface):
    page = doc[pno - 1]
    spans = page_spans(page)

    # 1) 表头 span：y 在 140~172 的列名 span（两行表头都在此区间）
    hdr = {}
    for s in spans:
        if not (140 <= s['y'] <= 172):
            continue
        for key, name in COL_KEYS:
            if key in s['t'].replace(' ', '') and name not in hdr:
                hdr[name] = s['x']
    if 'model' not in hdr or 'res' not in hdr:
        print('p%d 表头识别失败: %s' % (pno, hdr))
        return []

    # 2) 列边界：相邻列名 x 的中点
    cols = sorted(hdr.items(), key=lambda kv: kv[1])
    bounds = {}
    for i, (name, x0) in enumerate(cols):
        x1 = cols[i + 1][1] if i + 1 < len(cols) else 1200
        bounds[name] = (x0 - 6, (x0 + x1) / 2 + 6)

    def bucket(s):
        for name, (x0, x1) in bounds.items():
            if x0 <= s['xc'] <= x1:
                return name
        return None

    # 3) 数据行：y > 表头底（172），按 y 聚类
    hdr_bottom = 172
    rows = {}
    for s in spans:
        if s['y'] <= hdr_bottom:
            continue
        key = round(s['y'] / 4)
        rows.setdefault(key, []).append(s)
    # 聚类合并（相邻 key 间隔 <4px 视为一行）
    keys = sorted(rows)
    lines, cur, curY = [], [], None
    for k in keys:
        y = rows[k][0]['y']
        if curY is None or y - curY < 4:
            cur.extend(rows[k])
            curY = y if curY is None else curY
        else:
            lines.append((curY, cur))
            cur, curY = rows[k], y
    if cur:
        lines.append((curY, cur))

    recs = []
    seen_vals = {}  # 列 → 已接受值集合（PDF 重复文本层过滤：同行冲突取未出现过的值）
    for y, ss in lines:
        ss.sort(key=lambda s: s['x'])
        cells = {}
        for s in ss:
            b = bucket(s)
            if not b:
                continue
            cells.setdefault(b, [])
            if s['t'] not in cells[b]:
                cells[b].append(s['t'])
        # 桶内过滤：① 同桶去重（忽略前导 *，PDF 同单元格重复渲染）
        #          ② 字段模式校验（剔除跨列重复层，如 px 桶混入 'CMOS'）
        #          ③ 排除前面行已出现的同文本（同行多值取未出现过的）
        for b in list(cells.keys()):
            vals, seen_in_row, dedup = cells[b], set(), []
            for t in vals:
                k = t.lstrip('*')
                if k not in seen_in_row:
                    seen_in_row.add(k)
                    dedup.append(t)
            vals = dedup
            v = BUCKET_VALIDATORS.get(b)
            if v:
                ok = [t for t in vals if v(t)]
                if ok:
                    vals = ok
            if len(vals) > 1:
                fresh = [t for t in vals if t.lstrip('*') not in seen_vals.get(b, ())]
                vals = fresh if fresh else vals
            cells[b] = vals
        cells = {k: ''.join(v) for k, v in cells.items()}

        model = cells.get('model', '')
        m = re.search(r'\*?L\d{3,4}[A-Z0-9]{2,8}', model)
        if not m:
            continue
        model = m.group(0)

        # 分辨率：2048 x 4 / 4096*2 → w, taps
        res = cells.get('res', '').replace(' ', '')
        rm = re.search(r'(\d+)[x*×](\d+)', res)
        if not rm:
            print('p%d %s 分辨率解析失败: %r' % (pno, model, cells.get('res')))
            continue
        w, taps = int(rm.group(1)), int(rm.group(2))

        # 行频：#29~58 → 标准 29、最高 58；单值 59
        rate_txt = cells.get('rate', '').replace(' ', '').lstrip('#')
        nums = re.findall(r'\d+(?:\.\d+)?', rate_txt)
        if not nums:
            print('p%d %s 行频解析失败: %r' % (pno, model, cells.get('rate')))
            continue
        rate_std = float(nums[0])
        rate_max = float(nums[-1])

        # 像元：7*7 / 3.5*3.5
        px = cells.get('px', '')
        pm = re.search(r'(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)', px)
        if not pm:
            print('p%d %s 像元解析失败: %r' % (pno, model, px))
            continue
        pxH, pxV = float(pm.group(1)), float(pm.group(2))

        color = '彩色' if '彩' in cells.get('color', '') else '黑白'

        # 曝光：8μs~100ms / 3us~100ms（PDF 混用全角 μ 与 ASCII u）
        expo = cells.get('expo', '')
        em = re.search(r'(\d+(?:\.\d+)?)\s*[μu]s', expo)
        expMinUs = float(em.group(1)) if em else None

        # 接口：按单元格文本归一（同页可能混排 GigE / 10GigE）
        iface_txt = cells.get('iface', '')
        if '10GIGE' in iface_txt.upper().replace(' ', ''):
            iface_norm = '10GigE'
        elif 'CXP' in iface_txt.upper():
            iface_norm = 'CoaXPress'
        elif 'CAMERALINK' in iface_txt.upper() or iface_txt.strip() == 'CL':
            iface_norm = 'CameraLink'
        elif 'USB' in iface_txt.upper():
            iface_norm = 'USB3'
        else:
            iface_norm = 'GigE'

        # 镜头接口：C(FBL17526) / M42*1.0 / M72*0.75 / M90*1
        mount_txt = cells.get('mount', '')
        if mount_txt.startswith('C'):
            mount = 'C'
        elif 'M90' in mount_txt:
            mount = 'M90'
        elif 'M72' in mount_txt:
            mount = 'M72'
        elif 'M42' in mount_txt:
            mount = 'M42'
        else:
            mount = 'C'

        sensor = 'CMOS' if 'CMOS' in cells.get('stype', '') else None

        recs.append({
            'model': model,
            'w': w,
            'taps': taps,
            'pxH': pxH,
            'pxV': pxV,
            'lineRate': rate_std,
            'lineRateMax': rate_max,
            'color': color,
            'iface': iface_norm,
            'series': iface_norm + ' 线阵',
            'mount': mount,
            'powerW': None,
            'sensor': sensor,
            'expMinUs': expMinUs,
        })
        # seen 更新用提取后的规范值（避免同行近似重复文本 join 后污染）
        seen_vals.setdefault('model', set()).add(model.lstrip('*'))
        for b, v in cells.items():
            seen_vals.setdefault(b, set()).add(v.lstrip('*'))
    return recs


def main():
    doc = fitz.open(PDF)
    all_recs = []
    for pno, iface in PAGES.items():
        recs = parse_page(doc, pno, iface)
        print('p%d(%s): %d 台' % (pno, iface, len(recs)))
        all_recs.extend(recs)

    # 去重（同名型号）
    seen, out = set(), []
    for r in all_recs:
        if r['model'] in seen:
            continue
        seen.add(r['model'])
        out.append(r)

    os.makedirs('tools/_cache', exist_ok=True)
    with open('tools/_cache/huarui_linescan.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print('合计 %d 台，已写 tools/_cache/huarui_linescan.json' % len(out))
    for r in out:
        print('  %-16s w=%-6d taps=%d px=%gx%g rate=%g(max %g) %s %s %s exp=%s' % (
            r['model'], r['w'], r['taps'], r['pxH'], r['pxV'], r['lineRate'],
            r['lineRateMax'], r['color'], r['iface'], r['mount'], r['expMinUs']))


if __name__ == '__main__':
    main()
