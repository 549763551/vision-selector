# -*- coding: utf-8 -*-
"""
Basler 相机型号库生成器
数据来源：Basler 官网产品规格（baslerweb.com / 机器视觉产品页），经联网检索整理。
覆盖 ace / ace 2 / boost 三大面阵系列，接口含 GigE / USB3 / CameraLink / 10GigE / CoaXPress。
命名规则：
  ace        : acA<宽>-<帧率>[接口字母][m/c]   g=GigE  u=USB3  k=CameraLink
  ace 2      : a2A<宽>-<帧率>[接口字母][m/c]   g=GigE  u=USB3  g10=10GigE  c=CoaXPress
  boost(CXP) : boA<宽>-<帧率>c[m/c]            c=CoaXPress（所有 boost 均为 CXP-12）
仅相机支持多品牌（镜头/光源仍由海康提供），故本文件只产出 CAMERAS。
生成：python tools/parse-basler.py  ->  basler-catalog.js
"""
import json
import datetime

# 每个机型基础信息（同一机型同时生成 黑白/彩色 两款）
# prefix   : 型号前缀（含分辨率与帧率），如 "acA720-290"
# series   : 中文系列名
# iface_c  : 接口字母（拼到型号里），g/u/k/g10/c
# iface    : 引擎接口词（GigE/USB3/CameraLink/10GigE/CoaXPress）
# w,h      : 像素分辨率
# pxUm     : 像元尺寸 µm
# size     : 靶面光学尺寸
# fps      : 最大帧率
# shutter  : 快门 Global/Rolling
# sensor   : 传感器型号
BASE = [
    # ---------------- ace (GigE) ----------------
    ("acA720-290",  "ace (GigE)",      "g",  "GigE",       720, 540,  6.9,  "1/2.9\"", 291, "Global", "IMX287"),
    ("acA1920-48",  "ace (GigE)",      "g",  "GigE",       1920,1200,  4.8,  "2/3\"",   50,  "Global", "PYTHON2000"),
    ("acA2040-25",  "ace (GigE)",      "g",  "GigE",       2048,2048,  5.5,  "1\"",     25,  "Global", "CMV4000"),
    ("acA3088-16",  "ace (GigE)",      "g",  "GigE",       3072,2048,  2.4,  "1/1.8\"", 16,  "Global", "IMX178"),
    ("acA3800-10",  "ace (GigE)",      "g",  "GigE",       3664,2748,  1.67, "1/2.3\"", 10,  "Global", "MT9J003"),
    ("acA4112-8",   "ace (GigE)",      "g",  "GigE",       4096,3000,  3.45, "1.1\"",   8,   "Global", "IMX304"),
    ("acA5472-17",  "ace (GigE)",      "g",  "GigE",       5472,3648,  2.4,  "1/2.5\"", 17,  "Global", "IMX183"),

    # ---------------- ace (Camera Link) ----------------
    ("acA2000-340", "ace (CameraLink)","k",  "CameraLink", 2048,1088,  5.5,  "2/3\"",   340, "Global", "CMV2000"),
    ("acA2040-180", "ace (CameraLink)","k",  "CameraLink", 2048,2048,  5.5,  "1\"",     180, "Global", "CMV4000"),

    # ---------------- ace (USB3) ----------------
    ("acA720-520",  "ace (USB3)",      "u",  "USB3",       720, 540,  6.9,  "1/2.9\"", 525, "Global", "IMX287"),
    ("acA1300-200", "ace (USB3)",      "u",  "USB3",       1280,1024,  4.8,  "1/2\"",   203, "Global", "PYTHON1300"),
    ("acA1920-155", "ace (USB3)",      "u",  "USB3",       1920,1200,  5.86, "1/1.2\"", 164, "Global", "IMX174"),
    ("acA1920-150", "ace (USB3)",      "u",  "USB3",       1920,1200,  4.8,  "2/3\"",   150, "Global", "PYTHON2000"),
    ("acA2440-75",  "ace (USB3)",      "u",  "USB3",       2448,2048,  3.45, "2/3\"",   75,  "Global", "IMX250"),
    ("acA2500-14",  "ace (USB3)",      "u",  "USB3",       2592,1944,  2.2,  "1/2.5\"", 14,  "Rolling","MT9P031"),
    ("acA3088-57",  "ace (USB3)",      "u",  "USB3",       3072,2048,  2.4,  "1/1.8\"", 57,  "Global", "IMX178"),
    ("acA3800-50",  "ace (USB3)",      "u",  "USB3",       3664,2748,  1.67, "1/2.3\"", 50,  "Global", "MT9J003"),
    ("acA4112-20",  "ace (USB3)",      "u",  "USB3",       4096,3000,  3.45, "1.1\"",   23,  "Global", "IMX304"),
    ("acA5472-60",  "ace (USB3)",      "u",  "USB3",       5472,3648,  2.4,  "1/2.5\"", 60,  "Global", "IMX183"),

    # ---------------- ace 2 (GigE) ----------------
    ("a2A1920-51",  "ace 2 (GigE)",    "g",  "GigE",       1920,1200,  2.9,  "1/2.3\"", 51,  "Global", "IMX392"),
    ("a2A2448-23",  "ace 2 (GigE)",    "g",  "GigE",       2448,2048,  2.74, "1/1.8\"", 23,  "Global", "IMX547"),
    ("a2A4096-9",   "ace 2 (GigE)",    "g",  "GigE",       4096,3000,  3.45, "1/1.1\"", 9,   "Global", "IMX545"),
    ("a2A4504-5",   "ace 2 (GigE)",    "g",  "GigE",       4512,4512,  2.74, "1.1\"",   5,   "Global", "IMX541"),
    ("a2A5320-7",   "ace 2 (GigE)",    "g",  "GigE",       5320,3032,  2.74, "1.1\"",   7,   "Global", "IMX532"),
    ("a2A5328-4",   "ace 2 (GigE)",    "g",  "GigE",       5328,4608,  2.74, "1.2\"",   4,   "Global", "IMX530"),

    # ---------------- ace 2 (USB3) ----------------
    ("a2A1920-160", "ace 2 (USB3)",    "u",  "USB3",       1920,1200,  2.9,  "1/2.3\"", 160, "Global", "IMX392"),
    ("a2A2448-75",  "ace 2 (USB3)",    "u",  "USB3",       2448,2048,  2.74, "1/1.8\"", 75,  "Global", "IMX547"),
    ("a2A4096-30",  "ace 2 (USB3)",    "u",  "USB3",       4096,3000,  3.45, "1/1.1\"", 30,  "Global", "IMX545"),
    ("a2A4504-18",  "ace 2 (USB3)",    "u",  "USB3",       4512,4512,  2.74, "1.1\"",   18,  "Global", "IMX541"),
    ("a2A5320-23",  "ace 2 (USB3)",    "u",  "USB3",       5320,3032,  2.74, "1.1\"",   23,  "Global", "IMX532"),
    ("a2A5328-15",  "ace 2 (USB3)",    "u",  "USB3",       5328,4608,  2.74, "1.2\"",   15,  "Global", "IMX530"),

    # ---------------- ace 2 (10GigE) ----------------
    ("a2A2448-232", "ace 2 (10GigE)",  "g10","10GigE",     2448,2048,  2.74, "1/1.8\"", 232, "Global", "IMX537"),
    ("a2A2840-150", "ace 2 (10GigE)",  "g10","10GigE",     2848,2848,  2.74, "2/3\"",   150, "Global", "IMX536"),
    ("a2A4096-98",  "ace 2 (10GigE)",  "g10","10GigE",     4096,3000,  2.74, "1/1.1\"", 98,  "Global", "IMX535"),
    ("a2A4504-59",  "ace 2 (10GigE)",  "g10","10GigE",     4512,4512,  2.74, "1.1\"",   59,  "Global", "IMX531"),
    ("a2A5320-75",  "ace 2 (10GigE)",  "g10","10GigE",     5320,3032,  2.74, "1.1\"",   75,  "Global", "IMX532"),
    ("a2A5328-49",  "ace 2 (10GigE)",  "g10","10GigE",     5328,4608,  2.74, "1.2\"",   49,  "Global", "IMX530"),

    # ---------------- ace 2 (CoaXPress) ----------------
    ("a2A2448-210", "ace 2 (CoaXPress)","c", "CoaXPress",  2448,2048,  2.74, "1/1.8\"", 212, "Global", "IMX537"),

    # ---------------- boost (CoaXPress / CXP-12) ----------------
    ("boA4096-93",  "boost (CoaXPress)","c", "CoaXPress",  4096,2168,  3.45, "1.1\"",   94,  "Global", "IMX255"),
    ("boA2832-190", "boost (CoaXPress)","c", "CoaXPress",  2848,2848,  2.74, "2/3\"",   190, "Global", "IMX536"),
    ("boA4096-180", "boost (CoaXPress)","c", "CoaXPress",  4096,3008,  2.74, "1/1.1\"", 180, "Global", "IMX535"),
    ("boA4504-100", "boost (CoaXPress)","c", "CoaXPress",  4504,4504,  2.74, "1.1\"",   100, "Global", "IMX531"),
    ("boA5328-100", "boost (CoaXPress)","c", "CoaXPress",  5328,4608,  2.74, "1.2\"",   100, "Global", "IMX530"),
]

