# -*- coding: utf-8 -*-
"""生成 docs-data.js：主页「官方资料」区的品牌 × 文档清单。

输入是本地抓取产物（tmp/docs/*.json，不入库），来源如下，更新时重新采集即可：

  hik_search.json       海康机器人 下载中心接口
    https://www.hikrobotics.com/cn/Api/Foreground/Support/v2/DownCenter
      ?category=0&module=1&size=100&page=1&title=<关键词>
    module=1 是「资料」（module=0 是软件）。用 13 个关键词搜完合并去重，
    只保留标题含「手册 / 型录 / 目录 / 选型 / 样本」的品牌级与系列级文档，
    不收型号级规格书。
  irayple_manuals.json  华睿 下载中心「文档资料」分类
    https://www.irayple.com/api/cn/download/downloadList?nav_id=31&page=N&keywords=
    共 2 页 19 条。
  daheng_docs.json      大恒图像 产品型录页（阿里云 WAF，需真浏览器取 DOM）
    https://www.daheng-imaging.com/downloads/doc/
    下载按钮 onclick="downyz_click('/index.php?...&f=/uploadfile/...pdf')"。
  cst_docs.json         康视达 资料下载页 19 页
    https://cstmv.com/list/30.html?id=30&page=N  （www 主机有 JS 挑战，去掉 www）
    <td class="file-format" data-url="...pdf"> 与「文档名称」列配对。

Basler 与奥普特的下载需登录或被 WAF 挡，无法拿到公开文件直链，
因此只登记官方资料中心入口，不伪造文件链接。

输出 docs-data.js 的 return 后是一段严格 JSON，页面直接读，
tools/download-manuals.py 也用同一段 JSON 找要下载的本地副本。
"""
from __future__ import unicode_literals

import io
import json
import os
import re
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tmp', 'docs')
OUT = os.path.join(ROOT, 'js', 'docs-data.js')

HIK_BASE = 'https://www.hikrobotics.com'
DAHENG_BASE = 'https://www.daheng-imaging.com'
CST_BASE = 'https://cstmv.com'

# 品牌级 / 系列级文档中心入口（页面右上角「官方下载中心」）
CENTERS = {
    'hikrobot': 'https://www.hikrobotics.com/cn/machinevision/service/download?module=0',
    'huarui': 'https://www.irayple.com/serviceSupport/downloadCenter/18?p=17',
    'basler': 'https://www.baslerweb.com/en/downloads/documents/',
    'daheng': 'https://www.daheng-imaging.com/downloads/doc/',
    'opt': 'https://www.optmv.com/down/index.html',
    'cst': 'https://cstmv.com/list/30.html',
}

BRAND_ORDER = [
    ('hikrobot', '海康机器人 HIKROBOT', '下载中心「资料」模块，官方 PDF 直链'),
    ('huarui', '华睿科技 iRAYPLE', '下载中心 → 文档资料，官方 PDF 直链'),
    ('basler', 'Basler', '文档需从官方下载中心检索；产品文档站可按型号查规格'),
    ('daheng', '大恒图像 DAHENG', '产品型录页，官方 PDF 直链'),
    ('opt', '奥普特 OPT', '资料中心需注册登录后方可下载，故只提供官方入口'),
    ('cst', '康视达 CST', '官网「资料下载」栏目，按光源 / 镜头系列分册'),
]

# 本地 manuals/ 里已有的 7 份手册：直接复用，不重复下载
EXISTING = [
    ('hikrobot', '机器视觉标准产品手册-2026.Q3', '机器视觉标准产品手册-2026.Q3.pdf'),
    ('hikrobot', '机器视觉智能产品手册-2026.Q3', '机器视觉智能产品手册-2026.Q3.pdf'),
    ('hikrobot', '机器视觉3D产品手册-2026.Q3', '机器视觉3D产品手册26年Q3.pdf'),
    ('hikrobot', '机器视觉工控机产品手册-2026.Q2', '机器视觉工控机产品手册-V.151.CN.26Q2.1(阅读版).pdf'),
    ('huarui', '机器视觉产品手册中文版V20260901', '机器视觉产品手册中文版V20260901.pdf'),
    ('daheng', '大恒图像产品型录', '大恒图像产品型录.pdf'),
    ('daheng', '镜头产品型录', '大恒镜头产品型录.pdf'),
]

INVALID = re.compile(r'[\\/:*?"<>|\r\n\t（）()\[\]【】]')


def load(name):
    path = os.path.join(CACHE, name)
    return json.load(io.open(path, encoding='utf-8'))


def safe_name(text, ext):
    s = INVALID.sub('_', text or '')
    s = re.sub(r'\s+', '_', s).strip('_. ')
    return (s[:68] or 'doc') + ext


def ext_of(url, fallback='.pdf'):
    # 大恒的链接形如 /index.php?...&f=/uploadfile/.../xxx.pdf，
    # 域名后的 .php 不是文件类型，取查询串里最后一个真实文件扩展名。
    known = ('pdf', 'zip', 'rar', 'doc', 'docx', 'xls', 'xlsx', '7z', 'exe', 'msi')
    hits = re.findall(r'\.([A-Za-z0-9]{2,5})(?:[?&#]|$)', url or '')
    for e in reversed(hits):
        if e.lower() in known:
            return '.' + e.lower()
    return fallback


