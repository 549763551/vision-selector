# -*- coding: utf-8 -*-
"""解析奥普特（OPT）全部系列的型号表（通用「列名 → 值」抽取）。

输入：tools/_cache/opt/all/ajax/{dir}_{sid}.html + series.json
输出：tools/_cache/opt/all/parsed.json

页面结构（与工业相机一致）：
  左 fixed-table：tr[data-id] → 勾选框 + 「型号」链接（详情页）+ 规格书 pdf
  右 scroll-table：第二个 tbody 每行 td 与 fixed 表行号一一对齐，列名来自 thead
不同系列列数/列名都不一样，故不写死列位，一律按 thead 的列名对齐。
"""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt', 'all')


def clean(x):
    x = re.sub(r'<[^>]+>', ' ', x)
    return re.sub(r'[\s\u00a0]+', ' ', x).strip()


def parse_file(path):
    s = io.open(path, encoding='utf-8', errors='ignore').read()
    if 'scroll-table' not in s:
        return [], []
    i = s.find('scroll-table')
    head = s[i:]
    ths = [clean(t) for t in re.findall(r'<th[^>]*>(.*?)</th>', head, re.S)]
    ths = [t for t in ths if t]

    # 固定列（型号）
    fixed = re.findall(
        r'<tr data-id="(\d+)">\s*<td class="col-check-compare">.*?</td>\s*'
        r'<td class="col-model">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', s, re.S)

    # 滚动列（参数）
    body = re.search(r'<tbody(?![^>]*filter-row-wrap)[^>]*>(.*?)</tbody>', head, re.S)
    if not body:
        return [], ths
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', body.group(1), re.S)

    # 规格书 pdf：fixed 表 td 里有个下载链接
    pdfs = re.findall(r'<tr data-id="(\d+)">[\s\S]*?(/upload/pdf/[^"\']+\.pdf)', s)
    pdfmap = dict(pdfs)

    out = []
    for (did, href, model), tr in zip(fixed, rows):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        cells = [clean(t) for t in tds]
        # 列数不一致时按较短的截断，避免错位
        specs = {}
        for name, val in zip(ths, cells):
            if val and val not in ('-', '—', '/', 'N/A'):
                specs[name] = val
        out.append({
            'id': did,
            'model': clean(model),
            'url': 'https://www.optmv.com' + href if href.startswith('/') else href,
            'pdf': pdfmap.get(did, ''),
            'specs': specs,
        })
    return out, ths


def main():
    series = json.load(io.open(os.path.join(CACHE, 'series.json'), encoding='utf-8'))
    out = []
    stat = []
    for s in series:
        f = os.path.join(CACHE, 'ajax', '%s_%s.html' % (s['dir'], s['sid']))
        if not os.path.exists(f) or os.path.getsize(f) < 5000:
            continue
        rows, ths = parse_file(f)
        if not rows:
            continue
        for r in rows:
            r.update({'line': s['line'], 'group': s['group'], 'sid': s['sid'], 'sname': s['name']})
            out.append(r)
        stat.append((s['line'], s['name'], len(rows), len(ths)))

    # 去重：同型号只留一份（可能出现在多个系列页），保留首个并记录重复来源
    seen, uniq, dup = {}, [], 0
    for r in out:
        k = r['model'].upper()
        if k in seen:
            dup += 1
            continue
        seen[k] = r
        uniq.append(r)

    io.open(os.path.join(CACHE, 'parsed.json'), 'w', encoding='utf-8').write(
        json.dumps(uniq, ensure_ascii=False, indent=1))

    from collections import Counter
    c = Counter(r['line'] for r in uniq)
    for line, n in c.most_common():
        print('%-16s %4d 型号' % (line, n))
    print('原始 %d · 去重后 %d · 重复 %d' % (len(out), len(uniq), dup))
    print('→ tools/_cache/opt/all/parsed.json')

    # 抽样看字段覆盖
    for line in c:
        rs = [r for r in uniq if r['line'] == line]
        keys = Counter()
        for r in rs:
            for k in r['specs']:
                keys[k] += 1
        top = ', '.join('%s(%d)' % (k, v) for k, v in keys.most_common(6))
        print('\n[%s] 示例 %s\n   %s' % (line, rs[0]['model'], top))


if __name__ == '__main__':
    main()
