# -*- coding: utf-8 -*-
"""
补齐《机器视觉标准产品手册-2026.Q3》(49 页) 中海康机器人主库未入库的型号。

为什么需要新脚本（tools/parse-catalog.js 漏检的根因）：
1. pdftotext -raw 的文本流顺序与版面不一致：手册是「印刷页左右双栏 + 竖排导航条」，
   raw 流里小节标题常常排在它自己的表格 **之后**（如 p23 CB 系列 GigE 板级相机标题落在
   整表末尾），parse-catalog.js 用「标题行 → 向后若干行」归属，于是
     - CB 系列 GigE 板级相机 21 台：标题之前，areaSec/boardSec 已被「工业线阵相机」置空 → 整表跳过；
     - CL 系列 GigE/USB3/CameraLink/CoaXPress 线阵 15 台：同理只吃到 XoFLink/CoaXPress 小节；
     - 面阵各系列「概览页压缩表」（CS p8、CU p10-11、CH p15-16 左上半页）排在标题之前 → 整块丢失。
2. 解析要求「分辨率/像元/帧率/快门」同一行齐全，但 -raw 把长行拆断（USE/NE 曝光换行），
   像 MV-CS016-10GM 这类被拆行的行只在概览表出现 → 丢。
3. 颜色判定只认结尾字母 C/M：-GN/-UN/-TN/-UP/-11UP 之类第三字母变体返回 null 直接丢；
   板级/ MINI 型号结尾是 -B/-C/-S/-MINI-S，area 分支不去后缀 → 丢（CT MINI 8 台）。
4. 镜头行首与焦距之间有订货脚注「*」（MVL-KF1656-25MP * 16 mm …），正则不容「*」→ 丢 4 支 KF-P；
   「8mm F1.8 ~ F16」有空格 → 丢 MVL-KF0818M-20MP；M12 的 -12S 行首带「*」→ 丢 5 支。

做法：用 pymupdf 按几何坐标重建表格行（左右半页分别按 y 排序，行内按 x 拼词），
接口(iface) 优先由型号命名规则（尾段最后两个字母 = 接口字母 + 颜色字母）判定，
再用同半页「小节标题在其之上」的版面归属交叉校验；两者冲突或规则未知的型号
不写进 add，统一进「需与官网二次核对」清单。

用法：
  python tools/parse-hikrobot-gaps.py                # 生成 hikrobot_add.json + hikrobot_gaps_report.txt
  python tools/parse-hikrobot-gaps.py --diag         # 只出诊断 dump（tools/_cache/hikrobot_gaps_diag.txt）

只读输入：manuals/ 与 tools/_cache/library_models.json；输出仅两个 _cache 文件（+ --diag 的 dump）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, OrderedDict, defaultdict

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "manuals", "机器视觉标准产品手册-2026.Q3.pdf")
LIB = os.path.join(ROOT, "tools", "_cache", "library_models.json")
OUT_JSON = os.path.join(ROOT, "tools", "_cache", "hikrobot_add.json")
OUT_TXT = os.path.join(ROOT, "tools", "_cache", "hikrobot_gaps_report.txt")
OUT_DIAG = os.path.join(ROOT, "tools", "_cache", "hikrobot_gaps_diag.txt")
LENS_LEN = os.path.join(ROOT, "tools", "lens-lengths.json")

BRAND = "海康机器人 HIKROBOT"

# 手册里出现的接口字母（型号尾段倒数第二个字母）→ 词表值。
# 依据：手册各小节表格与型号对照（G=CS/CH GigE 表、U=USB3.0 表、T=万兆网表、
# N=CH/CL 黑白高敏感 GigE 变体表、A=CT XoCLink MINI 表、Q=CH XoFLink 表、C=CH Camera Link 表）。
IFACE_LETTER = {
    "G": "GigE",
    "U": "USB3",
    "V": "USB3",   # USB3 高帧率双口变体（CH120-60VM/CH250-90VM，库内同为 USB3）
    "N": "GigE",   # CH050-60NM/NC、CL044-91NM/NC 均在 GigE 小节表内
    "T": "10GigE",
    "A": "XoCLink",
    "Q": "XoFLink",
    "C": "CameraLink",
}
# 接口字母未定（需人工与官网核对）：X/Y = Camera Link 与 CoaXPress 两页混排、
# F/H/P/R/S/B 等 = 版本或卡口后缀，不足以判定接口。
IFACE_UNKNOWN_LETTERS = {"X", "Y", "F", "H", "P", "R", "S", "B", "O", "L", "E"}
# 颜色字母（型号尾段最后一个字母）
COLOR_LETTER = {"M": "黑白", "C": "彩色"}
# 不承载颜色信息的尾字母（订货/硬件版本后缀），需剥掉后再看颜色
STRIP_TAIL = ("W", "POE", "OCT", "V2", "V2.0", "BASE", "PRO", "RB", "R")

# 面阵/板级小节标题
RE_AREA_HDR = re.compile(r"^(CS|CU|CT|CH)\s*系列\s*(GigE|USB3\.0|万兆网|Camera ?Link|CoaXPress|XoFLink|XoCLink)\s*工业面阵相机")
RE_BOARD_HDR = re.compile(r"^CB\s*系列\s*(GigE|USB3\.0)\s*板级相机")
RE_LINE_HDR = re.compile(r"^CL\s*系列\s*(GigE|USB3\.0|万兆网|Camera ?Link|CoaXPress|XoFLink|XoCLink)\s*工业线阵相机")
RE_SERIES_INTRO = re.compile(r"^(CS|CU|CT|CH)\s*系列(二代产品|通用型|三代产品|高端型)$|^CB\s*系列(板级型产品|二代产品)")
# 镜头系列标题：HF-P 系列（1/1.8" 10MP） / KF-P 抗振系列（1.2" 25MP） / M12 系列 / MF-10MPE 系列*（2/3" 10MP）
RE_LENS_HDR = re.compile(r'^(?P<pre>[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?)\s*(?P<anti>抗振)?\s*系列\*?\s*(?P<par>[（(].*)?$')
# 订货号后缀 → 系列（依据主库 85 支已核对样本的命名规律，仅在版面标题缺失时兜底）
LENS_MODEL_SERIES = [
    (r"-6MPE$", "HF-E 系列"), (r"-10MP$", "HF-P 系列"), (r"-5MPE$", "MF-E 系列"),
    (r"-8MPS$", "MF-8MPS 系列"), (r"-10MPE$", "MF-10MPE 系列"), (r"-8MP$", "MF 系列"),
    (r"-12MPE$", "KF-E 系列"), (r"-12MP$", "KF 系列"), (r"-25MP$", "KF-P 系列"),
    (r"-05S$", "M12 系列"), (r"-12S$", "M12 系列"),
    (r"^MVL-AF", "AF 系列"), (r"^MVL-LF", "LF 系列"),
]
HDR_IFACE = {
    "GigE": "GigE", "USB3.0": "USB3", "万兆网": "10GigE",
    "CAMERA LINK": "CameraLink", "COAXPRESS": "CoaXPress",
    "XOFLink": "XoFLink", "XOCLINK": "XoCLink",
}


def hdr_iface(raw: str) -> str:
    t = raw.strip().replace("Camera Link", "CameraLink").upper()
    if "CAMERALINK" in t:
        return "CameraLink"
    if "COAXPRESS" in t:
        return "CoaXPress"
    if "XOFLINK" in t:
        return "XoFLink"
    if "XOCLINK" in t:
        return "XoCLink"
    if "万兆" in raw:
        return "10GigE"
    if "USB3" in raw:
        return "USB3"
    if "GIGE" in t:
        return "GigE"
    return ""


# ---------------------------------------------------------------- 版面行重建

def norm_unit(s: str) -> str:
    """把被拆开的单位黏回来：'7 µ m' -> '7μm'，'3.45 μm' 保持。"""
    s = re.sub(r"([0-9])\s*[μµu]\s*m\b", r"\1um", s)
    s = s.replace("μ", "µ").replace("µ ", "µ")
    s = re.sub(r"×\s*", "×", s)
    s = re.sub(r"\s+", " ", s)
    return s


def page_rows(page: pymupdf.Page):
    """按几何重建 [(side, y, text)]：左右半页各自成表，行内按 x 拼词，行按 y 排序。"""
    mid = (page.rect.x0 + page.rect.x1) / 2.0
    words = page.get_text("words")
    # 竖排导航条：同一 x 上出现 ≥4 个单字 CJK 词。表格里被拆开的「黑/白」「彩/色」
    # 不会命中该条件，不能一律按单字丢弃。
    strip_x = Counter()
    for w in words:
        if len(w[4]) == 1 and ord(w[4][0]) > 0x2E80:
            strip_x[round(w[0] / 2) * 2] += 1
    nav = {x for x, c in strip_x.items() if c >= 4}
    res = []
    for side in ("L", "R"):
        ws = [w for w in words if ((w[0] + w[2]) / 2 < mid) == (side == "L")]
        ws = [w for w in ws if not (len(w[4]) == 1 and ord(w[4][0]) > 0x2E80
                                    and round(w[0] / 2) * 2 in nav)]
        ws.sort(key=lambda w: (round(w[1] / 2.5), w[0]))
        groups, cur, key = [], [], None
        for w in ws:
            k = round(w[1] / 2.5)
            if key is not None and abs(k - key) > 1:
                groups.append(cur)
                cur, key = [], k
            elif key is None:
                key = k
            cur.append(w)
        if cur:
            groups.append(cur)
        glist = []
        for g in groups:
            g.sort(key=lambda x: x[0])
            glist.append((round(min(x[1] for x in g), 1), " ".join(x[4] for x in g)))
        glist.sort(key=lambda t: t[0])
        for y, txt in glist:
            res.append((side, y, norm_unit(txt)))
    return res


MODEL_RE = re.compile(r"^(MV-[A-Z]{2}[0-9][A-Z0-9]*(?:-[A-Z0-9()]+)+|MVL-[A-Z0-9-]+|MV-CL[A-Z0-9]+-[A-Z0-9]+)")


NO_MERGE = re.compile(r"^(产品型号|技术参数|外形尺寸图)")


def is_fragment(txt: str) -> bool:
    """碎片行：本身不是型号行，且不含型号（表头串台/换行续行/中文说明）。"""
    return bool(txt) and not re.search(r"(MV-[A-Z]{2}[0-9]|MVL-)", txt)


def build_stream(doc):
    """(phys_page, side, y, text, is_model_row, full) 流。

    碎片行归属：在同一半页内找**上下最近的型号行**，谁近归谁（阈值 24pt）。
    手册的几何行将「7µm × 7µm 2048×2」这类续行拆在上一行的下方或下一行的上方，
    只向后合并会丢线阵表的像元/分辨率，只向前合并会丢概览表的传感器/靶面列。
    """
    groups = OrderedDict()
    for pno in range(1, doc.page_count + 1):
        for side, y, txt in page_rows(doc[pno - 1]):
            is_model = bool(re.match(r"^(MV-[A-Z]{2}[0-9]|MV-CL[0-9]|MVL-)", txt))
            groups.setdefault((pno, side), []).append([y, txt, is_model])

    out = []
    for (pno, side), rows in groups.items():
        prev = None       # 已输出的上一条型号行 [p,s,y,txt,True,full]
        pending = []      # 尚未归属的碎片
        def flush_pending(owner_below):
            """碎片归给上下最近的型号行；两边都够不着时原样输出，绝不丢弃（标题/说明行）。"""
            nonlocal prev, pending
            if not pending:
                return
            texts = [r[1] for r in pending]
            d_prev = (pending[0][0] - prev[2]) if prev else 1e9
            d_next = (owner_below[2] - pending[-1][0]) if owner_below else 1e9
            if prev is not None and d_prev <= d_next and d_prev <= 24:
                prev[5] += " " + " ".join(texts)
            elif owner_below is not None and d_next <= 24:
                owner_below[5] = " ".join(texts) + " " + owner_below[5]
            else:
                for py, ptxt in ((r[0], r[1]) for r in pending):
                    out.append([pno, side, py, ptxt, False, ptxt])
            pending = []
        for y, txt, is_model in rows:
            if is_model:
                row = [pno, side, y, txt, True, txt]
                flush_pending(row)
                out.append(row)
                prev = row
                continue
            keep_own = bool(NO_MERGE.match(txt) or RE_AREA_HDR.match(txt)
                            or RE_BOARD_HDR.match(txt) or RE_LINE_HDR.match(txt)
                            or RE_SERIES_INTRO.match(txt) or RE_LENS_HDR.match(txt)
                            or "系列" in txt)
            if keep_own or not is_fragment(txt):
                # 小节标题/含其它型号的行必须独立成行：先结算已有碎片，再原样输出
                flush_pending(None)
                out.append([pno, side, y, txt, False, txt])
                prev = None if keep_own else prev
                continue
            pending.append([y, txt, False])
        flush_pending(None)
    return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in out]


# ---------------------------------------------------------------- 型号命名解析

# ---------------------------------------------------------------- 型号命名解析

# 型号尾部后缀段：镜头卡口(B/C/S) + 版本/形态(W=无外壳广角?、M=待定、F/OCT/BASE/PRO/MINI…)
MOUNT_SUFFIX = {"B": "Bare", "C": "C", "S": "M12"}
VARIANT_SUFFIX = {"W", "M", "F", "MINI", "PRO", "OCT", "BASE", "RB", "R", "POE"}


def clean_model(model: str):
    """剥掉卡口/形态后缀段（-B/-C/-S/-W/-M/-F/-MINI/-V2.0…），返回核心型号与后缀。"""
    t = re.sub(r"\(.*?\)", "", model)          # (POE)
    parts = [p for p in t.split("-") if p]
    suffixes = []
    simple = set(MOUNT_SUFFIX) | VARIANT_SUFFIX
    while len(parts) > 2 and (
        (len(parts[-1]) == 1 and parts[-1] in simple)
        or parts[-1] in simple
        or re.fullmatch(r"V\d+(\.\d+)?", parts[-1])
    ):
        suffixes.insert(0, parts.pop())
    letters = re.findall(r"[A-Z]", parts[-1]) if len(parts) > 2 else []
    mount = None
    for s in suffixes:
        if s in MOUNT_SUFFIX:
            mount = MOUNT_SUFFIX[s]
    return "-".join(parts), suffixes, mount, letters


def split_model(raw: str):
    """返回 (model, 脚注标记)，剥掉行内粘连的中文噪声。"""
    m = MODEL_RE.match(raw)
    if not m:
        return None, None
    model = m.group(1)
    rest = raw[m.end():]
    star = bool(re.match(r"\s*\*", rest))
    # 版本后缀（V2.0 / V2）留在型号里，其余噪声丢弃
    v = re.match(r"\s*(V\d+(?:\.\d+)?)", rest)
    if v:
        model += "-" + v.group(1).upper()
    return model, star


def codes_from_model(model: str):
    """(接口字母, 颜色字母, 卡口后缀 mount, 形态后缀列表)。
    命名规则：尾段最后两个字母 = 接口字母 + 颜色字母，如 10GM、60Y1C、240AM01、A0CM。"""
    core, suffixes, mount, letters = clean_model(model)
    ifc = letters[-2] if len(letters) >= 2 else ""
    col = letters[-1] if letters else ""
    return ifc, col, mount, suffixes


def iface_from_model(model: str):
    ifc, col = codes_from_model(model)[0], codes_from_model(model)[1]
    if ifc in IFACE_UNKNOWN_LETTERS:
        return None, col, ifc
    return IFACE_LETTER.get(ifc), col, ifc


def parse_num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


RE_RES = re.compile(r"(\d{3,5})\s*[×xX]\s*(\d{3,5})")
RE_PX = re.compile(r"([\d.]+)\s*(?:um|µm|μm|u m)", re.I)
RE_FPS = re.compile(r"([\d.]+)\s*fps", re.I)
RE_RATE = re.compile(r"([\d.]+)\s*kHz", re.I)
RE_SIZE = re.compile(r'(\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)\s*(?:["”″]|\'\'|\'\')')
RE_POWER = re.compile(r"([\d.]+)\s*W\s*@", re.I)
RE_EXP = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:us|µs|μs|u s)\s*~", re.I)


def mount_from_text(txt: str):
    t = txt.upper()
    if "M72" in t:
        return "M72"
    if "M58" in t:
        return "M58"
    if "M42" in t:
        return "M42/F"
    if "F-MOUNT" in t or "F MOUNT" in t:
        return "F"
    if "M12" in t or "S-MOUNT" in t:
        return "M12"
    if "C-MOUNT" in t or "C MOUNT" in t:
        return "C"
    return None


def sensor_from_text(model: str, txt: str):
    """第二列传感器型号：型号之后到靶面尺寸/像元之前的 ASCII 串。"""
    i = txt.find(model)
    if i < 0:
        return None
    after = txt[i + len(model):].strip()
    m = re.match(r"^\*\s*", after)
    if m:
        after = after[m.end():].strip()
    stop = re.search(r'(\d+(?:/\d+(?:\.\d+)?)?\s*["”″]|[\d.]+\s*(?:um|µm|mm)|Global|Rolling|\d{3,5}\s*[×xX])', after, re.I)
    head = after[:stop.start()] if stop else after[:24]
    head = re.sub(r"\s+", " ", head).strip()
    # 只接受 ASCII/数字型传感器代号，中文工艺描述（堆栈式 BSI）保留原样
    if not head:
        return None
    if len(head) > 24:
        return None
    if not re.search(r"[A-Za-z0-9]", head):
        return None
    return head


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag", action="store_true", help="只输出诊断 dump")
    args = ap.parse_args()

    lib = json.load(open(LIB, encoding="utf-8"))["hikrobot-catalog.js"]
    in_lib = set()
    for key in ("CAMERAS", "LINESCAN", "LENSES", "TELECENTRIC", "LIGHTS", "CONTROLLERS"):
        for m in lib.get(key, []):
            in_lib.add(norm(m))

    doc = pymupdf.open(PDF)
    stream = build_stream(doc)

    # 小节标题（同半页、在行之上）→ iface/series 版面归属
    sections = []  # (page, side, y, kind, iface, series)
    for p, s, y, t, m, full in stream:
        if m:
            continue
        line = full.strip()
        for rx, kind in ((RE_AREA_HDR, "area"), (RE_BOARD_HDR, "board"), (RE_LINE_HDR, "line")):
            mm = rx.match(line)
            if mm:
                iface = hdr_iface(mm.group(0))
                series = re.sub(r"\s*工业(面阵|线阵)相机|\s*板级相机", "", line).strip()
                sections.append((p, s, y, kind, iface, series))
                break

    def section_of(p, s, y, kind):
        """同半页内、位于该行**之上**最近的小节标题；若无（概览表/标题排在表格下方），
        退而用同半页最近的一个标题，并在报告里标注为版面不可靠。"""
        same = [(sp, ss, sy, sk, si, se) for sp, ss, sy, sk, si, se in sections if (sp, ss) == (p, s) and sk == kind]
        above = [x for x in same if x[2] <= y]
        if above:
            best = max(above, key=lambda x: x[2])
            return best[4], best[5], False
        below = [x for x in same if x[2] > y]
        if below:
            best = min(below, key=lambda x: x[2])
            return best[4], best[5], True
        return None, None, True

    cams, lines_rows, lens_rows = OrderedDict(), OrderedDict(), OrderedDict()
    diag = []
    review = []          # (model, page, reason)
    false_gap = Counter()
    # 逐系列清点：候选（手册里去重后的型号行）/ 入库 / 需官网复核（带原因）
    census = OrderedDict()

    def fam_of(model, kind=None):
        if model.startswith("MV-CL"):
            return "CL 工业线阵"
        if model.startswith("MVL-"):
            return "镜头"
        return {"CS": "CS 工业面阵", "CU": "CU 工业面阵", "CT": "CT 工业面阵",
                "CH": "CH 工业面阵", "CB": "CB 板级"}.get(model[3:5], model[3:5])

    def note(model, why=None, ok=False, fam=None):
        f = fam or fam_of(model)
        c = census.setdefault(f, {"cand": OrderedDict(), "ok": [], "rev": []})
        c["cand"][model] = True
        if ok:
            c["ok"].append(model)
        elif why:
            c["rev"].append((model, why))

    for p, s, y, t, m, full in stream:
        txt = full.strip()
        head = t.strip()          # 型号一律取本行原文的开头（碎片行可能被前置并入）
        if not m:
            continue
        if p > 26 and not head.startswith("MVL-"):
            continue
        model, star = split_model(head)
        if not model:
            continue
        nm = norm(model)
        if nm in in_lib:
            continue
        core = norm(clean_model(model)[0])
        if core != nm and core in in_lib:
            false_gap["版本后缀重复（手册同表另列 V2.0/硬件版本行）"] += 1
            review.append((model, p, f"与库内 {clean_model(model)[0]} 同规格，仅硬件版本后缀不同"))
            continue
        # ---------- 相机 ----------
        if model.startswith("MV-C") and not model.startswith("MV-CL"):
            if not re.match(r"MV-C[SUTHB]", model):
                continue
            kind = "board" if model.startswith("MV-CB") else "area"
            note(model, fam=("CB 板级" if kind == "board" else fam_of(model)))
            ifc_l, col_l, suffix_mount, suffixes = codes_from_model(model)
            iface_l = None if ifc_l in IFACE_UNKNOWN_LETTERS else IFACE_LETTER.get(ifc_l)
            color = COLOR_LETTER.get(col_l)
            iface_s, series_s, sec_unreliable = section_of(p, s, y, kind)
            diag.append(f"[CAM p{p}{s} y={y}] {model} | letter={ifc_l or '?'}/{col_l or '?'}"
                        f" iface_letter={iface_l} iface_section={iface_s} color={color}"
                        f" mount={suffix_mount} | {txt[:150]}")
            if not color:
                review.append((model, p, f"颜色字母『{col_l or '?'}』无法判定 黑白/彩色"))
                continue
            iface = iface_l or iface_s
            if iface is None:
                review.append((model, p, f"接口字母『{ifc_l or '?'}』落在 Camera Link / CoaXPress 混排区，需官网核对"))
                continue
            if iface_l and iface_s and iface_l != iface_s:
                review.append((model, p, f"接口冲突：命名规则 {iface_l} vs 版面小节 {iface_s}（不写入 add）"))
                continue
            w = h = px = fps = None
            # 字段一律在「型号之后」的表体里找：型号本身含 60UM/61UM 之类字母，
            # 用整行匹配像元会把 61 当成 61µm。
            bi = txt.find(model)
            body = txt[bi + len(model):] if bi >= 0 else txt
            r = RE_RES.search(body)
            if r:
                w, h = int(r.group(1)), int(r.group(2))
            pm = RE_PX.search(body)
            if not pm:
                # 手册该列的 µ 字形未被抽取：「3.45 m Global」「4 m Rolling」＝3.45µm/4µm
                pm = re.search(r"([\d.]+)\s*m\s+(?:Global|Rolling)", body, re.I)
            px = parse_num(pm.group(1)) if pm else None
            fm = RE_FPS.search(body)
            fps = parse_num(fm.group(1)) if fm else None
            shut = "Global" if re.search(r"Global", body, re.I) else ("Rolling" if re.search(r"Rolling", body, re.I) else None)
            missing = [k for k, v in (("分辨率", w), ("像元", px), ("帧率", fps), ("快门", shut)) if v is None]
            if missing:
                review.append((model, p, "表格缺字段：" + "/".join(missing)))
                continue
            if w < 320 or h < 240 or not (0.8 <= px <= 30):
                false_gap["分辨率/像元越界（疑串行）"] += 1
                review.append((model, p, f"分辨率/像元异常 {w}×{h} @{px}μm，疑排版串行"))
                continue
            mount = mount_from_text(txt) or suffix_mount
            if kind == "board" and not suffix_mount:
                review.append((model, p, f"板级卡口后缀『{suffixes or '无'}』不在 B/C/S 词表内，镜头接口待定"))
                continue
            if not mount:
                mount = "C" if kind == "board" else ("C" if w * px / 1000 <= 17.6 else "M42/F")
            sm = RE_SIZE.search(txt)
            rec = OrderedDict([
                ("model", model), ("kind", kind), ("w", w), ("h", h), ("pxUm", px),
                ("sw", round(w * px / 1000, 3)), ("sh", round(h * px / 1000, 3)),
                ("size", f'{sm.group(1)}"' if sm else None),
                ("fps", fps), ("shutter", shut), ("iface", iface), ("color", color),
                ("mount", mount),
                ("series", series_s or f"{'CB' if kind == 'board' else 'C' + model[4]} 系列 {iface}"),
                ("sensor", sensor_from_text(model, txt)),
                ("_page", p),
            ])
            pw = RE_POWER.search(txt)
            if pw:
                rec["powerW"] = parse_num(pw.group(1))
            ex = RE_EXP.search(txt)
            if ex:
                rec["expMinUs"] = parse_num(ex.group(1))
            if "POE" in txt.upper():
                rec["poe"] = True
            cams.setdefault(model, rec)
        elif model.startswith("MV-CL"):
            note(model)
            ifc_l, col_l, suffix_mount, suffixes = codes_from_model(model)
            iface_l = None if ifc_l in IFACE_UNKNOWN_LETTERS else IFACE_LETTER.get(ifc_l)
            iface_s, series_s, sec_unreliable = section_of(p, s, y, "line")
            pxm = re.search(r"([\d.]+)\s*(?:um|µm|μm)\s*[×x]\s*([\d.]+)\s*(?:um|µm|μm)", txt, re.I)
            if not pxm:
                # 手册线阵表的 µ 字形未被抽取，行里只剩「7 m ×7 m」
                pxm = re.search(r"([1-9][\d.]*)\s*m\s*[×x]\s*([1-9][\d.]*)\s*m\b", txt)
            resm = re.search(r"(\d{3,5})\s*[×xX]\s*(\d{1,2})\b", txt)
            rate = RE_RATE.search(txt)
            diag.append(f"[LINE p{p}{s} y={y}] {model} | letter={ifc_l or '?'}/{col_l or '?'} iface_letter={iface_l}"
                        f" iface_section={iface_s} unreliable={sec_unreliable} px={bool(pxm)} res={bool(resm)}"
                        f" rate={bool(rate)} | {txt[:170]}")
            if not (pxm and resm and rate):
                review.append((model, p, "线阵表缺 像元/分辨率/行频"))
                continue
            w, taps = int(resm.group(1)), int(resm.group(2))
            if not (1000 <= w <= 40000):
                review.append((model, p, f"线阵宽度异常 {w}"))
                continue
            color = COLOR_LETTER.get(col_l)
            if not color:
                if re.search(r"黑\s*白", txt):
                    color = "黑白"
                elif re.search(r"彩\s*色", txt):
                    color = "彩色"
            if not color:
                review.append((model, p, f"线阵颜色字母『{col_l or '?'}』无法判定"))
                continue
            iface = iface_l or iface_s
            if iface is None:
                review.append((model, p, f"线阵接口字母『{ifc_l or '?'}』落在 Camera Link / CoaXPress 混排区，需官网核对"))
                continue
            if iface_l and iface_s and iface_l != iface_s:
                review.append((model, p, f"线阵接口冲突：命名 {iface_l} vs 小节 {iface_s}（不写入 add）"))
                continue
            rec = OrderedDict([
                ("model", model), ("w", w), ("taps", taps),
                ("pxH", parse_num(pxm.group(1))), ("pxV", parse_num(pxm.group(2))),
                ("lineRate", parse_num(rate.group(1))), ("color", color),
                ("iface", iface), ("series", series_s or f"CL 系列 {iface}"),
                ("mount", mount_from_text(txt) or "M42/F"),
                ("_page", p),
            ])
            pw = RE_POWER.search(txt)
            if pw:
                rec["powerW"] = parse_num(pw.group(1))
            if re.search(r"([\d.]+)\s*(?:um|µs|μs)\s*~", rec["model"] + txt, re.I):
                ex = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:us|µs|μs)\s*~", txt, re.I)
                if ex:
                    rec["expMinUs"] = parse_num(ex.group(1))
            lines_rows.setdefault(model, rec)
        elif model.startswith("MVL-"):
            lens_rows.setdefault(model, (p, s, y, txt))
        else:
            diag.append(f"[SKIP p{p}{s}] {txt[:120]}")

    # ---------- 镜头 ----------
    lens_sections = []
    LENS_SERIES = {
        "HF-E 系列": ('1/1.8"', 6), "HF-P 系列": ('1/1.8"', 10), "MF-E 系列": ('2/3"', 5),
        "MF-10MPE 系列": ('2/3"', 10), "MF-8MPS 系列": ('2/3"', 8), "MF 系列": ('2/3"', 8),
        "KF-E 系列": ('1.1"', 12), "KF-P 抗振系列": ('1.2"', 25), "KF-P 系列": ('1.2"', 25),
        "KF 系列": ('1.1"', 12), "AF 系列": ("半画幅", None), "LF 系列": ("大靶面", None),
        "M12 系列": ('1/2"', 5),
    }

    def lens_hdr(line):
        """镜头系列标题 → (系列名, 靶面, 像素)；靶面/像素优先取标题括号内的实测标注。"""
        mm = RE_LENS_HDR.match(line.strip())
        if not mm:
            return None
        pre, anti, par = mm.group("pre"), mm.group("anti"), mm.group("par") or ""
        name = f"{pre} 抗振系列" if anti else f"{pre} 系列"
        q = par.replace("”", '"').replace("″", '"').replace("''", '"').replace("‘", "'")
        fmt = None
        if "半画幅" in q:
            fmt = "半画幅"
        elif "大靶面" in q:
            fmt = "大靶面"
        else:
            fm = re.search(r'(\d+\.\d+|\d+/\d+(?:\.\d+)?|\d+)"', q)
            if fm:
                fmt = fm.group(1) + '"'
        mp = re.search(r"(\d+(?:\.\d+)?)\s*MP", q, re.I)
        return name, fmt, (float(mp.group(1)) if mp else None)

    for p, s, y, t, m, full in stream:
        if m or not (28 <= p <= 34):
            continue
        r = lens_hdr(full)
        if r:
            lens_sections.append((p, s, y, r[0], r[1], r[2]))
            diag.append(f"[LENS-HDR p{p}{s} y={y}] {full[:70]} -> {r}")

    def lens_series_of(p, s, y):
        best = None
        for sp, ss, sy, sn, sf, sm in lens_sections:
            if (sp, ss) != (p, s) or sy > y:
                continue
            if best is None or sy > best[2]:
                best = (sp, ss, sy, sn, sf, sm)
        if best:
            name, fmt, mp = best[3], best[4], best[5]
        else:
            name = fmt = mp = None
        if name in LENS_SERIES:
            fmt = fmt or LENS_SERIES[name][0]
            mp = mp if mp is not None else LENS_SERIES[name][1]
        return name, fmt, mp

    llens = json.load(open(LENS_LEN, encoding="utf-8")) if os.path.exists(LENS_LEN) else {}

    def lens_series_from_model(model):
        """标题丢失时按订货号后缀推断系列（依据库内 85 支已核对的命名规律）。"""
        for rx, name in LENS_MODEL_SERIES:
            if re.search(rx, model):
                if name == "KF-P 系列" and not re.search(r"M-\d+P?E?S?$", model):
                    return "KF-P 抗振系列"
                return name
        return None

    def lens_mount(rest):
        """取行内最后一个卡口词：手册「滤镜螺纹 M27×0.5」也在 M42/M27 列，需末位为准。"""
        toks = re.findall(r"(C-Mount|M72|M58|M42|F-Mount|S-Mount)", rest, re.I)
        if not toks:
            return None
        t = toks[-1].upper()
        return {"C-MOUNT": "C", "S-MOUNT": "M12", "F-MOUNT": "F"}.get(t, t)

    new_lenses = OrderedDict()
    for model, (p, s, y, txt) in lens_rows.items():
        if not (28 <= p <= 34):
            diag.append(f"[LENS-SKIP p{p}] {txt[:120]}")
            continue
        m = re.match(r"^(MVL-[A-Z0-9-]+?)\s*\*?\s*([\d.]+)\s*mm\s*F([\d.]+)(?:\s*~\s*F?\s*([\d.]+))?", txt, re.I)
        diag.append(f"[LENS p{p}{s} y={y}] {txt[:170]}")
        if not m:
            review.append((model, p, "镜头行首无法定位 焦距/光圈（表格串行）"))
            continue
        rest = txt[m.end():]
        series, fmt, mp = lens_series_of(p, s, y)
        if series is None:
            series = lens_series_from_model(model)
            if series in LENS_SERIES:
                fmt = fmt or LENS_SERIES[series][0]
                mp = mp if mp is not None else LENS_SERIES[series][1]
                diag.append(f"[LENS-FALLBACK p{p}{s}] {model} -> {series}（按订货号后缀推断）")
        ang = re.search(r"(-?[\d.]+)°\s+(-?[\d.]+)°\s+(-?[\d.]+)°", rest)
        dist = re.search(r"(-?[\d.]+)\s*%", rest)
        min_d = re.search(r"([\d.]+)\s+m\s", rest + " ")
        focal = float(m.group(2))
        mount = lens_mount(rest)
        if not mount:
            mount = "M72" if (series or "").startswith("LF") else ("M42" if (series or "").startswith("AF") else "C")
        letter = re.search(r"([A-L])\s*$", txt)
        rec = OrderedDict([
            ("model", model), ("letter", letter.group(1) if letter else None),
            ("focal", focal), ("fmin", float(m.group(3))),
            ("fmax", float(m.group(4)) if m.group(4) else None),
            ("mount", mount), ("dist", parse_num(dist.group(1)) if dist else None),
            ("minDist", parse_num(min_d.group(1)) if min_d else None),
            ("ic", round(2 * focal * __import__("math").tan(float(ang.group(1)) * __import__("math").pi / 360), 2) if ang else None),
            ("fmt", fmt), ("mp", 12 if re.search(r"-12S$", model) else mp),
            ("series", series), ("_page", p),
        ])
        tbl = llens.get(series) or {}
        if rec["letter"] and tbl.get(rec["letter"]) is not None:
            rec["len"] = tbl[rec["letter"]]
        elif tbl.get("_byModel", {}).get(model) is not None:
            rec["len"] = tbl["_byModel"][model]
        if series is None:
            review.append((model, p, "所属镜头系列标题无法定位"))
        new_lenses.setdefault(model, rec)

    # ---------- 输出 ----------
    def clean(d):
        return OrderedDict((k, v) for k, v in d.items() if k != "_page" and v is not None and v != "")

    cam_list = [clean(c) for c in cams.values()]
    line_list = [clean(c) for c in lines_rows.values()]
    lens_list = [clean(c) for c in new_lenses.values()]
    for x in cam_list + line_list + lens_list:
        x["brand"] = BRAND

    result = OrderedDict([
        ("cameras", cam_list),
        ("linescan", line_list),
        ("lenses", lens_list),
        ("tele", []),
        ("not_done", OrderedDict([("红外", 12), ("采集卡", 50), ("2.5D系统", 83), ("显微", 3), ("线缆", 27)])),
        ("unresolved", [f"{mo} — {why}（p{pg}）" for mo, pg, why in review]),
    ])

    if args.diag:
        with open(OUT_DIAG, "w", encoding="utf-8") as f:
            f.write("\n".join(diag))
            f.write("\n===== REVIEW =====\n")
            rc = Counter(w for _, _, w in review)
            for why, v in rc.most_common():
                f.write(f"[{v}] {why}\n")
                f.write("      " + ", ".join(f"{mo}(p{pg})" for mo, pg, w in review if w == why) + "\n")
        print(f"diag lines={len(diag)} cams={len(cam_list)} line={len(line_list)} lens={len(lens_list)} review={len(review)}")
        return

    json.dump(result, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 报告
    fam = Counter()
    per_page = defaultdict(list)
    for c in cam_list:
        key = c["series"] + ("/board" if c["kind"] == "board" else "")
        fam[key] += 1
        per_page[c["model"]].append(c["_page"] if "_page" in c else "")
    page_of = {}
    for c in cams.values():
        page_of[c["model"]] = c["_page"]
    for c in lines_rows.values():
        page_of[c["model"]] = c["_page"]
    for c in new_lenses.values():
        page_of[c["model"]] = c["_page"]

    lines_out = []
    A = lines_out.append
    A("海康机器人主库缺口补齐报告  数据源：《机器视觉标准产品手册-2026.Q3》(49 页, pymupdf 几何行重建)")
    A("=" * 100)
    A("")
    A("一、新增数量（已按 tools/_cache/library_models.json 的 hikrobot-catalog.js 去重）")
    A(f"  cameras  {len(cam_list)}   （面阵 {sum(1 for c in cam_list if c['kind']=='area')} / 板级 {sum(1 for c in cam_list if c['kind']=='board')}）")
    A(f"  linescan {len(line_list)}")
    A(f"  lenses   {len(lens_list)}")
    A(f"  tele     0")
    A(f"  unresolved（需官网二次核对，未写入 add） {len(review)}")
    A("")
    A("二、按系列/接口分组")
    for k, v in sorted(fam.items(), key=lambda x: -x[1]):
        A(f"  {k:<28} {v}")
    A("  线阵：" + ", ".join(f"{k} {v}" for k, v in Counter(c['series'] for c in line_list).items()))
    A("  镜头：" + ", ".join(f"{k} {v}" for k, v in Counter(c['series'] for c in lens_list).items()))
    A("")
    A("三、型号 → 手册页码 证据抽样")
    A("-" * 100)
    sample = []
    for grp in (cam_list, line_list, lens_list):
        for c in grp:
            sample.append(c["model"])
    step = max(1, len(sample) // 34)
    for mo in sample[::step][:34]:
        A(f"  {mo:<34} p{page_of.get(mo, '?')}")
    A("")
    A("四、需与官网二次核对的型号（未写入 add）")
    A("-" * 100)
    by_reason = defaultdict(list)
    for mo, pg, why in review:
        by_reason[why].append(f"{mo}(p{pg})")
    for why, lst in sorted(by_reason.items(), key=lambda x: -len(x[1])):
        A(f"  [{len(lst)}] {why}")
        for i in range(0, len(lst), 6):
            A("      " + ", ".join(lst[i:i + 6]))
    A("")
    A("五、判定为假缺口 / 不计入的数量")
    A("-" * 100)
    for k, v in false_gap.items():
        A(f"  {k}: {v}")
    A(f"  红外 12 / 采集卡 50 / 相位偏折+光度立体 2.5D 83 / 显微 3 / 线缆 27：本轮按要求不解析，数量已在 not_done 固化。")
    A("")
    A("六、parse-catalog.js 漏检根因（本次修复点）")
    A("-" * 100)
    for i, s in enumerate(__doc__.strip().split("\n\n")[2:], 1):
        A(f"  {i}. {s.replace(chr(10), ' ')}")
    open(OUT_TXT, "w", encoding="utf-8").write("\n".join(lines_out))
    print(f"cams={len(cam_list)} line={len(line_list)} lens={len(lens_list)} review={len(review)}")


def norm(t: str) -> str:
    return t.upper().replace(" ", "").replace("–", "-").replace("—", "-")


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
