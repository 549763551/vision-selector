# -*- coding: utf-8 -*-
"""从 tools/_cache/daheng_lenses_full.json（tools/parse-daheng-lenses-all.py 输出）中
筛出「可验证 + 可用于选型」的条目，写出 gen-daheng-catalog.py 读取的两个文件：

  tools/_cache/daheng_lenses.json  = 原 HN/HN-P 基础表 + 通过验证的定焦镜头
  tools/_cache/daheng_tele.json    = 通过验证的远心 + TCEL 液态远心（接口取官网）

入选条件（宁缺毋滥，卡口猜错会推荐装不上的镜头）：
  1. 型号能在《大恒镜头产品型录》文本行里定位（tools/_cache/大恒镜头产品型录.txt）；
  2. 该行其后 11 行内能同时找到焦距/倍率、工作距离与卡口字样 —— 即手册原文有据可查；
  3. 字段齐全：镜头要 focal+mount+minDist，远心要 magMin+wdMin+wdMax+mount。

倍率补录（recover_mag）：FT / TL / TEC-V 系列的「倍率」列在手册里印成「0.5×」「6.0X」这种
带乘号的单元格，解析脚本的正则没认出来，导致 80 条远心 magMin 为空、完全无法参与选型。
本脚本从手册行窗口里按「整行只有一个数字 + ×/X/倍」严格识别倍率，且要求：
  · 窗口内只出现唯一一个这样的值（多个则说明是变焦/多档表，放弃）；
  · 卡口字样仍在窗口内可验证。
恢复出的倍率与型号命名自洽（FT05→0.5×、TL80→8.0×、TEC-V10110→1.0×），共 71 条入选。
远心 WD 取手册单值（定焦远心的工作距离本就是固定值），故 wdMin == wdMax。

焦距校验（FOV 反算）：MPW2-R 系列手册表格里有一列恒为「8」的单元格被解析器当成了焦距，
于是 M1224 / M1620 / M2518 / M3520 / M5028 全部被记成 8mm —— 真会把 12mm 的镜头推荐成 8mm。
手册同行的「视场角(H×V°)」是独立证据：f = 靶面宽 / (2·tan(H/2))。据此规则：
  · 解析焦距与反算值相差 ≤8% → 采用解析值；
  · 否则若型号名里的焦距段（M1224→12）与反算值相差 ≤8% → 采用型号名并记 focal_from；
  · 两者都不符 → 该行不入库；无反算依据（无视场角列或靶面尺寸表里没有）时沿用原校验规则。
靶面宽只收录手册里出现且与标准光学期片规格一致的尺寸，表里没有的一律不做反算，避免臆造。
反算公式只对水平视场角 ≤60° 的镜头可靠（广角/鱼眼畸变率手册里给到 -28%，针孔公式本身就对不上），
视场角大于 60° 的行仍以手册「焦距」列为准，不据此改判、也不据此剔除。

已知不入库的情况：
  · 手册里以「-□」结尾的家族模板行（BTL25WC2-□、LSTL05TC-□、LSTL10YC-□）：
    行内接口写作 M86×1.0 等，正则容易把 F6.6 误判成卡口 → 验证不过，丢弃。
  · ELM-T 表格（TCEL 系列 8 条）手册没印「接口」列 → 按 Opto Engineering 官网系列页
    补 mount=C：https://www.opto-e.cn/%E7%94%A2%E5%93%81/tcel-series
    其中 TCEL100 手册工作距离 107~124 mm 与官网 118~142 mm 不一致，取官网值。
  · 手册未印焦距的放大/变焦镜头（Rodagon、inspec.x、LM/M 系列的图页行）不参与选型，本脚本按条件 3 自动排除。

用法：python tools/curate-daheng-lenses.py
"""
import importlib.util
import json
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '_cache')
TXT = os.path.join(CACHE, '大恒镜头产品型录.txt')
SRC = os.path.join(CACHE, 'daheng_lenses_full.json')
BASE = os.path.join(CACHE, 'daheng_lenses_base.json')
LENS_OUT = os.path.join(CACHE, 'daheng_lenses.json')
TELE_OUT = os.path.join(CACHE, 'daheng_tele.json')

