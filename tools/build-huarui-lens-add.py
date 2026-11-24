# -*- coding: utf-8 -*-
r"""华睿官网镜头增量：把 tools/_cache/huarui/huarui_lens.json 整理成型录条目。

与 huarui-catalog.js 现有 63 支比对，只输出**新增**型号（22 款：面阵 3 + 线阵及大面阵 3 + 远心 16）。
字段口径对齐库里既有条目：
  定焦镜头 → LENSES：model/series/focal/fmin/fmax/mount/ic/fmt/minDist
  远心镜头 → TELECENTRIC：model/series/group/mount/ic/mag/magMin/magMax/wdMin/resUm/fmt/kind

官网接口给的列（item 的 id 键）：面阵 14~18 / 线阵 19~23 / 远心 24~29，
名称由样例值 + 官网列序推得（倍率 / 像面 / 工作距离 / F 数 / 分辨力 / 接口）。

产物：tools/_cache/huarui_lens_add.json（人工过一遍再落库）
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(HERE, '_cache', 'huarui', 'huarui_lens.json')
OUT = os.path.join(HERE, '_cache', 'huarui_lens_add.json')

# 子类 → 字段含义（按 item 的键顺序）
FIELDS = {
    '122': ['focal', 'aperture', 'sensor', 'focus', 'mount'],                      # 面阵镜头
    '187': ['focal', 'aperture', 'sensor', 'focus', 'mount'],                      # 线阵及大面阵
    '188': ['mag', 'sensor', 'wd', 'fnum', 'res', 'mount'],                        # 远心
}


def num(s, default=None):
    if s is None:
        return default
    m = re.search(r'-?\d+(?:\.\d+)?', str(s).replace(',', ''))
    return float(m.group(0)) if m else default


def mount_of(s):
    if not s:
        return None
    t = str(s).upper()
    if 'M72' in t:
        return 'M72'
    if 'M58' in t:
        return 'M58'
    if 'M42' in t:
        return 'M42'
    if 'M25' in t:
        return 'M25'
    if t.startswith('F') or 'F接口' in str(s):
        return 'F'
    if 'C' in t:
        return 'C'
    return None


def sensor_of(s, prefer_inch=True):
    """像面尺寸：返回 (ic 毫米, fmt 显示用)。
    写法有三种：「Ф9mm(1/1.8")」、「φ11mm」、「1.1\'\' (φ17.6mm）」——
    「1.1''」是英寸写法，直接取数字会得到 1.1，所以优先抓 Ø/φ 后面的 mm 值。"""
    if not s:
        return None, None
    t = str(s).replace('Ф', 'Ø').replace('φ', 'Ø')
    mm = None
    m = re.search(r'Ø\s*(\d+(?:\.\d+)?)\s*mm', t)
    if m:
        mm = float(m.group(1))
    else:
        mm = num(t)
    inch = re.search(r'(\d+(?:\.\d+)?/\d+(?:\.\d+)?)\s*["”\']', t) or re.search(r"(\d+(?:\.\d+)?)\s*''", t)
    if prefer_inch and inch and 'Ø' not in t.split(inch.group(0))[0][-3:]:
        return mm, inch.group(1) + '"'
    if mm:
        return mm, 'Ø%s mm' % ('%g' % mm)
    return None, None


def focus_min(s):
    """「0.1m to infinite」/「0.3 m to 2.2 m」→ 最近对焦距离（米）"""
    if not s:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*m', str(s))
    return float(m.group(1)) if m else None


def fnum_ok(s):
    """F 数校验：官网个别行把倍率填进了 F 数（MTL17-22005X-C 写成 0.5X），
    真实 F 数在 1.4~32，超出范围就置空，不把错值带进库。"""
    v = num(s)
    if v is None or v < 1.4 or v > 32:
        return None
    return v


def build():
    rows = json.load(io.open(SITE, encoding='utf-8'))
    out = []
    for r in rows:
        keys = FIELDS[r['navId']]
        it = r['raw_item'] or {}
        vals = {}
        for i, k in enumerate(keys):
            vals[k] = it.get(str(int(r['navId']) and 0) or '')  # 占位，下面按序取
        # 按 item 的键顺序取值（接口返回的键就是 14/15/... 递增）
        ordered = [it[k] for k in sorted(it.keys(), key=lambda x: int(x))]
        for i, k in enumerate(keys):
            vals[k] = ordered[i] if i < len(ordered) else None

        if r['navId'] == '188':
            ic, fmt = sensor_of(vals['sensor'], prefer_inch=False)
            mag = num(vals['mag'])
            mtl = re.match(r'MTL(\d+)-', r['model'])
            fam = 'MTL%s' % mtl.group(1) if mtl else 'MTL'
            label = {'MTL11': 'MTL11 远心（Ø11）', 'MTL16': 'MTL16 远心（Ø16.2）',
                     'MTL17': 'MTL17 远心（Ø17.6）'}.get(fam, 'MTL 远心')
            rec = {
                'model': r['model'], 'brand': '华睿', 'series': label, 'group': '远心镜头',
                'kind': '远心',
                'mount': mount_of(vals['mount']),
                'ic': ic, 'fmt': fmt,
                'mag': mag, 'magMin': mag, 'magMax': mag,
                'wdMin': num(vals['wd']), 'wdMax': num(vals['wd']),
                'fmin': fnum_ok(vals['fnum']), 'fmax': fnum_ok(vals['fnum']),
                'resUm': num(vals['res']),
                'coax': r['model'].endswith('XD-C'),
            }
            if not it:
                rec['note'] = '官网型号表未给参数，仅收录型号'
            out.append(rec)
        else:
            series = r['sub']
            if r['navId'] == '122':
                # MH0420S / MH1620S / MH7528S → 官网新上的 F2.0 大光圈 S 系列（区别于既有 MH-SP）
                series = 'MH-S 系列' if re.match(r'^MH\d', r['model']) else r['sub']
            elif r['navId'] == '187':
                series = '线扫&大靶面镜头'
            ic, fmt = sensor_of(vals['sensor'])
            fmin = None
            fmax = None
            ap = str(vals['aperture'] or '')
            fs = re.findall(r'F?\s*(\d+(?:\.\d+)?)', ap)
            if fs:
                fmin = float(fs[0])
                if len(fs) > 1:
                    fmax = float(fs[1])
            out.append({
                'model': r['model'], 'brand': '华睿', 'series': series,
                'focal': num(vals['focal']),
                'fmin': fmin, 'fmax': fmax,
                'mount': mount_of(vals['mount']),
                'ic': ic, 'fmt': fmt,
                'minDist': focus_min(vals['focus']),
            })
    return out


def main():
    # 与现有库比对，只留新增
    cat = io.open(os.path.join(ROOT, 'js', 'huarui-catalog.js'), encoding='utf-8').read()
    have = set(m.upper().replace(' ', '') for m in re.findall(r'"model":\s*"([^"]+)"', cat))
    add = build()
    new = [x for x in add if x['model'].upper().replace(' ', '') not in have]
    print('官网 %d 款，库内已有 %d 款，新增 %d 款' % (len(add), len(add) - len(new), len(new)))
    for x in new:
        print('  %-24s %-22s %s' % (x['model'], x['series'], json.dumps(
            {k: v for k, v in x.items() if k not in ('model', 'series', 'brand')}, ensure_ascii=False)))
    json.dump(new, io.open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n→ tools/_cache/huarui_lens_add.json')


if __name__ == '__main__':
    main()
