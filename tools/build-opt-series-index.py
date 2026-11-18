# -*- coding: utf-8 -*-
"""建立奥普特（OPT）全站「产品线 → 分类 → 系列」索引。

权威来源是官网首页的产品导航浮层（mega menu），层级完整：
  <div class="prod-panel" id="lensPanel">
    <div class="prod-line-entry"><a href="/p_gyjt/index.html">工业镜头 全系列</a></div>
    <div class="prod-group">
      <h4 class="prod-group-title"><a href="/p_gyjt/seriesAll_365.html">定焦镜头</a></h4>
      <ul class="prod-group-links"><li><a href="/p_gyjt/series_366.html">78M系列定焦镜头</a></li>...
（不用各页面的 seriesAll 页解析：那些页面把全站导航也算进去，会串类。）

输出：tools/_cache/opt/all/series.json
  [ {"line":"工业镜头","dir":"p_gyjt","group":"定焦镜头","gid":"365","sid":"366","name":"78M系列定焦镜头"} ]
"""
import io
import json
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE_DIR, 'tools', '_cache', 'opt', 'all')
HOME = os.path.join(CACHE, 'home.html')

LINE_NAME = {
    'p_gyjt': '工业镜头', 'p_bzgy': '标准光源', 'p_fbzgy': '非标光源',
    'p_gykzq': '光源控制器', 'p_gkj': '视觉控制器/工控机', 'p_znxj': 'SC智能相机',
    'p_zndmq': '智能读码器', 'p_cgq': '传感器', 'p_ydcdbj': '运控部件',
    'p_clxt': '测量系统', 'p_jszn': '具身智能', 'p_sjrj': '机器视觉软件',
}


def clean(x):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', x)).strip()


def main():
    h = io.open(HOME, encoding='utf-8', errors='ignore').read()
    # 切成产品线面板
    panels = re.split(r'<div class="prod-panel"', h)[1:]
    rows = []
    for p in panels:
        mdir = re.search(r'href="/(p_[a-z]+)/index\.html"', p)
        if not mdir:
            continue
        d = mdir.group(1)
        line = LINE_NAME.get(d, d)
        # 分类块
        for g in re.split(r'<div class="prod-group">', p)[1:]:
            mg = re.search(r'prod-group-title">\s*<a href="/p_[a-z]+/seriesAll_(\d+)\.html">([^<]*)<', g)
            gid, gname = (mg.group(1), clean(mg.group(2))) if mg else ('', line)
            for sid, name in re.findall(r'href="/%s/series_(\d+)\.html"[^>]*>([^<]*)<' % d, g):
                rows.append({'line': line, 'dir': d, 'group': gname,
                             'gid': gid, 'sid': sid, 'name': clean(name)})

    # 去重
    seen, out = set(), []
    for r in rows:
        k = (r['dir'], r['sid'])
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    out.sort(key=lambda r: (r['dir'], r['gid'] or 'zzz', r['sid']))

    io.open(os.path.join(CACHE, 'series.json'), 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=1))

    from collections import Counter
    by_line = Counter(r['line'] for r in out)
    by_group = Counter((r['line'], r['group']) for r in out)
    for d, line in LINE_NAME.items():
        if not by_line[line]:
            continue
        print('\n%s（%d 系列）' % (line, by_line[line]))
        for (l, g), n in by_group.items():
            if l == line:
                print('   %-30s %d' % (g, n))
    print('\n合计 %d 个系列' % len(out))
    print('→ tools/_cache/opt/all/series.json')


if __name__ == '__main__':
    main()
