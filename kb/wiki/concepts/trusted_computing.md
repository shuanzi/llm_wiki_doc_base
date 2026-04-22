---
id: trusted_computing
type: concept
title: 可信计算
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, tee, hardware-security]
aliases: [Trusted Computing, 可信计算, 可信计算体系]
source_ids: [src_sha256_5d99456c]
related: [tee, tpcm, secure_boot, hardware_isolation, risc_v]
---

# 可信计算

可信计算（Trusted Computing）是一种从硬件层面到软件层面为计算系统建立"不可篡改、可度量、可验证"环境的安全体系。其核心目标是确保计算平台的行为符合预期，防止恶意软件篡改系统状态。

## 关键特性

### 演进历程：1.0 → 2.0 → 3.0

- **可信 1.0**：以容错计算等基本安全机制为基础，被动式安全防护，主要关注硬件可靠性。
- **可信 2.0**：以 TCG（Trusted Computing Group）国际标准为代表，引入 TPM/TCM 可信根进行度量与存储，提升系统完整性检测；本质仍是被动式框架，在启动时度量但不干预运行时。
- **可信 3.0**："主动可信"理念，通过 TPCM 等可信计算节点与策略执行功能组件，对系统行为进行实时监测、判定与响应；信任从启动时延伸到运行时全周期。

### 核心组件

- **可信根（Root of Trust）**：信任链起点，通常是 ROM 中不可篡改的启动代码。
- **可信平台模块（TPM/TCM）**：存储度量值、执行加密操作的硬件安全芯片（2.0 框架核心）。
- **TPCM（可信平台控制模块）**：主动介入、实时监控的可信管控核心（3.0 框架核心）。
- **可信软件基（TSB）**：度量系统软件与应用软件的可信计算基础软件层。
- **TEE（可信执行环境）**：为敏感代码提供硬件隔离运行空间的安全执行框架。

## 关联

- [[tee|TEE]] — 可信计算的核心实现形式，提供硬件隔离安全执行环境
- [[tpcm|TPCM]] — 可信 3.0 的核心硬件模块，实现主动可信
- [[secure_boot|安全启动]] — 可信计算的基础安全机制，建立初始信任链
- [[hardware_isolation|硬件隔离]] — 可信计算依赖硬件隔离保证安全态不受侵犯
- [[risc_v|RISC-V]] — 可信计算体系在 RISC-V 平台上的适配与标准化挑战

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
