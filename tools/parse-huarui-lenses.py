# -*- coding: utf-8 -*-
"""
tools/parse-huarui-lenses.py
从 manuals/机器视觉产品手册中文版V20260901.pdf 镜头章节（PDF p80-85/87-88/90，
即 idx 79-86、88）抽取华睿（大华机器视觉）镜头全型号，
输出 tools/_cache/huarui_lenses.json：
    {"lenses": [...], "tele": [...], "unresolved": [...], "families": {...}}

解析手法：pymupdf find_tables 取表格行/单元格几何 rect，用 page.get_text("words")
在 rect 内按 (y,x) 排序拼回单元格文本（避开 extract() 小数点错位），再对整行
token 序列做状态机字段识别；无表格线可识别的页（MK-M，idx 82）退化为按 y 分桶
的行重组，同一状态机处理。

字段口径：focal=焦距mm；fmin/fmax=光圈；ic=像面（Ф值，mm 数字）；fmt=靶面字符串；
mp=支持百万像素；dist=畸变%；minDist=最近对焦mm；len=总长mm；
mount ∈ C/F/M42/M58/M72/M12/V38/CS。未知字段省略，绝不编造。
"""
import json
import os
import re

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "manuals", "机器视觉产品手册中文版V20260901.pdf")
OUT = os.path.join(ROOT, "tools", "_cache", "huarui_lenses.json")

BRAND = "华睿（大华机器视觉）"

# (page_idx, families_key, series_label, default_mp)
PAGES = [
    (79, "A9-6MP", "A9-6MP 系列", 6),
    (80, "MH-SP", "MH-SP 系列", 6),
    (81, "MH-M", "MH-M 系列", 8),
    (82, "MK-M", "MK-M 系列", 10),
    (83, "MH-X", "MH-X 系列", 12),
    (84, "MT-X", "MT-X 系列", 25),
    (85, "MH-K", "MH-K 系列", 10),
    (86, "线扫&大靶面", "线扫&大靶面镜头", None),
    (88, "行业镜头", "行业镜头", None),
]

MODEL_RE = re.compile(
    r"^(?:A9-\d{4}-6MP"
    r"|F\d{2}-[A-Z0-9.]+(?:-[A-Z0-9.]+)+"
    r"|M[KHTR][A-Z]?\d{3,5}[A-Z]{0,3})$")

NUM_RE = re.compile(r"^\d+(?:\.\d+)?$")          # 纯数字 token
M_RE = re.compile(r"^(\d+(?:\.\d+)?)m$")          # “0.2m” 形式（行业镜头摄距 0.x m to inf）
AP_RE = re.compile(r"^F(\d+(?:\.\d+)?)(?:\s*[-–]\s*F?\s*(\d+(?:\.\d+)?|[A-Z]))?", re.I)
PCT_RE = re.compile(r"^([+-]?\d+(?:\.\d+)?)%$")
MOUNT_TOKEN_RE = re.compile(r"^(?:C(?:-Mount)?|M(?:42|58|72)[*×x].*)$", re.I)
LEN_A_RE = re.compile(r"^(\d+(?:\.\d+)?)(?:mm)?\s*[*×x]\s*[ΦФφ\d]")   # "51.4*Φ52" / "77.8mmxФ60"

FMT_KEYS = ("''", "Φ", "Ф", "（", "(")


def merge_split_mount(tokens):
    """把被拆开的接口 token 'M'+'4'+'2'+'×'+'P'+'1' 合并回 'M42×P1'。"""
    out = []
    i = 0
    while i < len(tokens):
        if tokens[i] == "M" and i + 1 < len(tokens) and NUM_RE.match(tokens[i + 1]):
            j = i + 1
            s = "M"
            merged = False
            while j < len(tokens) and j - i <= 6:
                s += tokens[j]
                j += 1
                if re.match(r"^M(?:42|58|72)[*×x]P", s):
                    out.append(s)
                    i = j
                    merged = True
                    break
            if not merged:
                out.append(tokens[i])
                i += 1
            continue
        out.append(tokens[i])
        i += 1
    return out


