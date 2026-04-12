---
id: tee
type: entity
title: TEE（可信执行环境）
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, hardware-security, isolation]
aliases: [Trusted Execution Environment, 可信执行环境, TEE]
source_ids: [src_sha256_5d99456c]
related: [risc_v, tpcm, hardware_isolation, secure_boot, trusted_computing]
---

# TEE（可信执行环境）

TEE（Trusted Execution Environment，可信执行环境）是一种通过硬件隔离机制为敏感代码和数据提供安全运行空间的技术框架。TEE 与普通执行环境（REE）并行运行，通过严格的硬件访问控制确保安全区域内的代码和数据不受普通软件环境的攻击。

## 关键特性

- **硬件隔离**：通过 CPU 安全扩展（如 ARM TrustZone、RISC-V 安全态扩展）在硬件层面划分安全态（Secure World）与非安全态（Normal World）。
- **双环境架构**：TEE_OS 运行于安全态（EL1），处理加密密钥、认证等敏感操作；客户端 OS 运行于非安全态，提供丰富应用支持。
- **ARM 生态成熟**：ARM TrustZone 为 TEE 提供了完善的硬件基础和标准规范（OP-TEE、GlobalPlatform API 等）。
- **RISC-V TEE 标准制定中**：不同于 ARM，RISC-V 的 TEE 标准尚未统一，山东大学等机构正在推动 RISC-V TEE 标准的制定工作。
- **应用场景**：金融支付安全、医疗数据保护、军工可信计算、IoT 设备认证、数字版权管理（DRM）等高安全等级场景。

## 关联

- [[risc_v|RISC-V]] — TEE 的目标硬件平台之一，标准化工作正在推进
- [[tpcm|TPCM]] — 与 TEE 协同工作的主动可信控制模块
- [[hardware_isolation|硬件隔离]] — TEE 的核心技术机制
- [[secure_boot|安全启动]] — TEE 信任链建立的起点
- [[trusted_computing|可信计算]] — TEE 是可信计算的核心实现形式

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
