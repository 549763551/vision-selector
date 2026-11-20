# -*- coding: utf-8 -*-
"""生成奥普特（OPT）的镜头 / 光源 / 控制器 / 工控机型录。

输入：tools/_cache/opt/all/parsed.json（官网上 158 个系列的型号表，列名→值）
      tools/_cache/opt/all/tree.json（标准光源的分类归属）
输出：
    opt-lens-catalog.js    LENSES（定焦/线扫/液态/显微/变倍）+ TELECENTRIC（远心）
    opt-light-catalog.js   LIGHTS（环形/条形/背光/线光/同轴/无影/点/光纤/图案/拱形/平行/…）
    opt-ctrl-catalog.js    CONTROLLERS（光源控制器）+ IPC（视觉控制器/工控机）

字段口径与海康/大华/Basler 型录一致，官网没给的一律省略，不推算、不臆造。
"""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '_cache', 'opt', 'all')
TODAY = '2026-11-18'
BRAND = '奥普特'

# ---- 标准光源分类 → 照明类型 key（library.html 的 LIGHT_TYPE_LABEL） ----
GROUP_TYPE = {
    '环形光源': 'ring',
    '条形光源': 'bar',
    '背光源': 'backlight',
    '线形光源': 'line',
    '同轴光源': 'coaxial',
    '无影光源': 'flat_shadowless',
    '点光源': 'point',
    '光纤光源': 'fiber',
    '程控图案光源': 'pattern',
    '拱形光源': 'dome',
    '平行光源': 'backlight_parallel',
    '直射圆形光源': 'flood',
    '结构光源': 'struct',
    '红外光源': 'ir',
    '紫外光源': 'uv',
    '分区照明光源': 'zone',
    '高显色指数光源': 'high_cri',
}

COLOR_MAP = {
    '白色': 'white', '白': 'white', '红色': 'red', '红': 'red', '蓝色': 'blue', '蓝': 'blue',
    '绿色': 'green', '绿': 'green', '红外': 'ir', '红外光': 'ir', '紫外': 'uv', '紫外光': 'uv',
    '紫色': 'uv', '青色': 'cyan', '黄色': 'yellow', '琥珀色': 'yellow', '橙色': 'yellow',
    '多光谱': 'multi',   # RIPM 系列：8 波段可独立控制，官网 LED颜色 列就写「多光谱」
}
# 灯珠颜色列有时是 "白/红/蓝" 这种多色，取第一种做代表，其余放 colorList
COLOR_ALL = ['白', '红', '蓝', '绿', '紫外', '红外', '紫', '青', '黄', '橙']


def f(x):
    """安全转浮点"""
    if x is None:
        return None
    m = re.search(r'-?\d+(?:\.\d+)?', str(x).replace('，', ','))
    return float(m.group(0)) if m else None


