# -*- coding: utf-8 -*-
"""BookEditor 验收测试样本生成器（落地说明文档 8.3 的可复现版本）。

产物位于 e2e/fixtures/，路径全部 ASCII（GUI 自动化 SendKeys 限制）。
用法：python e2e/make_fixtures.py
"""
import os
import struct
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")
os.makedirs(OUT, exist_ok=True)

CN = "中文测试"
TXT_CN = (
    "BookEditor 端到端测试样本（UTF-8）\n"
    "\n"
    "第一段：春眠不觉晓，处处闻啼鸟。\n"
    "夜来风雨声，花落知多少。\n"
    "\n"
    "第二段：The quick brown fox jumps over the lazy dog. 0123456789\n"
    "\n"
    "第三段：床前明月光，疑是地上霜。举头望明月，低头思故乡。\n"
)


def write_bytes(name: str, data: bytes) -> str:
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(data)
    print(f"  {name:24s} {len(data):>12,} bytes")
    return path


# ---------- TXT 样本 ----------
write_bytes("sample-utf8.txt", TXT_CN.encode("utf-8"))
write_bytes("sample-gbk.txt", TXT_CN.encode("gbk"))
write_bytes("sample-bom.txt", b"\xef\xbb\xbf" + TXT_CN.encode("utf-8"))
write_bytes("sample-empty.txt", b"")
write_bytes("sample.mobi", "not a real mobi, dummy for UNSUPPORTED_FORMAT test\n".encode("utf-8"))
write_bytes("sample.azw3", "not a real azw3, dummy for UNSUPPORTED_FORMAT test\n".encode("utf-8"))

# 损坏样本：合法文本改名（对应 A12 / A13）
with open(os.path.join(OUT, "sample-gbk.txt"), "rb") as f:
    gbk_bytes = f.read()
write_bytes("broken.pdf", gbk_bytes)
write_bytes("broken.epub", gbk_bytes)


# ---------- PDF 样本（3 页，手写最小合法 PDF） ----------
def make_pdf(pages_text, extra_unreferenced: int = 0) -> bytes:
    objects = {}  # num -> bytes (完整对象体，不含 "n 0 obj"/"endobj")

    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    page_obj_nums = [3 + i * 2 for i in range(len(pages_text))]
    kids = b" ".join(b"%d 0 R" % n for n in page_obj_nums)
    objects[2] = b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % len(pages_text)
    objects[3 + 2 * len(pages_text)] = (
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>"
    )
    font_num = 3 + 2 * len(pages_text)

    for i, lines in enumerate(pages_text):
        page_num = 3 + i * 2
        content_num = page_num + 1
        stream = b"BT\n/F1 20 Tf\n72 720 Td\n"
        for j, line in enumerate(lines):
            if j > 0:
                stream += b"0 -30 Td\n"
            stream += b"(" + line.encode("latin-1") + b") Tj\n"
        stream += b"ET\n"
        objects[content_num] = (
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream"
        )
        objects[page_num] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (font_num, content_num)
        )

    if extra_unreferenced > 0:
        # 不被页面树引用的大对象：拉高文件体积但不进入 pdf.js 解析路径
        filler = (b"X" * 79 + b"\n") * (extra_unreferenced // 80)
        objects[100] = (
            b"<< /Length %d >>\nstream\n" % len(filler) + filler + b"endstream"
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + objects[num] + b"\nendobj\n"

    xref_pos = len(out)
    max_num = max(objects)
    out += b"xref\n0 %d\n" % (max_num + 1)
    out += b"0000000000 65535 f \n"
    for num in range(1, max_num + 1):
        if num in offsets:
            out += b"%010d 00000 n \n" % offsets[num]
        else:
            out += b"0000000000 65535 f \n"
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (max_num + 1, xref_pos)
    )
    return bytes(out)


pages = [
    ["BookEditor PDF E2E Test", "Page 1 of 3", "Sample line A"],
    ["Page 2 of 3", "Second page content", "Sample line B"],
    ["Page 3 of 3", "Last page content", "Sample line C"],
]
write_bytes("sample.pdf", make_pdf(pages))

# ---------- 30MB 性能样本（A17）：5 个真实页 + 未引用大对象 ----------
perf_pages = [[f"Perf PDF page {i+1} of 5", "Memory baseline sample"] for i in range(5)]
write_bytes("perf-30mb.pdf", make_pdf(perf_pages, extra_unreferenced=30 * 1024 * 1024))


# ---------- EPUB 样本 ----------
def make_epub(name: str, with_nav: bool) -> None:
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        # mimetype 必须首个且不压缩
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            "<rootfiles>"
            '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>",
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            "<dc:identifier id=\"bookid\">urn:uuid:bookeditor-e2e-001</dc:identifier>"
            "<dc:title>BookEditor 端到端测试书</dc:title>"
            "<dc:language>zh-CN</dc:language></metadata><manifest>"
            '<item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>'
            + (
                '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
                if with_nav
                else ""
            )
            + "</manifest><spine>"
            '<itemref idref="chap1"/><itemref idref="chap2"/>'
            "</spine></package>",
        )
        body1 = (
            "<h1>第一章 起点</h1>"
            "<p>这是第一章的正文，用于验证 EPUB 渲染与目录跳转。</p>"
            "<p>山一程，水一程，身向榆关那畔行，夜深千帐灯。</p>"
            "<p>风一更，雪一更，聒碎乡心梦不成，故园无此声。</p>"
            "<p>Chapter one paragraph four: 风住尘香花已尽，日晚倦梳头。</p>"
            "<p>物是人非事事休，欲语泪先流。</p>"
        )
        body2 = (
            "<h1>第二章 远行</h1>"
            "<p>这是第二章的正文，点击目录条目后应跳转到这里。</p>"
            "<p>长江悲已滞，万里念将归。况属高风晚，山山黄叶飞。</p>"
            "<p>Chapter two paragraph three: 莫愁前路无知己，天下谁人不识君。</p>"
        )
        for fname, body in (("chap1.xhtml", body1), ("chap2.xhtml", body2)):
            z.writestr(
                "OEBPS/" + fname,
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head>'
                "<title>t</title></head><body>" + body + "</body></html>",
            )
        if with_nav:
            z.writestr(
                "OEBPS/nav.xhtml",
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<html xmlns="http://www.w3.org/1999/xhtml" '
                'xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN"><head>'
                "<title>目录</title></head><body>"
                '<nav epub:type="toc" id="toc"><h1>目录</h1><ol>'
                '<li><a href="chap1.xhtml">第一章 起点</a></li>'
                '<li><a href="chap2.xhtml">第二章 远行</a></li>'
                "</ol></nav></body></html>",
            )
    print(f"  {name:24s} {os.path.getsize(path):>12,} bytes")


make_epub("sample.epub", with_nav=True)
make_epub("sample-notoc.epub", with_nav=False)

# ---------- 100MB 边界样本（稀疏文件，NTFS 下瞬间创建） ----------
def write_sparse(name: str, size: int) -> None:
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.truncate(size)
    print(f"  {name:24s} {os.path.getsize(path):>12,} bytes (sparse)")


write_sparse("over-100mb.pdf", 100 * 1024 * 1024 + 1)   # 严格大于 → FILE_TOO_LARGE
write_sparse("exact-100mb.pdf", 100 * 1024 * 1024)      # 恰好 100MB → 放行后解析失败

print("fixtures done ->", OUT)
