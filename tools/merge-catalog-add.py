# -*- coding: utf-8 -*-
"""把补库 JSON 追加进已有的 UMD 型录文件（按型号去重、保留原文件排版与字段顺序、更新 META 计数）。

为什么不是重跑原生成器：海康主库由 tools/parse-catalog.js 生成，其输入（pdftotext 文本、
官网 webref/lights/specs）不在仓库里，重跑无法复现现有文件；这里只做尾部追加，
除新行与 META 外文件其余字节不变。

用法:
  python tools/merge-catalog-add.py hikrobot-catalog.js tools/_cache/hikrobot_add.json \
      --map cameras=CAMERAS:cameras --map linescan=LINESCAN:linescan --map lenses=LENSES:lenses \
      --drop brand
"""
import argparse
import json
import re
import sys
import datetime
import os

sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

BLOCK_RE = re.compile(r'^(  var (\w+) = \[\n)(.*?)(\n  \];)', re.S | re.M)
MODEL_RE = re.compile(r'"model"\s*:\s*"([^"]*)"')


def norm_model(m):
    return str(m).upper().replace(' ', '').replace('–', '-')


def series_fix(s):
    return re.sub(r'系列(?=\S)', '系列 ', str(s)) if s else s


def key_order(block):
    """取该数组第一条记录的字段顺序，新记录按同样顺序输出（多余字段附在后面）。"""
    first = re.search(r'\{\s*"[^"]*"\s*:.*?\}', block)
    if not first:
        return []
    try:
        return list(json.loads(first.group(0)).keys())
    except Exception:
        return []


def to_js(rec, order):
    out = {}
    for k in order:
        if k in rec:
            out[k] = rec[k]
    for k, v in rec.items():
        if k not in out:
            out[k] = v
    return '    ' + json.dumps(out, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('catalog')
    ap.add_argument('add_json')
    ap.add_argument('--map', action='append', required=True,
                    help='addJSON键=JS数组名:META键，可重复')
    ap.add_argument('--drop', action='append', default=[], help='追加时丢弃的字段')
    ap.add_argument('--sync', default='小程序项目/lib', help='同步目标目录（- 表示不同步）')
    args = ap.parse_args()

    maps = []
    for m in args.map:
        a, b = m.split('=', 1)
        var, meta = b.split(':', 1)
        maps.append((a, var, meta))

    add = json.load(open(args.add_json, encoding='utf-8'))
    text = open(args.catalog, encoding='utf-8').read()
    stats = {}

    for jkey, var, meta_key in maps:
        records = add.get(jkey) or []
        block = None
        for mm in BLOCK_RE.finditer(text):
            if mm.group(2) == var:
                block = mm
                break
        if block is None:
            print('!! 未找到数组 %s（跳过 %s）' % (var, jkey))
            continue
        body = block.group(3)
        have = {norm_model(x) for x in MODEL_RE.findall(body)}
        order = key_order(body)
        new_lines = []
        for r in records:
            rec = {k: v for k, v in r.items() if k not in args.drop}
            if 'series' in rec:
                rec['series'] = series_fix(rec['series'])
            mo = norm_model(rec.get('model'))
            if not mo or mo in have:
                continue
            have.add(mo)
            new_lines.append(to_js(rec, order))
        if new_lines:
            lines = body.rstrip().split('\n')
            if not lines[-1].rstrip().endswith(','):
                lines[-1] = lines[-1].rstrip() + ','
            for i in range(len(new_lines) - 1):
                new_lines[i] += ','
            body = '\n'.join(lines + new_lines)
            text = text[:block.start(3)] + body + text[block.end(3):]
        stats[var] = (len(records), len(new_lines))

    # META：更新计数与生成日期
    def meta_fix(mo):
        line = mo.group(0)
        for _, var, meta_key in maps:
            if meta_key and meta_key in line:
                cnt = re.search(r'"%s"\s*:\s*(\d+)' % meta_key, line)
                if cnt:
                    new_cnt = int(cnt.group(1)) + stats.get(var, (0, 0))[1]
                    line = re.sub(r'"%s"\s*:\s*\d+' % meta_key,
                                  '"%s":%d' % (meta_key, new_cnt), line)
        line = re.sub(r'"generated"\s*:\s*"[^"]*"',
                      '"generated":"%s"' % datetime.date.today().isoformat(), line)
        return line

    text = re.sub(r'^  var META = .*$', meta_fix, text, count=1, flags=re.M)

    open(args.catalog, 'w', encoding='utf-8').write(text)
    for var, (tot, added) in stats.items():
        print('%s: 补库 %d 条，实际追加 %d 条（其余按型号已存在）' % (var, tot, added))

    if args.sync != '-':
        dst = os.path.join(args.sync, os.path.basename(args.catalog))
        if os.path.exists(dst):
            import shutil
            shutil.copyfile(args.catalog, dst)
            print('同步 ->', dst)


if __name__ == '__main__':
    main()
