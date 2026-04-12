---
id: secure_boot
type: concept
title: 安全启动（信任链）
updated_at: 2026-04-12
status: active
tags: [security, boot, trust-chain, firmware]
aliases: [Secure Boot, 信任链, trust chain, 安全启动]
source_ids: [src_sha256_5d99456c]
related: [risc_v, tee, tpcm, opensbi, trusted_computing, hardware_isolation]
---

# 安全启动（信任链）

安全启动（Secure Boot）是通过构建分层信任链（Trust Chain），确保系统从上电到操作系统加载的每个阶段都经过完整性验证的安全机制。核心思想是"信任根（Root of Trust）"：从不可篡改的只读存储中的初始代码开始，逐级验证下一阶段引导程序的签名和完整性，形成完整的信任传递链。

## 关键特性

- **信任根（RoT）**：信任链的起点，通常存储于只读 ROM 或硬件安全模块中，不可被外部篡改。
- **分层验证**：每一级引导程序验证下一级的签名/哈希，形成链式信任传递：ROM → ZSBL → FSBL → 固件 → OS。
- **RISC-V 安全可信 3.0 启动链**：
  - EL3 ZSBL（ROM 中，最初级硬件初始化+度量）
  - EL3 FSBL（外设/内存配置 + TPCM 安全认证）
  - EL3 OpenSBI/SEE（SBI 接口 + 安全态/非安全态切换）
  - EL1 TEE_OS（安全态，TPCM 管控下）+ 客户端 OS（非安全态）
- **主动可信增强**：在可信 3.0 框架下，安全启动不只是一次性验证，TPCM 持续监控运行时行为，将启动时的信任延伸到运行时。
- **跨平台对比**：ARM TrustZone 已有完善的安全启动规范；RISC-V 的安全启动标准正在制定中，是 RISC-V TEE 标准化工作的重要组成部分。

## 关联

- [[tpcm|TPCM]] — 可信 3.0 启动方案的核心控制模块，在 FSBL 阶段介入
- [[opensbi|OpenSBI]] — RISC-V 启动链中的固件层，带 SEE 扩展
- [[tee|TEE]] — 安全启动信任链的最终目的地之一（TEE_OS 的安全态启动）
- [[risc_v|RISC-V]] — 安全启动的目标平台
- [[trusted_computing|可信计算]] — 安全启动是可信计算的基础机制
- [[hardware_isolation|硬件隔离]] — 安全态与非安全态的硬件级分离保障启动链安全

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