OPTO_TCEL = 'https://www.opto-e.cn/%E7%94%A2%E5%93%81/tcel-series'
# 解析脚本沿用英文词，展示层（library.html 的「类型」列）与其他品牌统一用中文
TELE_KIND = {'tele': '远心', 'bi-tele': '双远心', '双远心': '双远心', '远心': '远心'}
# 型号 -> (倍率, WD 下限, WD 上限, 靶面)：接口官网统一 C
TCEL = [
    ('TCEL23036', 0.243, 73.2, 122.9, '2/3"'),
    ('TCEL050', 0.50, 112.2, 146.3, '2/3"'),
    ('TCEL066', 0.67, 112.3, 146.1, '2/3"'),
    ('TCEL075', 0.75, 112.5, 146.1, '2/3"'),
    ('TCEL100', 1.00, 118.0, 142.0, '2/3"'),
    ('TCEL150', 1.50, 118.0, 142.0, '2/3"'),
    ('TCEL250', 2.50, 117.9, 142.1, '2/3"'),
    ('TCEL350', 3.50, 117.9, 142.1, '2/3"'),
]


def load_lines():
    # 手册 PDF 抽取出来的文本里，靶面英寸号混用了右引号 ”（ELM-F 表整列如此）；
    # 统一成直引号，否则「1/1.8”」这类靶面永远匹配不上。
    raw = open(TXT, encoding='utf-8').read().replace(u'”', '"').replace(u'“', '"')
    lines = [l.strip() for l in raw.splitlines()]
    idx = {}
    for i, l in enumerate(lines):
        if l:
            idx.setdefault(l.upper().replace(' ', ''), []).append(i)
    return lines, idx


def row_of(lines, idx, model):
    hit = idx.get(str(model).upper().replace(' ', ''))
    if not hit:
        return None
    return ' | '.join(lines[hit[0] + 1:hit[0] + 12])


def has_mount(row, mount):
    return re.search(r'(?<![A-Za-z0-9])%s(?![\d.])' % re.escape(str(mount)), row) is not None


def g(v):
    return '%g' % v


# 手册「倍率」列的单元格形态：整行只有一个数值 + 乘号（0.5× / 6.0X / 1.0倍）
MAG_CELL = re.compile(r'^(\d{1,2}(?:\.\d+)?)[×X倍]$')
# 手册「靶面/尺寸」列的单元格形态：2/3"、1/1.8"、4/3"、1.1"、1"（英寸号已由 load_lines 统一）
FMT_CELL = re.compile(r'^\d+(?:/\d+(?:\.\d+)?)?(?:\.\d+)?"$')


def recover_mag(lines, idx, model):
    """从手册行窗口严格恢复倍率；窗口内出现 0 个或多个候选值则返回 None。"""
    hit = idx.get(str(model).upper().replace(' ', ''))
    if not hit:
        return None
    vals = set()
    for l in lines[hit[0] + 1:hit[0] + 12]:
        m = MAG_CELL.match(l)
        if m:
            vals.add(float(m.group(1)))
    return vals.pop() if len(vals) == 1 else None


def recover_fmt(lines, idx, models, model):
    """从手册行窗口恢复靶面（远心/镜头表的「尺寸」列）；出现多个不同值则放弃，避免猜错。
    手册里「靶面 焦距」常排在同一行（ELM-F 表），所以整行不匹配时再按空格拆一次词；
    窗口必须停在下一条型号行，否则会读到相邻行的靶面而误判为不唯一。"""
    vals = set()
    for l in row_lines(lines, idx, models, model):
        for tok in [l] + l.split():
            if FMT_CELL.match(tok):
                vals.add(tok)
    return vals.pop() if len(vals) == 1 else None


# 像面直径必须与解析脚本用同一张表，否则同一次入库里会出现两种口径
PARSE_SPEC = importlib.util.spec_from_file_location(
    'daheng_lens_parser', os.path.join(ROOT, 'tools', 'parse-daheng-lenses-all.py'))
PARSE = importlib.util.module_from_spec(PARSE_SPEC)
PARSE_SPEC.loader.exec_module(PARSE)


def apply_fmt(r, val):
    """补录靶面标签，并顺带补像面直径：引擎要求镜头像面覆盖相机靶面，缺 ic 就无从校验。"""
    if not val:
        return False
    r['fmt'] = val
    if r.get('ic') is None:
        parsed = PARSE.parse_fmt(val)
        if parsed and parsed[1] is not None:
            r['ic'] = parsed[1]
    return True


def row_cells(lines, idx, model, n=12):
    hit = idx.get(str(model).upper().replace(' ', ''))
    return lines[hit[0] + 1:hit[0] + 1 + n] if hit else []


