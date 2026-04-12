---
id: tpcm
type: entity
title: TPCM（可信平台控制模块）
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, hardware-security, risc-v]
aliases: [Trusted Platform Control Module, 可信平台控制模块, TPCM]
source_ids: [src_sha256_5d99456c]
related: [tee, risc_v, secure_boot, trusted_computing, hardware_isolation]
---

# TPCM（可信平台控制模块）

TPCM（Trusted Platform Control Module，可信平台控制模块）是可信计算 3.0 框架中的核心硬件模块，扮演"可信管控核心"角色。不同于被动的 TPM/TCM，TPCM 具备主动监控与策略执行能力，能对平台及上层软件执行过程进行实时度量、监控与响应。

## 关键特性

- **主动可信**：区别于 TPM/TCM 的被动度量，TPCM 主动介入系统运行，实时监测异常行为并执行可信策略。
- **双体系架构**：TPCM 与可信密码模块（TCM）协同运作，分别负责控制/度量和密码服务，构成"防护部件 + 计算部件"的双体系。
- **可信软件基（TSB）**：TPCM 内置 TSB，承担系统软件与应用软件的度量任务，并通过通信机制与管理中心动态同步策略库。
- **RISC-V 适配**：在 RISC-V 平台上，TPCM 集成于安全可信 3.0 启动链，在 FSBL 阶段介入进行安全认证，并贯穿整个运行时生命周期。
- **安全启动锚点**：TPCM 建立并维护系统信任源点，确保从 ZSBL 到 TEE_OS 的每个启动阶段都经过可信度量和验证。

## 关联

- [[tee|TEE]] — TPCM 与 TEE 协同工作，TPCM 管控 TEE_OS 的安全运行
- [[risc_v|RISC-V]] — TPCM 的目标部署平台
- [[secure_boot|安全启动]] — TPCM 是 RISC-V 安全启动链的核心组件
- [[trusted_computing|可信计算]] — TPCM 是可信 3.0 框架的核心实现
- [[opensbi|OpenSBI]] — 启动链中 TPCM 与 SBI 层交互的接口层

## 来源

- 基于 [[src_sha256_5d99456c|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