def build():
    cams = []
    for (prefix, series, iface_c, iface, w, h, pxUm, size, fps, shutter, sensor) in BASE:
        sw = round(w * pxUm / 1000.0, 3)
        sh = round(h * pxUm / 1000.0, 3)
        # 物理尺寸：ace/ace2 紧凑型 29×29×29；boost 外形 45(L)×80×80
        dims = [29, 29, 29] if not prefix.startswith("boA") else [80, 80, 45]
        # 功耗（典型值，W）：ace ~3.0；ace2 GigE/USB3 ~3.5，10GigE ~6.0；boost ~9.0
        if prefix.startswith("boA"):
            powerW = 9.0
        elif iface == "10GigE":
            powerW = 6.0
        elif series.startswith("ace 2"):
            powerW = 3.5
        else:
            powerW = 3.0
        poe = (iface == "GigE")            # 仅 GigE 支持 PoE
        expMinUs = 1.0 if shutter == "Global" else 20.0
        expMaxUs = 1000000.0
        for suffix_tail, color in (("m", "黑白"), ("c", "彩色")):
            model = prefix + iface_c + suffix_tail
            cams.append({
                "model": model,
                "w": w, "h": h, "pxUm": pxUm,
                "sw": sw, "sh": sh, "size": size,
                "fps": float(fps), "shutter": shutter,
                "iface": iface, "mount": "C", "series": series,
                "sensor": sensor, "dims": dims,
                "expMinUs": expMinUs, "expMaxUs": expMaxUs,
                "poe": poe, "powerW": powerW,
                "color": color, "kind": "area", "brand": "Basler",
            })
    return cams

