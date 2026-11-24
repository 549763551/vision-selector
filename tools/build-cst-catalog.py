#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把康视达官网抓下来的分类页 / 单品页 / 系列页组装成网页端 UMD 型录。

上游：python tools/fetch-cst.py discover / pages / collect / series / details
输出：
  cst-catalog.js        六个在售类目（面阵 / 线阵 / 镜头 / 远心 / 光源 / 控制器）
  cst-misc-catalog.js   不进 9 类页签的产品（非标定制等），按项目约定只落盘不挂页面
  tmp/cst/build-report.json

字段口径对齐 opt-*-catalog.js / hikrobot-catalog.js：
  * 光源 size：环形/无影环 = [外径, 0]，0 表示官网未给照射角（fmtSize 会显示 Ø外径）；
    其余 = [长, 宽] mm。康视达不进选型链，size[1] 不会被 engine 当角度参与面积计算。
  * 远心 wdMin/wdMax、magMin/magMax 单值两个键都写，避免页面渲染 undefined。
  * 型号统一 CST- 前缀；AVT 代理相机保留原型号并在 series 注明。
  * 补充型号：官网红外单品页写明「光源波长可定制 850、940 等」，故为在售 -IR940
    派生同规格 -IR850 变体（只改型号名 + 备注，不新增/推算任何参数）；
    EXTRA_LIGHTS 登记用户提供的型号，官网未公布规格的字段一律留空。
    两类补充都会由 selection-catalog.js 的必要参数门槛决定是否进选型链。
