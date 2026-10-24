#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从《机器视觉工控机产品手册-V.151.CN.26Q2.1(阅读版).pdf》抽取海康工控机：
  - MV-IPC-T* 上架式整机机箱
  - MV-IPC-MB-* 主板（含适配 CPU/内存/网口/USB/扩展槽/尺寸等）
用法：
  pdftotext -enc UTF-8 -raw "manuals/机器视觉工控机产品手册-V.151.CN.26Q2.1(阅读版).pdf" tools/_cache/ipc.txt
  python tools/parse-ipc.py tools/_cache/ipc.txt > hikrobot-ipc-catalog.js
"""
import re, sys

# 字段标签 → 归一化 key（长标签优先匹配）
LABELS = [
    ('机箱尺寸', 'size'), ('光驱位', 'oddbay'), ('硬盘位', 'bays'), ('风扇位', 'fans'),
    ('适用主板', 'board'), ('I/O 扩展', 'io'), ('I/O扩展', 'io'), ('外置接口', 'ports'),
    ('其他', 'other'), ('适用电源', 'psu'),
    ('处理器', 'cpu'), ('芯片组', 'chipset'), ('内存', 'ram'), ('存储', 'storage'),
    ('操作系统', 'os'), ('网络接口', 'lan'), ('USB 接口', 'usb'), ('USB接口', 'usb'),
    ('串口', 'com'), ('扩展接口', 'exp'), ('显示接口', 'display'), ('音频接口', 'audio'),
    ('GPIO', 'gpio'), ('BIOS', 'bios'), ('电源', 'power'), ('供电', 'supply'),
    ('外形尺寸', 'form'), ('温度', 'temp'), ('看门狗', 'wdt'), ('TPM', 'tpm'),
]
LABEL_RE = re.compile(r'^(%s)[：: ]+(.*)$' % '|'.join(re.escape(k) for k, _ in sorted(LABELS, key=lambda x: -len(x[0]))))
BARE_RE = re.compile(r'^(%s)[：:]?$' % '|'.join(re.escape(k) for k, _ in sorted(LABELS, key=lambda x: -len(x[0]))))
LABEL_KEY = dict(LABELS)
STOP_RE = re.compile(r'^(外观尺寸图|主板参数|产品规格|适配主板|名称|规格|Unit|注：|\d+ \d+)')

def main(path):
    lines = [l.strip() for l in open(path, encoding='utf-8').read().splitlines()]
    model_re = re.compile(r'^参数\s*型号\s+(MV-IPC-\S+)$')

    recs = []           # {'model':…, 'fields': {key: text}, 'order': [key…]}
    cur = None
    pending = None      # 单独成行的标签，值在后续行
    for ln in lines:
        m = model_re.match(ln)
        if m:
            cur = {'model': m.group(1), 'fields': {}, 'order': []}
            recs.append(cur)
            pending = None
            continue
        if cur is None:
            continue
        full = LABEL_RE.match(ln)
        bare = BARE_RE.match(ln)
        if full:
            key = LABEL_KEY.get(full.group(1))
            if key:
                if key not in cur['fields']:
                    cur['fields'][key] = full.group(2).strip()
                    cur['order'].append(key)
                else:
                    cur['fields'][key] += ' ' + full.group(2).strip()
                pending = key
                continue
        if bare:
            key = LABEL_KEY.get(bare.group(1))
            if key and key not in cur['fields']:
                cur['fields'][key] = ''
                cur['order'].append(key)
            pending = key
            continue
        if pending and len(ln) > 1 and not STOP_RE.match(ln):
            cur['fields'][pending] = (cur['fields'][pending] + ' ' + ln).strip()
        else:
            pending = None

    # 分类：T* 整机机箱 / MB* 主板
    chassis, boards = [], []
    seen = set()
    for r in recs:
        if r['model'] in seen:
            continue
        seen.add(r['model'])
        item = {'model': r['model'], 'brand': '海康机器人', 'series': (
            '上架式工控机' if '-T' in r['model'] else '工控主板')}
        item.update(r['fields'])
        (chassis if '-T' in r['model'] else boards).append(item)

    def js(v):
        if v is None:
            return 'null'
        v = re.sub(r'[\x00-\x1f\x7f]', ' ', v)   # pdftotext 残留控制符
        v = re.sub(r'\s+', ' ', v).strip()
        return '"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"'

    def obj(d):
        return '{ ' + ', '.join('"%s": %s' % (k, js(d[k])) for k in d) + ' }'

    out = ['''/**
 * 海康机器人工控机库（上架式整机机箱 + 工控主板）
 * 来源：《机器视觉工控机产品手册-V.151.CN.26Q2.1(阅读版)》
 * 生成脚本：tools/parse-ipc.py    生成日期：2026-10-24
 * 机箱 %d 款；主板 %d 款。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HikrobotIpcCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "机器视觉工控机产品手册-V.151.CN.26Q2.1", "brand": "海康机器人",
    "generated": "2026-10-24", "chassis": %d, "boards": %d};
''' % (len(chassis), len(boards), len(chassis), len(boards))]
    out.append('  var CHASSIS = [\n    ' + ',\n    '.join(obj(x) for x in chassis) + '\n  ];')
    out.append('  var BOARDS = [\n    ' + ',\n    '.join(obj(x) for x in boards) + '\n  ];')
    out.append('  return { META: META, CHASSIS: CHASSIS, BOARDS: BOARDS };')
    out.append('});')
    sys.stdout.write('\n'.join(out) + '\n')

if __name__ == '__main__':
    main(sys.argv[1])
