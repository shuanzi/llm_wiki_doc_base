---
id: src_sha256_381eec28
type: source
title: "[翻譯] 認識 x64 程式碼模型（code model）"
source_ids: [src_sha256_381eec28]
updated_at: 2026-04-11
status: active
tags: []
---

# [翻譯] 認識 x64 程式碼模型（code model）

## Source Info

- **Source ID**: src_sha256_381eec28
- **Kind**: markdown
- **Content Hash**: sha256:381eec28c3192c32249181e7135ece54cd6033ca9b3440595ab509a84b76c4f1
- **Ingested**: 2026-04-11

## Summary

- 原文標題：Understanding the x64 code models
- 原文網址： http://eli.thegreenplace.net/2012/01/03/understanding-the-x64-code-models
- 原文作者：Eli Bendersky
- 原文發表時間：2012 年 01 月 03 日
- 譯註：  
	- 文中的反組譯內容使用的是 AT&T 格式的 組合語言語法 。
		- 關於「code model」的正體中文翻譯，有 程式碼模型 、 程式碼模式 、 編碼式樣 等，在本文中，一律採取「程式碼模型」。
==↓↓↓↓↓↓ 正文開始 ↓↓↓↓↓↓==
在撰寫用於 x64 架構程式碼的時候，一個會出現的有趣議題是要使用哪個程式碼模型（code model），儘管這可能不是一個廣為人知的主題，但如果有人想要理解編譯器所產生的 x64 機器碼，則熟悉程式碼模型就有了教育意義；而對於那些真的很在乎效能，直到每個細小指令的人來說，該主題對最佳化（optimization）也會有影響。
無論在網路或其他地方，關於這個主題都只有很少的資訊，到目前為止...

## Structure

- 程式碼模型——源起
- 此處將涵蓋什麼
- 範例 C 原始碼
- 小型程式碼模型（small code model）
- 大型程式碼模型（large code model）
- 中型程式碼模型（medium code model）
- 小型 PIC 程式碼模型（small PIC code model）
- 大型 PIC 程式碼模型（large PIC code model）
- 中型 PIC 程式碼模型（medium PIC code model）