"""
from __future__ import annotations
import io, os, re, json, html, datetime, collections
import importlib.util

_spec = importlib.util.spec_from_file_location('fetch_cst', 'tools/fetch-cst.py')
fc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fc)

ROOT = 'tmp/cst'
PAGES = os.path.join(ROOT, 'pages')
TODAY = '2026-11-20'

# 用户补充的型号：官网分类页 / 系列型录未收录，只登记型号与归属类别。
# 规格字段一律留空（不推算、不编造），产品库可见，缺 size 会被必要参数门槛挡在选型链外。
# 后续用户再给新型号时，按同样格式往这里追加即可，重跑本脚本即可复现。
EXTRA_LIGHTS = [
    {
        'model': 'CST-2BS10238-UV365-D28',
        'type': 'uv', 'color': 'uv', 'series': '紫外光源', 'group': '紫外光源',
        'note': '用户补充型号；官网分类页与系列型录未列规格，参数暂缺，不进选型链',
    },
    {
        'model': 'CST-CP80M80-W',
        'color': 'white', 'series': '用户补充型号', 'group': '光源',
        'note': '用户补充型号；官网未收录，类型与规格待厂商资料确认，暂不进选型链',
    },
]

# 官网红外单品页（如 /show/387.html、/show/386.html）：「采用进口高输出 IR-LED、
# 光源波长可定制 850、940 等」。据此为在售 -IR940 型号派生 -IR850 同规格变体。
IR850_DERIVE = True

# ---------------------------------------------------------------- 分类映射
LIGHT_MAP = {
    '166': ('ring', '环形光源'), '167': ('bar', '条形光源'),
    '168': ('bar', '高均匀条形光源'), '169': ('bar', '高亮条形光源'),
    '170': ('bar_array', '组合条形光源'), '171': ('coaxial', '同轴光源'),
    '172': ('coaxial', '高清同轴光源'), '173': ('coaxial', '转角同轴光源'),
    '174': ('coaxial', '高亮同轴光源'), '175': ('coaxial', '平行同轴光源'),
    '176': ('coaxial', '平面同轴光源'), '177': ('backlight', '面光源'),
    '178': ('backlight_parallel', '平行底部面光源'), '179': ('backlight_hole', '开孔底部面光源'),
    '180': ('backlight_side', '侧部面光源'), '181': ('backlight_parallel', '平行侧部面光源'),
    '182': ('backlight_hole', '开孔侧部面光源'), '183': ('flat_shadowless', '无影光源'),
    '184': ('ring_dome', '环形无影光源'), '185': ('flat_shadowless', '平面无影光源'),
    '186': ('flat_shadowless', '方形无影光源'), '187': ('flat_shadowless', '圆形无影光源'),
    '188': ('flat_shadowless', '四面无影光源'), '189': ('point', '点光源'),
    '190': ('line', '线性光源'), '191': ('line_high', '超高亮线性光源'),
    '192': ('line_focus', '斜射线性光源'), '193': ('line', '微型线性光源'),
    '194': ('line_coax', '同轴线性光源'), '195': ('line_focus', '隧道线性光源'),
    '196': ('line', '多角度线性光源'), '197': ('dome', '拱形光源'),
    '198': ('backlight', '灯箱光源'), '199': ('ring_dome', 'AOI 光源'),
    '200': ('polar', '偏光光源'), '201': ('struct', '结构光光源'),
    '202': ('darkfield', '针脚检测光源'), '203': ('uv', '紫外光源'),
    '204': ('ir', '红外光源'), '205': ('rgb', '三色光源'),
    '206': ('strobe', '爆闪光源'), '207': ('line_high', '分时线扫光源'),
    '208': ('zone', '多路时序光源'), '254': ('polar', '偏光光源'),
    '256': ('polar', '偏光光源'),
}
CTRL_MODE = {
    '210': ('模拟', False), '211': ('模拟', False), '212': ('数字', False),
    '213': ('数字', False), '214': ('频闪', True), '215': ('爆闪', True),
    '216': ('可编程频闪', True), '217': ('可编程爆闪', True),
    '218': ('恒流', False), '219': ('恒流', False), '220': ('恒流', False),
    '221': ('可编程恒流', False), '244': ('频闪', True), '262': ('模块化数字', False),
}
LENS_CIDS = {'232', '233', '234', '235', '236', '237', '238', '239', '240', '241',
             '242', '243', '245', '246', '247', '248', '249', '250', '251'}
TELE_CIDS = {'252', '253'}
MISC_CIDS = {'259'}

COLOR_CLASS = {'white': 'white', 'red': 'red', 'blue': 'blue', 'green': 'green',
               'ir': 'ir', 'uv': 'uv', 'rgb': 'white', 'yellow': 'yellow',
               'cyan': 'cyan', 'warmwhite': 'white'}
COLOR_CN = {'白色': 'white', '红色': 'red', '蓝色': 'blue', '绿色': 'green',
            '红外': 'ir', '紫外': 'uv', '白': 'white', '红': 'red',
            '蓝': 'blue', '绿': 'green'}
# 传感器靶面字符串 → 对角线 mm（工程常用值）
FMT_IC = {'1/3"': 6.0, '1/2.9"': 5.0, '1/2.7"': 5.4, '1/2.5"': 7.2,
          '1/2"': 8.0, '1/1.8"': 8.9, '2/3"': 11.0, '1"': 16.0,
          '1.1"': 17.6, '4/3"': 22.5, '1.2"': 19.2, '1/1.7"': 9.5}


# ---------------------------------------------------------------- 工具
def num(s):
    if s is None:
        return None
    s = str(s).replace('，', ' ').replace(',', '')
    m = re.search(r'-?\d+(?:\.\d+)?', s)
    if not m:
        return None
    v = float(m.group(0))
    return int(v) if v == int(v) else round(v, 3)


def txt(s):
    if s is None:
        return None
    s = str(s).replace('\xa0', ' ').strip()
    return re.sub(r'\s+', ' ', s) or None


def mount_of(s):
    s = txt(s) or ''
    u = s.upper().replace(' ', '')
    if 'C-MOUNT' in u or u == 'C' or 'CMOUNT' in u:
        return 'C'
    if 'M58' in u:
        return 'M58'
    if 'M42' in u:
        return 'M42'
    if 'M72' in u:
        return 'M72'
    if u.startswith('F') or 'F-MOUNT' in u or 'F口' in s:
        return 'F'
    if 'M' in u and re.search(r'M\d{2}', u):
        return re.search(r'M\d{2}', u).group(0)
    return txt(s) or None


def iface_of(s):
    s = txt(s) or ''
    u = s.upper()
    if '10GIGE' in u:
        return '10GigE'
    if '5GIGE' in u:
        return '5GigE'
    if 'GIGE' in u:
        return 'GigE'
    if 'USB3' in u:
        return 'USB3'
    if 'CAMERALINK' in u:
        return 'CameraLink'
    if 'CXP' in u or 'COAXPRESS' in u:
        return 'CoaXPress'
    return txt(s) or None


def ic_of(s):
    s = txt(s) or ''
    m = re.search(r'[ΦφØø]\s*(\d+(?:\.\d+)?)', s)
    if m:
        return num(m.group(1))
    key = s.replace('”', '"').replace('′', '"').replace("'", '"').strip()
    if key in FMT_IC:
        return FMT_IC[key]
    for k, v in FMT_IC.items():
        if k in key:
            return v
    return None


def color_of(colors, cn, model):
    for c in colors or []:
        if c in COLOR_CLASS:
            return COLOR_CLASS[c]
    if cn:
        for k, v in COLOR_CN.items():
            if k in cn:
                return v
    u = (model or '').upper()
    if re.search(r'-UV|UV\d', u):
        return 'uv'
    if re.search(r'-IR|IR\d', u):
        return 'ir'
    if re.search(r'RGB', u):
        return 'white'
    m = re.search(r'-([WRBGY])(?:-|$)', u)
    if m:
        return {'W': 'white', 'R': 'red', 'B': 'blue', 'G': 'green', 'Y': 'yellow'}[m.group(1)]
    return 'white'


def detail_of(sid):
    p = os.path.join(PAGES, f'show_{sid}.html')
    if not os.path.exists(p):
        return {}
    s = io.open(p, encoding='utf-8', errors='replace').read()
    tabs = fc.parse_tables(s)
    if not tabs:
        return {}
    out = {}
    for row in tabs[0]:
        if len(row) >= 2 and row[0]:
            out[row[0]] = row[1]
            if len(row) >= 3:
                out.setdefault(row[0] + '_2', row[2])
    return out


def cells_vals(cols, cells):
    """产品行结构：[型号, 颜色li, ...值]，表头有的带「颜色」列有的不带。

    官网个别分类（如 211 标准模拟控制器）的产品行只填了 1,2,3… 占位序号，
    这类行必须判空，否则会把序号当成电压/电流/功率写进型录。"""
    if not cells:
        return {}
    vals = cells[2:] if len(cells) > 2 else []
    if len(vals) >= 4 and all(re.fullmatch(r'\s*\d+\s*', str(x)) for x in vals):
        seq = [int(str(x).strip()) for x in vals]
        if seq == list(range(seq[0], seq[0] + len(seq))):
            return {}
    keys = cols[2:] if (cols and len(cols) > 1 and cols[1] == '颜色') else cols[1:]
    return {k: vals[i] for i, k in enumerate(keys) if i < len(vals)}


def cmpact(o):
    return {k: v for k, v in o.items() if v is not None and v != '' and v != []}


# ---------------------------------------------------------------- 数据装载
def load():
    prod = json.load(io.open(os.path.join(ROOT, 'products.json'), encoding='utf-8'))
    disc = json.load(io.open(os.path.join(ROOT, 'discover.json'), encoding='utf-8'))
    series = json.load(io.open(os.path.join(ROOT, 'series.json'), encoding='utf-8'))
    return prod, disc, series


def rec_quality(rec):
    v = cells_vals(rec['cols'], rec['cells'])
    return sum(1 for x in v.values() if txt(x))


def build_products(prod):
    """按型号归一，保留最具体的子系列分类；非标单独分流。"""
    by_model, misc = {}, {}
    for p in prod['products']:
        model = txt(p['cells'][0]) if p['cells'] else None
        if not model or not re.match(r'^CST-', model, re.I):
            continue
        model = model.upper().strip()
        cid = p['cid']
        rec = {'model': model, 'cid': cid, 'cat': p['cat'], 'cols': p['cols'],
               'cells': p['cells'], 'colors': p['colors'], 'id': p['id']}
        if cid in MISC_CIDS:
            misc.setdefault(model, rec)
            continue
        old = by_model.get(model)
        if old is None:
            by_model[model] = rec
            continue
        # 先比参数有效值数量（占位行会被判 0），再比分类具体程度
        q_new, q_old = rec_quality(rec), rec_quality(old)
        more_specific = (('系列' in p['cat'] or re.search(r'[A-Z]{2,}\d', p['cat']))
                         and '系列' not in old['cat'])
        if q_new > q_old or (q_new == q_old and more_specific):
            by_model[model] = rec
    return by_model, misc


# ---------------------------------------------------------------- 各类目生成
def make_light(rec, det):
    cid, name = rec['cid'], rec['cat']
    t, group = LIGHT_MAP.get(cid, ('flood', name or '光源'))
    v = cells_vals(rec['cols'], rec['cells'])
    model = rec['model']
    pwr = num(v.get('功率') or det.get('光源功率'))
    length = num(v.get('长(外径)'))
    width = num(v.get('宽(内径)'))
    height = num(v.get('高'))
    inner = num(v.get('宽(内径)'))
    emit = txt(v.get('发光面尺寸(灯珠排数)'))
    if t.startswith('ring'):
        size = [length, 0] if length else None
        innerDia = inner
    else:
        size = [x for x in (length, width) if x is not None] or None
        innerDia = None
    color = color_of(rec['colors'], det.get('光源颜色'), model)
    d = cmpact({
        'model': model, 'type': t, 'color': color, 'size': size, 'power': pwr,
        'wavelength': txt(det.get('色温/波长')), 'series': name or group,
        'group': group, 'name': (group + ' ' + model) if group else model,
        'innerDia': innerDia, 'height': height, 'emitArea': emit,
        'volt': None,
    })
    return d


def make_ctrl(rec, det):
    cid, name = rec['cid'], rec['cat']
    mode, strobe = CTRL_MODE.get(cid, ('数字', False))
    v = cells_vals(rec['cols'], rec['cells'])

    # 控制器详情页的参数表是权威来源；分类页个别分类只有占位序号，只作兜底。
    def val(key, unit=None):
        a, b = det.get(key), v.get(key)
        for x in (a, b):
            s = txt(x)
            if not s:
                continue
            if unit and not re.search(unit, s, re.I):
                continue
            return s
        return None

    d = cmpact({
        'model': rec['model'],
        'channels': num(val('通道数')),
        'mode': (txt(det.get('调光方式')) or mode) + (' · ' + name if name else ''),
        'strobe': strobe,
        'series': name or mode, 'group': name or mode,
        'vin': val('输入电压', r'V|AC|DC'),
        'vout': val('输出电压', r'V|DC|AC'),
        'ampPerCh': num(val('最大输出电流', r'A')),
        'power': num(val('总功率', r'W')),
        'conn': val('输出端口'),
        'drive': txt(det.get('驱动方式')),
    })
    return d


def make_lens(rec, det):
    name = rec['cat'] or '工业镜头'
    model = rec['model']
    fmin = num(det.get('光圈系数') or det.get('F数') or
               cells_vals(rec['cols'], rec['cells']).get('光圈系数'))
    fmt = txt(det.get('最大像面尺寸') or cells_vals(rec['cols'], rec['cells']).get('最大像面尺寸'))
    d = cmpact({
        'model': model, 'brand': '康视达', 'series': name, 'group': name,
        'focal': num(det.get('焦距') or cells_vals(rec['cols'], rec['cells']).get('焦距')),
        'fmin': fmin,
        'mount': mount_of(det.get('接口') or cells_vals(rec['cols'], rec['cells']).get('接口')),
        'ic': ic_of(fmt), 'fmt': fmt,
        'filter': txt(det.get('滤镜螺纹')),
        'minDist': num(det.get('最近距离')),
        'distortion': txt(det.get('畸变') or det.get('TV畸变')),
        'lensKind': name,
    })
    return d


def make_tele(rec, det):
    model, name = rec['model'], rec['cat'] or '远心镜头'
    mag = num(det.get('倍率') or det.get('放大倍率'))
    wd = num(det.get('工作距离'))
    fmt = txt(det.get('最大像面尺寸'))
    fno = num(det.get('光圈系数'))
    d = cmpact({
        'model': model, 'brand': '康视达', 'series': name, 'group': name,
        'focal': None,
        'mag': mag, 'magMin': mag, 'magMax': mag,
        'wdMin': wd, 'wdMax': wd,
        'mount': mount_of(det.get('接口')), 'ic': ic_of(fmt), 'fmt': fmt,
        'fmin': fno, 'fmax': fno,
        'resUm': num(det.get('分辨力') or det.get('分辨率(um)')),
        'dof': txt(det.get('景深')),
        'telecentricity': txt(det.get('远心度')),
        'tvDistort': txt(det.get('TV畸变')),
        'kind': '远心', 'coax': False,
    })
    return d


def tele_from_series(row, head, series_name):
    ix = {h: i for i, h in enumerate(head)}
    g = lambda k: row[ix[k]] if k in ix and ix[k] < len(row) else None
    model = txt(g('型号'))
    if not model:
        return None
    mag = num(g('倍率'))
    wd = num(g('工作距离'))
    fmt = txt(g('最大像面尺寸'))
    fno = num(g('光圈系数'))
    return cmpact({
        'model': model.upper(), 'brand': '康视达', 'series': series_name, 'group': series_name,
        'focal': None, 'mag': mag, 'magMin': mag, 'magMax': mag,
        'wdMin': wd, 'wdMax': wd, 'mount': mount_of(g('接口')),
        'ic': ic_of(fmt), 'fmt': fmt, 'fmin': fno, 'fmax': fno,
        'resUm': num(g('分辨率(um)')), 'dof': txt(g('景深(mm)')),
        'telecentricity': txt(g('远心度')), 'tvDistort': txt(g('TV畸变')),
        'kind': '远心', 'coax': False,
    })


def camera_from_series(row, head, series_name, is_line=False):
    ix = {h: i for i, h in enumerate(head)}
    g = lambda k: row[ix[k]] if k in ix and ix[k] < len(row) else None
    raw = txt(g('型号'))
    if not raw:
        return []
    res = txt(g('分辨率')) or ''
    wh = re.search(r'(\d{2,6})\s*[×xX]\s*(\d{1,6})', res)
    w, h = (int(wh.group(1)), int(wh.group(2))) if wh else (None, None)
    px = num(g('像元(um^2)') or g('像元(um²)'))
    sensor = txt(g('感光芯片'))
    size = txt(g('靶面'))
    shutter = txt(g('曝光方式'))
    iface = iface_of(g('数字接口') or g('数据接口'))
    color_raw = txt(g('黑白/彩色')) or 'M/C'
    dims_s = txt(g('相机尺寸'))
    dims = [num(x) for x in dims_s.split('×')] if dims_s and '×' in dims_s else None
    if dims and any(x is None for x in dims):
        dims = None

    def one(model, color, shutter_v, mount_v):
        return cmpact({
            'model': model, 'kind': 'line' if is_line else 'area',
            'w': w, 'h': h, 'pxUm': px,
            'sw': round(w * px / 1000, 4) if (w and px) else None,
            'sh': round(h * px / 1000, 4) if (h and px) else None,
            'size': size, 'sensor': sensor,
            'fps': None if is_line else num(g('帧率(fps)')),
            'shutter': shutter_v, 'iface': iface, 'color': color,
            'mount': mount_v, 'series': series_name, 'dims': dims,
            'lineRate': num(g('帧率(fps)')) if is_line else None,
        })

    if is_line:
        # 线阵表「曝光方式」列实际填的是卡口；帧率列是行频 kHz
        mount_v = mount_of(shutter) if shutter and re.search(r'M\d{2}|C-MOUNT|^C$', shutter, re.I) else None
        color = '彩色' if color_raw.upper().startswith('C') else '黑白'
        return [one(raw.upper(), color, None, mount_v)]

    models = []
    if re.search(r'M/C', color_raw, re.I) and re.search(r'GM/C$|GC/GM$', raw, re.I):
        base = re.sub(r'GM/C$', 'G', raw)
        models = [(base + 'M', '黑白'), (base + 'C', '彩色')]
    elif re.search(r'M/C', color_raw, re.I) and raw.upper().endswith('M/C'):
        base = raw[:-3]
        models = [(base + 'M', '黑白'), (base + 'C', '彩色')]
    else:
        c = '彩色' if ('彩色' in color_raw or color_raw.upper() == 'C') else '黑白'
        models = [(raw, c)]
    shutter_v = 'Global' if (shutter and 'global' in shutter.lower()) else (
        'Rolling' if (shutter and 'rolling' in shutter.lower()) else txt(shutter))
    # 面阵表未给卡口，保持缺省；康视达不进选型链，无 mount 不影响页面展示
    return [one(m.upper(), c, shutter_v, None) for m, c in models]


# ---------------------------------------------------------------- 主流程
def main():
    prod, disc, series = load()
    by_model, misc = build_products(prod)

    CAM, LINE, LENS, TELE, LIGHT, CTRL, MISC = [], [], [], [], [], [], []
    detail_hit = 0
    for model, rec in sorted(by_model.items()):
        det = detail_of(rec['id'])
        if det:
            detail_hit += 1
        cid = rec['cid']
        if cid in LIGHT_MAP:
            LIGHT.append(make_light(rec, det))
        elif cid in CTRL_MODE:
            CTRL.append(make_ctrl(rec, det))
        elif cid in LENS_CIDS:
            LENS.append(make_lens(rec, det))
        elif cid in TELE_CIDS:
            TELE.append(make_tele(rec, det))
        else:
            MISC.append(cmpact({'model': model, 'group': rec['cat'],
                                'source': 'cstmv.com /show/' + rec['id']}))

    for model, rec in sorted(misc.items()):
        MISC.append(cmpact({'model': model, 'group': rec['cat'] or '非标产品',
                            'source': 'cstmv.com /show/' + rec['id']}))

    # 系列汇总表：相机 / 远心（型号可能与分类页重叠，按 model 去重）
    tele_seen = {d['model'] for d in TELE}
    cam_seen, line_seen = set(), set()
    for sid, v in series.items():
        if not v['series']:
            continue
        for tab in v['series']:
            head = tab[0]
            for row in tab[1:]:
                if sid in ('1650', '1654'):
                    d = tele_from_series(row, head, v['name'])
                    if d and d['model'] not in tele_seen:
                        TELE.append(d)
                        tele_seen.add(d['model'])
                elif sid == '1652':
                    for d in camera_from_series(row, head, v['name'], True):
                        if d['model'] not in line_seen:
                            LINE.append(d)
                            line_seen.add(d['model'])
                elif sid in ('1641', '1651', '1653'):
                    nm = v['name'] + ('（代理）' if sid == '1653' else '')
                    for d in camera_from_series(row, head, nm, False):
                        if d['model'] not in cam_seen:
                            CAM.append(d)
                            cam_seen.add(d['model'])

    # 型号归一差集校验：与现有五品牌在售型录比
    existing = set()
    for f in os.listdir('js'):
        if not f.endswith('-catalog.js') or f.startswith('cst-') or f == 'retired-catalog.js':
            continue
        s = io.open(os.path.join('js', f), encoding='utf-8', errors='replace').read()
        for m in re.finditer(r'"model"\s*:\s*"([^"]+)"', s):
            existing.add(re.sub(r'\s+', '', m.group(1)).upper())
    overlap = sorted({d['model'] for d in CAM + LINE + LENS + TELE + LIGHT + CTRL}
                     & existing)

    # ---------------------------------------------------------- 补充型号
    # 归一差集：只在型号确实不存在时才补，避免覆盖官网抓到的原始记录。
    def norm(m):
        return re.sub(r'\s+', '', m or '').upper()

    seen = {norm(d['model']) for d in LIGHT}
    added_derived, added_extra = 0, 0

    if IR850_DERIVE:
        for src in list(LIGHT):
            m = src.get('model', '')
            if 'IR940' not in m:
                continue
            target = m.replace('IR940', 'IR850')
            key = norm(target)
            if key in seen or key in existing:
                continue
            d = dict(src)                       # 规格逐字段复制，不改任何数值
            d['model'] = target
            if d.get('name'):
                d['name'] = d['name'].replace('IR940', 'IR850')
            d['note'] = (src.get('note', '') + '；' if src.get('note') else '') + \
                        '850nm 定制波长变体（官网注明波长可定制 850 / 940），规格同 ' + m
            LIGHT.append(d)
            seen.add(key)
            added_derived += 1

    for extra in EXTRA_LIGHTS:
        key = norm(extra['model'])
        if key in seen or key in existing:
            continue
        d = cmpact({
            'model': extra['model'], 'type': extra.get('type'), 'color': extra.get('color'),
            'size': extra.get('size'), 'power': extra.get('power'),
            'wavelength': extra.get('wavelength'),
            'series': extra['series'], 'group': extra['group'],
            'name': extra['group'] + ' ' + extra['model'],
            'note': extra.get('note'),
        })
        LIGHT.append(d)
        seen.add(key)
        added_extra += 1

    LIGHT.sort(key=lambda d: d['model'])        # 保持按型号排序，diff 只有新增行

    meta = {
        'source': '康视达官网 cstmv.com（产品中心分类页 + 单品参数页 + 系列型号表）'
                  '；红外 850nm 变体按官网「波长可定制 850 / 940」同规格派生，另含用户补充型号',
        'brand': '康视达 CST', 'generated': TODAY,
        'cameras': len(CAM), 'linescan': len(LINE), 'lenses': len(LENS),
        'telecentric': len(TELE), 'lights': len(LIGHT), 'controllers': len(CTRL),
    }
    write_umd('js/cst-catalog.js', 'CstCatalog', meta,
              [('CAMERAS', CAM), ('LINESCAN', LINE), ('LENSES', LENS),
               ('TELECENTRIC', TELE), ('LIGHTS', LIGHT), ('CONTROLLERS', CTRL)],
              '康视达（CST）在售产品库：面阵 / 线阵相机、工业镜头、远心镜头、光源与控制器。\n'
              '生成脚本：tools/fetch-cst.py → tools/build-cst-catalog.py。本文件由脚本生成，请勿手工编辑。\n'
              '说明：六品牌统一加载；面阵相机官网未给卡口，由 selection-catalog.js 的必要参数门槛挡在选型链外，其余类目正常参与。\n'
              '补充：红外 -IR850 为官网注明「波长可定制 850 / 940」的同规格派生变体（带备注）；'
              '用户补充型号未公布规格的字段留空。')
    write_umd('js/cst-misc-catalog.js', 'CstMiscCatalog',
              {'source': '康视达官网 非标产品 / 其它未归入 9 类页签的产品',
               'brand': '康视达 CST', 'generated': TODAY, 'misc': len(MISC)},
              [('MISC', MISC)],
              '康视达非标与其它产品线：按项目约定只落盘、不挂任何页面。')

    report = {
        'generated': TODAY, 'meta': meta, 'misc': len(MISC),
        'detailPagesHit': detail_hit, 'classifiedProducts': len(by_model),
        'overlapWithExisting': overlap,
        'addedIR850Variants': added_derived, 'addedExtraLights': added_extra,
        'typeCount': dict(collections.Counter(d.get('type') for d in LIGHT)),
        'seriesTele': sum(1 for sid in ('1650', '1654') if sid in series),
    }
    io.open(os.path.join(ROOT, 'build-report.json'), 'w', encoding='utf-8', newline='\n').write(
        json.dumps(report, ensure_ascii=False, indent=1))
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print('\n样例：')
    for k, arr in [('CAMERAS', CAM), ('LINESCAN', LINE), ('LENSES', LENS),
                   ('TELECENTRIC', TELE), ('LIGHTS', LIGHT), ('CONTROLLERS', CTRL)]:
        print(' ', k, json.dumps(arr[0], ensure_ascii=False)[:300] if arr else '(空)')


def write_umd(path, global_name, meta, arrays, comment):
    def js(v):
        return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    lines = ['/**', *[' * ' + x for x in comment.split('\n')], ' */',
             '(function (root, factory) {',
             "  if (typeof module === 'object' && module.exports) module.exports = factory();",
             f'  else root.{global_name} = factory();',
             "})(typeof self !== 'undefined' ? self : this, function () {",
             "  'use strict';",
             '  var META = ' + js(meta) + ';']
    for name, arr in arrays:
        lines.append(f'  var {name} = [')
        for i, d in enumerate(arr):
            lines.append('    ' + js(d) + (',' if i < len(arr) - 1 else ''))
        lines.append('  ];')
    lines.append('  return { META: META, ' +
                 ', '.join(f'{n}: {n}' for n, _ in arrays) + ' };')
    lines.append('});')
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    print(f'写出 {path}  ({os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()
