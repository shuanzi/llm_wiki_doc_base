---
id: risc_v
type: entity
title: RISC-V
updated_at: 2026-04-12
status: active
tags: [architecture, isa, open-source, hardware]
aliases: [RISC-V ISA, riscv, RISCV]
source_ids: [src_sha256_5d99456c]
related: [tee, opensbi, tpcm, secure_boot]
---

# RISC-V

RISC-V 是一种开放的精简指令集架构（ISA），由加州大学伯克利分校发起，现由 RISC-V International 维护。其最大特点是完全开源、模块化，允许任何人免费使用、实现和扩展，已从嵌入式微控制器延伸至高性能服务器和 AI 加速器场景。

## 关键特性

- **开放 ISA**：无需授权费，允许商用与学术使用，打破 ARM/x86 的授权壁垒。
- **模块化扩展**：基础整数指令集（RV32I/RV64I）加上可选扩展（M/A/F/D/C/V 等），支持高度定制化设计。
- **特权级体系**：机器态（M-mode）、监督态（S-mode）、用户态（U-mode）三级权限，配合 H 扩展支持虚拟化。
- **安全生态建设中**：目前 TEE 标准尚未统一，各厂商方案割裂；RISC-V TEE 标准制定是当前生态关键任务之一。
- **广泛应用场景**：从嵌入式 IoT、车规级芯片到数据中心服务器，RISC-V 正在向产业规模化迈进。

## 关联

- [[tee|TEE]] — RISC-V 平台上的可信执行环境，标准制定中
- [[opensbi|OpenSBI]] — RISC-V 特权级固件（SBI 实现），启动链必要组件
- [[tpcm|TPCM]] — 提出的 RISC-V 主动可信控制模块方案
- [[secure_boot|安全启动]] — RISC-V 平台的信任链启动流程
- [[trusted_computing|可信计算]] — RISC-V 安全生态的上层理论框架

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
