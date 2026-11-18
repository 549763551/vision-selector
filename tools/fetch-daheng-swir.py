# -*- coding: utf-8 -*-
r"""大恒图像短波红外（SWIR）相机：抓官网系列页的规格书 PDF → 抽型号与规格 → 输出 JSON。

背景：大恒官网 /product/swir/daheng/swir/ 只放营销排版，型号表不在 DOM 里，
每个系列挂一份「产品规格书」PDF，参数页是规整的 `label / label / value` 三元组（模板把每个
标签渲染了两遍），所以解析只需「去掉相邻重复行 → 交替取键值」。

用法：
  py -3 tools/fetch-daheng-swir.py            # 抓页面 + 下载 + 解析，写 tools/_cache/dh_swir.json
  py -3 tools/fetch-daheng-swir.py --parse    # 只用已下载的 PDF 重新解析

产物（都在 tools/_cache/ 下，不入库）：
  dh_pdf/*.pdf    规格书原件
  dh_swir.json    解析结果：[{model, 规格键值对...}]
"""
import io
import json
import os
import re
import sys
import time
import urllib.request

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '_cache')
PDF_DIR = os.path.join(CACHE, 'dh_pdf')
OUT = os.path.join(CACHE, 'dh_swir.json')

PAGE = 'https://www.daheng-imaging.com/product/swir/daheng/swir/'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'

# 规格书里会出现、但不是参数的模板行
SKIP = {'用科技定义“ 视” 界！|   www.daheng-imaging.com', '规格参数', '机械', '软件', '功能特性',
        '应用领域', '光谱响应', '外形尺寸'}


def fetch(url, binary=False, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode('utf-8', 'replace')
        except Exception as e:
            if i == retry - 1:
                raise
            time.sleep(1.5)


def pdf_links():
    # 官网对 urllib 会返回空壳（WAF），本地留一份 curl 抓的页面时就优先用它；
    # 重新抓页面用：curl -s "https://www.daheng-imaging.com/product/swir/daheng/swir/" -o tools/_cache/lines/dh_swir_daheng_swir.html
    local = os.path.join(CACHE, 'lines', 'dh_swir_daheng_swir.html')
    html = io.open(local, encoding='utf-8', errors='replace').read() if os.path.exists(local) else fetch(PAGE)
    seen, out = [], []
    for m in re.finditer(r'href="(/index\.php\?m=content&c=index&a=file_down&f=(/uploadfile/[^"]+))"', html):
        u = m.group(1).replace('&amp;', '&')
        if u not in seen:
            seen.append(u)
            out.append((u, m.group(2)))
    return out


def download(links):
    os.makedirs(PDF_DIR, exist_ok=True)
    for i, (u, path) in enumerate(links, 1):
        name = os.path.basename(path)
        dst = os.path.join(PDF_DIR, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 20000:
            print(f'  [{i}/{len(links)}] skip {name}')
            continue
        data = fetch('https://www.daheng-imaging.com' + u, binary=True)
        with open(dst, 'wb') as f:
            f.write(data)
        print(f'  [{i}/{len(links)}] {name} {len(data)} bytes')
        time.sleep(0.4)


def dedupe(lines):
    """去掉相邻重复行（模板把每个标签渲染两遍）。"""
    out = []
    for l in lines:
        if not out or out[-1] != l:
            out.append(l)
    return out


def key_vocab(files):
    """键名词表：模板会把每个标签连续渲染两遍，值只渲染一遍。
    先扫全部 PDF 收集「相邻重复行」，作为「哪些行是标签」的判据。
    这比写死键名表稳：不同系列 PDF 的排版行数都不一样（有的型号跨 4 行）。"""
    vocab = set()
    for path in files:
        try:
            doc = pymupdf.open(path)
        except Exception:
            continue
        for page in doc:
            raw = [l.strip() for l in page.get_text().split('\n') if l.strip()]
            for a, b in zip(raw, raw[1:]):
                if a == b and 1 < len(a) <= 14:
                    vocab.add(a)
        doc.close()
    return vocab


def wave_of(doc):
    """规格页不写波段，从封面简介里抓「400nm~1700nm」这种表述。"""
    for page in doc:
        m = re.search(r'(\d{3})\s*nm\s*~\s*(\d{3,4})\s*nm', page.get_text())
        if m:
            return f'{m.group(1)} ~ {m.group(2)} nm'
    return None


MODEL_RX = re.compile(r'^[A-Z][A-Z0-9\-]{5,}(?:\s?F0\d)?$')


def parse_pdf(path, vocab):
    doc = pymupdf.open(path)
    rec = None
    for page in doc:
        raw = [l.strip() for l in page.get_text().split('\n') if l.strip()]
        if not {'分辨率', '数据接口'} & set(raw):
            continue
        merged = [l for l in dedupe(raw) if l not in SKIP]
        kv = {}
        # 型号：页面里最长的机型行（有的 PDF 会拆成「MARS-...-TN-SWIR」+「-SWIR F02」残片）
        models = [l for l in merged if MODEL_RX.match(l) and re.search(r'\d', l)]
        if models:
            kv['型号'] = max(models, key=len)
        # 其余字段：遇到标签就取其后第一个「不是标签」的行
        for i, l in enumerate(merged):
            if l not in vocab or l in kv:
                continue
            for v in merged[i + 1:i + 4]:
                if v in vocab or v == kv.get('型号') or MODEL_RX.match(v):
                    continue
                if len(v) <= 2 and v not in ('C', 'F'):
                    continue
                kv[l] = v
                break
        # 「机械尺寸 / 尺寸 / 29(W)×...」——模板多渲染一层子标签
        if kv.get('机械尺寸') == '尺寸':
            kv.pop('机械尺寸', None)
        if kv.get('型号') and len(kv) >= 6:
            rec = kv
            break
    if rec:
        w = wave_of(doc)
        if w:
            rec['波段范围'] = w
        rec.pop('尺寸', None)
    doc.close()
    return rec


def main():
    os.makedirs(CACHE, exist_ok=True)
    if '--parse' not in sys.argv:
        links = pdf_links()
        print(f'规格书 {len(links)} 份')
        download(links)

    files = [os.path.join(PDF_DIR, f) for f in sorted(os.listdir(PDF_DIR)) if f.endswith('.pdf')]
    files = [f for f in files if os.path.getsize(f) > 20000]
    vocab = key_vocab(files)
    print(f'键名词表 {len(vocab)} 个')
    out = []
    for p in files:
        kv = parse_pdf(p, vocab)
        if not kv:
            print('  未解析出型号', os.path.basename(p))
            continue
        out.append(kv)
        print(f'  {kv.get("型号"):40s} {kv.get("分辨率",""):22s} {kv.get("数据接口","")}')
    with io.open(OUT, 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    print(f'\n合计 {len(out)} 个型号 → {OUT}')


if __name__ == '__main__':
    main()
