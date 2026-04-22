---
id: opensbi
type: entity
title: OpenSBI
updated_at: 2026-04-12
status: active
tags: [risc-v, firmware, bootloader, sbi]
aliases: [Open SBI, RISC-V SBI]
source_ids: [src_sha256_5d99456c]
related: [risc_v, tee, secure_boot, tpcm]
---

# OpenSBI

OpenSBI（Open Supervisor Binary Interface）是 RISC-V 平台的开源特权固件实现，由 Western Digital 主导开发。它实现了 RISC-V SBI（Supervisor Binary Interface）规范，在机器态（M-mode）运行，为上层操作系统（S-mode）提供标准化的硬件抽象接口。

## 关键特性

- **SBI 规范实现**：作为 RISC-V 启动链中的关键固件层，提供从 Boot 阶段到操作系统的特权级接口。
- **安全态扩展（SEE）**：在安全可信 3.0 启动方案中，OpenSBI 集成 SEE（Secure Execution Environment）扩展，实现安全态与非安全态的切换与管理。
- **SSE + RAS 支持**：SBI 标准提供的 SSE（Software Surprise Exception）扩展配合 RAS（Reliability, Availability, Serviceability）机制，提供可用性支撑。
- **启动链位置**：在 RISC-V 安全可信 3.0 启动链中，OpenSBI 处于 EL3 层（FSBL 之后），负责完成安全态初始化并移交控制权给 TEE_OS 和客户端 OS。
- **开源生态**：OpenSBI 的开源特性使其成为 RISC-V 安全生态的重要基础设施，可与 TPCM 和 TEE 方案集成。

## 关联

- [[risc_v|RISC-V]] — OpenSBI 是 RISC-V 平台的标准固件层
- [[tee|TEE]] — OpenSBI/SEE 扩展是 TEE_OS 安全启动的桥接层
- [[tpcm|TPCM]] — TPCM 与 OpenSBI 在启动链中协同工作
- [[secure_boot|安全启动]] — OpenSBI 是 RISC-V 信任链中的重要环节

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
