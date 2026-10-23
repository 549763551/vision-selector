# -*- coding: utf-8 -*-
"""
大恒 HN / HN-P 系列镜头解析器：从《大恒镜头产品型录.pdf》p5-8 解析自有品牌定焦镜头。
策略：get_text() 行流（保留完整小数精度）+ 型号锚点切块 + 顺序模式匹配取值。
代理品牌（Computar/Kowa/FUJINON/RICOH/SCHNEIDER 等）不入库。
输出：tools/_cache/daheng_lenses.json → 由 gen-daheng-catalog.py 并入 daheng-catalog.js。
"""
import fitz, re, json, os

PDF = 'manuals/大恒镜头产品型录.pdf'
PAGES = [5, 6, 7, 8]

# 型号锚点：HN-0612-2M-C1/2X / HNP-0628-6M-C1/1.8X / HNP3528100MF / HNP4040L
MODEL_ANCHOR = re.compile(r'^HN-?P?-?\d')

# 顺序模式：靶面 → 焦距 → 光圈 → 视场角 → 畸变 → 工作距离 → 滤镜 → 尺寸 → 接口
# 视场角行可能尾部附带畸变（'21.82×16.06 0.016'），由状态机双填
PATS = [
    ('fmt', re.compile(r'^(?:\d+/[\d.]+"?|\d+(?:\.\d+)?"|Φ\d+)$')),
    ('focal', re.compile(r'^\d+(?:\.\d+)?$')),
    ('aper', re.compile(r'^F[\d.]+-F[\d.]+$')),
    ('fov', re.compile(r'^\d+(?:\.\d+)?×\d+(?:\.\d+)?(?:\s+[±\-]?\d+(?:\.\d+)?\*?)?$')),
    ('dist', re.compile(r'^[±\-]?\d+(?:\.\d+)?\*?$')),
    ('wd', re.compile(r'^\d+(?:\.\d+)?m\s*-\s*∞$')),
    ('filter', re.compile(r'^(?:M[\d.]+×[\d.]+|―|-)$')),
    ('dims', re.compile(r'^Φ[\d.]+×[\d.]+$')),
    ('mount', re.compile(r'^(C|F|V38|M42|M72)$')),
]

# 可选跳过模式（不占位）：分辨率 8K/16K、放大倍率 0.04×/0.07×、斜杠多值 -0.17/-0.14
SKIP_PATS = [
    re.compile(r'^\d+K$'),
    re.compile(r'^[\d.]+\s*×\s*/'),
    re.compile(r'^-?[\d.]+/-?[\d.]+$'),
]

# 可选字段：该列缺失时自动跳过（如线扫表无视场角/畸变列）
OPTIONAL_FIELDS = {'fov', 'dist', 'filter'}
TOKEN_RE = re.compile(r'\d+(?:\.\d+)?m\s*-\s*∞|M[\d.]+×[\d.]+|Φ[\d.]+×[\d.]+|(?:(?<=\s)|^)(?:V38|[CF])(?=\s|$)')


def split_line(ln):
    toks = TOKEN_RE.findall(ln)
    if len(toks) >= 2:
        cover = sum(len(t.strip()) for t in toks)
        if cover >= len(ln.replace(' ', '')) * 0.6:
            return [t.strip() for t in toks]
    return [ln]

# 靶面 → 像面对角线 mm（行业标准值，与大恒相机库保持一致）
IC_MAP = {
    '1/2"': 8.0, '1/1.8"': 8.9, '2/3"': 11.0, '1"': 15.8,
    '1.1"': 17.5, '1.2"': 19.0, 'Φ46': 46.0, 'Φ60': 60.0,
}