def nums(x):
    return [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', str(x or ''))]


def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def umd(global_name, meta, arrays, body_names):
    lines = []
    lines.append('/**')
    lines.append(' * 奥普特（OPT）%s' % meta['title'])
    lines.append(' * 来源：奥普特官网 %s' % meta['source'])
    lines.append(' * 生成脚本：tools/build-opt-full.py（上游 fetch-opt-ajax.js / parse-opt-all.py）')
    lines.append(' * %s。本文件由脚本生成，请勿手工编辑。' % meta['counts'])
    lines.append(' */')
    lines.append('(function (root, factory) {')
    lines.append("  if (typeof module === 'object' && module.exports) module.exports = factory();")
    lines.append('  else root.%s = factory();' % global_name)
    lines.append("})(typeof self !== 'undefined' ? self : this, function () {")
    lines.append("  'use strict';")
    lines.append('  var META = %s;' % js(meta['meta']))
    for name, arr in arrays:
        lines.append('  var %s = [' % name)
        for i, o in enumerate(arr):
            lines.append('    %s%s' % (js(o), ',' if i < len(arr) - 1 else ''))
        lines.append('  ];')
    lines.append('  return { META: META, %s };' % ', '.join('%s: %s' % (n, n) for n in body_names))
    lines.append('});')
    lines.append('')
    return '\n'.join(lines)


def main():
    data = json.load(io.open(os.path.join(CACHE, 'parsed.json'), encoding='utf-8'))
    tree = json.load(io.open(os.path.join(CACHE, 'tree.json'), encoding='utf-8'))

    # 标准光源：sid → 分类名
    sid_group = {}
    for k, v in tree.items():
        for g in v['groups']:
            for s in g['subs']:
                sid_group[s['id']] = g['name']

    lenses, teles, lights, ctrls, ipcs = [], [], [], [], []
    miss = {'focal': 0, 'ic': 0, 'mount': 0, 'size': 0, 'color': 0}

    for r in data:
        if r['line'] == 'p_gyxj':
            continue                      # 相机已在 opt-catalog.js
        sp = dict(r['specs'])
        sp.pop('规格书(pdf)', None)
        line, sname = r['line'], r['sname']
        model = r['model']
        if not model:
            continue                  # 官网表格的占位空行（如 OPT-LIT 系列），不是产品

        # ---------------- 工业镜头 ----------------
        if line == '工业镜头':
            focal = f(sp.get('焦距(mm)'))
            mag = f(sp.get('放大倍率(X)'))
            ic = f(sp.get('靶面∅(mm)'))
            wd = nums(sp.get('工作距离(mm)'))
            ap = sp.get('光圈', '')
            apn = nums(ap)
            mount = sp.get('接口')
            if mount:
                # 官网写 "C-Mount / F-Mount"，统一成与海康/Basler 一致的 C / F
                mount = (mount.replace('C-Mount', 'C').replace('F-Mount', 'F')
                         .replace('C口', 'C').replace('C 口', 'C').strip())
            dims = nums(sp.get('尺寸(mm)'))
            # 远心只看系列名（"远心"字样）——定倍/变倍/显微系列也有「放大倍率」列但没有焦距，
            # 早先按「有倍率且无焦距」判断会把 635 支定焦/显微误判成远心
            is_tele = '远心' in sname
            o = {'model': model, 'brand': BRAND, 'series': sname, 'group': r['group']}
            if focal:
                o['focal'] = focal
                if not ic:
                    miss['ic'] += 1
            else:
                o['focal'] = None
                miss['focal'] += 1
            o['mount'] = mount or None
            if not mount:
                miss['mount'] += 1
            if ic:
                o['ic'] = ic
            if apn:
                o['fmin'] = apn[0]
                o['fmax'] = apn[1] if len(apn) > 1 else apn[0]
            if wd:
                o['minDist'] = round(min(wd) / 1000.0, 3)      # m
                o['wdMin'] = min(wd)
            if dims:
                o['len'] = max(dims)
            if sp.get('像方分辨率(μm)'):
                o['resUm'] = f(sp['像方分辨率(μm)'])
            if sp.get('重量(kg)'):
                o['weight'] = f(sp['重量(kg)'])
            if sp.get('滤镜螺纹'):
                o['filter'] = sp['滤镜螺纹']
            if is_tele:
                o['mag'] = mag
                o['magMin'] = mag
                o['magMax'] = mag
                o['kind'] = '双远心' if '双远心' in sname else '远心'
                o['coax'] = str(sp.get('是否同轴光', '')).strip() in ('是', '支持', 'Y', '√')
                if sp.get('景深(mm)'):
                    o['dof'] = sp['景深(mm)']
                if sp.get('远心度'):
                    o['telecentricity'] = sp['远心度']
                if ic:
                    o['fmt'] = 'Ø%s mm' % (('%g' % ic))
                teles.append(o)
            else:
                if sp.get('类型'):
                    o['lensKind'] = sp['类型']
                if sp.get('景深(mm)'):
                    o['dof'] = sp['景深(mm)']
                lenses.append(o)

        # ---------------- 标准光源 ----------------
        elif line == '标准光源':
            group = sid_group.get(r['sid'], r['group'])
            if group == '光源配件':
                continue                  # 延长线/分支线/光源线/实验架，不是灯具
            typ = GROUP_TYPE.get(group)
            if not typ:
                # 兜底：按系列名关键词判断，绝不默认成环形
                guess = [('环形', 'ring'), ('条形', 'bar'), ('背光', 'backlight'), ('线', 'line'),
                         ('同轴', 'coaxial'), ('点', 'point'), ('穹顶', 'dome'), ('拱形', 'dome')]
                typ = next((v for k, v in guess if k in sname), 'flood')
                miss['lightType'] = miss.get('lightType', 0) + 1

            col_raw = sp.get('LED颜色', '')
            colors = [c for c in COLOR_ALL if c in col_raw]
            color = COLOR_MAP.get((colors[0] + '色') if colors and colors[0] not in ('白', '红', '蓝', '绿') else colors[0], None) if colors else None
            if color is None and col_raw:
                color = (COLOR_MAP.get(col_raw.strip())
                         or {'白': 'white', '红': 'red', '蓝': 'blue', '绿': 'green',
                             '紫': 'uv', '青': 'cyan', '黄': 'yellow'}.get(col_raw.strip()[:1]))
            if not color and not col_raw:
                # 官网产品参数表没有「LED颜色」列时（如 PCP 程控图案光源，页面写「大功率恒流背光」），
                # 只认厂商自己写在型号末尾的颜色后缀，不按光源类型臆测。
                tail = re.search(r'-(IR|UV|W|R|G|B)\d*(?:-|$)', str(model).upper())
                if tail:
                    color = {'IR': 'ir', 'UV': 'uv', 'W': 'white',
                             'R': 'red', 'G': 'green', 'B': 'blue'}[tail.group(1)]
            if not color:
                miss['color'] += 1

            # size 口径：环形/环形无影 = [外径, 照射角度]；面积类 = [长, 宽]；线/点 = [单值或两维]
            dia = f(sp.get('外形直径(mm）') or sp.get('外形直径(mm)'))
            ang = f(sp.get('照射角度(°)'))
            # 面积类尺寸与海康口径一致：取外形长宽（型号里的 250×250 就是外形），发光面只在缺外形时兜底
            L = f(sp.get('外形长度(mm）') or sp.get('外形长度(mm)') or sp.get('发光面长度(mm)'))
            W = f(sp.get('外形宽度(mm）') or sp.get('外形宽度(mm)') or sp.get('发光面宽度(mm)'))
            H = f(sp.get('外形高度(mm）') or sp.get('外形高度(mm)'))
            hole = f(sp.get('外形内径(mm）') or sp.get('外形内径(mm)'))
            beam = f(sp.get('光束直径(mm)') or sp.get('发光面直径(mm)'))

            size = None
            if typ in ('ring', 'ring_dome'):
                if dia is not None:
                    size = [dia, ang] if ang is not None else [dia]
            elif typ in ('backlight', 'backlight_parallel', 'backlight_hole', 'bar', 'coaxial', 'struct', 'zone'):
                if L is not None and W is not None:
                    size = [L, W]
                elif L is not None:
                    size = [L]
                elif dia is not None:
                    size = [dia]
            elif typ in ('dome', 'flat_shadowless', 'flood'):
                if dia is not None:
                    size = [dia]
                elif L is not None and W is not None:
                    size = [L, W]
            elif typ in ('line', 'line_focus', 'line_high', 'line_coax'):
                if L is not None:
                    size = [L]
                elif W is not None:
                    size = [W]
                elif dia is not None:
                    size = [dia]
            elif typ == 'point':
                if beam is not None:
                    size = [beam]
                elif dia is not None:
                    size = [dia]
            else:
                if dia is not None:
                    size = [dia, ang] if ang is not None else [dia]
                elif L is not None:
                    size = [L, W] if W is not None else [L]
            if size is None:
                # 官网「尺寸(mm)」是通用外形长×宽×高列（如 "124 × 141 × 178"）。
                # 光纤 / 程控图案等系列没有「外形长度/宽度/直径」专用列，早先只认专用列
                # 会把官网已公布的尺寸丢成 null；这里按该列兜底，只搬数值、不推算。
                box = [v for v in nums(sp.get('尺寸(mm)') or sp.get('显示区域尺寸(mm)')) if v > 0]
                if box:
                    size = [box[0], box[1]] if len(box) > 1 and typ in (
                        'backlight', 'backlight_parallel', 'backlight_hole', 'bar',
                        'coaxial', 'struct', 'zone', 'fiber', 'pattern', 'flood',
                        'flat_shadowless', 'dome', 'high_cri', 'ir', 'uv') else [box[0]]
            if size is None:
                miss['size'] += 1

            o = {'model': model, 'type': typ, 'color': color, 'size': size,
                 'power': f(sp.get('消耗功率(W)')), 'angle': ang if typ in ('ring', 'dome') else None,
                 'series': sname, 'group': group,
                 'name': (GROUP_TYPE and group or '') + model}
            o['name'] = group + ' ' + model
            if len(colors) > 1:
                o['colorList'] = colors
            if sp.get('波段(nm)'):
                o['wavelength'] = sp['波段(nm)']
            if sp.get('输入电压(V)'):
                o['volt'] = sp['输入电压(V)']
            if sp.get('输入电流(A)'):
                o['amp'] = sp['输入电流(A)']
            if sp.get('输入接口'):
                o['conn'] = sp['输入接口']
            if sp.get('建议匹配控制器'):
                o['ctrlHint'] = sp['建议匹配控制器']
            if sp.get('重量(kg)'):
                o['weight'] = f(sp['重量(kg)'])
            if sp.get('线缆长度(mm）') or sp.get('线缆长度(mm)'):
                o['cableMm'] = f(sp.get('线缆长度(mm）') or sp.get('线缆长度(mm)'))
            if typ in ('ring', 'ring_dome') and hole is not None:
                o['innerDia'] = hole
            if H is not None and typ in ('ring', 'ring_dome', 'dome'):
                o['height'] = H
            lights.append(o)

        # ---------------- 光源控制器 ----------------
        elif line == '光源控制器':
            mode = [x for x in [sp.get('驱动方式'), sp.get('通信方式')] if x and x not in ('--', '-')]
            o = {'model': model, 'channels': int(f(sp.get('通道数')) or 1),
                 'mode': ' · '.join(mode) or None, 'series': sname, 'group': r['group'],
                 'strobe': bool(sp.get('DO') and sp.get('DO') not in ('--', '-'))}
            if sp.get('输入电压'):
                o['vin'] = sp['输入电压']
            if sp.get('输出电压(V)'):
                o['vout'] = sp['输出电压(V)']
            if sp.get('单路最大电流(A)'):
                o['ampPerCh'] = f(sp['单路最大电流(A)'])
            if sp.get('总功率(W)'):
                o['power'] = f(sp['总功率(W)'])
            if sp.get('光源接口'):
                o['conn'] = sp['光源接口']
            if sp.get('尺寸(mm)'):
                o['dims'] = sp['尺寸(mm)']
            ctrls.append(o)

        # ---------------- 视觉控制器 / 工控机 ----------------
        elif line == '视觉控制器/工控机':
            o = {'model': model, 'series': sname, 'form': sname, 'brand': BRAND,
                 'cpu': sp.get('中央处理器'), 'board': sp.get('芯片组')}
            if sp.get('内存'):
                o['mem'] = sp['内存']
            if sp.get('固态硬盘'):
                o['ssd'] = sp['固态硬盘']
            if sp.get('机械硬盘'):
                o['hdd'] = sp['机械硬盘']
            if sp.get('电源'):
                o['psu'] = sp['电源']
            if sp.get('扩展槽'):
                o['slots'] = sp['扩展槽']
            if sp.get('I/O接口'):
                o['io'] = sp['I/O接口']
            if sp.get('尺寸(mm)'):
                o['size'] = sp['尺寸(mm)']
            o = {k: v for k, v in o.items() if v not in (None, '', '--')}
            ipcs.append(o)

    # ---------- 写文件 ----------
    lens_js = umd('OptLensCatalog',
                  {'title': '工业镜头库（定焦/线扫/液态/显微/变倍 + 远心）',
                   'source': '工业镜头 29 个系列的型号表',
                   'counts': '镜头 %d 支；远心 %d 款' % (len(lenses), len(teles)),
                   'meta': {'source': '奥普特官网产品页（optmv.com 工业镜头系列）', 'brand': '奥普特 OPT',
                            'generated': TODAY, 'lenses': len(lenses), 'telecentric': len(teles)}},
                  [('LENSES', lenses), ('TELECENTRIC', teles)],
                  ['LENSES', 'TELECENTRIC'])

    light_js = umd('OptLightCatalog',
                   {'title': '光源库',
                    'source': '标准光源 17 个分类 53 个系列的型号表（非标光源为定制方案，无型号表）',
                    'counts': '光源 %d 支' % len(lights),
                    'meta': {'source': '奥普特官网产品页（optmv.com 标准光源系列）', 'brand': '奥普特 OPT',
                             'generated': TODAY, 'lights': len(lights)}},
                   [('LIGHTS', lights)], ['LIGHTS'])

    ctrl_js = umd('OptCtrlCatalog',
                  {'title': '光源控制器与视觉控制器/工控机',
                   'source': '光源控制器 14 个系列 + 视觉控制器/工控机 3 个系列',
                   'counts': '控制器 %d 台；工控机 %d 台' % (len(ctrls), len(ipcs)),
                   'meta': {'source': '奥普特官网产品页（optmv.com 光源控制器 / 工控机系列）', 'brand': '奥普特 OPT',
                            'generated': TODAY, 'controllers': len(ctrls), 'ipc': len(ipcs)}},
                  [('CONTROLLERS', ctrls), ('IPC', ipcs)], ['CONTROLLERS', 'IPC'])

    for name, s in [('opt-lens-catalog.js', lens_js), ('opt-light-catalog.js', light_js),
                    ('opt-ctrl-catalog.js', ctrl_js)]:
        io.open(os.path.join(BASE, name), 'w', encoding='utf-8').write(s)
        print('→ %s  %.0f KB' % (name, len(s.encode('utf-8')) / 1024))

    print('\n镜头 %d（缺焦距 %d）· 远心 %d · 光源 %d · 控制器 %d · 工控机 %d'
          % (len(lenses), miss['focal'], len(teles), len(lights), len(ctrls), len(ipcs)))
    print('缺项统计：', miss)
    from collections import Counter
    print('光源类型分布：', dict(Counter(x['type'] for x in lights)))
    print('光源颜色分布：', dict(Counter(x['color'] for x in lights)))


if __name__ == '__main__':
    main()
