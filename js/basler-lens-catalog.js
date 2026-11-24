/**
 * Basler 镜头库（C/F 口定焦 + C 口远心）
 * 来源：docs.baslerweb.com 镜头规格页（联网抓取）
 * 抓取脚本：tools/fetch-basler-lenses.js    合成脚本：tools/gen-basler-lens-catalog.py
 * 生成日期：2026-10-24
 * 定焦 46 支（C 口 42 + F 口 4）；远心 22 款。请勿手工编辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BaslerLensCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var META = {"source": "docs.baslerweb.com 镜头规格页", "brand": "Basler", "generated": "2026-10-24",
    "lenses": 46, "telecentric": 22};

  var LENSES = [
    { "model": "C10-0814-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8.25, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 2, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C10-1214-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12.7, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 2, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C10-1614-3M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16.2, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 3, "dist": null, "minDist": 0.3, "len": null },
    { "model": "C10-2514-3M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 3, "dist": null, "minDist": 0.3, "len": null },
    { "model": "C10-3514-8M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 8, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C10-5014-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 50, "fmin": 1.4, "fmax": 16, "mount": "C", "ic": 16, "fmt": "1\"", "mp": 2, "dist": null, "minDist": 0.5, "len": null },
    { "model": "C11-0824-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8.46, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C11-1220-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12.39, "fmin": 2, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C11-1620-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16.36, "fmin": 2, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C11-2520-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25.4, "fmin": 2, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C11-3520-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35, "fmin": 2, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.15, "len": null },
    { "model": "C11-5020-12M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 49.7, "fmin": 2, "fmax": 16, "mount": "C", "ic": 17.6, "fmt": "1.1\"", "mp": 12, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C12-1224-25M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 19.3, "fmt": "1.2\"", "mp": 25, "dist": null, "minDist": 100, "len": null },
    { "model": "C12-1624-25M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 19.3, "fmt": "1.2\"", "mp": 25, "dist": null, "minDist": 100, "len": null },
    { "model": "C12-2524-25M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25.4, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 19.3, "fmt": "1.2\"", "mp": 25, "dist": null, "minDist": 150, "len": null },
    { "model": "C12-3524-25M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 19.3, "fmt": "1.2\"", "mp": 25, "dist": null, "minDist": 150, "len": null },
    { "model": "C12-5024-25M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 49.8, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 19.3, "fmt": "1.2\"", "mp": 25, "dist": null, "minDist": 200, "len": null },
    { "model": "C125-0418-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 4.09, "fmin": 1.8, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C125-0618-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 6.05, "fmin": 1.8, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C125-0818-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8.11, "fmin": 1.8, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C125-1218-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12.05, "fmin": 1.8, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C125-1620-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16, "fmin": 2, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C125-2522-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25, "fmin": 2.2, "fmax": 22, "mount": "C", "ic": 7.3, "fmt": "2.5\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-0816-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8.6, "fmin": 1.6, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.25, "len": null },
    { "model": "C23-0824-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8.06, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-0828-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 8, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-1216-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12.3, "fmin": 1.6, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-1224-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12.01, "fmin": 2.4, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.15, "len": null },
    { "model": "C23-1228-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 12, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-1616-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16.5, "fmin": 1.6, "fmax": 22, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-1620-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16.09, "fmin": 2, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-1628-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 16, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-2518-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25.8, "fmin": 1.8, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.3, "len": null },
    { "model": "C23-2518-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 24.9, "fmin": 1.8, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-2528-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 25, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.1, "len": null },
    { "model": "C23-3520-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 34.3, "fmin": 2, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.35, "len": null },
    { "model": "C23-3520-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35.09, "fmin": 2, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-3528-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.15, "len": null },
    { "model": "C23-5026-2M-S", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 49.5, "fmin": 2.6, "fmax": 32, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 2, "dist": null, "minDist": 0.3, "len": null },
    { "model": "C23-5028-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 50, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.2, "len": null },
    { "model": "C23-5028-5M-P", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 48, "fmin": 2.8, "fmax": 16, "mount": "C", "ic": 11, "fmt": "2/3\"", "mp": 5, "dist": null, "minDist": 0.4, "len": null },
    { "model": "C23-7538-16M", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 75, "fmin": 3.8, "fmax": 16, "mount": "C", "ic": 11.8, "fmt": "2/3\"", "mp": 16, "dist": null, "minDist": 0.25, "len": null },
    { "model": "F-S35-2528-45M-S-SD", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 24.5, "fmin": 2.8, "fmax": 22, "mount": "F", "ic": 32, "fmt": null, "mp": 45, "dist": null, "minDist": 0.17, "len": null },
    { "model": "F-S35-3528-45M-S-SD", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 35.3, "fmin": 2.8, "fmax": 22, "mount": "F", "ic": 32, "fmt": null, "mp": 45, "dist": null, "minDist": 0.2, "len": null },
    { "model": "F-S35-5028-45M-S-SD", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 50.5, "fmin": 2.8, "fmax": 22, "mount": "F", "ic": 32, "fmt": null, "mp": 45, "dist": null, "minDist": 0.22, "len": null },
    { "model": "F-S35-7528-45M-S-SD", "brand": "Basler", "series": "Basler 定焦镜头", "focal": 75, "fmin": 2.8, "fmax": 22, "mount": "F", "ic": 32, "fmt": null, "mp": 45, "dist": null, "minDist": 0.34, "len": null }
  ];
  var TELECENTRIC = [
    { "series": "Basler 远心镜头", "model": "C11T-05-110-VI-C", "brand": "Basler", "magMin": 0.5, "magMax": 0.5, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-05-110-VI", "brand": "Basler", "magMin": 0.5, "magMax": 0.5, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-08-110-VI-C", "brand": "Basler", "magMin": 0.8, "magMax": 0.8, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-08-110-VI", "brand": "Basler", "magMin": 0.8, "magMax": 0.8, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-1-110-VI-C", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-1-110-VI", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-2-110-VI-C", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-2-110-VI", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 110, "wdMax": 110, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-4-110-VI-C", "brand": "Basler", "magMin": 4, "magMax": 4, "wdMin": 108, "wdMax": 108, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C11T-4-110-VI", "brand": "Basler", "magMin": 4, "magMax": 4, "wdMin": 108, "wdMax": 108, "fmt": "1.1\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-1-80-VI-C", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 80, "wdMax": 80, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-1-80-VI", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 80, "wdMax": 80, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-2-63-VI-C", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 63, "wdMax": 63, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-2-63-VI", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 63, "wdMax": 63, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-4-63-VI-C", "brand": "Basler", "magMin": 4, "magMax": 4, "wdMin": 60, "wdMax": 60, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C12T-4-63-VI", "brand": "Basler", "magMin": 4, "magMax": 4, "wdMin": 60, "wdMax": 60, "fmt": "1.2\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-03-110-VI-C", "brand": "Basler", "magMin": 0.3, "magMax": 0.3, "wdMin": 110, "wdMax": 110, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-03-110-VI", "brand": "Basler", "magMin": 0.3, "magMax": 0.3, "wdMin": 110, "wdMax": 110, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-1-110-VI-C", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 108, "wdMax": 108, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-1-110-VI", "brand": "Basler", "magMin": 1, "magMax": 1, "wdMin": 108, "wdMax": 108, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-2-110-VI-C", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 108, "wdMax": 108, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" },
    { "series": "Basler 远心镜头", "model": "C23T-2-110-VI", "brand": "Basler", "magMin": 2, "magMax": 2, "wdMin": 108, "wdMax": 108, "fmt": "2/3\"", "mount": "C", "coax": false, "kind": "远心" }
  ];
  return { META: META, LENSES: LENSES, TELECENTRIC: TELECENTRIC };
});
