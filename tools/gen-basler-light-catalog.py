#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 tools/fetch-basler-lights.js 抓到的 JSON 合成 basler-light-catalog.js：
  LIGHTS        各型灯具（环形/背光/条形/穹顶/同轴/点/暗场…）
  CONTROLLERS   Basler 灯光控制器
用法：
  node tools/fetch-basler-lights.js > tools/_cache/basler-lights.json
  python tools/gen-basler-light-catalog.py tools/_cache/basler-lights.json > basler-light-catalog.js
"""
import json, re, sys
from datetime import date

TYPE_FIX = {'wide_bar': 'bar', 'bar_array': 'bar'}

def size_from_model(model):
    m = re.search(r'(\d+)\s*[x×]\s*(\d+)', model)
    if m:
        return [int(m.group(1)), int(m.group(2))]
    m = re.search(r'(?:ring|dome|spot|dark ?field)-(\d+)', model, re.I)
    if m:
        return [int(m.group(1))]
    m = re.search(r'(?:bar|flood)-(\d+)', model, re.I)
    if m:
        return [int(m.group(1))]
    return None

def clean_wave(w):
    if not w:
        return None
    w = re.sub(r'\(typical\)', '', w).strip()
    m = re.match(r'(\d{3,4})\s*nm', w)
    return m.group(1) + ' nm' if m else None

def main(path):
    data = json.load(open(path, encoding='utf-8'))
    lights, ctrls = [], []
    seen = set()
    for x in data:
        model = x['model']
        if 'controller' in x.get('type', '') or 'controller' in model.lower():
            if model not in seen:
                seen.add(model)
                ctrls.append({'model': model, 'channels': None, 'mode': 'Basler 灯光控制器',
                              'strobe': True, 'brand': 'Basler'})
            continue
        if model in seen:
            continue
        seen.add(model)
        wave = clean_wave(x.get('wavelength'))
        size = x.get('size') or size_from_model(model)
        lights.append({
            'model': model,
            'type': TYPE_FIX.get(x.get('type'), x.get('type') or 'ring'),
            'color': x.get('color') or 'white',
            'wavelength': wave,
            'size': size,
            'power': x.get('power'),
            'brand': 'Basler',
            'series': 'Basler 灯光',
        })

    def js(v):
        if v is None:
            return 'null'
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, list):
            return '[' + ', '.join(str(i) for i in v) + ']'
        if isinstance(v, (int, float)):
            return str(v)
        v = re.sub(r'\s+', ' ', str(v))
        return '"%s"' % v.replace('\\', '\\\\').replace('"', '\\"')

    def obj(d):
        return '{ ' + ', '.join('"%s": %s' % (k, js(d[k])) for k in d) + ' }'

    out = ['''/**
 * Basler 灯光库（环形/背光/条形/穹顶/同轴/点/暗场等）+ 灯光控制器
 * 来源：docs.baslerweb.com 灯光规格页（联网抓取）
 * 抓取脚本：tools/fetch-basler-lights.js    合成脚本：tools/gen-basler-light-catalog.py
 * 生成日期：%s
 * 灯具 %d 款（含颜色变体）；控制器 %d 款。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BaslerLightCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "docs.baslerweb.com 灯光规格页", "brand": "Basler", "generated": "%s",
    "lights": %d, "controllers": %d};
''' % (date.today().isoformat(), len(lights), len(ctrls), date.today().isoformat(), len(lights), len(ctrls))]
    out.append('  var LIGHTS = [\n    ' + ',\n    '.join(obj(x) for x in lights) + '\n  ];')
    out.append('  var CONTROLLERS = [\n    ' + ',\n    '.join(obj(x) for x in ctrls) + '\n  ];')
    out.append('  return { META: META, LIGHTS: LIGHTS, CONTROLLERS: CONTROLLERS };')
    out.append('});')
    sys.stdout.write('\n'.join(out) + '\n')

if __name__ == '__main__':
    main(sys.argv[1])
