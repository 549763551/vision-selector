# -*- coding: utf-8 -*-
r"""华睿 iRayple 官网镜头/远心型号：走站点自身 JSON 接口。

站点是 React SPA，curl 抓 HTML 只会得到 1109 字节空壳（被 WAF 挡时是 23670 字节挑战页），
型号数据在 XHR 里。用 Chrome DevTools Protocol 监听一次就能看到：
  /api/cn/vision/productSeries?id=121          → 镜头下的三个子类
  /api/cn/vision/productListNew?id=<navId>     → 型号列表（每页 16 条，data.count 给总数）
  /api/cn/vision/attributes?id=<navId>         → 属性名（多数子类返回空，靠 item 的键序兜底）

用法：py -3 tools/fetch-huarui-lens.py
产物：tools/_cache/huarui_lens.json
"""
import io
import json
import os
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '_cache', 'huarui')
BASE = 'https://www.irayple.com'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
REFERER = BASE + '/cn/product/vision?id=9&navId=121'

# navId → 类型标签（121 是「镜头」总类，下面是三个子类）
SUBS = [('122', '面阵镜头'), ('187', '线阵及大面阵镜头'), ('188', '远心镜头')]


def api(path):
    url = BASE + path
    r = subprocess.run(['curl', '-s', '-m', '40', '-A', UA, '-H', 'Referer: ' + REFERER, url],
                       capture_output=True)
    txt = r.stdout.decode('utf-8', 'replace')
    try:
        j = json.loads(txt)
    except Exception:
        raise RuntimeError(f'接口返回非 JSON：{path} → {len(txt)} 字节')
    if j.get('status') != '00':
        raise RuntimeError(f'接口状态异常：{path} → {j.get("status")} {j.get("message")}')
    return j.get('data')


def fetch_sub(nav_id, label):
    # 属性名：多数子类给空，先用返回的 dict 里的 name 字段兜底
    attrs = {}
    try:
        a = api(f'/api/cn/vision/attributes?id={nav_id}')
        if isinstance(a, dict):
            for k, v in a.items():
                if isinstance(v, dict) and v.get('name'):
                    attrs[str(k)] = v['name']
    except Exception as e:
        print('  属性接口失败：', e)

    rows, page = [], 1
    while True:
        d = api(f'/api/cn/vision/productListNew?id={nav_id}&attr=&page={page}&type=')
        lst = d.get('list') or []
        rows.extend(lst)
        if page >= (d.get('totalPage') or 1):
            break
        page += 1
        time.sleep(0.5)
    print(f'  {label}({nav_id}): {len(rows)} 款 / 声明 {d.get("count")}')
    return [{'navId': nav_id, 'sub': label, 'model': r.get('model'),
             'item': {attrs.get(k, k): v for k, v in (r.get('item') or {}).items()},
             'raw_item': r.get('item')} for r in rows]


def main():
    os.makedirs(CACHE, exist_ok=True)
    out = []
    for nav_id, label in SUBS:
        out.extend(fetch_sub(nav_id, label))
    with io.open(os.path.join(CACHE, 'huarui_lens.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'\n合计 {len(out)} 款 → tools/_cache/huarui/huarui_lens.json')
    # 打印每个子类的参数键顺序，便于写字段映射
    for nav_id, label in SUBS:
        sub = [x for x in out if x['navId'] == nav_id]
        if sub:
            print(f'\n{label} 键：{list(sub[0]["item"].keys())}')
            print('  样例：', json.dumps(sub[0]['item'], ensure_ascii=False))


if __name__ == '__main__':
    main()