def cell_text(words, rect):
    if rect is None:
        return ""
    x0, y0, x1, y1 = rect
    ws = [w for w in words
          if x0 - 1 <= (w[0] + w[2]) / 2 <= x1 + 1
          and y0 - 1 <= (w[1] + w[3]) / 2 <= y1 + 1]
    ws.sort(key=lambda w: (round(w[1] / 4), w[0]))
    return " ".join(w[4] for w in ws)


def page_rows(page):
    """返回每行的 token 列表（优先表格行；无表格则按 y 分桶重组）。"""
    words = page.get_text("words")
    tabs = page.find_tables()
    if tabs.tables:
        t = max(tabs.tables, key=lambda tb: tb.row_count * tb.col_count)
        rows = []
        for r in t.rows:
            txt = " ".join(cell_text(words, c) for c in r.cells)
            rows.append(txt.split())
        return rows
    buckets = {}
    for w in words:
        buckets.setdefault(round((w[1] + w[3]) / 12), []).append(w)
    return [" ".join(w[4] for w in sorted(buckets[k], key=lambda w: w[0])).split()
            for k in sorted(buckets)]


def find_model(tokens):
    """找到型号 token（处理换行拆词：'F80-8040-02X-'+'M72-D76'、'F30'+'-2528'+'-M42'）。"""
    for i, tok in enumerate(tokens):
        if not re.match(r"^(?:[AF]|M[KHTR])", tok):
            continue
        cand = tok
        j = i
        while not MODEL_RE.match(cand) and j + 1 < len(tokens) and j - i < 4:
            nxt = tokens[j + 1]
            if cand.endswith("-") or nxt.startswith("-"):
                cand += nxt
                j += 1
            else:
                break
        if MODEL_RE.match(cand):
            return cand, i, j
    return None, None, None


def parse_fmt(tokens, start):
    for i in range(start, len(tokens)):
        tok = tokens[i]
        if any(k in tok for k in FMT_KEYS) and not tok.startswith("F"):
            s = re.sub(r"\s+", "", tok)
            m = re.search(r"[ΦФ]\s*(\d+(?:\.\d+)?)", s)
            ic = float(m.group(1)) if m else None
            head = re.split(r"[（(]", s)[0]
            head = head.replace("''", '"').replace("'", "")
            head = re.sub(r"^[ΦФ]\d+(?:\.\d+)?$", lambda x: x.group(0), head)
            if head:
                return head, ic
    return None, None


