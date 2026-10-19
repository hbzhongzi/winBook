# -*- coding: utf-8 -*-
"""PDF/EPUB 样本结构级前置校验（不依赖渲染引擎）。

- PDF：头部、xref 偏移指向真实对象、trailer/Root、/Type /Page 计数
- EPUB：mimetype 首条目且 STORED、container.xml → opf 可解析、nav 存在且含 2 条目
"""
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

FIX = "e2e/fixtures/"
failed = 0


def check(cond, msg):
    global failed
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failed += 1


def check_pdf(name, expect_pages):
    path = FIX + name
    data = open(path, "rb").read()
    check(data.startswith(b"%PDF-1."), f"{name}: 头部 %PDF-1.x")
    m = re.search(rb"startxref\s+(\d+)\s+%%EOF\s*$", data)
    check(bool(m), f"{name}: startxref/%%EOF 收尾")
    xref_pos = int(m.group(1))
    check(data[xref_pos : xref_pos + 4] == b"xref", f"{name}: startxref 指向 xref 表")
    # xref 表从对象 0 开始逐行对应：第 i 个条目描述对象 i
    xref_body = data[xref_pos:]
    entries = re.findall(rb"(\d{10}) (\d{5}) ([nf])", xref_body.split(b"trailer")[0])
    ok = True
    for idx, (off, _gen, kind) in enumerate(entries):
        if kind == b"n":
            off = int(off)
            header = b"%d 0 obj" % idx
            if not data[off : off + len(header)] == header:
                ok = False
    check(ok, f"{name}: xref 条目与对象偏移一致")
    check(b"/Root 1 0 R" in data, f"{name}: trailer Root")
    n_pages = len(re.findall(rb"/Type\s*/Page[^s]", data))
    check(n_pages == expect_pages, f"{name}: /Type /Page 计数 {n_pages} (expect {expect_pages})")


def check_epub(name, expect_toc_entries):
    path = FIX + name
    z = zipfile.ZipFile(path)
    infos = z.infolist()
    check(infos[0].filename == "mimetype", f"{name}: mimetype 为首条目")
    check(infos[0].compress_type == zipfile.ZIP_STORED, f"{name}: mimetype 未压缩")
    check(z.read("mimetype") == b"application/epub+zip", f"{name}: mimetype 内容")
    container = ET.fromstring(z.read("META-INF/container.xml"))
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    rootfile = container.find(".//c:rootfile", ns).get("full-path")
    check(rootfile == "OEBPS/content.opf", f"{name}: container 指向 {rootfile}")
    opf = ET.fromstring(z.read(rootfile))
    check(opf.get("version") == "3.0", f"{name}: OPF version 3.0")
    has_nav = any(
        i.get("properties") == "nav" for i in opf.iter("{http://www.idpf.org/2007/opf}item")
    )
    check(has_nav == (expect_toc_entries > 0), f"{name}: nav 声明存在={has_nav}")
    if has_nav:
        nav_name = next(
            i.get("href")
            for i in opf.iter("{http://www.idpf.org/2007/opf}item")
            if i.get("properties") == "nav"
        )
        nav = ET.fromstring(z.read("OEBPS/" + nav_name))
        links = nav.findall(".//{http://www.w3.org/1999/xhtml}a")
        check(len(links) == expect_toc_entries, f"{name}: nav 条目 {len(links)} (expect {expect_toc_entries})")
        for a in links:
            check(z.read("OEBPS/" + a.get("href"))[:1] != b"", f"{name}: 目录目标 {a.get('href')} 存在")


check_pdf("sample.pdf", 3)
check_pdf("perf-30mb.pdf", 5)
check_epub("sample.epub", 2)
check_epub("sample-notoc.epub", 0)

# 编码与稀疏样本
gbk = open(FIX + "sample-gbk.txt", "rb").read()
check(gbk.decode("gbk").startswith("BookEditor"), "sample-gbk.txt: GBK 可解码为预期文本")
bom = open(FIX + "sample-bom.txt", "rb").read()
check(bom.startswith(b"\xef\xbb\xbf"), "sample-bom.txt: 含 UTF-8 BOM")
import os
check(os.path.getsize(FIX + "over-100mb.pdf") == 100 * 1024 * 1024 + 1, "over-100mb.pdf: 100MB+1 字节")
check(os.path.getsize(FIX + "exact-100mb.pdf") == 100 * 1024 * 1024, "exact-100mb.pdf: 恰好 100MB")
check(os.path.getsize(FIX + "sample-empty.txt") == 0, "sample-empty.txt: 0 字节")

print("FIXTURES_OK" if failed == 0 else f"FIXTURES_FAILED({{}})".format(failed))
sys.exit(0 if failed == 0 else 1)