# ---------------------------------------------------------------- 行窗口补录
# 上游解析按坐标建列，手册表头里的「工作距离(mm)」标签常落在校列窗口之外（ELM-F、
# TEC-M 200 万像素、BV-L 三张表都因此整列丢失），数据本身仍在手册行里，所以在这里
# 按「型号行到下一条型号行」的手册单元格补录；窗口内候选不唯一即放弃。
# 变焦镜头的焦距列印成「5.5-」「6.6-」这种后半截被截断的区间，单值 focal 本就无法表达，
# 见到即整行放弃。（注意不能写成 `N-M`：工作距离列的「90-1000」也是这个形状。）
ZOOM_RANGE = re.compile(r'^\d+(?:\.\d+)?[-~]$')
APER_HEAD = re.compile(r'^[Ff]\d')
# 「N-∞」「N1-N2」取下限作为最小摄距；单位省略时按表头 mm 处理
WD_INF = re.compile(r'^(\d{1,4}(?:\.\d+)?)(mm|m)?[-~—](?:∞|inf|无限远)')
WD_PAIR = re.compile(r'^(\d{1,4}(?:\.\d+)?)(mm|m)?[-~—](\d{1,4}(?:\.\d+)?)$')
# BV 的「最小工作距离(mm)」列单独印一个整数，只有紧跟在光圈格之后才认
WD_BARE = re.compile(r'^\d{2,4}$')
# 远心工作距离：手册印成 110 / 110.5 这样的裸数字（畸变率都是带符号的小数，天然排除）
TELE_WD = re.compile(r'^\d{2,4}(?:\.\d+)?$')


def row_lines(lines, idx, models, model, limit=12):
    """型号行之后、下一条型号行之前的手册原始行（保留空格）。"""
    hit = idx.get(str(model).upper().replace(' ', ''))
    if not hit:
        return []
    out = []
    for l in lines[hit[0] + 1:hit[0] + 1 + limit]:
        if l.upper().replace(' ', '') in models:
            break
        if l:
            out.append(l)
    return out


def row_window(all_lines, idx, models, model, limit=12):
    """同 row_lines，但去掉空格并统一大写（手册把「工作距离 接口」挤在一行时要先粘回一格）。"""
    out = []
    for l in row_lines(all_lines, idx, models, model, limit):
        key = l.upper().replace(' ', '')
        out.append(key if l.isascii() else l.replace(' ', ''))
    return out


def recover_mindist(cells, focal):
    """镜头最小摄距（米）：工作距离列的下限；候选不唯一或行是变焦区间则返回 None。"""
    if any(ZOOM_RANGE.match(c) for c in cells):
        return None
    vals = set()
    seen_aper = False
    for c in cells:
        m = WD_INF.match(c)
        if m:
            v = float(m.group(1))
            vals.add(round(v if m.group(2) == 'm' else v / 1000.0, 4))
            seen_aper = seen_aper or bool(APER_HEAD.match(c))
            continue
        m = WD_PAIR.match(c)
        if m:
            a, b = float(m.group(1)), float(m.group(3))
            if a >= 20 and b > a and abs(a - focal) > 1e-6 and abs(b - focal) > 1e-6:
                vals.add(round(a / 1000.0, 4))
            continue
        if WD_BARE.match(c):
            v = float(c)
            # 页脚页码也是裸整数（BV 的 C 口表只有型号/焦距/接口），只认光圈格之后那一列
            if seen_aper and v >= 50 and abs(v - focal) > 1e-6:
                vals.add(round(v / 1000.0, 4))
            continue
        if APER_HEAD.match(c):
            seen_aper = True
    return vals.pop() if len(vals) == 1 else None


def recover_wd(cells):
    """远心工作距离（毫米）：窗口内唯一的裸数字才认，多个候选说明读到了别列/别行。"""
    vals = {float(c) for c in cells if TELE_WD.match(c) and 20.0 <= float(c) <= 2000.0}
    return vals.pop() if len(vals) == 1 else None


# Blue Vision 的 C 口表（手册脚注「M52 口转C 口」）只印型号/焦距/接口，
# 光学与同焦距的 M52/F 口款完全一致，最小摄距按同族款补齐。
BV_SIBLING = re.compile(r'^BV-L1(\d{3})(-SWIR)?-C$')


def bv_sibling_model(model):
    """C 口款对应的同族型号候选（可见光款印作 -M/F，短波红外款印作 -SWIR-M）。"""
    m = BV_SIBLING.match(str(model))
    if not m:
        return []
    stem = 'BV-L1%s%s' % (m.group(1), m.group(2) or '')
    return [stem + s for s in ('-M/F', '-M', '-F')]


