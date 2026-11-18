# -*- coding: utf-8 -*-
"""解析奥普特（OPT）官网「工业相机」系列 ajax 列表，产出型号清单。

可复现链条：
  1) 系列 ajax 列表（pageSize=200 一次取全）：
       https://www.optmv.com/p_gyxj/ajax_series_{id}.html?pageSize=200&pageIndex=1
     id: 351 CC1 小面阵 / 352 CH1 大面阵 / 353 CM1 多光谱 / 354 CL1 线阵
     （349 是「工业面阵相机全系列」聚合页 = 351+352+353，不重复使用）
  2) 本脚本 → tools/_cache/opt/list.json
  3) tools/fetch-opt-detail.js 抓详情页 → tools/_cache/opt/detail.json
  4) tools/build-opt-catalog.js 生成 opt-catalog.js

表格是「左侧固定列 + 右侧滚动列」两个独立 table，行序一一对应：
  固定列：选择 / 型号（<a href> 详情页）
  滚动列：规格书 / 传感器型号 / 分辨率 / 像元尺寸 / 最大帧率 / 数据接口 / 黑白彩色
"""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt')

SERIES = [
    # (ajax id, 简称, 系列名, 是否线阵)
    # 线阵表少一列「传感器型号」：下载 / 分辨率 / 像元 / 行频(KHz) / 接口 / 颜色（6 列）
    ('351', 'CC1', 'CC1 系列小面阵相机', False),
    ('352', 'CH1', 'CH1 系列大面阵相机', False),
    ('353', 'CM1', 'CM1 系列多光谱面阵相机', False),
    ('354', 'CL1', 'CL1 系列线阵相机', True),
]


def clean(x):
    x = re.sub(r'<[^>]+>', '', x)
    return re.sub(r'\s+', ' ', x).strip()


def parse(fid, code, name, is_line):
    p = os.path.join(CACHE, 'full_%s.html' % fid)
    s = io.open(p, encoding='utf-8', errors='ignore').read()

    # 固定列：data-id + 型号链接
    fixed = re.findall(
        r'<tr data-id="(\d+)">\s*<td class="col-check-compare">.*?</td>\s*'
        r'<td class="col-model">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        s, re.S)
    if not fixed:
        raise SystemExit('系列 %s 未解析到固定列' % code)

    # 滚动列：跳过 filter-row-wrap 那个 tbody
    i = s.find('scroll-table')
    seg = s[i:]
    body = re.search(r'<tbody(?![^>]*filter-row-wrap)[^>]*>(.*?)</tbody>', seg, re.S).group(1)
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S)

    if len(fixed) != len(rows):
        raise SystemExit('系列 %s 行列数不匹配 fixed=%d scroll=%d' % (code, len(fixed), len(rows)))

    need = 6 if is_line else 7
    out = []
    for (did, href, model), tr in zip(fixed, rows):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if len(tds) < need:
            raise SystemExit('系列 %s 行 %s 列数 %d' % (code, model, len(tds)))
        cells = [clean(t) for t in tds]
        # 统一成 7 槽：线阵无传感器列，补空串占位
        if is_line:
            cells = cells[:1] + [''] + cells[1:]
        out.append({
            'id': did,
            'model': clean(model),
            'url': 'https://www.optmv.com' + href if href.startswith('/') else href,
            'series': name,
            'seriesCode': code,
            'cat': 'line' if is_line else 'cam',
            'sensor': cells[1],
            'res': cells[2],
            'px': cells[3],
            'fps': cells[4],       # 线阵此列为行频 KHz
            'iface': cells[5],
            'color': cells[6],
        })
    return out


def main():
    allrows = []
    for fid, code, name, is_line in SERIES:
        rows = parse(fid, code, name, is_line)
        print('%-4s %-28s %d' % (code, name, len(rows)))
        allrows.extend(rows)

    # 去重校验（同型号可能出现在多个系列页）
    seen = {}
    dup = []
    for r in allrows:
        k = r['model'].lower()
        if k in seen:
            dup.append(r['model'])
        else:
            seen[k] = r
    if dup:
        print('重复型号:', dup)
    uniq = list(seen.values())
    print('合计 %d（去重后 %d）' % (len(allrows), len(uniq)))

    os.makedirs(CACHE, exist_ok=True)
    io.open(os.path.join(CACHE, 'list.json'), 'w', encoding='utf-8').write(
        json.dumps(uniq, ensure_ascii=False, indent=1))
    print('→ tools/_cache/opt/list.json')


if __name__ == '__main__':
    main()