def existing_for(brand, name):
    for b, key, filename in EXISTING:
        if b == brand and key in (name or ''):
            return filename
    return ''


def main():
    docs = {k: [] for k, _, _ in BRAND_ORDER}

    # --- 海康：只留品牌级 / 系列级手册 ---
    hik = load('hik_search.json')
    keys = ('手册', '型录', '目录', '选型', '样本')
    hik_manuals = [r for r in hik if any(k in (r.get('title') or '') for k in keys)]
    for r in sorted(hik_manuals, key=lambda x: (0 if '产品手册' in x.get('title', '') else 1,
                                                x.get('title', ''))):
        title = (r.get('title') or '').strip()
        path = (r.get('filePath') or r.get('extLinks') or '').strip()
        if not path:
            continue
        url = path if path.startswith('http') else HIK_BASE + quote(path, safe='/')
        kind = '产品手册' if '产品手册' in title else '系列手册'
        docs['hikrobot'].append((title, url, kind, r.get('fileSize') or ''))

    # --- 华睿：文档资料分类全部分页 ---
    for r in load('irayple_manuals.json'):
        title = (r.get('title') or '').strip()
        url = (r.get('file_url') or '').strip()
        if not url:
            continue
        ext = ext_of(url)
        kind = '产品手册' if '产品手册' in title or '手册' in title else '培训 / 资料'
        docs['huarui'].append((title, url, kind, ''))

    # --- 大恒：产品型录页 27 份 ---
    for r in load('daheng_docs.json'):
        row = (r.get('name') or '').strip()
        url = (r.get('url') or '').strip()
        if not url:
            continue
        row = re.sub(r'\s*下载\s*$', '', row)
        m = re.search(r'(\d+\.?\d*\s*MB)', row)
        size = m.group(1) if m else ''
        title = re.sub(r'\s+(pdf|PDF)\s+.*$', '', row).strip()
        title = re.sub(r'\s+\d{6}\s*$', '', title).strip()
        docs['daheng'].append((title or row[:60], DAHENG_BASE + url, '产品型录', size))

    # --- 康视达：资料下载 19 页 ---
    for r in load('cst_docs.json'):
        title = (r.get('name') or '').strip()
        path = (r.get('url') or '').strip()
        if not path:
            continue
        url = path if path.startswith('http') else CST_BASE + path
        docs['cst'].append((title, url, '系列手册', ''))

    # --- Basler / 奥普特：官方入口（无公开文件直链） ---
    docs['basler'] = [
        ('文档下载中心（数据表 / 手册 / 白皮书 / 证书）', 'https://www.baslerweb.com/en/downloads/documents/', '官方入口', ''),
        ('Basler 产品文档站（按型号查规格与参数）', 'https://docs.baslerweb.com/', '官方入口', ''),
        ('软件与驱动下载', 'https://www.baslerweb.com/en/downloads/software/', '官方入口', ''),
        ('Basler 中国站', 'https://www.baslerweb.cn/zh-cn/', '官方入口', ''),
    ]
    docs['opt'] = [
        ('资料中心（总入口）', 'https://www.optmv.com/down/index.html', '官方入口 · 需登录', ''),
        ('产品手册 / 规格书', 'https://www.optmv.com/down/manual.html', '官方入口 · 需登录', ''),
        ('软件与驱动下载', 'https://www.optmv.com/down/down.html', '官方入口 · 需登录', ''),
        ('CAD 图纸下载', 'https://www.optmv.com/down/blueprint.html', '官方入口 · 需登录', ''),
    ]

    brands = []
    for key, name, note in BRAND_ORDER:
        items = []
        for i, (title, url, kind, size) in enumerate(docs[key], 1):
            if kind.startswith('官方入口'):
                local = ''
            else:
                local = existing_for(key, title) or ('%s_%03d_%s' % (
                    key, i, safe_name(title, ext_of(url))))
            items.append({'n': title, 'u': url, 'l': local, 't': kind, 's': size})
        brands.append({'key': key, 'name': name, 'note': note,
                       'center': CENTERS[key], 'docs': items})

    data = {'updated': '2026-11-20', 'brands': brands}
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    js = (
        '/* 官方资料清单 —— 由 tools/build-docs-data.py 生成，勿手改。\n'
        '   页面只读 window.VISION_DOCS；PDF 本体不入库，manuals/ 是本地离线副本。\n'
        '   每条 u = 厂商官方直链，l = 本地 manuals/ 下的副本文件名（空 = 仅入口）。 */\n'
        '(function (root, factory) {\n'
        '  var data = factory();\n'
        '  if (typeof module === "object" && module.exports) module.exports = data;\n'
        '  else root.VISION_DOCS = data;\n'
        '})(typeof self !== "undefined" ? self : this, function () {\n'
        '  return ' + blob + ';\n'
        '});\n'
    )
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(js)

    total = sum(len(b['docs']) for b in brands)
    downloadable = sum(1 for b in brands for d in b['docs'] if d['l'])
    print('docs-data.js 写出 %d 字节，%d 品牌 / %d 条，其中 %d 条有本地副本' %
          (len(js.encode('utf-8')), len(brands), total, downloadable))
    for b in brands:
        print('  %-10s %3d 条（可下载 %d）' %
              (b['key'], len(b['docs']), sum(1 for d in b['docs'] if d['l'])))


if __name__ == '__main__':
    main()
