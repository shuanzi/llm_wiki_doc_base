---
id: src_sha256_f04df3b5
type: source
title: RISC-V UEFI 架构支持详解，第 1 部分 - OpenSBI/U-Boot/UEFI 简介 - 泰晓科技
source_ids: [src_sha256_f04df3b5]
updated_at: 2026-04-11
status: active
tags: []
---

# RISC-V UEFI 架构支持详解，第 1 部分 - OpenSBI/U-Boot/UEFI 简介 - 泰晓科技

## Source Info

- **Source ID**: src_sha256_f04df3b5
- **Kind**: markdown
- **Content Hash**: sha256:f04df3b5a8c04f426ee20135e7ac10792ef16d6e15476d34e6302c96fe244ff3
- **Ingested**: 2026-04-11

## Summary

泰晓科技 -- 聚焦 Linux - 追本溯源，见微知著！  
网站地址：https://tinylab.org
![  
泰晓Linux实验盘，即刻上手内核与嵌入式开发](https://shop155917374.taobao.com/ "支持 16GB-4TB，某宝检索 “泰晓 Linux” 或者 B 站搜索 “泰晓科技” 工房，即插即跑 Linux Lab，已支持 Mint, Ubuntu, Fedora, Deepin, Manjaro, Kali，高效做 Linux 内核实验与开发，也可以当普通 Linux 系统使用")
!请稍侯
> Author: Jacob Wang jiangbo.jacob@outlook.com Date: 2022/03/19 Project: RISC-V Linux 内核剖析
从 邮件列表 中找到了一笔 patchset： adds UEFI support for RISC-V 。该 patchset 实现 RISC-V 如下引导启动支撑:
Qemu (both RV32 & RV64) for the following bootflo...

## Structure

- 1 前言
- 2 OpenSBI
- 2.1 OpenSBI 加载过程涉及到的相关概念
- 2.2 OpenSBI 加载过程
- 3 U-Boot
- 3.1 U-Boot 加载过程涉及的相关概念
- 3.2 U-Boot 加载过程
- 3.3 U-Boot 代码分析
- 4 UEFI
- 4.1 UEFI 与硬件及 OS 的关系
- 4.2 UEFI 的引导流程
- 4.3 EDK2
- 5 引导程序生态系统
- 5.1 Coreboot 引导阶段与 UEFI 对比
- 6 参考文档
- 猜你喜欢：
- Read Album:
- Read Related:
- Read Latest:
