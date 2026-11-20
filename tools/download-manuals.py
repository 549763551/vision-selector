# -*- coding: utf-8 -*-
"""把 docs-data.js 里登记的官方 PDF 下载到 manuals/，供离线使用。

manuals/ 被 .gitignore 忽略，不入库、不推送；线上主页一律走厂商官方直链。
用法：
  python tools/download-manuals.py            # 断点续传，跳过已存在文件
  python tools/download-manuals.py --brand cst
  python tools/download-manuals.py --force   # 已存在也重新下载
"""
from __future__ import unicode_literals

import argparse
import concurrent.futures
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'manuals')
DATA_JS = os.path.join(ROOT, 'docs-data.js')
FAIL_LOG = os.path.join(ROOT, 'tmp', 'docs', 'download-fail.json')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')


def load_manifest():
    s = io.open(DATA_JS, encoding='utf-8').read()
    return json.loads(re.search(r'return (\{.*\});', s, re.S).group(1))


def is_document(ctype, head):
    ctype = (ctype or '').lower()
    if 'text/html' in ctype or head.startswith(b'<'):
        return False
    return ('pdf' in ctype or 'zip' in ctype or 'octet-stream' in ctype
            or 'rar' in ctype or head.startswith(b'%PDF') or head.startswith(b'PK'))


def download(item):
    brand, doc = item
    local = doc['l']
    dest = os.path.join(OUT_DIR, local)
    if not local:
        return ('skip', brand, '', '入口')
    if os.path.exists(dest) and os.path.getsize(dest) > 10240:
        return ('cached', brand, local, os.path.getsize(dest))
    part = dest + '.part'
    try:
        req = urllib.request.Request(doc['u'], headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            head = r.read(512)
            if not is_document(r.headers.get('Content-Type'), head):
                return ('blocked', brand, local, r.headers.get('Content-Type'))
            with open(part, 'wb') as f:
                f.write(head)
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
        size = os.path.getsize(part)
        if size < 10240:
            os.remove(part)
            return ('tiny', brand, local, size)
        os.replace(part, dest)
        return ('ok', brand, local, size)
    except Exception as e:
        if os.path.exists(part):
            os.remove(part)
        return ('error', brand, local, str(e)[:120])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--brand', default='')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    data = load_manifest()
    jobs = []
    for b in data['brands']:
        if args.brand and b['key'] != args.brand:
            continue
        for d in b['docs']:
            if not d.get('l'):
                continue
            if args.force:
                p = os.path.join(OUT_DIR, d['l'])
                if os.path.exists(p):
                    os.remove(p)
            jobs.append((b['key'], d))

    print('待处理 %d 份，目标目录 %s' % (len(jobs), OUT_DIR))
    stats, failures = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for i, (status, brand, local, info) in enumerate(ex.map(download, jobs), 1):
            stats[status] = stats.get(status, 0) + 1
            if status in ('blocked', 'error', 'tiny'):
                failures.append({'brand': brand, 'local': local, 'status': status, 'info': str(info)})
            if i % 20 == 0 or i == len(jobs):
                print('  进度 %d/%d  %s' % (i, len(jobs), stats), flush=True)

    print('\n结果:', stats)
    if failures:
        os.makedirs(os.path.dirname(FAIL_LOG), exist_ok=True)
        json.dump(failures, io.open(FAIL_LOG, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        by_brand = {}
        for f in failures:
            by_brand[f['brand']] = by_brand.get(f['brand'], 0) + 1
        print('失败明细按品牌:', by_brand, '→', FAIL_LOG)
    total = sum(os.path.getsize(os.path.join(OUT_DIR, f))
                for f in os.listdir(OUT_DIR)
                if os.path.isfile(os.path.join(OUT_DIR, f)) and not f.endswith('.part'))
    print('manuals/ 当前合计 %.1f MB' % (total / 1e6))


if __name__ == '__main__':
    main()
