---
id: risc_v_matrix_extensions
type: concept
title: RISC-V 矩阵扩展
updated_at: 2026-04-19
status: active
tags: [risc-v, matrix-extension, ai, ml, accelerator]
source_ids: [src_sha256_08e04538]
related: [risc_v]
---

# RISC-V 矩阵扩展

RISC-V 矩阵扩展是面向 AI/ML 矩阵计算负载的一组 ISA 扩展探索方向，目标是在通用处理器与加速器场景下提升矩阵乘累加（MAC）吞吐。按当前来源（单篇文章）描述，社区讨论主要围绕“复用向量寄存器表达矩阵操作”与“引入附加矩阵寄存器状态”两类路径展开；下文的 Integrated/Attached/折中形态是该来源中的归纳与当前提案讨论方向，不代表已定型的官方 taxonomy。

## 讨论路径（基于该来源的归纳）

- **Integrated（集成式）**：复用 RVV 向量寄存器与既有控制语义（如 `vl`/`SEW`）描述矩阵片段，来源中将其视为状态增量较小的方向。
- **Attached（附加式）**：引入 2D tile/matrix 寄存器与累加寄存器，来源中将其视为吞吐潜力较高但状态成本更大的方向。
- **折中形态**：来源还提及“向量输入 + 矩阵累加输出”等折中形态，用于缓解部分数据搬运成本。

## 工程关注点（基于该来源）

- **吞吐与状态成本权衡**：更高吞吐通常伴随更大寄存器/缓冲区状态。
- **向量-矩阵数据交换**：若交换路径不足，来源认为配置与搬运开销可能显著稀释收益。
- **应用定位**：来源提出其目标场景尚未完全收敛（通用 CPU、共享矩阵单元或专用加速器）。
- **标准化收敛风险**：多提案并行有利于探索，但会增加兼容与生态统一难度。

## 不确定性与边界

- 本页基于单一来源中的提案/讨论信息，不代表 RISC-V International 已冻结或已批准的官方规范。
- “Integrated/Attached”等术语在不同讨论上下文中的边界可能变化，应以对应规范草案文本为准。
- 文中跨架构对照用于解释取舍，属于启发式比较。

## 关联

- [[risc_v|RISC-V]] — 矩阵扩展所属 ISA 主体

## 来源

- 基于 [[src_sha256_08e04538|From Vector to Matrix: The Future of RISC-V Matrix Extensions]]
