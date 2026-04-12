---
id: hardware_isolation
type: concept
title: 硬件隔离
updated_at: 2026-04-12
status: active
tags: [security, hardware, isolation, memory-protection]
aliases: [Hardware Isolation, 硬件隔离, 安全隔离, security isolation]
source_ids: [src_sha256_5d99456c]
related: [tee, risc_v, tpcm, secure_boot, trusted_computing]
---

# 硬件隔离

硬件隔离是通过 CPU 架构层面的安全扩展，在物理硬件级别将安全态（Secure World）与非安全态（Normal World/Normal）的计算资源严格分离的技术机制。这种隔离确保敏感代码和数据（如密钥、认证逻辑）不能被非安全态软件读取或篡改。

## 关键特性

- **寄存器级隔离**：安全态拥有独立的寄存器组或寄存器状态，安全态与非安全态之间切换时必须通过受控入口（如 SMC/ecall）。
- **内存级隔离**：通过硬件内存保护机制（如 ARM TrustZone 的 TrustZone Protection Controller、RISC-V 的 PMP/IOPMP）将物理内存分区，非安全态代码无法访问安全区内存。
- **外设隔离**：高敏感外设（如密码加速器、安全存储）被标记为安全态独占资源，非安全态无法直接访问。
- **RISC-V 实现挑战**：RISC-V 安全态寄存器隔离设计是当前 TEE 标准化工作中的关键待解决问题，需在 ISA 层面统一定义安全态/非安全态切换机制。
- **与 TEE 的关系**：硬件隔离是 TEE 的物理基础，没有硬件隔离，软件层面的 TEE 无法提供可靠的安全保证。

## 关联

- [[tee|TEE]] — 硬件隔离是 TEE 实现的物理基础
- [[risc_v|RISC-V]] — RISC-V 平台的硬件隔离机制正在标准化中
- [[tpcm|TPCM]] — TPCM 依赖硬件隔离实现安全态的可信度量
- [[secure_boot|安全启动]] — 安全启动需要硬件隔离保证每个启动阶段的安全边界
- [[trusted_computing|可信计算]] — 硬件隔离是可信计算体系的技术基石

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
