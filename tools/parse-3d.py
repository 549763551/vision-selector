#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成海康机器人 3D 产品库 hikrobot-3d-catalog.js，三个来源：
  1. MV-DP / 双目单线 激光轮廓传感器：《机器视觉3D产品手册26年Q3》参数表逐行解析
  2. DLS / DPS / DS5000 / DT04 立体相机：先跑 tools/fetch-hikrobot-3d.js 存官网快照，本脚本按字段映射录入
  3. 官网没有产品页的型号（DLS 手工款、DS5000 其余 4 款、DL2125/2126、DT1300S、DLS1300P）按手册原文录入

为什么以官网为主、手册为辅：手册参数表有合并单元格与排版粘连，同型号不同硬件版本会混排
（如 MV-DPS200P-02 手册写近视场 180×140，官网当前页写 180×160@250mm），官网按产品 id 取数更可靠。
只走手册的型号在数据里标 source=手册，字段值一律照手册原文，不做推算。

用法：
  pdftotext -enc UTF-8 -raw "manuals/机器视觉3D产品手册26年Q3.pdf" tools/_cache/3d.txt
  node tools/fetch-hikrobot-3d.js
  python tools/parse-3d.py tools/_cache/3d.txt > hikrobot-3d-catalog.js
"""
import json, os, re, sys

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_cache')
OFFICIAL_FILE = os.path.join(CACHE, 'hikrobot_3d_official.json')
GENERATED = '2026-11-02'
SRC_SITE = '海康机器人官网产品数据'
SRC_BOOK = '机器视觉3D产品手册26年Q3'

SERIES_LABEL = {
    'DLS系列': 'DLS 系列 激光振镜立体相机',
    'DLS-U系列': 'DLS-U 系列 激光振镜立体相机',
    'DLS-L系列': 'DLS-L 系列 激光振镜立体相机',
    'DLS-T系列': 'DLS-T 系列 激光振镜立体相机',
    'DPS系列': 'DPS 系列 投影结构光立体相机',
    'DPS-U系列': 'DPS-U 系列 投影结构光立体相机',
    'DS5000系列': 'DS5000 系列 3D 结构光传感器',
    'DT系列感知相机': 'DT 系列 感知相机'
}

# 官网字段名 → 记录键（同名键在轮廓传感器里含义一致，直接复用）
FIELD_KEY = [
    ('净距离（CD）', 'cd'), ('测量范围（MR）', 'mr'), ('Z轴重复精度', 'accuracy'),
    ('VDI/VDE精度', 'vdi'), ('采集时间', 'capture'), ('出图延迟时间', 'latency'),
    ('像素间距', 'pixGap'), ('数据类型', 'output'), ('数字I/O', 'io'), ('供电', 'supply'),
    ('典型功耗', 'power'), ('外形尺寸', 'size'), ('重量', 'weight'), ('IP防护等级', 'ip'),
    ('温度', 'temp'), ('湿度', 'humidity'), ('软件', 'software'), ('操作系统', 'os'),
    ('认证', 'cert'), ('激光安全等级', 'laserClass'), ('光源', 'light'), ('光源类型', 'light'),
    ('波长', 'laser'), ('光源波长', 'laser'), ('图像分辨率', 'res'), ('分辨率', 'res'),
    ('扫描帧率', 'fps'), ('全周期帧率', 'fps'), ('最大帧率', 'fps'),
    ('Z轴测量范围', 'zRange'), ('工作范围', 'work'), ('基准距离', 'ref')
]

# 官网字段沿用手册表下脚注：'0.03 mm@600 mm1'、'HiViewer,RobotPilot3' 末尾数字是注号，不是数值
FOOTNOTE_MM = re.compile(r'(?<=mm)\d{1,2}(?=(\s*/|$))')
FOOTNOTE_WORD = re.compile(r'(?<=[a-z])\d{1,2}(?=(\s*/|$))')


def norm(v):
    """多行值折成一行、去脚注号、压缩空白。"""
    if v is None:
        return None
    parts = [re.sub(r'\s+', ' ', str(p)).strip() for p in str(v).split('\n')]
    s = ' / '.join([p for p in parts if p])
    s = FOOTNOTE_MM.sub('', FOOTNOTE_WORD.sub('', s))
    s = s.replace('mm×', 'mm × ')
    return re.sub(r'\s+', ' ', s).strip() or None


def iface_short(v):
    s = norm(v)
    if not s:
        return None
    if re.search(r'gigabit ethernet|gige', s, re.I):
        return 'GigE'
    if re.search(r'usb\s*3', s, re.I):
        return 'USB3'
    return s


def out_text(s):
    """数据类型串里的半角逗号改成顿号，避免和字段内英文逗号混淆。"""
    if not s:
        return None
    return '，'.join([p.strip() for p in s.split(',') if p.strip()])


def smart_from_official(raw):
    """官网 VisionProductConfig 字段 → SMART 记录。"""
    recs = []
    for model in sorted(raw):
        info = raw[model]
        f = info['fields']
        kind = norm(re.sub(r'[（(][^）)]*[）)]', '', f.get('名称') or ''))
        r = {'model': model, 'kind': kind, 'series': SERIES_LABEL.get(info['series']),
             'brand': '海康机器人', 'source': SRC_SITE}
        for name, key in FIELD_KEY:
            if f.get(name):
                v = norm(f[name])
                if key == 'iface':
                    continue
                elif key == 'output':
                    v = out_text(v)
                r[key] = v
        ifac = iface_short(f.get('数据接口'))
        if ifac:
            r['iface'] = ifac
        # 视场：手册/官网把近·远·典型三种视场分行给，拼成一列方便扫读
        seg = []
        if f.get('视场范围'):
            seg.append(norm(f['视场范围']))
        for k in ('近视场', '远视场', '典型视场', '视场角'):
            if f.get(k):
                seg.append(k + ' ' + norm(f[k]))
        if seg:
            r['fov'] = ' / '.join(seg)
        if not f.get('工作范围') and f.get('净距离（CD）'):
            w = '净距离 ' + norm(f['净距离（CD）'])
            if f.get('测量范围（MR）'):
                w += ' / 测量范围 ' + norm(f['测量范围（MR）'])
            r['work'] = w
        det = []
        for k in ('深度图检测精度', '彩色图检测精度'):
            if f.get(k):
                det.append(k.replace('检测精度', '') + ' ' + norm(f[k]))
        for k in ('检测精度',):
            if f.get(k):
                det.append(norm(f[k]))
        if det:
            r['det'] = ' / '.join(det)
        if f.get('测量精度'):
            r['macc'] = norm(f['测量精度'])
        recs.append(r)
    return recs


def main(path):
    text = open(path, encoding='utf-8').read()
    # pdftotext -raw 有两类粘连：数值「80.2 mm15.2 mm」与型号版本号「MV-DP2060-01DV2.0」，
    # 不拆开就会整行匹配失败（DP2080/DP3080/DP3900 与全部 -01D 双目单线型号此前因此漏检）。
    text = re.sub(r'mm(?=[\d.])', 'mm ', text)
    text = re.sub(r'(?<=[A-Za-z0-9])(?=V2\.0)', ' ', text)
    lines = [l.strip() for l in text.splitlines()]

    # ---------- 1. MV-DP 轮廓传感器：型号行为锚点，向后吃字段 ----------
    # 型号行：MV-DP1060-01P * 3200 62 mm 27 mm / MV-DP2020-01P V2.0 3200 21.4 mm 6.8 mm
    # 双目单线系列（-01D）行形如 MV-DP2060-01D V2.0 3200 63.5mm 26 mm，列序与 P 型一致
    head = re.compile(r'^(MV-DP\d{4}-\d+[PD])( V2\.0)?( \*)?\s+(\d{3,4})\s+([\d.]+ ?mm)\s+([\d.]+ ?mm)\s*$')
    chapter = re.compile(r'^(DP\d{4} 系列|双目单线系列) 3D 激光轮廓传感器$')
    prof = []
    cur_series = 'MV-DP 系列 激光轮廓传感器'
    i = 0
    while i < len(lines):
        cm = chapter.match(lines[i])
        if cm:
            cur_series = lines[i]
            i += 1
            continue
        m = head.match(lines[i])
        if not m:
            i += 1
            continue
        model, ver, star, points, xr, zr = m.groups()
        ver = (ver or '').strip()
        blk = lines[i + 1:i + 14]
        blk_txt = '\n'.join(blk)
        rec = {
            'model': model, 'ver': ver or None, 'points': int(points),
            'xRange': xr.replace(' ', ''), 'zRange': zr.replace(' ', ''),
            'ref': None, 'zRes': None, 'zRepeat': None, 'interval': None,
            'rate': None, 'laser': None, 'dwg': None, 'brand': '海康机器人',
            'series': cur_series, 'kind': 'profiler', 'source': SRC_BOOK,
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

    # ---------- 2. 结构光 / 双目 / 物流 3D 相机（数量少、排版各异，按手册原文手工核对录入） ----------
    smart_book = [
        # 双目结构光立体相机（手册「USB 系列感知相机」章节）
        {'model': 'MV-DT01SDU', 'kind': '双目结构光', 'series': 'USB 系列 感知相机', 'fov': '64° × 50°', 'work': '0.3~3.5 m',
         'zacc': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '强度图 / 彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人',
         'source': SRC_BOOK},
        {'model': 'MV-DT01SNU', 'kind': '双目结构光', 'series': 'USB 系列 感知相机', 'fov': '65° × 50°', 'work': '0.2~1.5 m',
         'zacc': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人',
         'source': SRC_BOOK},
        {'model': 'MV-DT01WMU', 'kind': '双目结构光', 'series': 'USB 系列 感知相机', 'fov': '84° × 63°', 'work': '0.2~1.5 m',
         'zacc': '±(10+0.5%depth) mm', 'fps': '深度图 640×480@30 fps；RGB 图 1536×1280@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'A', 'brand': '海康机器人',
         'source': SRC_BOOK},
        {'model': 'MV-DB02SNU', 'kind': '双目结构光', 'series': 'USB 系列 感知相机', 'fov': '60° × 50°', 'work': '0.1~1.0 m',
         'zacc': '5 mm @ 0.5 m，10 mm @ 1 m', 'fps': '深度图 1280×1024@17 fps；RGB 图 1536×1280@17 fps',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'USB3', 'dwg': 'B', 'brand': '海康机器人',
         'source': SRC_BOOK},
        {'model': 'MV-EB435i', 'kind': '双目结构光', 'series': 'USB 系列 感知相机', 'fov': '84° × 55°', 'work': '0.2~5.0 m',
         'zacc': '1.5% @0.2~3 m', 'fps': '深度图 1280×720@30 fps；RGB 图 640×360@30 fps',
         'output': '彩色图 / 深度图', 'iface': 'USB3', 'dwg': 'C', 'brand': '海康机器人',
         'source': SRC_BOOK},
        # 物流行业相机
        {'model': 'MV-DB500S-S', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 580×470 mm / 远视场 2500×1800 mm', 'work': '净距离 500 mm / 测量范围 1500 mm', 'cd': '500 mm', 'mr': '1500 mm',
         'det': '4 mm@1 m；8 mm@2 m', 'fps': '30 fps@单件分离模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体位姿信息', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB500S-C', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 580×470 mm / 远视场 2500×1800 mm', 'work': '净距离 500 mm / 测量范围 1500 mm', 'cd': '500 mm', 'mr': '1500 mm',
         'det': '4 mm@1 m；8 mm@2 m', 'fps': '20 fps@EDP 模式',
         'output': '原始图（黑白+彩色）/ 深度图 / EDP 检测结果', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB500S-V', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 580×470 mm / 远视场 2400×1800 mm', 'work': '净距离 500 mm / 测量范围 1500 mm', 'cd': '500 mm', 'mr': '1500 mm',
         'det': '4 mm@1 m；8 mm@2 m', 'fps': '8 fps@体积测量模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体体积信息', 'iface': 'GigE', 'dwg': 'B',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB700S-S', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '净距离 300 mm / 测量范围 700 mm', 'cd': '300 mm', 'mr': '700 mm',
         'det': '2.5 mm@0.5 m；5 mm@1 m', 'fps': '30 fps@单件分离模式',
         'output': '原始图（黑白+彩色）/ 深度图 / 物体位姿信息', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB700S-C', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '净距离 300 mm / 测量范围 700 mm', 'cd': '300 mm', 'mr': '700 mm',
         'det': '2.5 mm@0.5 m；5 mm@1 m', 'fps': '20 fps@EDP 模式',
         'output': '原始图（黑白+彩色）/ 深度图 / EDP 检测结果', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB1300A-V', 'kind': '物流测量', 'series': '物流行业立体相机',
         'fov': '近视场 870×860 mm / 远视场 3340×2500 mm', 'work': '净距离 1100 mm / 测量范围 2100 mm', 'cd': '1100 mm', 'mr': '2100 mm',
         'zacc': '1.5 mm@2100 mm', 'fps': '1.2~1.5 s / 次',
         'output': '原始图（黑白+彩色）/ 深度图', 'iface': 'GigE', 'dwg': 'C',
         'brand': '海康机器人', 'source': SRC_BOOK},
        # 物流行业相机（大视场）
        {'model': 'MV-DB12SME', 'kind': '物流测量', 'series': 'DB 系列 感知相机',
         'fov': '近视场 580×480 mm / 远视场 2400×1800 mm', 'work': '净距离 500 mm / 测量范围 1500 mm', 'cd': '500 mm', 'mr': '1500 mm',
         'det': '4 mm@1 m；8 mm@2 m', 'fps': 'RGB-D 同步 20 fps@1536×1280 / 30 fps@768×640',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DB12UNE', 'kind': '物流测量', 'series': 'DB 系列 感知相机',
         'fov': '近视场 590×470 mm / 远视场 2200×1500 mm', 'work': '净距离 300 mm / 测量范围 700 mm', 'cd': '300 mm', 'mr': '700 mm',
         'det': '4 mm@500 mm；8 mm@1000 mm', 'fps': 'RGB-D 同步 20 fps@1536×1280 / 30 fps@768×640',
         'output': '原始图（黑白+彩色）/ 深度图 / RGB-D 图', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        # DLS 系列里官网无产品页的三款（手册 p22 振镜 / p23 DLS-L / p24 DLS-UL）
        {'model': 'MV-DLS1400M-15B', 'kind': '激光振镜立体相机', 'series': 'DLS 系列 激光振镜立体相机',
         'fov': '近视场 1300 mm × 1100 mm / 远视场 2940 mm × 2570 mm',
         'work': '净距离 1500 mm / 测量范围 3500 mm', 'cd': '1500 mm', 'mr': '3500 mm',
         'accuracy': '0.2 mm@2500 mm', 'vdi': '0.3 mm@2500 mm',
         'res': 'RGB 图 4000×3000 / 深度图 1920×1536', 'capture': '0.4~0.9 s', 'latency': '0.9~1.6 s',
         'light': '单线激光', 'laserClass': 'Class 3R',
         'output': '原始图（黑白+彩色），深度图，RGB-D图', 'ip': 'IP65', 'dwg': 'D',
         'brand': '海康机器人', 'source': SRC_BOOK,
         'note': '手册测量范围列印 3500 mm；同视场的 MV-DLS1400M-15L 官网为 2000 mm，待核'},
        {'model': 'MV-DLS600P-12L', 'kind': '激光振镜立体相机', 'series': 'DLS-L 系列 激光振镜立体相机',
         'fov': '近视场 620 mm × 570 mm / 远视场 1290 mm × 1060 mm',
         'work': '净距离 1200 mm / 测量范围 1000 mm', 'cd': '1200 mm', 'mr': '1000 mm',
         'accuracy': '0.08 mm@1800 mm', 'vdi': '0.15 mm@1800 mm',
         'res': 'RGB 图 3200×1944 / 深度图 1632×1264', 'capture': '0.5~0.9 s', 'latency': '0.9~1.4 s',
         'light': '多线激光', 'laserClass': 'Class 2',
         'output': '原始图（黑白+彩色），深度图，RGB-D图', 'ip': 'IP65', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DLS300UL-13', 'kind': '激光振镜立体相机', 'series': 'DLS-UL 系列 激光振镜立体相机',
         'fov': '近视场 349 mm × 363 mm / 远视场 470 mm × 418 mm',
         'work': '净距离 1300 mm / 测量范围 200 mm', 'cd': '1300 mm', 'mr': '200 mm',
         'accuracy': '0.05 mm@1400 mm', 'vdi': '0.08 mm@1400 mm',
         'res': 'RGB 图 4000×3000 / 深度图 2448×2048', 'capture': '0.4~0.9 s', 'latency': '1.0~1.7 s',
         'light': '单线激光', 'laserClass': 'Class 2',
         'output': '原始图（黑白+彩色），深度图，RGB-D图', 'ip': 'IP65',
         'brand': '海康机器人', 'source': SRC_BOOK},
        # DS5000 系列：官网只有 5040 产品页，其余 4 款按手册 p18/19 录入
        {'model': 'MV-DS5025-02H', 'kind': '3D结构光传感器', 'series': 'DS5000 系列 3D 结构光传感器',
         'fov': '25 mm × 21 mm@近视场 / 25 mm × 21 mm@基准视场 / 25 mm × 21 mm@远视场',
         'ref': '100 mm', 'zRange': '±5 mm@基准距离', 'accuracy': '＜0.1 µm',
         'res': '2472×2064', 'fps': '3 fps@5.1M / 9 fps@1.3M', 'pixGap': '0.010 mm',
         'light': '蓝光LED', 'ip': 'IP67',
         'brand': '海康机器人', 'source': SRC_BOOK,
         'note': '手册近/基准/远视场三格印值相同（同系列 5040 为 ±2% 递增），疑为排版合并单元格'},
        {'model': 'MV-DS5090-02H', 'kind': '3D结构光传感器', 'series': 'DS5000 系列 3D 结构光传感器',
         'fov': '81.9 mm × 68.4 mm@近视场 / 90 mm × 75.1 mm@基准视场 / 98.1 mm × 81.9 mm@远视场',
         'ref': '225 mm', 'zRange': '±15 mm@基准距离', 'accuracy': '＜0.1 µm',
         'res': '2472×2064', 'fps': '3 fps@5.1M / 9 fps@1.3M', 'pixGap': '0.036 mm',
         'light': '蓝光LED', 'ip': 'IP67', 'dwg': 'B',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DS5145-02H', 'kind': '3D结构光传感器', 'series': 'DS5000 系列 3D 结构光传感器',
         'fov': '134.8 mm × 112.1 mm@近视场 / 145 mm × 121 mm@基准视场 / 156.2 mm × 129.9 mm@远视场',
         'ref': '310 mm', 'zRange': '±20 mm@基准距离', 'accuracy': '＜0.5 µm',
         'res': '2472×2064', 'fps': '3 fps@5.1M / 9 fps@1.3M', 'pixGap': '0.059 mm',
         'light': '蓝光LED', 'ip': 'IP67', 'dwg': 'C',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DS5200-02H', 'kind': '3D结构光传感器', 'series': 'DS5000 系列 3D 结构光传感器',
         'fov': '183 mm × 153 mm@近视场 / 200 mm × 167 mm@基准视场 / 216 mm × 181 mm@远视场',
         'ref': '420 mm', 'zRange': '±30 mm@基准距离', 'accuracy': '＜0.5 µm',
         'res': '2472×2064', 'fps': '3 fps@5.1M / 9 fps@1.3M', 'pixGap': '0.081 mm',
         'light': '蓝光LED', 'ip': 'IP67',
         'brand': '海康机器人', 'source': SRC_BOOK},
        # 快递物流线激光立体相机（手册 p31）
        {'model': 'MV-DL2125-04H-R', 'kind': '物流线激光立体相机', 'series': 'DL 系列 快递物流线激光立体相机',
         'fov': '近视场 1000 mm / 远视场 2600 mm', 'work': '净距离 700 mm / 测量范围 1000 mm',
         'cd': '700 mm', 'mr': '1000 mm', 'det': '±5 mm', 'speed': '3 m/s@±5 mm 检测精度',
         'fps': '600 fps@1 m 测量范围', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DL2125-04P-R', 'kind': '物流线激光立体相机', 'series': 'DL 系列 快递物流线激光立体相机',
         'fov': '近视场 1000 mm / 远视场 2600 mm', 'work': '净距离 700 mm / 测量范围 1000 mm',
         'cd': '700 mm', 'mr': '1000 mm', 'det': '±5 mm', 'speed': '3 m/s@±5 mm 检测精度',
         'fps': '1140 fps@1 m 测量范围', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DL2126-04H-R', 'kind': '物流线激光立体相机', 'series': 'DL 系列 快递物流线激光立体相机',
         'fov': '近视场 700 mm / 远视场 2000 mm', 'work': '净距离 260 mm / 测量范围 470 mm',
         'cd': '260 mm', 'mr': '470 mm', 'det': '±5 mm', 'speed': '3 m/s@±5 mm 检测精度',
         'fps': '600 fps@300 mm 测量范围', 'dwg': 'B',
         'brand': '海康机器人', 'source': SRC_BOOK},
        {'model': 'MV-DL2126-04P-R', 'kind': '物流线激光立体相机', 'series': 'DL 系列 快递物流线激光立体相机',
         'fov': '近视场 700 mm / 远视场 2000 mm', 'work': '净距离 260 mm / 测量范围 470 mm',
         'cd': '260 mm', 'mr': '470 mm', 'det': '±5 mm', 'speed': '3 m/s@±5 mm 检测精度',
         'fps': '1140 fps@300 mm 测量范围', 'dwg': 'B',
         'brand': '海康机器人', 'source': SRC_BOOK},
        # 仓储物流 RGBD 立体相机（手册 p32）
        {'model': 'MV-DT1300S', 'kind': '物流测量', 'series': '仓储物流 RGBD 立体相机',
         'fov': '近视场 1200 mm × 900 mm@1000 mm / 远视场 4200 mm × 3100 mm@3500 mm',
         'work': '0.5~5 m', 'zacc': '(5+0.1%depth) mm', 'res': 'RGB 图 1536×1280 / 深度图 640×480',
         'output': '强度图，彩色图，深度图，RGB-D 图', 'iface': 'GigE', 'dwg': 'A',
         'brand': '海康机器人', 'source': SRC_BOOK,
         'note': '无法接入基线 RobotPilot，只能接入拆码垛专用版本（手册注 1）'},
        {'model': 'MV-DLS1300P', 'kind': '物流测量', 'series': '仓储物流 RGBD 立体相机',
         'fov': '近视场 1360 mm × 1200 mm / 远视场 3200 mm × 2800 mm',
         'work': '1.5~3.5 m', 'zacc': '0.3 mm@2500 mm', 'res': 'RGB 图 3200×2400 / 深度图 1440×1152',
         'output': '原始图（黑白+彩色），深度图，RGB-D 图', 'iface': 'GigE', 'dwg': 'C',
         'brand': '海康机器人', 'source': SRC_BOOK,
         'note': '只适用于料况拆垛，点云匹配 DL 的算子使用有一定限制（手册注 2）'},
    ]

    official = {}
    if os.path.exists(OFFICIAL_FILE):
        official = json.load(open(OFFICIAL_FILE, encoding='utf-8'))
    from_site = smart_from_official(official)
    # 手工款与官网款同裸名时以官网为准，避免同型号两份数据
    book_models = set(r['model'] for r in smart_book)
    site_models = set(r['model'] for r in from_site)
    smart = [r for r in smart_book if r['model'] not in site_models] + from_site
    dup = [m for m in book_models if m in site_models]
    if dup:
        sys.stderr.write('警告：%s 手册与官网都有，已取官网\n' % ', '.join(sorted(dup)))

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
        return '{ ' + ', '.join('"%s": %s' % (k, js(d[k])) for k in d) + ' }'

    out = []
    out.append('''/**
 * 海康机器人 3D 产品库（轮廓传感器 + 结构光/振镜/双目/物流 3D 相机）
 * 来源：《机器视觉3D产品手册26年Q3.pdf》+ 海康机器人官网产品数据（立体相机系列）
 * 生成脚本：tools/parse-3d.py    生成日期：%s
 * 激光轮廓传感器 %d 款；3D 相机 / 结构光传感器 %d 款（其中官网快照 %d 款、手册补录 %d 款）。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hikrobot3DCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "机器视觉3D产品手册26年Q3 + 海康机器人官网", "brand": "海康机器人", "generated": "%s",
    "profilers": %d, "smart": %d};
''' % (GENERATED, len(prof), len(smart), len(from_site), len(smart) - len(from_site), GENERATED,
       len(prof), len(smart)))
    out.append('  var PROFILERS = [\n    ' + ',\n    '.join(obj(p) for p in prof) + '\n  ];')
    out.append('  var SMART = [\n    ' + ',\n    '.join(obj(s) for s in smart) + '\n  ];')
    out.append('  return { META: META, PROFILERS: PROFILERS, SMART: SMART };')
    out.append('});')
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
