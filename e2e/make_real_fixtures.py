# -*- coding: utf-8 -*-
"""生成模拟真实商业中文 EPUB 结构特性的测试样本，用于定位「目录加载成功但正文空白」问题。

变体：
  r1-cover-image-broken  EPUB3，封面页 linear=no 且图片缺失
  r2-img-first-broken    首个 linear 章节是纯图片页且图片缺失
  r3-gbk-decl            章节为 GBK 字节且 XML 声明 encoding=gb2312
  r4-encoded-names       zip 内存原始中文名，OPF href 用百分号编码（不匹配）
  r5-vertical            首章 vertical-rl 竖排
  r6-obfuscated-font     encryption.xml 字体混淆（IDPF obfuscation）
  r7-epub3-full          EPUB3 完整特性（nav+NCX+cover+属性）
"""
import os
import struct
import zipfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

NCX = """<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:test-book-0001"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <bookTitle><text>关键对话测试样书</text></bookTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>制词</text></navLabel><content src="text/cizhi.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>前言</text></navLabel><content src="text/qianyan.xhtml"/></navPoint>
    <navPoint id="n3" playOrder="3"><navLabel><text>第1章 何谓关键对话</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
  </navMap>
</ncx>
"""

NAV = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>目录</h1>
  <ol>
    <li><a href="text/cizhi.xhtml">制词</a></li>
    <li><a href="text/qianyan.xhtml">前言</a></li>
    <li><a href="text/ch1.xhtml">第1章 何谓关键对话</a></li>
  </ol>
</nav>
</body>
</html>
"""


def xhtml(body: str, extra_css: str = "", gbk: bool = False, vertical: bool = False) -> bytes:
    writing = "vertical-rl" if vertical else "horizontal-tb"
    css = (
        "body{font-family:serif;margin:5%;line-height:1.8;}"
        "img{max-width:100%;}"
        f"{extra_css}"
    )
    doc = f"""<?xml version="1.0" encoding="{"gb2312" if gbk else "utf-8"}"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8"/>
<title>样书</title>
<style type="text/css">{css}</style>
</head>
<body style="-epub-writing-mode:{writing};-webkit-writing-mode:{writing};writing-mode:{writing};">
{body}
</body>
</html>
"""
    if gbk:
        return doc.encode("gbk")
    return doc.encode("utf-8")


TEXT_PAGE = xhtml(
    "<h1>前言</h1><p>这是测试样书的前言正文。关键对话是一种沟通方式，"
    "旨在帮助人们在情绪激烈、观点分歧的时刻保持坦诚与尊重。</p>"
    "<p>本书第2版在初版基础上增加了新的案例与工具。</p>"
)

CH1_PAGE = xhtml(
    "<h1>第1章 何谓关键对话</h1><p>关键对话有三个特征：结果风险很高、观点分歧很大、"
    "情绪反应强烈。当这三个要素同时出现时，我们面对的往往就是关键对话。</p>"
    "<p>大多数人面对关键对话时只有两种反应：逃避或面对后失控。</p>"
)

CIZHI_IMG = xhtml('<div style="text-align:center"><img src="../images/cizhi.jpg" alt="制词"/></div>')
CIZHI_TEXT = xhtml("<h1>制词</h1><p>谨以此书献给所有在重要时刻敢于开口的人们。</p>")


def png_1x1() -> bytes:
    """最小合法 PNG（1x1 白色）。"""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\xff\xff"
    comp = b"\x78\x9c" + b"\x63\x60\x18\x05\xa3\xa6" + b"\x00\x00\x00\xff\xff\x03\x00\x02\x99\x01\x4e"
    # 简化：用 zlib 标准库压缩，避免手写 CRC 出错
    import zlib
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def write_epub(path: str, files: dict) -> None:
    with zipfile.ZipFile(path, "w") as z:
        # mimetype 必须是首个条目且 STORED
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        for name, data in files.items():
            z.writestr(name, data)
    print(f"  {os.path.basename(path):28s} {os.path.getsize(path):>8,d} bytes")


def opf(manifest: str, spine: str, epub3: bool = True) -> str:
    ver = "3.0" if epub3 else "2.0"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="{ver}" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-book-0001</dc:identifier>
    <dc:title>关键对话测试样书</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-10-19T00:00:00Z</meta>
  </metadata>
{manifest}
{spine}
</package>
"""