def bv_inherit(r, by_model, lines, idx, models):
    """BV 的 C 口表只印型号/焦距/接口三列（手册注明「M52 口转C 口」）：
    靶面、像面、光圈、最小摄距都按同焦距的 M52/F 款补；同族款读不到工作距离就放弃。"""
    for key in bv_sibling_model(r['model']):
        s = by_model.get(str(key).upper().replace(' ', ''))
        if not s or s.get('focal') != r.get('focal'):
            continue
        md = s.get('minDist')
        if md is None:
            md = recover_mindist(row_window(lines, idx, models, s['model']), s.get('focal'))
        if md is None:
            continue
        if r.get('fmt') is None:
            r['fmt'] = s.get('fmt')
        if r.get('ic') is None:
            r['ic'] = s.get('ic')
        if r.get('fmin') is None and s.get('fmin') is not None:
            r['fmin'], r['fmax'] = s['fmin'], s.get('fmax')
        r['minDist'] = md
        return True
    return False


# 手册对广角/防水系列只印「可选光圈档位」（F2.8/F4/F8/F16），不是连续范围；
# 这类行上游解析器不认，于是整格丢了光圈。换行时档位还会拆在两行（F1.4/F2.8/ + F4/F8）。
APER_CELL = re.compile(r'^F\d+(?:\.\d+)?(?:/F\d+(?:\.\d+)?){1,}/?$')


def recover_aperture(cells):
    """从手册行窗口恢复离散光圈档位，返回 (fmin, fmax)；连续范围与缺失返回 None。"""
    norm = [c.replace(' ', '') for c in cells]
    # 先试「两行合并」，档位常被断行切成 F1.4/F2.8/ + F4/F8，只取半截会漏掉收得最小的那档
    cands = [norm[i] + norm[i + 1] for i in range(len(norm) - 1)] + norm
    for t in cands:
        if not APER_CELL.match(t):
            continue
        vals = [float(v) for v in re.findall(r'\d+(?:\.\d+)?', t.replace('F', ' '))]
        if vals and 0.5 <= min(vals) <= max(vals) <= 64:
            return min(vals), max(vals)
    return None


# 手册「视场角(H×V°)」单元格；比例约束用来排除「尺寸(D×L)」这类同样带 × 的单元格
FOV_CELL = re.compile(r'^(\d{1,3}(?:\.\d+)?)×(\d{1,3}(?:\.\d+)?)$')
# 标准光学靶面的水平像面宽（mm，4:3 系列）；表里没有的尺寸不做反算
FMT_WIDTH = {
    '1/3.6"': 3.6, '1/3.2"': 4.5, '1/3"': 4.8, '1/2.9"': 4.96, '1/2.8"': 5.04,
    '1/2.7"': 5.32, '1/2.6"': 5.5, '1/2.5"': 5.76, '1/2.3"': 6.3, '1/2"': 6.4,
    '1/1.9"': 6.6, '1/1.8"': 7.2, '1/1.7"': 7.4, '1/1.6"': 8.0, '1/1.2"': 9.0,
    '1/1.3"': 9.8, '2/3"': 8.8, '1"': 12.8, '1.1"': 14.4, '4/3"': 18.0,
}


def focal_from_fov(cells):
    """按视场角反算焦距，返回 (焦距, 水平视场角)；无可用视场角单元格返回 None。

    只认 4:3 比例的角度对，排除同样带 × 的「尺寸(D×L)」列。
    """
    for c in cells:
        m = FOV_CELL.match(c)
        if not m:
            continue
        h, v = float(m.group(1)), float(m.group(2))
        if not (0 < h < 180) or not (0.65 <= v / h <= 0.9):
            continue
        fmt = next((x for x in cells if FMT_CELL.match(x) and x in FMT_WIDTH), None)
        if not fmt:
            return None
        return FMT_WIDTH[fmt] / (2 * math.tan(math.radians(h / 2))), h
    return None


# 针孔公式 f = w / (2·tan(H/2)) 只对中低视场角可靠；广角/鱼眼畸变大（手册畸变率可达 -28%），
# 反算值与手册「焦距」列本就对不上，此时以手册列为准，不做改判也不据此剔除。
FOV_TRUST_DEG = 60.0


# 型号里的「焦距+光圈」四位编码：M1224→12mm、HN1614→16mm、HF0814→8mm
NAME_FOCAL = re.compile(r'(?:^|[^0-9])(\d{2})\d{2}(?:[^0-9]|$)')


def name_focal(model):
    m = NAME_FOCAL.search(str(model))
    return int(m.group(1)) if m else None


def near(a, b, tol=0.08):
    return a is not None and b is not None and abs(a - b) / b <= tol


# 电动调焦（液态）与线阵大像面镜头虽然焦距、卡口可以和普通定焦完全一致，
# 但光学设计、像面和价位都不同，不能互相当「同规格可替换」——用 lensKind 把它们分开。
def lens_kind(model, series):
    m = str(model).upper()
    if m.startswith('ELM'):
        return u'电动调焦'
    if m.startswith('BV-L') or u'线扫' in str(series or u''):
        return u'线扫'
    return None


def tag_kind(r):
    k = lens_kind(r.get('model'), r.get('series'))
    if k:
        r['lensKind'] = k
    return r


# 手册 HN-P 线扫表把 -H 行只印成「16K」（其余参数与同焦距 -L 行合并单元格印刷），
# 即同一支镜头的 16K 线阵版本 → 光学参数沿用 -L，型号独立入库便于按 16K 相机配镜头。
LINESCAN_H = [('HN-P-4040-H', 'HN-P-4040-L'),
              ('HN-P-6040-H', 'HN-P-6040-L'),
              ('HN-P-8040-H', 'HN-P-8040-L')]


