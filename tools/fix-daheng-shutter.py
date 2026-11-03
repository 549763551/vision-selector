# -*- coding: utf-8 -*-
"""按手册原文的「帧曝光 / 行曝光」校正大恒相机快门字段。

背景：型录按 PDF 坐标切单元格，个别行（如 ME2P-5030 的传感器文字换行）会把上一行/下一行的
片段串进同一格，于是 `parse-daheng-cams-v2.py` 采到的 shutter 可能张冠李戴或整格丢失。
传感器芯片与快门类型是绑定的（GMAX / XGS / Pregius 为帧曝光，IMX226 / AR2020 为行曝光），
所以直接从手册正文建立「芯片 → 曝光」映射，再回校每一行快门，比按行窗口猜更稳。

用法：python tools/fix-daheng-shutter.py
输入：tools/_cache/大恒图像产品型录.txt、tools/_cache/daheng_cams.json
输出：就地修正 daheng_cams.json，并写 tools/_cache/_shutter_fix.txt 变更清单。
"""
import io
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
MANUAL = os.path.join(HERE, '_cache', u'大恒图像产品型录.txt')
CAMS = os.path.join(HERE, '_cache', 'daheng_cams.json')
REPORT = os.path.join(HERE, '_cache', '_shutter_fix.txt')

# 传感器芯片名：厂商前缀 + 型号数字（够覆盖手册里出现的 Sony/Gpixel/ON/Plus 等）
CHIP = re.compile(r'\b((?:IMX|GMAX|GSPRINT|XGS|AR|PYRO|KAI|ISGX|MT9|OV|LUCID|GMAX|PREGIUS)'
                  r'[0-9]{2,6}[A-Z]{0,3})\b')
EXP = ((u'帧曝光', 'Global'), (u'行曝光', 'Rolling'))


def build_map():
    """芯片名 → 快门 / 靶面；同一芯片在手册里出现两种曝光则视为不可判定，剔除。"""
    votes = defaultdict(set)
    sizes = defaultdict(set)
    text = io.open(MANUAL, encoding='utf-8', errors='ignore').read()
    for line in text.split('\n'):
        kw = [v for token, v in EXP if token in line]
        if len(kw) != 1:
            continue
        sm = re.search(r'([0-9]{1,2}/[0-9.]+(?:"|”)|[0-9](?:\.[0-9]+)?(?:"|”))', line)
        for chip in CHIP.findall(line.replace(u'曝光', u'曝光 ')):
            votes[chip.upper()].add(kw[0])
            if sm:
                sizes[chip.upper()].add(sm.group(1).replace(u'”', '"'))
    return ({k: next(iter(v)) for k, v in votes.items() if len(v) == 1},
            {k: sorted(v) for k, v in votes.items() if len(v) > 1},
            {k: v for k, v in sizes.items()})


def main():
    cmap, conflict, sizes = build_map()
    cams = json.load(io.open(CAMS, encoding='utf-8'))
    changed, filled, cleaned, unknown = [], [], [], set()
    for c in cams:
        sensor = (c.get('sensor') or '')
        chips = [x.upper() for x in CHIP.findall(sensor)]
        if not chips:
            unknown.add(c['model'])
            continue
        truth = cmap.get(chips[0])          # 串格时芯片名可能带出邻居，取本行第一个
        if truth is None:
            unknown.add(c['model'])
            continue
        if c.get('shutter') is None:
            c['shutter'] = truth
            filled.append((c['model'], sensor, truth))
        elif c['shutter'] != truth:
            changed.append((c['model'], c['shutter'], truth, sensor))
            c['shutter'] = truth
        # 传感器名串进邻行芯片：按手册「靶面 ↔ 芯片」对应，只留本行靶面能对上那颗
        uniq = []
        for x in chips:
            if x not in uniq:
                uniq.append(x)
        if len(uniq) > 1 and c.get('size'):
            own = [x for x in uniq if c['size'].replace('″', '"') in sizes.get(x, set())]
            if len(own) == 1:
                nm = re.search(r'((?:[A-Za-z]+\s+)?%s)' % own[0], sensor)
                if nm:
                    cleaned.append((c['model'], sensor, own[0]))
                    c['sensor'] = nm.group(1).strip()
    json.dump(cams, io.open(CAMS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    with io.open(REPORT, 'w', encoding='utf-8') as f:
        f.write(u'芯片→快门映射 %d 颗；手册内自相矛盾的芯片 %d 颗（不参与校正）\n' % (len(cmap), len(conflict)))
        for k, v in sorted(conflict.items()):
            f.write(u'  矛盾：%s %s\n' % (k, v))
        f.write(u'\n快门漏采补齐 %d 行：\n' % len(filled))
        for m in filled:
            f.write(u'  %s（sensor=%s）→ %s\n' % m)
        f.write(u'\n快门错采纠正 %d 行：\n' % len(changed))
        for m in changed:
            f.write(u'  %s：%s → %s（sensor=%s）\n' % m)
        f.write(u'\n传感器名去串格 %d 行：\n' % len(cleaned))
        for m in cleaned:
            f.write(u'  %s：%s → %s\n' % m)
        f.write(u'\n未能判定（传感器名缺/不在映射）%d 行：%s\n'
                % (len(unknown), u', '.join(sorted(unknown)[:30])))
    print('map=%d filled=%d fixed=%d cleaned=%d unknown=%d'
          % (len(cmap), len(filled), len(changed), len(cleaned), len(unknown)))


if __name__ == '__main__':
    main()