def main():
    doc = pymupdf.open(PDF)
    lenses, unresolved, families = [], [], {}

    for pno, fam, series, default_mp in PAGES:
        page = doc[pno]
        n_row = 0
        for tokens in page_rows(page):
            tokens = merge_split_mount(tokens)
            model, m0, m_end = find_model(tokens)
            if not model:
                continue
            # 系列列（线扫页 4K7u/65MP/151MP 标签在型号左侧）
            labels = [t for t in tokens[:m0] if re.match(r"^\d+(?:\.\d+)?(?:MP|K\d?u)", t)]
            mp = default_mp
            for lab in labels:
                mm = re.match(r"^(\d+(?:\.\d+)?)MP$", lab)
                if mm:
                    v = float(mm.group(1))
                    mp = int(v) if v == int(v) else v
            rec = {"model": model, "brand": BRAND, "series": series}
            if mp is not None:
                rec["mp"] = mp
            # 焦距：型号后第一个纯数字
            focal = next((float(t) for t in tokens[m_end + 1:] if NUM_RE.match(t)), None)
            if focal is not None:
                rec["focal"] = focal
            fmt, ic = parse_fmt(tokens, m_end + 1)
            if fmt:
                rec["fmt"] = fmt
            if ic is not None:
                rec["ic"] = ic
            # 光圈：第一个 F+数字 token（可能拆为 "F2.8" "-" "F16"）
            ap_i = None
            for i in range(m_end + 1, len(tokens)):
                if AP_RE.match(tokens[i]):
                    joined = " ".join(tokens[i:i + 3]) if not re.search(r"-\s*\S+$", tokens[i]) else tokens[i]
                    m = AP_RE.match(joined if joined.startswith(tokens[i]) else tokens[i]) or AP_RE.match(tokens[i])
                    if m:
                        rec["fmin"] = float(m.group(1))
                        if m.group(2) and re.match(r"^\d", m.group(2)):
                            rec["fmax"] = float(m.group(2))
                        elif m.group(2):
                            unresolved.append("%s — 光圈上限非数值（手册原文“%s”），仅入库 fmin"
                                              % (model, " ".join(tokens[i:i + 3])))
                        ap_i = i + (2 if len(tokens) > i + 2 and tokens[i + 1] == "-" else 0)
                        break
            if ap_i is None:
                ap_i = m_end
            tail = tokens[ap_i + 1:]
            # 畸变 / 最近摄距 / 卡口 / 总长
            dist = dist_susp = None
            mind = None
            mount = None
            ln = None
            for i, tok in enumerate(tail):
                if PCT_RE.match(tok) and dist is None:
                    v = float(PCT_RE.match(tok).group(1))
                    if abs(v) > 20:
                        dist_susp = tok
                    else:
                        dist = v
                    continue
                if mount is None and MOUNT_TOKEN_RE.match(tok):
                    u = tok.upper()
                    mount = "C" if u.startswith("C") else re.match(r"^M(\d+)", u).group(0)
                    ln = None
                    for k in range(i + 1, min(i + 3, len(tail))):
                        mm2 = LEN_A_RE.match(tail[k])
                        if mm2:
                            ln = float(mm2.group(1))
                            break
                        if NUM_RE.match(tail[k]) and k + 1 < len(tail) and re.match(r"^[*×x]", tail[k + 1]):
                            ln = float(tail[k])
                            break
                    continue
                if mount is not None:
                    continue
                if mind is None and NUM_RE.match(tok):
                    mind = float(tok)
                    continue
                if mind is None:
                    mm2 = M_RE.match(tok)
                    if mm2:
                        mind = float(mm2.group(1)) * 1000.0
                        continue
            if dist is not None:
                rec["dist"] = dist
            if dist_susp:
                unresolved.append("%s — 手册畸变标注“%s”疑为排版异常，未入库 dist" % (model, dist_susp))
            if mind is not None:
                rec["minDist"] = mind
            if mount is None:
                mm2 = re.search(r"-M(42|58|72)(?:$|-)", model)
                if mm2:
                    mount = "M" + mm2.group(1)
            if mount:
                rec["mount"] = mount
            else:
                unresolved.append("%s — 相机接口未识别，需人工核对" % model)
            if ln is None:
                for k, tok in enumerate(tail):
                    mm2 = LEN_A_RE.match(tok)
                    if mm2:
                        ln = float(mm2.group(1))
                        break
                    if NUM_RE.match(tok) and k + 1 < len(tail) and re.match(r"^[*×x]", tail[k + 1]):
                        ln = float(tok)
                        break
            if ln is not None:
                rec["len"] = ln
            lenses.append(rec)
            n_row += 1
        if n_row:
            families[fam] = n_row
        else:
            unresolved.append("p%d(%s) — 未解析到任何型号" % (pno + 1, fam))

    # 全文交叉核对：其它章节（相机“适配镜头”列）提到、但镜头章节无参数行的型号
    have = {l["model"] for l in lenses}
    fulltext = "".join(pg.get_text() for pg in doc)
    for tok in sorted(set(re.findall(
            r"\b(?:A9-\d{4}-6MP|F\d{2}-[A-Z0-9.]+(?:-[A-Z0-9.]+)+|M[KHTR][A-Z]?\d{3,5}[A-Z]{0,3})\b",
            fulltext))):
        if tok in have or any(h.startswith(tok) for h in have):
            continue
        unresolved.append("%s — 仅见于相机章节“适配镜头”推荐列，镜头章节无参数行，未入库" % tok)

    result = {"lenses": lenses, "tele": [], "unresolved": unresolved, "families": families}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    print("lenses=%d tele=%d unresolved=%d" % (len(lenses), len(result["tele"]), len(unresolved)))
    print("families:", json.dumps(families))
    print("page text length p78-93 (pdf 1-based):")
    for p in range(78, 94):
        n = len(doc[p - 1].get_text())
        print("  p%d: %d%s" % (p, n, "  <-- <200" if n < 200 else ""))


if __name__ == "__main__":
    main()
