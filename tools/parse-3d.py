#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从《机器视觉3D产品手册26年Q3.pdf》抽取海康 3D 产品：
  1. MV-DP 激光轮廓传感器（表格逐型号解析）
  2. MV-DB / MV-DT / MV-EB 结构光 / 双目 / 物流 3D 相机（数量少、排版各异，按手册原文手工核对录入）

用法：
  pdftotext -enc UTF-8 -raw "manuals/机器视觉3D产品手册26年Q3.pdf" tools/_cache/3d.txt
  python tools/parse-3d.py tools/_cache/3d.txt > hikrobot-3d-catalog.js
"""
import re, sys

def main(path):
    text = open(path, encoding='utf-8').read()
    lines = [l.strip() for l in text.splitlines()]

    # ---------- 1. MV-DP 轮廓传感器：型号行为锚点，向后吃字段 ----------
    # 型号行：MV-DP1060-01P * 3200 62 mm 27 mm / MV-DP2020-01P V2.0 3200 21.4 mm 6.8 mm
    head = re.compile(r'^(MV-DP\d{4}-\d+P)( V2\.0)?( \*)?\s+(\d{3,4})\s+([\d.]+ ?mm)\s+([\d.]+ ?mm)\s*$')
    prof = []
    i = 0
    while i < len(lines):
        m = head.match(lines[i])
        if not m:
            i += 1
            continue
        model, ver, star, points, xr, zr = m.groups()
        ver = (ver or '').strip()
        star = (star or '').strip()
        blk = lines[i + 1:i + 14]
        blk_txt = '\n'.join(blk)
        rec = {
            'model': model, 'ver': ver or None, 'points': int(points),
            'xRange': xr.replace(' ', ''), 'zRange': zr.replace(' ', ''),
            'ref': None, 'zRes': None, 'zRepeat': None, 'interval': None,
            'rate': None, 'laser': None, 'dwg': None, 'brand': '海康机器人',
            'series': 'MV-DP 系列 激光轮廓传感器', 'kind': 'profiler',
        }
        rm = re.search(r'([\d.]+ ?mm)@ ?参考距离', blk_txt)
        if rm:
            rec['ref'] = rm.group(1).replace(' ', '')
        ranges = re.findall(r'([\d.]+ ?~ ?[\d.]+ ?µm)', blk_txt)
        if ranges:
            rec['zRes'] = ranges[0].replace(' ', '')
            if len(ranges) > 1:
                rec['interval'] = ranges[1].replace(' ', '')
        # 重复精度：去掉范围值后再找独立的单个 µm 值
        wo_ranges = blk_txt
        for r in ranges:
            wo_ranges = wo_ranges.replace(r, ' ')
        singles = re.findall(r'([\d.]+ ?µm)', wo_ranges)
        if singles:
            rec['zRepeat'] = singles[0].replace(' ', '')
        rkm = re.search(r'([\d.]+k ?Hz ?~)\s*\n?([\d.]+k ?Hz)', blk_txt)
        if rkm:
            rec['rate'] = rkm.group(1).split(' ')[0] + '~' + rkm.group(2).replace(' ', '')
        lm = re.search(r'(\d{3}) ?nm ?([A-Z])?', blk_txt)
        if lm:
            rec['laser'] = lm.group(1) + ' nm'
            if lm.group(2):
                rec['dwg'] = lm.group(2)
        for l2 in blk:
            if re.fullmatch(r'[A-Z]', l2):
                rec['dwg'] = l2
        prof.append(rec)
        i += 1

    # ---------- 2. 结构光 / 双目 / 物流 3D 相机（13 款，按手册 p 核对录入） ----------
    smart = [
        # 双目结构光立体相机（p 感知相机章节）
        {'model': 'MV-DT01SDU', 'kind': '双目结构光', 'fov': '64° × 50°', 'work': '0.3~3.5 m',
         'accuracy': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '强度图 / 彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DT01SNU', 'kind': '双目结构光', 'fov': '65° × 50°', 'work': '0.2~1.5 m',
         'accuracy': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DT01WMU', 'kind': '双目结构光', 'fov': '84° × 63°', 'work': '0.2~1.5 m',
         'accuracy': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB02SNU', 'kind': '双目结构光', 'fov': '60° × 50°', 'work': '0.1~1.0 m',
         'accuracy': '5 mm @ 0.5 m，10 mm @ 1 m', 'fps': '深度图 1280×1024@17 fps；RGB 图 1536×1280@17 fps',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'USB3', 'dwg': 'B', 'brand': '海康机器人'},
        {'model': 'MV-EB435i', 'kind': '双目结构光', 'fov': '84° × 55°', 'work': '0.2~5.0 m',
         'accuracy': '1.5% @0.2~3 m', 'fps': '深度图 1280×720@30 fps；RGB 图 640×360@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'C', 'brand': '海康机器人'},
        # 物流行业相机
        {'model': 'MV-DB500S-S', 'kind': '物流测量', 'fov': '近视场 580×470 mm / 远视场 2500×1800 mm', 'work': '净距 500~1500 mm',
         'accuracy': '4 mm@1 m；8 mm@2 m', 'fps': '30 fps@单件分离模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体位姿信息', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB500S-C', 'kind': '物流测量', 'fov': '近视场 580×470 mm / 远视场 2500×1800 mm', 'work': '净距 500~1500 mm',
         'accuracy': '4 mm@1 m；8 mm@2 m', 'fps': '20 fps@EDP 模式',
         'output': '原始图（黑白+彩色）/ 深度图 / EDP 检测结果', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB500S-V', 'kind': '物流测量', 'fov': '近视场 580×470 mm / 远视场 2400×1800 mm', 'work': '净距 500~1500 mm',
         'accuracy': '4 mm@1 m；8 mm@2 m', 'fps': '8 fps@体积测量模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体体积信息', 'iface': 'GigE', 'dwg': 'B', 'brand': '海康机器人'},
        {'model': 'MV-DB700S-S', 'kind': '物流测量', 'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '净距 300~700 mm',
         'accuracy': '2.5 mm@0.5 m；5 mm@1 m', 'fps': '30 fps@单件分离模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体位姿信息', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB700S-C', 'kind': '物流测量', 'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '净距 300~700 mm',
         'accuracy': '2.5 mm@0.5 m；5 mm@1 m', 'fps': '20 fps@EDP 模式',
         'output': '原始图（黑白+彩色）/ 深度图 / EDP 检测结果', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB1300A-V', 'kind': '物流测量', 'fov': '近视场 870×860 mm / 远视场 3340×2500 mm', 'work': '净距 1100~2100 mm',
         'accuracy': '1.5 mm@2100 mm', 'fps': '1.2~1.5 s / 次',
         'output': '原始图（黑白+彩色）/ 深度图', 'iface': 'GigE', 'dwg': 'C', 'brand': '海康机器人'},
        # 物流行业相机（大视场）
        {'model': 'MV-DB12SME', 'kind': '物流测量', 'fov': '近视场 580×480 mm / 远视场 2400×1800 mm', 'work': '500 / 1500 mm',
         'accuracy': '4 mm@1 m；8 mm@2 m', 'fps': 'RGB-D 同步 20 fps@1536×1280 / 30 fps@768×640',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
        {'model': 'MV-DB12UNE', 'kind': '物流测量', 'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '300 / 700 mm',
         'accuracy': '4 mm@500 mm；8 mm@1000 mm', 'fps': 'RGB-D 同步 20 fps@1536×1280 / 30 fps@768×640',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'GigE', 'dwg': 'A', 'brand': '海康机器人'},
    ]

    def js(v):
        if v is None:
            return 'null'
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, (int, float)):
            return str(v)
        return json_str(v)

    def json_str(s):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

    def obj(d, indent='    '):
        keys = [k for k in d if d[k] is not None or k in ('model',)]
        return '{ ' + ', '.join('"%s": %s' % (k, js(d[k])) for k in d) + ' }'

    out = []
    out.append('''/**
 * 海康机器人 3D 产品库（轮廓传感器 + 结构光/双目/物流 3D 相机）
 * 来源：《机器视觉3D产品手册26年Q3.pdf》
 * 生成脚本：tools/parse-3d.py    生成日期：2026-10-24
 * MV-DP 轮廓传感器 %d 款；MV-DT/DB/EB 结构光与物流 3D 相机 %d 款。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hikrobot3DCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "机器视觉3D产品手册26年Q3", "brand": "海康机器人", "generated": "2026-10-24",
    "profilers": %d, "smart": %d};
''' % (len(prof), len(smart), len(prof), len(smart)))
    out.append('  var PROFILERS = [\n    ' + ',\n    '.join(obj(p) for p in prof) + '\n  ];')
    out.append('  var SMART = [\n    ' + ',\n    '.join(obj(s) for s in smart) + '\n  ];')
    out.append('  return { META: META, PROFILERS: PROFILERS, SMART: SMART };')
    out.append('});')
    sys.stdout.write('\n'.join(out) + '\n')

if __name__ == '__main__':
    main(sys.argv[1])