def main():
    lines, idx = load_lines()
    full = json.load(open(SRC, encoding='utf-8'))
    base = json.load(open(BASE, encoding='utf-8'))
    lens_rows = full.get('lenses') or []
    tele_rows = full.get('tele') or []

    # 行窗口要停在「下一条型号行」，否则会读到相邻行的工作距离；这里用三处型号并集作分界。
    models = set(str(r['model']).upper().replace(' ', '') for r in lens_rows + tele_rows)
    models |= set(str(x['model']).upper().replace(' ', '') for x in base)
    by_model = {}
    for r in lens_rows:
        by_model.setdefault(str(r['model']).upper().replace(' ', ''), r)

    # ---- 定焦镜头 ----
    lenses = [tag_kind(dict(x)) for x in base]
    have = {str(x['model']).upper().replace(' ', '') for x in lenses}
    lens_ok = lens_skip = lens_incomplete = focal_fixed = fmt_filled = aper_filled = 0
    mindist_filled = mount_filled = 0
    deferred = []
    for r in lens_rows:
        if not r.get('focal'):
            lens_incomplete += 1
            continue
        mo = str(r['model']).upper().replace(' ', '')
        cells = row_cells(lines, idx, r['model'])
        row = ' | '.join(cells)
        if mo in have or not cells or g(r['focal']) not in row:
            lens_skip += 1
            continue
        # BV 的「C 口镜头」表只印型号/焦距/接口三列，接口列甚至没被解析出来；
        # 手册注明「M52 口转C 口」，光学与同焦距 M52/F 款同格印刷，故按同族款补齐。
        if not r.get('mount'):
            if not bv_inherit(r, by_model, lines, idx, models) or not has_mount(row, 'C'):
                lens_incomplete += 1
                continue
            r['mount'] = 'C'
            r['mount_from'] = u'手册 C 口表（注明 M52 口转 C 口），靶面与最小摄距取同焦距 M52/F 款'
            mount_filled += 1
        if not has_mount(row, r['mount']):
            lens_skip += 1
            continue
        # 焦距二次校验：解析值与「视场角反算」不符时退回型号名标称，两者都不符则不入库
        fov = focal_from_fov(cells)
        if fov and fov[1] <= FOV_TRUST_DEG:
            f_fov = fov[0]
            if not near(r['focal'], f_fov):
                nf = name_focal(r['model'])
                if not near(nf, f_fov):
                    lens_skip += 1
                    continue
                r['focal'] = float(nf)
                r['focal_from'] = u'视场角反算校核后取型号标称焦距'
                focal_fixed += 1
        if not r.get('fmt'):
            if apply_fmt(r, recover_fmt(lines, idx, models, r['model'])):
                fmt_filled += 1
        if not r.get('fmin'):
            ap = recover_aperture(cells[:9])
            if ap:
                r['fmin'], r['fmax'] = ap
                r['aper_from'] = u'手册光圈档位恢复（离散档，非连续范围）'
                aper_filled += 1
        if r.get('minDist') is None:
            md = recover_mindist(row_window(lines, idx, models, r['model']), r['focal'])
            if md is None:
                deferred.append(r)      # 同族其它接口款可能还没处理到，第二遍再补
                continue
            r['minDist'] = md
            r['mindist_from'] = u'手册工作距离列下限补录'
            mindist_filled += 1
        have.add(mo)
        lenses.append(tag_kind(r))
        lens_ok += 1

    # 第二遍：本行窗口读不到工作距离的（BV 的 C 口表整列没印），按同族款补
    still = []
    for r in deferred:
        if not bv_inherit(r, by_model, lines, idx, models):
            still.append(r)
            continue
        r['mindist_from'] = u'同族其它接口款同格印刷的最小工作距离'
        mindist_filled += 1
        have.add(str(r['model']).upper().replace(' ', ''))
        lenses.append(tag_kind(r))
        lens_ok += 1
    lens_incomplete += len(still)

    # 线扫 -H（16K）版本：手册与 -L 同格印刷，直接从已入库的 -L 记录派生
    for h, l in LINESCAN_H:
        src = next((x for x in lenses if str(x['model']) == l), None)
        if not src or h.upper() in have:
            continue
        rec = dict(src)
        rec['model'] = h
        rec['note'] = u'16K 线阵版本，光学与 %s 同格印刷' % l
        have.add(h.upper())
        lenses.append(tag_kind(rec))

    # ---- 远心 ----
    tele = []
    seen = set()
    tele_ok = tele_skip = tele_incomplete = mag_recovered = fmt_recovered = wd_recovered = 0
    for r in tele_rows:
        if r.get('magMin') is None and r.get('wdMin') is not None and r.get('wdMax') is not None and r.get('mount'):
            mag = recover_mag(lines, idx, r['model'])
            if mag is not None:
                r['magMin'] = r['magMax'] = mag
                r['mag_from'] = u'手册倍率列严格恢复'
                mag_recovered += 1
        if r.get('wdMin') is None and r.get('mount'):
            wd = recover_wd(row_window(lines, idx, models, r['model']))
            if wd is not None:
                r['wdMin'] = r['wdMax'] = wd
                r['wd_from'] = u'手册工作距离列单值补录'
                wd_recovered += 1
        if not (r.get('magMin') is not None and r.get('wdMin') is not None and r.get('wdMax') is not None and r.get('mount')):
            tele_incomplete += 1
            continue
        mo = str(r['model']).upper().replace(' ', '')
        row = row_of(lines, idx, r['model'])
        good = (row is not None and g(r['magMin']) in row
                and g(r['wdMin']) in row and g(r['wdMax']) in row
                and has_mount(row, r['mount']))
        if mo in seen or not good:
            tele_skip += 1
            continue
        seen.add(mo)
        r['kind'] = TELE_KIND.get(str(r.get('kind') or '远心'), '远心')
        if not r.get('fmt'):
            if apply_fmt(r, recover_fmt(lines, idx, models, r['model'])):
                fmt_recovered += 1
        tele.append(r)
        tele_ok += 1
    for m, mag, lo, hi, fmt in TCEL:
        if m.upper() in seen:
            continue
        tele.append({'series': 'TCEL 系列（液态远心）', 'model': m, 'brand': '大恒图像',
                     'magMin': mag, 'magMax': mag, 'wdMin': lo, 'wdMax': hi,
                     'fmt': fmt, 'mount': 'C', 'coax': False, 'kind': '远心', 'src': OPTO_TCEL})
        seen.add(m.upper())

    json.dump(lenses, open(LENS_OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(tele, open(TELE_OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(u'镜头：基础 %d + 手册验证通过 %d（焦距改判 %d、靶面补录 %d、光圈档位补录 %d、'
          u'最小摄距补录 %d、C 口表按同族补齐 %d）= %d（验证未过/重名 %d，字段缺失 %d）'
          % (len(base), lens_ok, focal_fixed, fmt_filled, aper_filled, mindist_filled,
             mount_filled, len(lenses), lens_skip, lens_incomplete))
    print(u'远心：手册验证通过 %d（含倍率补录 %d、靶面补录 %d、工作距离补录 %d）+ 官网补接口 %d = %d（验证未过/重名 %d，字段缺失 %d）'
          % (tele_ok, mag_recovered, fmt_recovered, wd_recovered, len(TCEL), len(tele), tele_skip, tele_incomplete))


if __name__ == '__main__':
    main()
