# -*- coding: utf-8 -*-
"""生成奥普特（OPT）的智能相机 / 智能读码器 / 传感器 / 测量系统 / 运控 / 具身智能型录。

输入：tools/_cache/opt/all/parsed.json
输出：opt-misc-catalog.js
    SMART    智能相机 80 + 智能读码器 65
    SENSORS  传感器 1057（激光位移/光谱共焦/纠偏/光电/槽型/颜色/光纤/安全光栅/安全门锁/安全继电器/接近）
    MEAS     测量系统 16 + 运控部件 3 + 具身智能 7

这几类不属于「相机-镜头-光源」选型链，故各自保留完整原始规格（spec 键值对），
列表只抽少量可比字段；不做推算，官网没写的一律不填。
"""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt', 'all')
TODAY = '2026-11-18'
BRAND = '奥普特'


def f(x):
    if x is None:
        return None
    m = re.search(r'-?\d+(?:\.\d+)?', str(x))
    return float(m.group(0)) if m else None


def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def res_of(s):
    m = re.match(r'\s*(\d+)\s*[×xX*]\s*(\d+)\s*$', str(s or ''))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


# 各小类的列表摘要优先键（按顺序取前 3 个有值的）
KEY_FIRST = {
    '激光位移传感器': ['测量中心距离(mm)', '测量范围(mm)', '重复精度(μm)', '线性精度'],
    '点光谱共焦传感器': ['测量中心距离(mm)', '测量范围(mm)', '分辨率(nm)', '光斑大小(μm)'],
    '纠偏传感器': ['测量范围(mm)', '重复精度(μm)', '线性精度'],
    '方形光电传感器': ['检测距离', '检测方式', '开关量输出'],
    '槽型光电传感器': ['检测距离', '检测方式', '开关量输出'],
    '颜色传感器': ['检测距离(mm)', '输出', '响应时间'],
    '光纤传感器': ['输出方式', '类型', '反应时间'],
    '安全光栅': ['光轴间距(mm)', '分辨率(mm)', '对射距离(m)', '保护高度(mm)'],
    '安全门锁': ['触点类型', '锁定方式', '安全类别'],
    '安全继电器': ['触点数量', '输入设备', '输出类型'],
    '接近传感器': ['（最大）检测工作距离(mm)', '检测距离(mm)', '输出模式'],
    '测量系统': ['量测范围(mm)', '测量精度 （无拼接）(μm)', '重复精度 (工作台未移动）(μm)'],
    '运控部件': ['传动方式', '马达功率', '本体宽幅'],
    '具身智能': ['工作距离', '深度分辨率', '精度'],
}


# 键名太长，列表里用短标签带上语义（否则只剩一串「18-28 · 100us」猜不出是什么）
KEY_LABEL = {
    '测量中心距离(mm)': '中心距', '测量范围(mm)': '量程', '重复精度(μm)': '重复精度',
    '线性精度': '线性精度', '分辨率(nm)': '分辨率', '光斑大小(μm)': '光斑',
    '检测距离': '检测距离', '检测方式': '检测方式', '开关量输出': '输出',
    '检测距离(mm)': '检测距离', '输出': '输出', '响应时间': '响应',
    '光轴间距(mm)': '光轴间距', '分辨率(mm)': '分辨率', '对射距离(m)': '对射距离',
    '保护高度(mm)': '保护高度', '触点类型': '触点', '锁定方式': '锁定',
    '安全类别': '安全类别', '触点数量': '触点', '输入设备': '输入', '输出类型': '输出',
    '（最大）检测工作距离(mm)': '检测距离', '输出模式': '输出',
    '量测范围(mm)': '量测范围', '测量精度 （无拼接）(μm)': '精度',
    '重复精度 (工作台未移动）(μm)': '重复精度',
    '传动方式': '传动', '马达功率': '功率', '本体宽幅': '宽幅',
    '工作距离': '工作距离', '深度分辨率': '深度', '精度': '精度',
    '输出方式': '输出', '类型': '类型', '反应时间': '响应'
}


def summary(group, spec):
    keys = KEY_FIRST.get(group, [])
    out = []
    for k in keys:
        if spec.get(k) and len(out) < 3:
            out.append((KEY_LABEL.get(k, '') + ' ' + spec[k]).strip())
    if len(out) < 2:
        for k, v in spec.items():
            if k not in ('规格书(pdf)',) and len(out) < 3:
                out.append('%s %s' % (k.replace('(mm)', '').replace('(μm)', 'µm'), v))
    return out


