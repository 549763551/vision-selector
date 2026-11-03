# -*- coding: utf-8 -*-
"""把 tools/_cache/daheng_cams.json + daheng_lenses.json 生成为 daheng-catalog.js（UMD，与其它品牌目录同构）。"""
import json, io, os, sys, datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CACHE = 'tools/_cache/daheng_cams.json'
LENS_CACHE = 'tools/_cache/daheng_lenses.json'
TELE_CACHE = 'tools/_cache/daheng_tele.json'
OUT = 'daheng-catalog.js'

cams = json.load(open(CACHE, encoding='utf-8'))
lenses = json.load(open(LENS_CACHE, encoding='utf-8'))
tele = json.load(open(TELE_CACHE, encoding='utf-8')) if os.path.exists(TELE_CACHE) else []
today = datetime.date.today().isoformat()

# 字段排序，与其它 catalog 风格对齐（核心字段在前）
KEYS = ['model', 'brand', 'series', 'seriesName', 'w', 'h', 'sw', 'sh', 'pxUm',
        'size', 'fps', 'shutter', 'iface', 'color', 'mount', 'kind', 'sensor']

# 缓存里混了两代抽取结果，生成前统一口径（与华睿/Basler 目录一致用英文）
KIND_MAP = {'面阵': 'area', '板级': 'board'}
full = {c['model'] for c in cams}
clean = []
dropped = []
for c in cams:
    k = c.get('kind')
    if k in KIND_MAP:
        c['kind'] = KIND_MAP[k]
    m = c['model']
    if m.endswith('-') and m[:-1] in full:
        dropped.append(m)
        continue
    clean.append(c)
cams = clean
if dropped:
    print('dropped truncated duplicates:', dropped)

def rec_js(c):
    return '{' + ', '.join(f'"{k}": {json.dumps(c[k], ensure_ascii=False)}' for k in KEYS if c.get(k) is not None) + '}'

LENS_KEYS = ['model', 'brand', 'series', 'focal', 'fmin', 'fmax', 'mount', 'ic', 'fmt', 'mp', 'dist', 'minDist',
             'lensKind', 'note']
TELE_KEYS = ['series', 'model', 'brand', 'magMin', 'magMax', 'wdMin', 'wdMax', 'fmt', 'mount', 'coax', 'kind']


def lens_js(l):
    return '{' + ', '.join(f'"{k}": {json.dumps(l[k], ensure_ascii=False)}' for k in LENS_KEYS if l.get(k) is not None) + '}'


def tele_js(t):
    return '{' + ', '.join(f'"{k}": {json.dumps(t[k], ensure_ascii=False)}' for k in TELE_KEYS if k in t) + '}'

lines = []
lines.append('/**')
lines.append(' * 大恒图像工业相机 + 全量镜头（LM/M/HN·HN-P（含 16K 线阵大像面）/BV-L 线阵大像面/ELM 电动调焦/宝石小像面/FL-* 等）+ 远心型号库')
lines.append(' * 来源：大恒图像产品型录 + 大恒镜头产品型录（相机：火星/水星/ME2x/金星/天狼星家族 + SWIR/UV/高灵敏）；')
lines.append(' * TEC/TCEL 液态远心的接口与倍率/工作距离取自 Opto Engineering 官网系列页（手册表格未印接口列）；')
lines.append(' * 镜头/远心的靶面、像面直径、光圈档位、最小工作距离按手册同型号行窗口补录，焦距以视场角反算校核；')
lines.append(' * 字段值无法从手册唯一确认的一律省略（宁缺毋滥），省略项记录在 tools/_cache/ 的核查报告中；')
lines.append(' * 生成脚本：tools/parse-daheng-cams-v2.py + tools/parse-daheng-lenses-all.py + tools/curate-daheng-lenses.py')
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
    'lenses': len(lenses),
    'telecentric': len(tele)
}, ensure_ascii=False) + ';')
lines.append('  var CAMERAS = [')
for c in cams:
    lines.append('    ' + rec_js(c) + ',')
lines.append('  ];')
lines.append('  var LENSES = [')
for l in lenses:
    lines.append('    ' + lens_js(l) + ',')
lines.append('  ];')
lines.append('  var TELECENTRIC = [')
for t in tele:
    lines.append('    ' + tele_js(t) + ',')
lines.append('  ];')
lines.append('  return { META: META, CAMERAS: CAMERAS, LINESCAN: [], LENSES: LENSES, TELECENTRIC: TELECENTRIC, LIGHTS: [], CONTROLLERS: [] };')
lines.append('});')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('written', OUT, 'cameras:', len(cams), 'lenses:', len(lenses), 'tele:', len(tele))
