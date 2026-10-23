# -*- coding: utf-8 -*-
"""把 tools/_cache/daheng_cams.json + daheng_lenses.json 生成为 daheng-catalog.js（UMD，与其它品牌目录同构）。"""
import json, io, sys, datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CACHE = 'tools/_cache/daheng_cams.json'
LENS_CACHE = 'tools/_cache/daheng_lenses.json'
OUT = 'daheng-catalog.js'

cams = json.load(open(CACHE, encoding='utf-8'))
lenses = json.load(open(LENS_CACHE, encoding='utf-8'))
today = datetime.date.today().isoformat()

# 字段排序，与其它 catalog 风格对齐（核心字段在前）
KEYS = ['model', 'brand', 'series', 'seriesName', 'w', 'h', 'sw', 'sh', 'pxUm',
        'size', 'fps', 'shutter', 'iface', 'color', 'mount', 'kind', 'sensor']

def rec_js(c):
    return '{' + ', '.join(f'"{k}": {json.dumps(c[k], ensure_ascii=False)}' for k in KEYS if c.get(k) is not None) + '}'

LENS_KEYS = ['model', 'brand', 'series', 'focal', 'fmin', 'fmax', 'mount', 'ic', 'fmt', 'mp', 'dist', 'minDist']

def lens_js(l):
    return '{' + ', '.join(f'"{k}": {json.dumps(l[k], ensure_ascii=False)}' for k in LENS_KEYS if l.get(k) is not None) + '}'

lines = []
lines.append('/**')
lines.append(' * 大恒图像工业相机 + HN/HN-P 系列镜头型号库')
lines.append(' * 来源：大恒图像产品型录（相机：水星/天狼星/火星/金星家族 + SWIR/UV/高灵敏；镜头：HN/HN-P 系列 p5-8）；')
lines.append(' * 生成脚本：tools/parse-daheng-cams.py + tools/parse-daheng-lenses.py')
lines.append(' * 本文件由脚本生成，请勿手工编辑。')
lines.append(' */')
lines.append('(function (root, factory) {')
lines.append("  if (typeof module === 'object' && module.exports) module.exports = factory();")
lines.append('  else root.DahengCatalog = factory();')
lines.append("})(typeof self !== 'undefined' ? self : this, function () {")
lines.append("  'use strict';")
lines.append('  var META = ' + json.dumps({
    'source': '大恒图像产品型录',
    'brand': '大恒图像',
    'generated': today,
    'cameras': len(cams),
    'lenses': len(lenses)
}, ensure_ascii=False) + ';')
lines.append('  var CAMERAS = [')
for c in cams:
    lines.append('    ' + rec_js(c) + ',')
lines.append('  ];')
lines.append('  var LENSES = [')
for l in lenses:
    lines.append('    ' + lens_js(l) + ',')
lines.append('  ];')
lines.append('  return { META: META, CAMERAS: CAMERAS, LINESCAN: [], LENSES: LENSES, TELECENTRIC: [], LIGHTS: [], CONTROLLERS: [] };')
lines.append('});')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('written', OUT, 'cameras:', len(cams), 'lenses:', len(lenses))
