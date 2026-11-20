#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""康视达（CST / cstmv.com）官网产品目录抓取器。

站点要点：
  * https://www.cstmv.com 有 JS 挑战页（412/405），但 **https://cstmv.com 无 www 直连 200**，无需真浏览器。
  * 分类页  /list/<id>.html?id=<id>&page=<n>
    - <ul class="cp-list-top">  是该分类的规格表头
    - <div class="cp-txt" id="ajax_prolists"> 内每个 <a href=".../show/<id>.html"> 是一行产品
    - 分页在 <div class="pagesDiv">
  * 详情页 /show/<id>.html 是「标签—值」两列表；系列汇总页是 <table class="info-tab"> 多型号表。

用法：
  python tools/fetch-cst.py discover           # BFS 分类树，抓每个分类第 1 页
  python tools/fetch-cst.py pages             # 按 discover 结果翻页抓全部产品行
  python tools/fetch-cst.py collect           # 汇总成 tmp/cst/products.json
"""
from __future__ import annotations
import io, os, re, sys, json, html, time, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

BASE = 'https://cstmv.com'
CACHE = os.path.join('tmp', 'cst', 'pages')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
HEADERS = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'}
SEED_HOME = os.path.join('tmp', 'cst', 'home.html')


# ---------------------------------------------------------------- utils
def clean(x: str) -> str:
    x = re.sub(r'<[^>]+>', ' ', x)
    x = html.unescape(x)
    return re.sub(r'\s+', ' ', x).strip()


def fetch(url: str, tries: int = 3):
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=25)
            if r.status_code == 200 and len(r.content) > 20000:
                r.encoding = 'utf-8-sig'
                return r.text
        except Exception:
            pass
        time.sleep(0.5 * (i + 1))
    return None


def list_url(cid, page=1):
    return f'{BASE}/list/{cid}.html?id={cid}&page={page}' if page > 1 else f'{BASE}/list/{cid}.html'


def cache_path(cid, page=1):
    return os.path.join(CACHE, f'list_{cid}_{page}.html')


def get_page(cid, page, force=False):
    p = cache_path(cid, page)
    if os.path.exists(p) and not force:
        return io.open(p, encoding='utf-8').read()
    s = fetch(list_url(cid, page))
    if s:
        os.makedirs(CACHE, exist_ok=True)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    return s


def show_path(sid):
    return os.path.join(CACHE, f'show_{sid}.html')


def get_show(sid, force=False):
    p = show_path(sid)
    if os.path.exists(p) and not force:
        return io.open(p, encoding='utf-8').read()
    s = fetch(f'{BASE}/show/{sid}.html')
    if s:
        os.makedirs(CACHE, exist_ok=True)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    return s


def parse_tables(s: str):
    """解析详情页所有表格，返回 [[cell,...], ...] 的列表（每表一张）。"""
    out = []
    for t in re.finditer(r'<table[^>]*>(.*?)</table>', s, re.I | re.S):
        rows = []
        for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', t.group(1), re.I | re.S):
            cells = [clean(x) for x in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr.group(1), re.I | re.S)]
            if cells:
                rows.append(cells)
        if rows:
            out.append(rows)
    return out


def stage_details(args):
    """按 products.json 里的 show id 全量抓单品详情页（标签—值参数表）。"""
    d = json.load(io.open(os.path.join('tmp', 'cst', 'products.json'), encoding='utf-8'))
    ids = sorted({p['id'] for p in d['products']
                  if re.match(r'^CST-', p['cells'][0], re.I)}, key=int)
    print(f'需抓单品页 {len(ids)} 个', flush=True)
    ok = skip = fail = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(get_show, sid, args.force): sid for sid in ids}
        for fu in as_completed(futs):
            sid = futs[fu]
            if os.path.exists(show_path(sid)) and not args.force:
                skip += 1
            r = fu.result()
            if r:
                ok += 1
            else:
                fail += 1
                if fail < 15:
                    print('  !! 失败', sid, flush=True)
            if (ok + fail) % 200 == 0:
                print(f'  进度 {ok + fail}/{len(ids)}', flush=True)
    print(f'完成 ok={ok} fail={fail}', flush=True)


def stage_series(args):
    """抓全站导航里的「系列汇总页」，提取多型号参数表。"""
    nav = json.load(io.open(os.path.join('tmp', 'cst', 'nav_shows.json'), encoding='utf-8'))
    ids = sorted(nav, key=int)
    print(f'导航 show 页 {len(ids)} 个', flush=True)
    result = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(get_show, sid, args.force): sid for sid in ids}
        for fu in as_completed(futs):
            sid = futs[fu]
            s = fu.result()
            if not s:
                print('  !! 失败', sid, flush=True)
                continue
            tabs = parse_tables(s)
            # 多型号表：首行是表头且列数 >= 4，或至少 4 行且首格是型号
            series = [t for t in tabs if len(t) >= 3 and len(t[0]) >= 4
                      and ('型号' in t[0][0] or '产品型号' in t[0][0])]
            result[sid] = {'name': nav[sid], 'tables': tabs, 'series': series}
    out = os.path.join('tmp', 'cst', 'series.json')
    io.open(out, 'w', encoding='utf-8', newline='\n').write(json.dumps(result, ensure_ascii=False, indent=1))
    for sid, v in sorted(result.items(), key=lambda x: int(x[0])):
        if v['series']:
            for t in v['series']:
                print(f"  {sid:>5} | {v['name'][:28]:<30} | {len(t)-1:>3} 型号 | {'/'.join(t[0][:8])}", flush=True)
    print(f'写出 {out}', flush=True)


def parse_list(s: str):
    """返回 (表头, 产品行, 最大页码, 子分类 list id, info-tab 表格数)"""
    # 表头
    m = re.search(r'<ul\s+class="cp-list-top"[^>]*>(.*?)</ul>', s, re.I | re.S)
    cols = [clean(x) for x in re.findall(r'<li[^>]*>(.*?)</li>', m.group(1), re.I | re.S)] if m else []
    # 产品行（可能带颜色 <i class="white">）
    rows = []
    box = re.search(r'<div\s+class="cp-txt"\s+id="ajax_prolists"[^>]*>(.*?)</div>', s, re.I | re.S)
    if box:
        for a in re.finditer(
                r'<a\s+href="[^"\']*/show/(\d+)\.html"[^>]*>\s*<ul\s+class="cp-contect"[^>]*>(.*?)</ul>',
                box.group(1), re.I | re.S):
            sid, body = a.group(1), a.group(2)
            lis = re.findall(r'<li[^>]*>(.*?)</li>', body, re.I | re.S)
            cells = [clean(x) for x in lis]
            colors = [c for x in lis for c in re.findall(r'<i\s+class="([^"]+)"', x, re.I)]
            rows.append({'id': sid, 'cells': cells, 'colors': colors})
    # 分页（HTML 里是 &amp;page=N，必须先反转义）
    nums = [int(x) for x in re.findall(r'[?&]page=(\d+)', html.unescape(s))]
    maxpage = max(nums) if nums else 1
    # 子分类（全站导航里的 list 链接，用于 BFS 发现隐藏系列页）
    subs = set(re.findall(r'/list/(\d+)\.html', s))
    # 系列汇总表
    ntab = len(re.findall(r'<table[^>]*class="info-tab"', s, re.I))
    return cols, rows, maxpage, subs, ntab


def seed_ids():
    if not os.path.exists(SEED_HOME):
        s = fetch(BASE + '/')
        os.makedirs(os.path.dirname(SEED_HOME), exist_ok=True)
        io.open(SEED_HOME, 'w', encoding='utf-8', newline='\n').write(s or '')
    else:
        s = io.open(SEED_HOME, encoding='utf-8').read()
    ids, names = set(), {}
    for m in re.finditer(r'<a\b[^>]*href=["\'][^"\']*?/list/(\d+)\.html[^"\']*["\'][^>]*>(.*?)</a>',
                         s, re.I | re.S):
        cid, t = m.group(1), clean(m.group(2))
        ids.add(cid)
        if t and cid not in names:
            names[cid] = t
    return ids, names


# ---------------------------------------------------------------- stages
def stage_discover(args):
    ids, names = seed_ids()
    print(f'种子分类 {len(ids)} 个', flush=True)
    seen, queue, meta = set(), sorted(ids, key=int), {}
    round_no = 0
    while queue and round_no < 6:
        round_no += 1
        todo = [c for c in queue if c not in seen]
        print(f'第 {round_no} 轮：待抓 {len(todo)} 个分类', flush=True)
        new = set()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(get_page, c, 1, args.force): c for c in todo}
            for fu in as_completed(futs):
                cid = futs[fu]
                s = fu.result()
                seen.add(cid)
                if not s:
                    print(f'  !! list/{cid} 抓取失败', flush=True)
                    continue
                cols, rows, maxpage, subs, ntab = parse_list(s)
                meta[cid] = {'cols': cols, 'n1': len(rows), 'pages': maxpage,
                             'tabs': ntab, 'name': names.get(cid, '')}
                for x in subs:
                    if x not in seen:
                        new.add(x)
                        if x not in names:
                            names[x] = ''
        queue = sorted(new, key=int)
        print(f'  新发现 {len(new)} 个分类 id', flush=True)

    # 名称回填：从任一页面导航里找锚文本
    for cid in list(meta):
        if not meta[cid]['name']:
            p = cache_path(cid, 1)
            if os.path.exists(p):
                s = io.open(p, encoding='utf-8').read()
                for m in re.finditer(
                        r'<a\b[^>]*href=["\'][^"\']*?/list/' + cid + r'\.html[^"\']*["\'][^>]*>(.*?)</a>',
                        s, re.I | re.S):
                    t = clean(m.group(1))
                    if t:
                        meta[cid]['name'] = t
                        break
    out = os.path.join('tmp', 'cst', 'discover.json')
    io.open(out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(meta, ensure_ascii=False, indent=1))
    prod = {k: v for k, v in meta.items() if v['n1'] > 0}
    print(f'\n分类总数 {len(meta)}，其中有产品的 {len(prod)} 个', flush=True)
    print(f'第一页产品合计 {sum(v["n1"] for v in prod.values())} 行，'
          f'按分页估算总量约 {sum(v["n1"] * v["pages"] for v in prod.values())} 行', flush=True)
    print(f'写出 {out}', flush=True)
    for k, v in sorted(prod.items(), key=lambda x: int(x[0]))[:15]:
        print(f'  {k:>4} {v["name"][:26]:<28} 首页{v["n1"]:>3} 页{v["pages"]:>3} 列{len(v["cols"])}', flush=True)


def stage_pages(args):
    p = os.path.join('tmp', 'cst', 'discover.json')
    meta = json.load(io.open(p, encoding='utf-8'))
    jobs = [(cid, pg) for cid, v in meta.items() if v['n1'] > 0
            for pg in range(2, min(v['pages'], args.maxpage) + 1)]
    print(f'需翻页 {len(jobs)} 个请求', flush=True)
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(get_page, c, pg, args.force): (c, pg) for c, pg in jobs}
        for fu in as_completed(futs):
            if fu.result():
                ok += 1
            else:
                fail += 1
                print('  !! 失败', futs[fu], flush=True)
            if (ok + fail) % 50 == 0:
                print(f'  进度 {ok + fail}/{len(jobs)}', flush=True)
    print(f'完成 ok={ok} fail={fail}', flush=True)


def stage_collect(args):
    meta = json.load(io.open(os.path.join('tmp', 'cst', 'discover.json'), encoding='utf-8'))
    products, by_cat = [], {}
    for cid, v in meta.items():
        if not v['n1']:
            continue
        rows = []
        for pg in range(1, v['pages'] + 1):
            p = cache_path(cid, pg)
            if not os.path.exists(p):
                continue
            s = io.open(p, encoding='utf-8').read()
            cols, rr, _, _, _ = parse_list(s)
            rows.extend(rr)
        # 去重（同型号可能出现在父子分类）
        uniq = {}
        for r in rows:
            model = r['cells'][0] if r['cells'] else ''
            if model:
                uniq[model] = r
        by_cat[cid] = {'name': v['name'], 'cols': v['cols'], 'rows': list(uniq.values())}
        for r in uniq.values():
            products.append({'cid': cid, 'cat': v['name'], 'cols': v['cols'],
                             'id': r['id'], 'cells': r['cells'], 'colors': r['colors']})
    out = os.path.join('tmp', 'cst', 'products.json')
    io.open(out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps({'byCat': by_cat, 'products': products}, ensure_ascii=False, indent=1))
    print(f'分类 {len(by_cat)} 个，产品行 {len(products)} 条，'
          f'唯一型号 {len(set(p["cells"][0] for p in products))} 个', flush=True)
    print(f'写出 {out}', flush=True)
    # 按分类打印规模，便于决定映射
    for cid, v in sorted(by_cat.items(), key=lambda x: -len(x[1]['rows']))[:25]:
        print(f'  {cid:>4} {v["name"][:30]:<32} {len(v["rows"]):>5}  {"/".join(v["cols"][:5])}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['discover', 'pages', 'collect', 'series', 'details'])
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--maxpage', type=int, default=100)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    stage = {'discover': stage_discover, 'pages': stage_pages, 'collect': stage_collect,
             'series': stage_series, 'details': stage_details}[args.stage]
    stage(args)


if __name__ == '__main__':
    main()
