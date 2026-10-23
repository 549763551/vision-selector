# -*- coding: utf-8 -*-
"""从华睿《机器视觉产品手册中文版 V20260901》抽取相机型号库（面阵）。

算法 v2：
  - 逐页取行 bbox；
  - 定位每张表的“产品型号”表头，收集双行表头列（含子表头 型号/像元/快门/颜色/靶面…）；
  - 用“型号锚点行”确定每行 y，再把每个数据单元格按 x 归位到最近列，并按 y 容差归到对应锚点行；
  - 对未归位的错位单元格（同逻辑行但 y 偏移）做二次补捞；
  - 清洗字段、剥离型号前导 '*'、按 M/C 颜色变体拆分；输出 JSON + UMD 目录。
"""
import pymupdf, re, json, statistics
from collections import Counter

PDF = r"C:\Users\54976\Desktop\视觉\vision-selector\manuals\机器视觉产品手册中文版V20260901.pdf"
OUT_JSON = r"C:\Users\54976\Desktop\视觉\vision-selector\tools\_cache\huarui_cams.json"
OUT_JS = r"C:\Users\54976\Desktop\视觉\vision-selector\huarui-catalog.js"

def norm_key(t):
    s = re.sub(r"[\s()（）]", "", t)
    if "产品型号" in s: return "model"
    if s == "型号": return "sensor"      # 子表头“型号”= 传感器型号，区别于“产品型号”
    if s.startswith("传感器"): return "sensor"
    if "分辨率" in s: return "res"
    if "帧率" in s: return "fps"
    if "位深" in s: return "bit"
    if "像元" in s: return "px"
    if "靶面" in s: return "size"
    if "快门" in s: return "shutter"
    if "颜色" in s: return "color"
    if "曝光" in s: return "exp"
    if "传输接口" in s or s == "接口": return "iface"
    if "相机尺寸" in s or "尺寸外观" in s: return "dims"
    if "镜头接口" in s: return "mount"
    if "适配镜头" in s: return "lens"
    if "供电" in s: return "power"
    if s == "类型": return "stype"
    if "像素" in s: return "mp"
    return None

IFACE_MAP = [("10GigE", "10GigE"), ("万兆", "10GigE"),
             ("GigE", "GigE"),
             ("USB3", "USB3"), ("USB 3", "USB3"),
             ("Serdes", "Serdes"), ("Serdes", "Serdes"),
             ("CXP", "CoaXPress"), ("CoaXPress", "CoaXPress"),
             ("CameraLink", "CameraLink"), ("Camera Link", "CameraLink")]
def map_iface(t):
    t = t or ""
    for k, v in IFACE_MAP:
        if k.lower() in t.lower():
            return v
    return None

def norm_mount(t):
    t = re.sub(r"\s", "", t or "")
    if not t: return None
    if t.startswith("CS"): return "CS"
    if t.startswith("C") and "M42" not in t and "M58" not in t and "M72" not in t: return "C"
    if "M42" in t: return "M42"
    if "M58" in t: return "M58"
    if "M72" in t: return "M72"
    if t.startswith("F"): return "F"
    if "M12" in t: return "M12"
    return None

MODEL_LOOSE = re.compile(r"A[A-Z]{0,2}\d[A-Z0-9]*(?:/[A-Z]{1,3}\d{0,3})?")
def clean_model(t):
    return re.sub(r"[^A-Za-z0-9/]", "", t or "")

def center(ln):
    return (ln["x0"] + ln["x1"]) / 2.0

