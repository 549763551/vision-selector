# -*- coding: utf-8 -*-
"""把 tools/_cache/opt/detail.json 生成为 opt-catalog.js（奥普特 OPT 相机型号库）。

来源：奥普特官网（optmv.com）工业相机四个系列的 ajax 列表 + 逐个详情页的
「详细产品参数」表，不掺入任何推测值——官网上没有的字段一律省略。

字段口径（与海康/大恒/华睿型录对齐，引擎只认这些）：
  cam : model kind w h pxUm sw sh size fps shutter iface color mount series
        dr snr expMinUs expMaxUs poe powerW sensor dims weight band tec
  line: model w taps pxH pxV lineRate color iface series mount powerW sensor
        expMinUs expMaxUs dims weight
  其中 sw/sh = w×pxUm/1000、h×pxUm/1000（引擎算靶面对角线只用 sw/sh，不用 size 字符串）。

归一化规则（都来自官网原文，只是改写法）：
  数据接口  USB 3.0→USB3 / GigE PoE→GigE(poe) / 10 GigE（SFP+）→10GigE
            / Camera Link→CameraLink / CoaXPress→CoaXPress
  镜头接口  C-Mount→C / M42 × 1.0→M42 / M58 × 0.75→M58 / M72 × 0.75→M72 / F-Mount→F
  靶面      1.1″→1.1" ；29.9 mm × 22.4 mm→29.9 mm x 22.4 mm（与海康同款写法）
用法：python tools/build-opt-catalog.py
"""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt')
OUT = os.path.join(BASE, 'opt-catalog.js')

IFACE = {
    'USB 3.0': ('USB3', False),
    'GigE PoE': ('GigE', True),
    'GigE': ('GigE', False),
    '2.5GigE PoE': ('2.5GigE', True),
    '10 GigE（SFP+）': ('10GigE', False),
    '10 GigE(SFP+)': ('10GigE', False),
    '10 GigE': ('10GigE', False),
    'CoaXPress': ('CoaXPress', False),
    'Camera Link': ('CameraLink', False),
}
MOUNT = {
    'C-Mount': 'C', 'C': 'C',
    'M42 × 1.0': 'M42', 'M42 × 1': 'M42', 'M42': 'M42',
    'M58 × 0.75': 'M58', 'M58': 'M58',
    'M72 × 0.75': 'M72', 'M72': 'M72',
    'M90 × 0.75': 'M90', 'M90': 'M90',
    'F-Mount': 'F', 'F': 'F',
    'M42/F': 'M42/F',
}


def num(x, d=None):
    try:
        return float(x)
    except Exception:
        return d


def tidy(v):
    """浮点去掉多余 0：4.0→4, 3.45→3.45"""
    if v is None:
        return None
    r = round(float(v), 4)
    return int(r) if abs(r - int(r)) < 1e-9 else r


def parse_res(s):
    m = re.match(r'\s*(\d+)\s*[×x*]\s*(\d+)', s or '')
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def parse_px(s):
    m = re.findall(r'(\d+(?:\.\d+)?)', s or '')
    if not m:
        return (None, None)
    if len(m) == 1:
        return (float(m[0]), float(m[0]))
    return (float(m[0]), float(m[1]))


def parse_size(s):
    """靶面字符串归一：英寸保留；mm 形式统一成 `A mm x B mm`。"""
    if not s:
        return None
    t = s.replace('\u2033', '"').replace('″', '"').replace('”', '"').strip()
    if 'mm' in t:
        nums = re.findall(r'(\d+(?:\.\d+)?)', t)
        if len(nums) >= 2:
            return '%s mm x %s mm' % (nums[0], nums[1])
        return t
    return t


def parse_fps(s):
    m = re.search(r'(\d+(?:\.\d+)?)\s*fps', s or '', re.I)
    return float(m.group(1)) if m else None


def parse_line_rate(s):
    """线阵行频：取所有 kHz 的最大值，同时推断 taps。"""
    if not s:
        return (None, 1)
    vals = [float(x) for x in re.findall(r'(\d+(?:\.\d+)?)\s*kHz', s)]
    rate = max(vals) if vals else None
    taps = 1
    tapm = [int(x) for x in re.findall(r'@\s*(\d+)\s*Tap', s, re.I)]
    if tapm:
        taps = max(tapm)
    elif '2-Line' in s:
        taps = 2
    return (rate, taps)


def parse_exp(s):
    """曝光时间 → (minUs, maxUs)。支持 μs / ms / s。"""
    if not s:
        return (None, None)
    mult = {'μs': 1.0, 'us': 1.0, 'ms': 1000.0, 's': 1e6}
    items = re.findall(r'(\d+(?:\.\d+)?)\s*(μs|us|ms|s)\b', s)
    if not items:
        return (None, None)
    us = [float(a) * mult[b] for a, b in items]
    return (tidy(min(us)), tidy(max(us)))


def parse_power(s):
    if not s or s.strip() == '/':
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*W', s)
    return float(m.group(1)) if m else None


def parse_dims(s):
    if not s or s.strip() == '/':
        return None
    nums = re.findall(r'(\d+(?:\.\d+)?)', s)
    if len(nums) >= 3:
        return [tidy(float(x)) for x in nums[:3]]
    return None