def main():
    cams = build()
    meta = {
        "source": "Basler 官网产品规格（联网检索整理）",
        "brand": "Basler",
        "generated": datetime.date.today().isoformat(),
        "cameras": len(cams),
    }
    out = []
    out.append("""/**
 * Basler（宝视纳）相机型号库 —— 面阵 area
 * 数据来源：Basler 官网产品规格（baslerweb.com），经联网检索整理；生成脚本：tools/parse-basler.py
 * 本文件由脚本生成，请勿手工编辑。
 */""")
    out.append("(function (root, factory) {")
    out.append("  if (typeof module === 'object' && module.exports) module.exports = factory();")
    out.append("  else root.BaslerCatalog = factory();")
    out.append("})(typeof self !== 'undefined' ? self : this, function () {")
    out.append("  'use strict';")
    out.append("  var META = " + json.dumps(meta, ensure_ascii=False) + ";")
    out.append("  var CAMERAS = " + json.dumps(build(), ensure_ascii=False) + ";")
    out.append("  return { META: META, CAMERAS: CAMERAS, LINESCAN: [], LENSES: [], TELECENTRIC: [], LIGHTS: [], CONTROLLERS: [] };")
    out.append("});")
    text = "\n".join(out) + "\n"
    with open("basler-catalog.js", "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote basler-catalog.js :", len(cams), "cameras")

if __name__ == "__main__":
    main()