def main() -> None:
    print("生成真实结构模拟样本 ->", OUT)

    # ---------- r1：封面 linear=no 且图片缺失 ----------
    files = {
        "OEBPS/content.opf": opf(
            """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/qianyan.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
            """  <spine toc="ncx">
    <itemref idref="cover" linear="no"/>
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
    <itemref idref="ch1"/>
  </spine>""",
        ),
        "OEBPS/toc.ncx": NCX,
        "OEBPS/nav.xhtml": NAV,
        "OEBPS/style.css": "body{font-family:serif;}",
        # cover.xhtml 引用的图片 cover.jpg 故意不放（模拟加载失败）
        "OEBPS/cover.xhtml": xhtml('<div style="text-align:center"><img src="images/cover.jpg" alt="封面"/></div>'),
        "OEBPS/text/cizhi.xhtml": CIZHI_TEXT,
        "OEBPS/text/qianyan.xhtml": TEXT_PAGE,
        "OEBPS/text/ch1.xhtml": CH1_PAGE,
    }
    write_epub(os.path.join(OUT, "r1-cover-image-broken.epub"), files)

    # ---------- r2：首个 linear 章节是纯图片页且图片缺失 ----------
    files["OEBPS/content.opf"] = opf(
        """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/qianyan.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
        """  <spine toc="ncx">
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
    <itemref idref="ch1"/>
  </spine>""",
    )
    files.pop("OEBPS/cover.xhtml")
    files["OEBPS/text/cizhi.xhtml"] = CIZHI_IMG  # 纯图片页，图片缺失
    write_epub(os.path.join(OUT, "r2-img-first-broken.epub"), files)

    # ---------- r3：GBK 字节 + XML 声明 gb2312 ----------
    files["OEBPS/content.opf"] = opf(
        """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/qianyan.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
        """  <spine toc="ncx">
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
    <itemref idref="ch1"/>
  </spine>""",
    )
    files["OEBPS/text/cizhi.xhtml"] = xhtml("<h1>制词</h1><p>谨以此书献给所有在重要时刻敢于开口的人们。</p>", gbk=True)
    files["OEBPS/text/qianyan.xhtml"] = xhtml(TEXT_PAGE.split("<body")[0] if False else "<h1>前言</h1><p>这是测试样书的前言正文。关键对话是一种沟通方式。</p>", gbk=True)
    write_epub(os.path.join(OUT, "r3-gbk-decl.epub"), files)

    # ---------- r4：zip 原始中文名 vs OPF 百分号编码 ----------
    files4 = {
        "OEBPS/content.opf": opf(
            """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cizhi" href="text/%E5%88%B6%E8%AF%8D.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/%E5%89%8D%E8%A8%80.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/%E7%AC%AC1%E7%AB%A0.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
            """  <spine toc="ncx">
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
    <itemref idref="ch1"/>
  </spine>""",
        ),
        "OEBPS/toc.ncx": NCX,
        # zip 内是原始中文名
        "OEBPS/text/制词.xhtml": CIZHI_TEXT,
        "OEBPS/text/前言.xhtml": TEXT_PAGE,
        "OEBPS/text/第1章.xhtml": CH1_PAGE,
    }
    write_epub(os.path.join(OUT, "r4-encoded-names.epub"), files4)

    # ---------- r5：竖排 ----------
    files5 = {
        "OEBPS/content.opf": opf(
            """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/qianyan.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
            """  <spine toc="ncx">
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
  </spine>""",
        ),
        "OEBPS/toc.ncx": NCX,
        "OEBPS/text/cizhi.xhtml": xhtml("<h1>制词</h1><p>谨以此书献给所有在重要时刻敢于开口的人们。</p>", vertical=True),
        "OEBPS/text/qianyan.xhtml": TEXT_PAGE,
    }
    write_epub(os.path.join(OUT, "r5-vertical.epub"), files5)

    # ---------- r6：字体混淆 ----------
    font = b"\x00\x01\x00\x00" + os.urandom(2048)  # 伪字体字节（非合法 ttf，仅测加载路径）
    obf = bytearray(font)
    for i in range(1024, 1024 + 16):
        obf[i] ^= 0x0A
    files6 = {
        "OEBPS/content.opf": opf(
            """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="font" href="fonts/obf.otf" media-type="application/vnd.ms-opentype"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
            """  <spine toc="ncx">
    <itemref idref="cizhi"/>
  </spine>""",
        ),
        "META-INF/encryption.xml": """<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData>
      <enc:CipherReference URI="../OEBPS/fonts/obf.otf"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>
""",
        "OEBPS/toc.ncx": NCX,
        "OEBPS/fonts/obf.otf": bytes(obf),
        "OEBPS/text/cizhi.xhtml": xhtml(
            "<h1>制词</h1><p>谨以此书献给所有在重要时刻敢于开口的人们。</p>",
            extra_css='@font-face{font-family:"obf";src:url("../fonts/obf.otf");}body{font-family:"obf",serif;}',
        ),
    }
    write_epub(os.path.join(OUT, "r6-obfuscated-font.epub"), files6)

    # ---------- r7：EPUB3 完整特性 ----------
    files7 = {
        "OEBPS/content.opf": opf(
            """  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="cizhi" href="text/cizhi.xhtml" media-type="application/xhtml+xml"/>
    <item id="qianyan" href="text/qianyan.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>""",
            """  <spine toc="ncx">
    <itemref idref="cover" linear="no"/>
    <itemref idref="cizhi"/>
    <itemref idref="qianyan"/>
    <itemref idref="ch1"/>
  </spine>""",
        ),
        "OEBPS/toc.ncx": NCX,
        "OEBPS/nav.xhtml": NAV,
        "OEBPS/style.css": "body{font-family:serif;}",
        "OEBPS/images/cover.png": png_1x1(),
        "OEBPS/cover.xhtml": xhtml('<div style="text-align:center"><img src="images/cover.png" alt="封面"/></div>'),
        "OEBPS/text/cizhi.xhtml": CIZHI_TEXT,
        "OEBPS/text/qianyan.xhtml": TEXT_PAGE,
        "OEBPS/text/ch1.xhtml": CH1_PAGE,
    }
    write_epub(os.path.join(OUT, "r7-epub3-full.epub"), files7)

    print("完成")


if __name__ == "__main__":
    main()