def main():
    data = json.load(io.open(os.path.join(CACHE, 'detail.json'), encoding='utf-8'))

    cams, lines = [], []
    warn = []

    for it in data:
        sp = it['spec']
        model = it['model']
        w, h = parse_res(sp.get('分辨率'))
        pxh, pxv = parse_px(sp.get('像元尺寸(μm)') or sp.get('像元尺寸(µm)'))
        if w is None:
            warn.append('分辨率解析失败 ' + model)
            continue
        if pxh is None:
            warn.append('像元缺失 ' + model)

        iface_raw = sp.get('数据接口', '').strip()
        if iface_raw not in IFACE:
            warn.append('未知接口 %s: %s' % (model, iface_raw))
        iface, poe = IFACE.get(iface_raw, (iface_raw, False))
        # 供电方式里只要写了 PoE 也算（官网个别条目接口列只写 GigE）
        if 'PoE' in sp.get('供电方式', '') and iface == 'GigE':
            poe = True

        mount_raw = sp.get('镜头接口', '').strip()
        if mount_raw not in MOUNT:
            warn.append('未知镜头口 %s: %s' % (model, mount_raw))
        mount = MOUNT.get(mount_raw, mount_raw)

        color = sp.get('黑白/彩色', '').strip()
        series = it['series']
        sensor = sp.get('传感器型号') or None
        exp_min, exp_max = parse_exp(sp.get('曝光时间'))
        dims = parse_dims(sp.get('尺寸(mm)'))
        power = parse_power(sp.get('功耗'))

        if it['cat'] == 'line':
            rate, taps = parse_line_rate(sp.get('最大行频'))
            if rate is None:
                warn.append('行频缺失 ' + model)
            row = {
                'model': model, 'w': w, 'taps': taps,
                'pxH': tidy(pxh), 'pxV': tidy(pxv),
                'lineRate': tidy(rate), 'color': color, 'iface': iface,
                'series': series, 'mount': mount,
            }
            if power is not None:
                row['powerW'] = power
            row['sensor'] = sensor
            if exp_min is not None:
                row['expMinUs'] = exp_min
                row['expMaxUs'] = exp_max
            if dims:
                row['dims'] = dims
            lines.append(row)
            continue

        row = {
            'model': model, 'kind': 'area', 'w': w, 'h': h,
            'pxUm': tidy(pxh),
        }
        if pxh and pxv and abs(pxh - pxv) > 1e-9:
            row['pxH'] = tidy(pxh)
            row['pxV'] = tidy(pxv)
        # 传感器物理尺寸（引擎算对角线用）
        row['sw'] = tidy(round(w * pxh / 1000.0, 4))
        row['sh'] = tidy(round(h * pxv / 1000.0, 4))
        row['size'] = parse_size(sp.get('靶面尺寸'))
        row['fps'] = tidy(parse_fps(sp.get('最大帧率')))
        row['shutter'] = sp.get('快门类型') or None
        row['iface'] = iface
        row['color'] = color
        row['mount'] = mount
        row['series'] = series
        row['dr'] = tidy(num(sp.get('动态范围(dB)')))
        row['snr'] = tidy(num(sp.get('信噪比(dB)')))
        if exp_min is not None:
            row['expMinUs'] = exp_min
            row['expMaxUs'] = exp_max
        row['poe'] = bool(poe)
        if power is not None:
            row['powerW'] = power
        row['sensor'] = sensor
        if dims:
            row['dims'] = dims
        wm = re.search(r'(\d+)', sp.get('重量(g)', '') or '')
        if wm:
            row['weight'] = int(wm.group(1))
        band = sp.get('波段范围(µm)')
        if band:
            row['band'] = band
        if sp.get('制冷方式'):
            row['tec'] = sp['制冷方式']

        cams.append(row)

    # 系列顺序：CC1 → CH1 → CM1，内部按分辨率、色彩排
    order = {'CC1': 0, 'CH1': 1, 'CM1': 2}
    cams.sort(key=lambda r: (order.get(r['model'].split('-')[1][:3], 9), r['w'] * r['h'],
                             r['color'] != '黑白', r['model']))
    lines.sort(key=lambda r: (r['w'], r['color'] != '黑白', r['model']))

    if warn:
        print('--- 告警 %d ---' % len(warn))
        for x in warn:
            print('  ' + x)

    meta = {
        'source': '奥普特官网产品页（optmv.com 工业相机四系列 · 详细产品参数）',
        'brand': '奥普特 OPT',
        'generated': '2026-11-18',
        'cameras': len(cams),
        'linescan': len(lines),
        'lenses': 0,
        'telecentric': 0,
        'lights': 0,
        'controllers': 0,
    }

    def dump(rows):
        return ',\n'.join('    ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows)

    js = '''/**
 * 奥普特（OPT）工业相机型号库
 * 来源：奥普特官网 optmv.com 工业相机四个系列的型号表 + 逐型号「详细产品参数」页
 *       CC1 小面阵 %d / CH1 大面阵 %d / CM1 多光谱 %d / CL1 线阵 %d
 * 字段口径与海康/大恒/华睿型录一致；官网未给的一律省略（传感器型号、曝光上下限等都有缺项）
 * 生成脚本：tools/parse-opt-list.py → tools/fetch-opt-detail.js → tools/parse-opt-detail.py → tools/build-opt-catalog.py
 * 本文件由脚本生成，请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = %s;
  var CAMERAS = [
%s
  ];
  var LINESCAN = [
%s
  ];
  return { META: META, CAMERAS: CAMERAS, LINESCAN: LINESCAN, LENSES: [], TELECENTRIC: [], LIGHTS: [], CONTROLLERS: [] };
});
''' % (
        sum(1 for r in cams if '(CC1' in r['model'] or '-CC1-' in r['model']),
        sum(1 for r in cams if '-CH1-' in r['model']),
        sum(1 for r in cams if '-CM1-' in r['model']),
        len(lines),
        json.dumps(meta, ensure_ascii=False, separators=(',', ':')),
        dump(cams), dump(lines),
    )
    io.open(OUT, 'w', encoding='utf-8').write(js)
    print('面阵 %d，线阵 %d → opt-catalog.js' % (len(cams), len(lines)))


if __name__ == '__main__':
    main()
