---
id: src_sha256_23d8fea9
type: source
title: RISC-V 中开发 Java 是一种什么体验？ 让 Dragonwell JDK 来回答
source_ids: [src_sha256_23d8fea9]
updated_at: 2026-04-11
status: active
tags: []
---

# RISC-V 中开发 Java 是一种什么体验？ 让 Dragonwell JDK 来回答

## Source Info

- **Source ID**: src_sha256_23d8fea9
- **Kind**: markdown
- **Content Hash**: sha256:23d8fea99d732c6e3a289d84decbbc7e82bcf266e6138c0a72c5894f7fccd09c
- **Ingested**: 2026-04-11

## Summary

Alibaba Dragonwell \[1\] 是一 款免费的 OpenJDK 发行版 。它提供了长期支持，包括性能增强、安全修复以及 Dragonwell 上专有的一些特性，比如 Wisp 协程 、多租户、JWarmup、 G1 elastic heap 以及 serviceability 上的特性 \[2\] 等等。Dragonwell 包括 8、11、17 三个版本，而每个版本又包括 standard (和 OpenJDK 基本保持一致) 和 extended (基于 OpenJDK，搭载了 Dragonwell 的各种专有特性) 两个子版本。而我们当前介绍的 RISC-V 后端支持是在 Dragonwell11 上的 extended 版本上 ，已在 2023 年 2 月正式 release，其中 Dragonwell11 上的特性如 Wisp 暂时还不支持。
RISC-V \[3\] 是一个基于 RISC (精简指令集) 的指令集架构。 它主要的特性是开源、模块化、可扩展性以及非常精简的指令集 。当前的 RISC-V 主要应用于物联网；而后续进入服务器领域也是未来可期的。同...

## Structure

- 01 背景介绍
- 1\. Alibaba Dragonwell 发行版
- 2\. RISC-V 指令集架构
- 3\. OpenJDK on RISC-V
- 02 Alibaba Dragonwell11 on RISC-V
- 为什么是 JDK11？
- 硬件特性支持平头哥 RISC-V 芯片
- 二进制版本下载
- 使用方便的 QEMU Docker 容器镜像进行模拟
- 现只支持 x86 宿主机
- Demo：Springboot 示例
- 03 致谢
- 04 总结和展望
