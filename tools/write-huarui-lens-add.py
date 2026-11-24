# -*- coding: utf-8 -*-
r"""把 tools/_cache/huarui_lens_add.json 写进 huarui-catalog.js。

只追加、不改既有行：
  · 定焦 / 线扫镜头 6 款 → LENSES 末尾
  · 远心镜头 16 款 → TELECENTRIC（原为空数组）
同时刷 META 的 lenses / telecentric 计数与 source 说明。

重复执行安全：已存在的型号会跳过（按 model 大写去空格比对）。
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG = os.path.join(ROOT, 'js', 'huarui-catalog.js')
ADD = os.path.join(HERE, '_cache', 'huarui_lens_add.json')

ORDER = ['model', 'brand', 'series', 'group', 'kind', 'focal', 'fmin', 'fmax',
         'mount', 'ic', 'fmt', 'mag', 'magMin', 'magMax', 'wdMin', 'wdMax', 'resUm',
         'minDist', 'coax', 'note']


def js_line(d):
    parts = []
    for k in ORDER:
        if k not in d or d[k] is None:
            continue
        v = d[k]
        if isinstance(v, bool):
            parts.append('"%s": %s' % (k, 'true' if v else 'false'))
        elif isinstance(v, (int, float)):
            parts.append('"%s": %s' % (k, ('%g' % v)))
        else:
            parts.append('"%s": %s' % (k, json.dumps(v, ensure_ascii=False)))
    return '    {' + ', '.join(parts) + '},'


def main():
    src = io.open(CATALOG, encoding='utf-8').read()
    rows = json.load(io.open(ADD, encoding='utf-8'))
    have = set(m.upper().replace(' ', '') for m in re.findall(r'"model":\s*"([^"]+)"', src))

    lens, tele = [], []
    for r in rows:
        if r['model'].upper().replace(' ', '') in have:
            continue
        (tele if r.get('kind') == '远心' else lens).append(r)

    # 1) LENSES 末尾追加（定位到 TELECENTRIC 声明前的那个 ];
    anchor = '  var TELECENTRIC = ['
    i = src.index(anchor)
    close = src.rindex('  ];', 0, i)
    if lens:
        block = '\n'.join(js_line(x) for x in lens)
        src = src[:close] + block + '\n' + src[close:]

    # 2) TELECENTRIC 数组填充
    if tele:
        block = '\n'.join(js_line(x) for x in tele)
        src = src.replace('  var TELECENTRIC = [\n  ];',
                          '  var TELECENTRIC = [\n' + block + '\n  ];', 1)

    # 3) META 计数 + 来源
    n_lens = len(re.findall(r'\n    \{"model"', src.split('var LENSES = [')[1].split('var TELECENTRIC')[0]))
    n_tele = len(re.findall(r'\n    \{"model"', src.split('var TELECENTRIC = [')[1].split('var LIGHTS')[0]))
    src = re.sub(r'"lenses":\s*\d+', '"lenses": %d' % n_lens, src, count=1)
    src = re.sub(r'"telecentric":\s*\d+', '"telecentric": %d' % n_tele, src, count=1)
    src = src.replace('"source": "机器视觉产品手册中文版V20260901 + iRayple 官网 A 系列 GigE 型号（手册未收录）"',
                      '"source": "机器视觉产品手册中文版V20260901 + iRayple 官网（A 系列 GigE 相机 12 台、'
                      '镜头与远心 22 款，官网型号表走 /api/cn/vision/productListNew 接口）"')

    io.open(CATALOG, 'w', encoding='utf-8').write(src)
    print('写入：定焦/线扫 %d 款 → LENSES（共 %d），远心 %d 款 → TELECENTRIC（共 %d）'
          % (len(lens), n_lens, len(tele), n_tele))


if __name__ == '__main__':
    main()