def main():
    data = json.load(io.open(os.path.join(CACHE, 'parsed.json'), encoding='utf-8'))
    smart, sensors, meas = [], [], []
    grp_of_code = {}
    for r in data:
        sp = dict(r['specs'])
        sp.pop('规格书(pdf)', None)
        line, sname, model = r['line'], r['sname'], r['model']

        if line in ('SC智能相机', '智能读码器'):
            w, h = res_of(sp.get('分辨率'))
            px = f(sp.get('像元尺寸(μm)'))
            o = {
                'model': model, 'brand': BRAND, 'series': sname,
                'group': sname,
                'kind': '智能相机' if line == 'SC智能相机' else '智能读码器',
                'w': w, 'h': h, 'pxUm': px,
                'size': (sp.get('靶面尺寸') or '').replace('＂', '"') or None,
                'fps': f(sp.get('最大采集帧率(fps)') or sp.get('最大处理帧率(fps)')),
                'color': sp.get('图像类型'),
                'focal': f(sp.get('镜头焦距(mm)')),
                'read': sp.get('读取距离(mm)'),
                'focus': sp.get('对焦方式'),
                'sensorType': sp.get('传感器类型'),
                'iface': sp.get('通讯接口'),
            }
            o = {k: v for k, v in o.items() if v not in (None, '')}
            o['spec'] = sp
            smart.append(o)

        elif line == '传感器':
            o = {'model': model, 'brand': BRAND, 'series': sname, 'group': r['group'],
                 'brief': ' · '.join(summary(r['group'], sp)), 'spec': sp}
            sensors.append(o)

        elif line in ('测量系统', '运控部件', '具身智能'):
            g = '测量系统' if line == '测量系统' else line
            o = {'model': model, 'brand': BRAND, 'series': sname, 'group': g,
                 'brief': ' · '.join(summary(g, sp)), 'spec': sp}
            if line == '具身智能':
                w, h = res_of(str(sp.get('深度分辨率', '')).split('@')[0])
                o['w'], o['h'] = w, h
                o['iface'] = sp.get('接口')
            meas.append(o)

    smart.sort(key=lambda x: (x['kind'], x['series'], x['model']))
    sensors.sort(key=lambda x: (x['group'], x['series'], x['model']))
    meas.sort(key=lambda x: (x['group'], x['series'], x['model']))

    meta = {'source': '奥普特官网产品页（optmv.com 智能相机/读码器/传感器/测量/运控/具身智能）',
            'brand': '奥普特 OPT', 'generated': TODAY,
            'smart': len(smart), 'sensors': len(sensors), 'meas': len(meas),
            'smartCam': sum(1 for x in smart if x['kind'] == '智能相机'),
            'codeReader': sum(1 for x in smart if x['kind'] == '智能读码器')}

    L = ['/**',
         ' * 奥普特（OPT）智能相机 / 读码器 / 传感器 / 测量系统 / 运控 / 具身智能',
         ' * 来源：奥普特官网产品页，逐型号规格表（原始规格完整保留在 spec 里）',
         ' * 生成脚本：tools/build-opt-misc.py（上游 fetch-opt-ajax.js / parse-opt-all.py）',
         ' * 智能相机 %d · 读码器 %d · 传感器 %d · 测量与运控 %d。本文件由脚本生成，请勿手工编辑。'
         % (meta['smartCam'], meta['codeReader'], len(sensors), len(meas)),
         ' */',
         '(function (root, factory) {',
         "  if (typeof module === 'object' && module.exports) module.exports = factory();",
         '  else root.OptMiscCatalog = factory();',
         "})(typeof self !== 'undefined' ? self : this, function () {",
         "  'use strict';",
         '  var META = %s;' % js(meta)]
    for name, arr in [('SMART', smart), ('SENSORS', sensors), ('MEAS', meas)]:
        L.append('  var %s = [' % name)
        for i, o in enumerate(arr):
            L.append('    %s%s' % (js(o), ',' if i < len(arr) - 1 else ''))
        L.append('  ];')
    L.append('  return { META: META, SMART: SMART, SENSORS: SENSORS, MEAS: MEAS };')
    L.append('});')
    L.append('')
    s = '\n'.join(L)
    io.open(os.path.join(BASE, 'js', 'opt-misc-catalog.js'), 'w', encoding='utf-8').write(s)
    print('→ opt-misc-catalog.js  %.0f KB' % (len(s.encode('utf-8')) / 1024))
    print('智能相机 %d（相机 %d + 读码器 %d）· 传感器 %d · 测量运控 %d'
          % (len(smart), meta['smartCam'], meta['codeReader'], len(sensors), len(meas)))

    from collections import Counter
    print('传感器分类：', dict(Counter(x['group'] for x in sensors)))
    print('测量运控分类：', dict(Counter(x['group'] for x in meas)))


if __name__ == '__main__':
    main()
