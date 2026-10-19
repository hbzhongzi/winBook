package main

import (
	"strings"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

// decodeText 行为契约（落地说明文档 7.1）：
// 1. 合法 UTF-8 直接转字符串，并去除 UTF-8 BOM（D7）；
// 2. 否则尝试 GBK 解码；
// 3. 仍失败按 UTF-8 替换非法字符，保证输出一定是合法 UTF-8。

func TestDecodeTextUTF8(t *testing.T) {
	in := "第一行\n第二行\n中文 English 混排 123。"
	if got := decodeText([]byte(in)); got != in {
		t.Fatalf("UTF-8 文本被改动: got %q", got)
	}
}

func TestDecodeTextUTF8BOM(t *testing.T) {
	in := "\uFEFF" + "BOM 后的正文"
	got := decodeText([]byte(in))
	if strings.HasPrefix(got, "\uFEFF") {
		t.Fatalf("UTF-8 BOM 未去除: %q", got)
	}
	if got != "BOM 后的正文" {
		t.Fatalf("去 BOM 结果不符: got %q", got)
	}
}

func TestDecodeTextGBK(t *testing.T) {
	want := "中文GBK编码测试。\r\n第二行。"
	encoded, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(want))
	if err != nil {
		t.Fatalf("GBK 编码样本制备失败: %v", err)
	}
	if utf8.Valid(encoded) {
		t.Fatal("样本不应是合法 UTF-8，无法覆盖 GBK 分支")
	}
	got := decodeText(encoded)
	if got != want {
		t.Fatalf("GBK 解码结果不符:\n got %q\nwant %q", got, want)
	}
}

func TestDecodeTextInvalidBytes(t *testing.T) {
	// 非 UTF-8 且 GBK 无法完整解码的字节：输出必须是合法 UTF-8 且不含原始非法字节
	in := []byte{0xFF, 0xFE, 0x00, 0x80, 0x81, 0xFF}
	got := decodeText(in)
	if !utf8.ValidString(got) {
		t.Fatalf("输出不是合法 UTF-8: %q", got)
	}
	if strings.ContainsRune(got, 0xFF) {
		t.Fatalf("输出仍含原始非法字节 0xFF: %q", got)
	}
}

func TestDecodeTextEmpty(t *testing.T) {
	if got := decodeText(nil); got != "" {
		t.Fatalf("空输入应返回空串: got %q", got)
	}
	if got := decodeText([]byte{}); got != "" {
		t.Fatalf("空切片应返回空串: got %q", got)
	}
}