def parse_page(doc, pno):
    page = doc[pno - 1]
    lines = [l.strip() for l in page.get_text().split('\n') if l.strip()]
    recs = []
    cur = None
    for raw in lines:
        for ln in split_line(raw):
            if MODEL_ANCHOR.match(ln) and re.search(r'\d', ln):
                if cur:
                    recs.append(cur)
                cur = {'model': ln.replace(' ', ''), 'vals': [], 'i': 0}
                continue
            if cur is None or cur['i'] >= len(PATS):
                continue
            # 当前行依次尝试：匹配 / SKIP / 可选字段跳过（当前行重新参与）
            while cur['i'] < len(PATS):
                name, pat = PATS[cur['i']]
                if pat.match(ln):
                    if name == 'fov':
                        # 视场角行可能尾部附带畸变（'21.82×16.06 0.016'）
                        parts = ln.split()
                        cur['vals'].append(('fov', parts[0]))
                        cur['i'] += 1
                        if len(parts) > 1:
                            cur['vals'].append(('dist', parts[1]))
                            cur['i'] += 1
                    else:
                        cur['vals'].append((name, ln))
                        cur['i'] += 1
                    break
                if any(sp.match(ln) for sp in SKIP_PATS):
                    break  # 可选列（分辨率/放大倍率/斜杠多值）：丢弃该行，不占位
                if name in OPTIONAL_FIELDS:
                    cur['i'] += 1
                    continue
                break
    if cur:
        recs.append(cur)

    out = []
    for r in recs:
        vals = dict(r['vals'])
        # 必需字段：靶面/焦距/光圈（接口缺省 C；畸变/滤镜/工作距离可缺）
        if not {'fmt', 'focal', 'aper'}.issubset(vals.keys()):
            continue
        fmt = vals.get('fmt', '')
        ic = IC_MAP.get(fmt)
        if ic is None:
            print('p%d %s 未知靶面 %r，跳过' % (pno, r['model'], fmt))
            continue
        aper = vals.get('aper', '')
        am = re.match(r'^F([\d.]+)-F([\d.]+)$', aper)
        if not am:
            print('p%d %s 光圈解析失败 %r' % (pno, r['model'], aper))
            continue
        wd = vals.get('wd', '')
        wm = re.match(r'^(\d+(?:\.\d+)?)m', wd)
        dist = vals.get('dist', '').lstrip('±').replace('*', '')
        try:
            dist_v = float(dist) if dist not in ('', '―', '-') else None
        except ValueError:
            dist_v = None

        # 像素档：-2M- / -5M- / -6M- / -10M- / -16M- / -20M- / -25M-
        mp = None
        pm = re.search(r'-(\d+)M-', r['model'])
        if pm:
            mp = int(pm.group(1))

        model = r['model']
        if model.endswith('-F'):
            series = 'HN-P F 口系列'
        elif model.endswith('-L') or model.endswith('-H'):
            series = 'HN-P 线扫系列'
        elif model.startswith('HN-P') or model.startswith('HNP'):
            series = 'HN-P 系列'
        else:
            series = 'HN 系列'

        out.append({
            'model': model,
            'focal': float(vals['focal']),
            'fmin': float(am.group(1)),
            'fmax': float(am.group(2)),
            'mount': vals.get('mount', 'C'),
            'ic': ic,
            'fmt': fmt,
            'mp': mp,
            'series': series,
            'dist': dist_v,
            'minDist': float(wm.group(1)) if wm else None,
            'brand': '大恒图像',
        })
    return out


def main():
    doc = fitz.open(PDF)
    all_recs = []
    for pno in PAGES:
        recs = parse_page(doc, pno)
        print('p%d: %d 支' % (pno, len(recs)))
        all_recs.extend(recs)

    seen, out = set(), []
    for r in all_recs:
        if r['model'] in seen:
            continue
        seen.add(r['model'])
        out.append(r)

    os.makedirs('tools/_cache', exist_ok=True)
    json.dump(out, open('tools/_cache/daheng_lenses.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('合计 %d 支 → tools/_cache/daheng_lenses.json' % len(out))
    byser = {}
    for r in out:
        byser[r['series']] = byser.get(r['series'], 0) + 1
    print('by series:', byser)
    for r in out[:5]:
        print(' ', {k: r[k] for k in ('model', 'focal', 'fmin', 'fmax', 'mount', 'ic', 'mp', 'series', 'dist', 'minDist')})


if __name__ == '__main__':
    main()
