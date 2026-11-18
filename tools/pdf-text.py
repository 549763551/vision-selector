# -*- coding: utf-8 -*-
"""从 PDF 里粗抽文本：解 FlateDecode 流 + 提取 ( ) 字符串。
本机没有 pypdf/pdfminer，只能用这种办法。仅用于抓型号清单，排版不还原。
用法：python tools/pdf-text.py 文件或目录
"""
import io
import os
import re
import sys
import zlib


def streams(data):
    out = []
    for m in re.finditer(rb'stream\r?\n', data):
        start = m.end()
        end = data.find(b'endstream', start)
        if end < 0:
            continue
        raw = data[start:end]
        try:
            out.append(zlib.decompress(raw))
        except Exception:
            try:
                out.append(zlib.decompressobj().decompress(raw))
            except Exception:
                continue
    return out


def unescape(s):
    s = s.replace(r'\(', '(').replace(r'\)', ')').replace(r'\\', '\\')
    s = re.sub(r'\\[0-7]{1,3}', lambda m: chr(int(m.group(0)[1:], 8)), s)
    return s


def page_text(stream):
    """把内容流里的 (..)Tj / [..]TJ 拆成文本；不同文本块之间插入换行。"""
    txt = []
    for m in re.finditer(rb'\[(.*?)\]\s*TJ|\((.*?)\)\s*Tj|T\*|\bTd\b|\bTD\b', stream, re.S):
        if m.group(1) is not None:
            buf = []
            for sm in re.finditer(rb'\((.*?)(?<!\\)\)', m.group(1), re.S):
                buf.append(unescape(sm.group(1).decode('latin-1')))
            txt.append(''.join(buf))
        elif m.group(2) is not None:
            txt.append(unescape(m.group(2).decode('latin-1')))
        else:
            txt.append('\n')
    return ''.join(txt)


def extract(path):
    data = io.open(path, 'rb').read()
    parts = []
    for s in streams(data):
        if b'Tj' in s or b'TJ' in s:
            parts.append(page_text(s))
    return '\n'.join(parts)


def clean(t):
    t = re.sub(r'(en-US|zh-CN)', '', t)
    t = t.replace('\x00', '')
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t


def main():
    targets = sys.argv[1:]
    files = []
    for t in targets:
        if os.path.isdir(t):
            files += [os.path.join(t, f) for f in sorted(os.listdir(t)) if f.lower().endswith('.pdf')]
        else:
            files.append(t)
    for f in files:
        txt = clean(extract(f))
        out = os.path.splitext(f)[0] + '.txt'
        io.open(out, 'w', encoding='utf-8', newline='\n').write(txt)
        print('%-28s %6d chars -> %s' % (os.path.basename(f), len(txt), os.path.basename(out)))


if __name__ == '__main__':
    main()
