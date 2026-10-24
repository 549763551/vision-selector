#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 tools/fetch-basler-lenses.js 抓到的 JSON 合成 basler-lens-catalog.js：
  LENSES       C/F 口定焦镜头（FA）
  TELECENTRIC  C 口远心镜头（固定倍率）
用法：
  node tools/fetch-basler-lenses.js > tools/_cache/basler-lenses.json
  python tools/gen-basler-lens-catalog.py tools/_cache/basler-lenses.json > basler-lens-catalog.js
"""
import json, sys
from datetime import date

def main(path):
    data = json.load(open(path, encoding='utf-8'))
    fa = [x for x in data if not x.get('tele')]
    tele = [x for x in data if x.get('tele')]

    def js(v):
        if v is None:
            return 'null'
        if isinstance(v, (int, float)):
            return str(v)
        return '"%s"' % str(v).replace('\\', '\\\\').replace('"', '\\"')

    def lens_obj(x):
        return '{ "model": %s, "brand": "Basler", "series": "Basler 定焦镜头", "focal": %s, "fmin": %s, "fmax": %s, "mount": %s, "ic": %s, "fmt": %s, "mp": %s, "dist": null, "minDist": %s, "len": null }' % (
            js(x.get('model')), js(x.get('focal')), js(x.get('fmin')), js(x.get('fmax')),
            js(x.get('mount')), js(x.get('ic')), js(x.get('fmt')), js(x.get('mp')), js(x.get('minDist')))

    def tele_obj(x):
        return '{ "series": "Basler 远心镜头", "model": %s, "brand": "Basler", "magMin": %s, "magMax": %s, "wdMin": %s, "wdMax": %s, "fmt": %s, "mount": %s, "coax": false, "kind": "远心" }' % (
            js(x.get('model')), js(x.get('mag')), js(x.get('mag')), js(x.get('wd')), js(x.get('wd')),
            js(x.get('fmt')), js(x.get('mount')))

    out = ['''/**
 * Basler 镜头库（C/F 口定焦 + C 口远心）
 * 来源：docs.baslerweb.com 镜头规格页（联网抓取）
 * 抓取脚本：tools/fetch-basler-lenses.js    合成脚本：tools/gen-basler-lens-catalog.py
 * 生成日期：%s
 * 定焦 %d 支（C 口 %d + F 口 %d）；远心 %d 款。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BaslerLensCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "docs.baslerweb.com 镜头规格页", "brand": "Basler", "generated": "%s",
    "lenses": %d, "telecentric": %d};
''' % (date.today().isoformat(), len(fa), sum(1 for x in fa if x.get('mount') == 'C'), sum(1 for x in fa if x.get('mount') == 'F'), len(tele), date.today().isoformat(), len(fa), len(tele))]
    out.append('  var LENSES = [\n    ' + ',\n    '.join(lens_obj(x) for x in fa) + '\n  ];')
    out.append('  var TELECENTRIC = [\n    ' + ',\n    '.join(tele_obj(x) for x in tele) + '\n  ];')
    out.append('  return { META: META, LENSES: LENSES, TELECENTRIC: TELECENTRIC };')
    out.append('});')
    sys.stdout.write('\n'.join(out) + '\n')

if __name__ == '__main__':
    main(sys.argv[1])
