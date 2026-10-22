"""
从《机器视觉标准产品手册-2026.Q3》的外形尺寸图中提取镜头总长（纯程序）。

要点：图纸下方的 A/B/C… 编号是**可提取文本**，用它做锚点切图，
比图像投影切分稳定。每张图纸的总长标注在右侧竖排，裁右侧竖条、
旋转 90° 后 OCR，取 15~250mm 内最大值（总长是图上最大尺寸；Min/Max 取大）。

stdout: {"系列": {"A": 32.53, ...}, ...}
stderr: 逐系列的锚点与识别明细（用于人工抽查）
"""
import json
import re
import sys

import pymupdf
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

PDF = r"C:\Users\54976\Desktop\视觉\机器视觉标准产品手册-2026.Q3.pdf"
DPI = 400
PAGE_RANGE = range(27, 36)
SKIP_SERIES = ("远心",)
COL_SPLIT = 650

ocr = RapidOCR()
_num = re.compile(r"^\d{2,3}(?:\.\d{1,2})?$")
_letter = re.compile(r"^[A-H]$")
_heading = re.compile(r"^([A-Za-z0-9\-]+ ?系列)")


def page_items(page):
    items = []
    for b in page.get_text("blocks"):
        items.append({"col": 0 if b[0] < COL_SPLIT else 1, "x0": b[0], "y0": b[1],
                      "x1": b[2], "y1": b[3], "t": b[4].strip(), "letter": False})
    for w in page.get_text("words"):
        if _letter.match(w[4].strip()):
            items.append({"col": 0 if w[0] < COL_SPLIT else 1, "x0": w[0], "y0": w[1],
                          "x1": w[2], "y1": w[3], "t": w[4].strip(), "letter": True})
    items.sort(key=lambda d: (d["col"], d["y0"], d["x0"]))
    return items


def collect_groups(doc):
    groups, cur = [], None
    for pi in PAGE_RANGE:
        page = doc[pi]
        for it in page_items(page):
            if it["letter"]:
                continue
            head = _heading.match(it["t"])
            if head and ("（" in it["t"] or "(" in it["t"] or "''" in it["t"] or '"' in it["t"]):
                cur = head.group(1).strip()
                continue
            if "外形尺寸图" in it["t"] and cur and not any(s in cur for s in SKIP_SERIES):
                groups.append({"series": cur, "page": pi, "col": it["col"], "label_y": it["y1"]})
    return groups


def find_anchors(items, grp):
    """标签下方的单字母锚点，按行分组、行内按 x 排序"""
    cand = [it for it in items if it["letter"] and it["col"] == grp["col"] and it["y0"] > grp["label_y"] + 2]
    if not cand:
        return []
    cand.sort(key=lambda d: d["y0"])
    rows, cur = [], [cand[0]]
    for it in cand[1:]:
        if abs(it["y0"] - cur[-1]["y0"]) < 30:
            cur.append(it)
        else:
            rows.append(sorted(cur, key=lambda d: d["x0"]))
            cur = [it]
    rows.append(sorted(cur, key=lambda d: d["x0"]))
    return rows


def read_length(img, box):
    x0, y0, x1, y1 = [int(v) for v in box]
    if x1 - x0 < 40 or y1 - y0 < 40:
        return None, []
    strip_w = max(16, int((x1 - x0) * 0.22))
    strip = img.crop((x1 - strip_w, y0, x1, y1))
    rot = strip.rotate(-90, expand=True)
    if rot.width < 8 or rot.height < 8:
        return None, []
    rot = rot.resize((rot.width * 2, rot.height * 2), Image.LANCZOS)
    try:
        res, _ = ocr(rot)
    except Exception:
        return None, []
    nums = []
    for _b, txt, _s in (res or []):
        t = txt.strip().replace(" ", "")
        if _num.match(t):
            v = float(t)
            if 15 <= v <= 250:
                nums.append(v)
    if not nums:
        return None, []
    nums.sort(reverse=True)
    return nums[0], nums[:4]


def main():
    doc = pymupdf.open(PDF)
    out, diag = {}, []
    for grp in collect_groups(doc):
        page = doc[grp["page"]]
        items = page_items(page)
        rows = find_anchors(items, grp)
        if not rows:
            diag.append('%s P%d: 未找到图号' % (grp["series"], grp["page"] + 1))
            continue

        bottom = page.rect.y1 - 6
        for it in items:
            if (not it["letter"] and it["col"] == grp["col"] and it["y0"] > grp["label_y"] + 4
                    and _heading.match(it["t"])):
                bottom = min(bottom, it["y0"] - 4)

        x_left = 20 if grp["col"] == 0 else COL_SPLIT + 10
        x_right = COL_SPLIT - 10 if grp["col"] == 0 else page.rect.x1 - 10
        clip = pymupdf.Rect(x_left, grp["label_y"] + 2, x_right, bottom)
        png = "_grp_%d_%d.png" % (grp["page"], grp["col"])
        page.get_pixmap(clip=clip, dpi=DPI).save(png)
        img = Image.open(png)
        scale = DPI / 72.0

        series_out, detail = {}, []
        prev_row_bottom = clip.y0
        for row in rows:
            row_y = row[0]["y0"]
            for idx, a in enumerate(row):
                left = (row[idx - 1]["x1"] + a["x0"]) / 2 if idx > 0 else a["x0"] - 70
                right = (a["x1"] + row[idx + 1]["x0"]) / 2 if idx + 1 < len(row) else a["x1"] + 70
                box = (
                    (left - clip.x0) * scale,
                    (prev_row_bottom - clip.y0) * scale,
                    (right - clip.x0) * scale,
                    (a["y0"] - 3 - clip.y0) * scale,
                )
                val, cand = read_length(img, box)
                series_out[a["t"]] = val
                detail.append("%s:%s%s" % (a["t"], val, cand[:3]))
            prev_row_bottom = max(x["y1"] for x in row) + 2

        out[grp["series"]] = series_out
        diag.append("%s P%d%s n=%d rows=%d -> %s" % (
            grp["series"], grp["page"] + 1, "L" if grp["col"] == 0 else "R",
            sum(len(r) for r in rows), len(rows), " ".join(detail)))

    sys.stderr.write("\n".join(diag) + "\n")
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