def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0: continue
        for ln in b["lines"]:
            txt = "".join(s["text"] for s in ln["spans"]).strip()
            if not txt: continue
            x0, y0, x1, y1 = ln["bbox"]
            out.append({"t": txt, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return out

def is_title(t):
    tt = t.strip()
    if "相机" not in tt: return False
    if any(w in tt for w in ["参数", "特性", "手册", "尺寸图", "外观", "尺寸", "规格", "说明"]): return False
    if len(tt) > 32: return False
    return True

def nearest(cols, cx):
    best, bd = None, 1e9
    for k, kx in cols.items():
        d = abs(cx - kx)
        if d < bd:
            best, bd = k, d
    return best, bd

cams = {}
current_series = None
stats = {"pages": 0, "tables": 0, "anchors": 0, "kept": 0, "skipped_nocore": 0}

doc = pymupdf.open(PDF)
for pno in range(doc.page_count):
    page = doc[pno]
    lines = page_lines(page)
    if not lines: continue
    stats["pages"] += 1

    headers = [ln for ln in lines if norm_key(ln["t"]) == "model"]
    if not headers:
        for ln in lines:
            if is_title(ln["t"]) and ln["y0"] < 760:
                current_series = re.sub(r"\s+", "", ln["t"])
        continue

    headers.sort(key=lambda l: l["y0"])
    for hi, hd in enumerate(headers):
        hy = hd["y0"]
        y_end = (headers[hi + 1]["y0"] - 14) if hi + 1 < len(headers) else 820
        stats["tables"] += 1

        # 表头单元（主行 + 子行），y 在 [hy-18, hy+42]
        hcells = [ln for ln in lines if hy - 18 <= ln["y0"] <= hy + 42 and norm_key(ln["t"])]
        cols = {}
        for ln in hcells:
            k = norm_key(ln["t"])
            if ln["t"].startswith("("): continue
            if k is None: continue
            cx = center(ln)
            if k == "sensor":
                # 取最左侧（子表头“型号”常为数据实际所在列）
                if k not in cols or cx < cols[k]:
                    cols[k] = cx
            else:
                if k not in cols:
                    cols[k] = cx
        header_bottom = max((ln["y0"] for ln in hcells), default=hy)

        for ln in sorted(lines, key=lambda l: l["y0"]):
            if ln["y0"] < hy and is_title(ln["t"]):
                current_series = re.sub(r"\s+", "", ln["t"])

        if "res" not in cols or "model" not in cols:
            continue

        # 数据单元
        dcells = [ln for ln in lines if header_bottom + 2 < ln["y0"] < y_end]

        # 每个数据单元归到最近列
        assigned = []  # (cx, y, key, text)
        for ln in dcells:
            cx = center(ln)
            k, d = nearest(cols, cx)
            if k and d <= 72:
                assigned.append((cx, ln["y0"], k, ln["t"]))

        # 型号锚点行
        anchors = []
        for (cx, y, k, t) in assigned:
            if k == "model":
                ms = MODEL_LOOSE.search(clean_model(t))
                if ms and len(ms.group(0)) >= 5:
                    anchors.append(y)
        if not anchors:
            continue
        anchors.sort()
        gaps = [anchors[i + 1] - anchors[i] for i in range(len(anchors) - 1)]
        med = statistics.median(gaps) if gaps else 14
        tol = max(7.0, med * 0.6)

        # 归位到锚点行
        rows = {}        # anchor_y -> {key: text}
        unassigned = []
        for (cx, y, k, t) in assigned:
            a = min(anchors, key=lambda a: abs(a - y))
            if abs(a - y) <= tol:
                rows.setdefault(a, {})
                rows[a][k] = (rows[a].get(k, "") + " " + t).strip()
            else:
                unassigned.append((cx, y, k, t))

        # 二次补捞：把未归位的单元补到最近锚点（限 2*tol，且该列在该锚点尚缺值）
        for (cx, y, k, t) in unassigned:
            a = min(anchors, key=lambda a: abs(a - y))
            if abs(a - y) <= tol * 2 and k not in rows.get(a, {}):
                rows.setdefault(a, {})
                rows[a][k] = (rows[a].get(k, "") + " " + t).strip()

        stats["anchors"] += len(rows)
        for a in anchors:
            rec = rows.get(a, {})
            ms = MODEL_LOOSE.search(clean_model(rec.get("model", "")))
            if not ms or len(ms.group(0)) < 5:
                continue
            model = ms.group(0)
            res = re.search(r"(\d{3,5})\s*[*x×]\s*(\d{3,5})", rec.get("res", ""))
            pxs = re.search(r"([\d.]+)\s*[*x×]\s*([\d.]+)", rec.get("px", ""))
            if not res or not pxs:
                stats["skipped_nocore"] += 1
                continue
            w, h = int(res.group(1)), int(res.group(2))
            pxUm = float(pxs.group(1))
            if w < 320 or h < 240 or pxUm < 0.8 or pxUm > 30:
                continue
            fps = None
            fm = re.search(r"([\d.]+)", rec.get("fps", ""))
            if fm: fps = float(fm.group(1))
            bit = None
            bm = re.search(r"(\d+)", rec.get("bit", ""))
            if bm: bit = int(bm.group(1))
            dims = None
            dm = re.search(r"(\d+)\s*[*x×]\s*(\d+)\s*[*x×]\s*(\d+)", rec.get("dims", ""))
            if dm: dims = [int(dm.group(1)), int(dm.group(2)), int(dm.group(3))]
            iface = map_iface(rec.get("iface", ""))
            mount = norm_mount(rec.get("mount", ""))
            if not mount and current_series and "单板" in current_series:
                # 型录中单板相机表无“镜头接口”列；板级面阵相机行业标准为 C 口（可加 CS 转接环）
                mount = "C"
            sz = rec.get("size", "").replace(" ", "").replace("”", '"').replace("“", '"')
            shutter = "Global" if "Global" in rec.get("shutter", "") else ("Rolling" if "Rolling" in rec.get("shutter", "") else None)
            exp = rec.get("exp", "")
            expMin, expMax = None, None
            em = re.search(r"([\d.]+)\s*(?:μ|µ|u)s", exp)
            if em: expMin = float(em.group(1))
            es = re.search(r"~([\d.]+)\s*(?:sec|s)\b", exp)
            if es: expMax = float(es.group(1)) * 1e6
            elif "s" in exp.lower():
                es2 = re.search(r"([\d.]+)\s*s\b", exp)
                if es2: expMax = float(es2.group(1)) * 1e6

            base = {
                "w": w, "h": h, "pxUm": pxUm,
                "sw": round(w * pxUm / 1000, 3), "sh": round(h * pxUm / 1000, 3),
                "size": sz or None, "fps": fps, "shutter": shutter,
                "iface": iface, "mount": mount, "series": current_series,
                "sensor": rec.get("sensor") or None, "bit": bit, "dims": dims,
                "expMinUs": expMin, "expMaxUs": expMax, "lens": rec.get("lens") or None,
                "power": rec.get("power") or None, "colorRaw": rec.get("color") or None,
            }
            colorRaw = (rec.get("color") or "").upper().replace(" ", "")
            variants = ["黑白", "彩色"] if ("M" in colorRaw and "C" in colorRaw) else (["彩色"] if "C" in colorRaw else ["黑白"])
            for col in variants:
                m2 = model
                if col == "彩色":
                    if "/" in model:
                        a, b = model.split("/", 1)
                        m2 = re.sub(r"M$", "C", a) + "/" + b
                    else:
                        m2 = re.sub(r"M$", "C", model)
                elif "/" in model:
                    a, b = model.split("/", 1)
                    m2 = re.sub(r"C$", "M", a) + "/" + b
                if m2 in cams:
                    continue
                d = dict(base)
                d["model"] = m2
                d["color"] = col
                d["kind"] = "area"
                d["brand"] = "华睿"
                cams[m2] = d
                stats["kept"] += 1

cams_list = sorted(cams.values(), key=lambda c: (c["w"] * c["h"], c["model"]))
json.dump(cams_list, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---- 线阵相机：由 parse-huarui-linescan.py 生成，读入合并 ----
LINESCAN_JSON = "tools/_cache/huarui_linescan.json"
try:
    linescan_list = json.load(open(LINESCAN_JSON, encoding="utf-8"))
except Exception:
    linescan_list = []
for r in linescan_list:
    r["brand"] = "华睿"

# ---- 光源 / 光源控制器：由 parse-huarui-lights.py 生成，读入合并 ----
# 颜色按 A 方案拆分（型号尾 W/R/B → 逐色独立型号，红灯功率取 (R) 列，其余取 (G/B/W) 列）
LIGHTS_JSON = "tools/_cache/huarui_lights.json"
CTRLS_JSON = "tools/_cache/huarui_controllers.json"
try:
    lights_list = json.load(open(LIGHTS_JSON, encoding="utf-8"))
except Exception:
    lights_list = []
try:
    ctrls_list = json.load(open(CTRLS_JSON, encoding="utf-8"))
except Exception:
    ctrls_list = []
for r in lights_list:
    r["brand"] = "华睿"
for r in ctrls_list:
    r["brand"] = "华睿"

# ---- 生成 UMD 目录 ----
META = {"source": "机器视觉产品手册中文版V20260901", "brand": "华睿（大华机器视觉）",
        "generated": "2026-10-23", "cameras": len(cams_list), "linescan": len(linescan_list),
        "lights": len(lights_list), "controllers": len(ctrls_list)}
js = []
js.append("/**")
js.append(" * 华睿（大华机器视觉）型号库 —— 面阵 + 线阵 + 光源 + 光源控制器")
js.append(" * 来源：机器视觉产品手册中文版V20260901；生成脚本：tools/parse-huarui.py（面阵）+ tools/parse-huarui-linescan.py（线阵）+ tools/parse-huarui-lights.py（光源/控制器）")
js.append(" * 本文件由脚本生成，请勿手工编辑。")
js.append(" */")
js.append("(function (root, factory) {")
js.append("  if (typeof module === 'object' && module.exports) module.exports = factory();")
js.append("  else root.HuaruiCatalog = factory();")
js.append("})(typeof self !== 'undefined' ? self : this, function () {")
js.append("  'use strict';")
js.append("  var META = " + json.dumps(META, ensure_ascii=False) + ";")
js.append("  var CAMERAS = [")
for c in cams_list:
    c2 = {k: c[k] for k in c}
    js.append("    " + json.dumps(c2, ensure_ascii=False) + ",")
js.append("  ];")
js.append("  var LINESCAN = [")
for r in linescan_list:
    js.append("    " + json.dumps(r, ensure_ascii=False) + ",")
js.append("  ];")
js.append("  var LIGHTS = [")
for r in lights_list:
    js.append("    " + json.dumps(r, ensure_ascii=False) + ",")
js.append("  ];")
js.append("  var CONTROLLERS = [")
for r in ctrls_list:
    js.append("    " + json.dumps(r, ensure_ascii=False) + ",")
js.append("  ];")
js.append("  return { META: META, CAMERAS: CAMERAS, LINESCAN: LINESCAN, LIGHTS: LIGHTS, CONTROLLERS: CONTROLLERS };")
js.append("});")
open(OUT_JS, "w", encoding="utf-8").write("\n".join(js) + "\n")

byser = Counter(c["series"] for c in cams_list)
byif = Counter(c["iface"] for c in cams_list)
bycol = Counter(c["color"] for c in cams_list)
miss = {k: sum(1 for c in cams_list if not c.get(k)) for k in ["fps", "iface", "mount", "size", "shutter", "sensor"]}
print("stats", stats)
print("total cameras:", len(cams_list))
print("by iface:", dict(byif))
print("by color:", dict(bycol))
print("missing fields:", miss)
print("linescan:", len(linescan_list), "| lights:", len(lights_list), "| controllers:", len(ctrls_list))
print("by series:")
for k, v in byser.most_common():
    print("  %-34s %d" % (k, v))
print("\nsamples (AB/AC/AV/AX):")
for c in cams_list:
    if c["model"].startswith(("AB", "AC", "AV", "AX")):
        print(" ", {k: c[k] for k in ["model", "series", "w", "h", "pxUm", "fps", "iface", "mount", "color", "shutter", "size", "dims", "sensor"]})
