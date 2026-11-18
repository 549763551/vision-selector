# -*- coding: utf-8 -*-
"""解析奥普特详情页 param-table → tools/_cache/opt/detail.json，并打印字段覆盖率。
用法：python tools/parse-opt-detail.py
"""
import io
import json
import os
import re
import collections

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt')
DET = os.path.join(CACHE, 'det')


def strip(x):
    x = re.sub(r'<[^>]+>', '', x)
    x = x.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'\s+', ' ', x).strip()


def parse_one(path):
    s = io.open(path, encoding='utf-8', errors='ignore').read()
    i = s.find('param-table')
    if i < 0:
        return None
    j = s.find('</table>', i)
    seg = s[i:j]
    kv = {}
    for th, td in re.findall(r'<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>', seg, re.S):
        k = strip(th)
        v = strip(td)
        if k and k not in kv:
            kv[k] = v
    return kv


def main():
    list_ = json.load(io.open(os.path.join(CACHE, 'list.json'), encoding='utf-8'))
    out = []
    keys = collections.Counter()
    for it in list_:
        p = os.path.join(DET, it['id'] + '.html')
        kv = parse_one(p)
        if kv is None:
            print('!! 解析失败', it['model'])
            continue
        keys.update(kv.keys())
        it['spec'] = kv
        out.append(it)

    print('解析 %d 条' % len(out))
    print('--- 字段覆盖率 ---')
    for k, n in keys.most_common():
        print('%-16s %3d  %s' % (k, n, out[0]['spec'].get(k, '')))

    io.open(os.path.join(CACHE, 'detail.json'), 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=1))
    print('→ tools/_cache/opt/detail.json')


if __name__ == '__main__':
    main()
