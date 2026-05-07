---
title: "From Vector to Matrix: The Future of RISC-V Matrix Extensions"
source: "https://zhuanlan.zhihu.com/p/23884812048"
author:
  - "[[Robin古来何物是经纶，一片青山了此身。]]"
published:
created: 2026-04-19
description: "RV Day Tokyo 2025 Spring PosterAbstract: The idea of accelerating the emerging matrix workloads from artificial intelligence and machine learning has been implemented in general-purpose ISA includin…"
tags:
  - "clippings"
---
[收录于 · RISC-V 和 HPC 杂谈](https://www.zhihu.com/column/c_1875668614960537600)

63 人赞同了该文章

> RV Day Tokyo 2025 Spring Poster

Abstract: The idea of accelerating the emerging matrix workloads from artificial intelligence and machine learning has been implemented in general-purpose ISA including x86-64 ([AMX](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=AMX&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJBTVgiLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjoyNTM3OTg4NDEsImNvbnRlbnRfdHlwZSI6IkFydGljbGUiLCJtYXRjaF9vcmRlciI6MSwiemRfdG9rZW4iOm51bGx9.Q77uVLFaNQH205EUcX_IasYEwdTvN3j72R8sZYKBCbc&zhida_source=entity)) and [ARMv9.2](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=ARMv9.2&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJBUk12OS4yIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjUzNzk4ODQxLCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.qbMF-fdvkQZWpFOVGGb-exTm91gZitzlOSuoc6vn-ds&zhida_source=entity) ([SME](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=SME&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJTTUUiLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjoyNTM3OTg4NDEsImNvbnRlbnRfdHlwZSI6IkFydGljbGUiLCJtYXRjaF9vcmRlciI6MSwiemRfdG9rZW4iOm51bGx9.KcKRcN1mLFPmDsjnI_eEQtlSF1QQ2rCIsTrpC4bG2Y4&zhida_source=entity)), and accelerators including NVIDIA Tensor Cores. RISC-V, as an open-source ISA, has followed this trend a multiple matrix extension drafts and implementations available. In this poster, the author will introduce the Integrated matrix extension from [Spacemit](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=Spacemit&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJTcGFjZW1pdCIsInpoaWRhX3NvdXJjZSI6ImVudGl0eSIsImNvbnRlbnRfaWQiOjI1Mzc5ODg0MSwiY29udGVudF90eXBlIjoiQXJ0aWNsZSIsIm1hdGNoX29yZGVyIjoxLCJ6ZF90b2tlbiI6bnVsbH0.2Sskq1Vaml10EYklag1qUzH9jgOphkwsM6I8Crox9oo&zhida_source=entity) and the Attached Matrix Extension from [Xuantie](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=Xuantie&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJYdWFudGllIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjUzNzk4ODQxLCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.CKIDkFwJAUK1CyR3fVLqLtSHHMa0ScVz2ZSC2gUXSZo&zhida_source=entity), [Stream Computing](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=Stream+Computing&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJTdHJlYW0gQ29tcHV0aW5nIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjUzNzk4ODQxLCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.lTLtpPqRz9Dpq28jtQxVDODbc0qb9M5zGF1Td9AcR5I&zhida_source=entity), and SiFive ([Zvma](https://zhida.zhihu.com/search?content_id=253798841&content_type=Article&match_order=1&q=Zvma&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzY3MzgyODksInEiOiJadm1hIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjUzNzk4ODQxLCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.wMDd8LfeHPn_ZNm7EnEVic4C5JeZ1ZwIlssfODi7x3c&zhida_source=entity)). The author will focus on the tradeoff between "Integrated" and "Attached", the relationship between existing V extension and matrix extension, and the potential hardware implementation of RISC-V matrix acceleration in this poster.

1\. RISC-V Matrix Extensions: "Integrated" and "Attached" [^1]

By definition, matrix extensions are extensions to the ISA designed to work on matrices, mainly to accelerate AI and ML workloads. RVV's flexibility enables only 1D vector registers as input-output for matrix operations, leading to the "Integrated" Matrix Extension. Meanwhile, ARM SME and Intel AMX introduce a 2D "tiled" matrix register, which, in RISC-V, corresponds to the "Attached" Matrix Extension.

Spacemit's Draft to IME [^2], and the current IME task group [^3]

Spacemit's IME extension focuses on dot-product matrix multiply-accumulate instructions and the sliding-window variant, which in C form, can be written as `C[cp][i][j] +=  A[cp][i][k] * B[cp][k][j]`, where `A` `B` and `C` are three vector registers, and the `i` `j` and `k` is restricted by MAC's shape ( $M \times N \times K$). RVV's VLEN, vl, and SEW ("the width of the currently selected element within the vector register") are utilized to shape the matrix, in which elements are arranged in this order:

![](https://pic4.zhimg.com/v2-55e07e3c5e348256cddb4d1cb968159d_1440w.jpg)

VLEN=256 and SEW=8

By definition, A and B can be (u)int4/(u)int8/(u)int16 or fp4/fp8/fp16/bfp16, and C will be int32/int32/fp32 or fp16/fp16/fp16/bfp16.

The IME TG has Options from A (an L-word vector holds matrix), B(1 Matrix in 4 Vector Registers), C(Matrix as Element Type), D(Option A with two stream source matrix), and E(vd\[0\] = vs1.p0 \* vs2) for IME standard. Andes introduces an "amm" instruction [^4] implementation following Option E. Some detailed analyses on architecture [^5] and memory burst [^6] can be found.

### The Matrix-Only Extension: Xuantie's and Stream Computing Matrix Extension

Stream Computing and Xuantie have proposed controversial "independent from V extension" matrix extensions with slight differences.

Xuantie's RISC-V Matrix Specification Proposal v0.6.0 uses TLEN (number of bits in a single matrix register), TRLEN (number of bits in a row of a single matrix register), and ELEN (maximize size in bits of a single element) to define four Tile Registers as input, and similar for four Accumulation Registers as output.

![](https://pic4.zhimg.com/v2-460a91ccbf3840c860fd7cbd9463f07b_1440w.jpg)

Workload analysis [^7] on Xuantie Matrix Extension v0.3 illustrates the importance of vector and matrix cooperation. The matrix/vector instruction ratio is low in all four scenarios, indicating that these workloads still rely on vector extension for data processing. Further discussion could be found in [^8].

![](https://pic4.zhimg.com/v2-d6ddcd37682e92f79e2a444f3909c67b_1440w.jpg)

matrix/vector instruction ratio

However, Xuantie's proposal didn't provide methods to exchange matrix data between vector and matrix registers, which might cause overhead (about 50% of the instructions are vset\* and vload/vstore instructions) though partly solved by introducing more element-wise matrix instructions.

Stream Computing had a similar proposal (and actual product [^9]) but introduced Zmv [^10] to solve the problem. Zmv allows loading/storing matrix tile slices into vector registers, moving data between slices of a matrix register and vector registers, and broadcasting element-wise multiplication with matrix and vector register, which might help improve performance.

### Vector-Input Matrix-Output Extension: SiFive

SiFive has proposed "Zvma",[^11] which implements operations in the form of `C[tm,tn] += A[tk,tm]^T * B[tk,tn]`. Inputs `A` and `B` here are each sourced from a vector register group, while the accumulator `C` is held in a matrix tile.

Zvma utilizes reserved bits in RVV vtype registers to save `tm` and `tk`, while using `tn` as an alias to `vl` register. Each vector register group input has `tk` rows, where each row is held separately in one (or more) vector registers, with the total number of vector registers constrained to fit in one eight-register group.

## 2\. Real-World Matrix Acceleration, and what RISC-V can do

### General Computing: Compared to Apple AMX/ARM SME

![](https://pic3.zhimg.com/v2-c3f7f3792ebf4f6896c6badb5ffe243c_1440w.jpg)

SVE has not been introduced to Apple Silicons (at least for now), and Apple has introduced a matrix "co-processor" (external to CPU) to their products. Apple M4 introduces ARM SME support for their matrix co-processor (while keeping AMX instruction support). Co-processors likely read instructions ignored by CPU from instruction cache in this case.

SiFive's proposal is similar to Apple's AMX and ARM's SME design. Register pools X and Y can contain 512 bits of data (for a vector), and a single instruction can perform a vector outer product. The main difference is that Apple doesn't implement SVE but only NEON so X and Y registers come from memory instead of vector register pool.

Looking into Apple M4's microbenchmark,[^12] the scaling behavior shows two fully decoupled AMX units, one associated with the performance cores and one associated with the efficiency cores. "Initially, when using 1-4 threads, the performance drops slightly from 2009 to 1983 GFLOPS. Using a fifth thread, we see a performance increase of 358 GFLOPS."

The "Shared AME Units" [^13] are acceptable for Apple's researchers (even for 4-way or more sharing), and the author cannot understand why AME TG seems to be negative on "fully independent co-processor".

### Accelerator: Compared to Huawei Ascend NPU

![](https://picx.zhimg.com/v2-ebd7ffbdfd2cb77235e31892df837dab_1440w.jpg)

The Unified Architecture of Atlas NPU

![](https://picx.zhimg.com/v2-07c1c20ee209ead374091207ccac6ecf_1440w.jpg)

The Seperated Architecture of Atlas NPU A2

The Huawei Ascend NPU [^14] has a similar vector-matrix design and implements a unified Instruction Dispatcher and dedicated Cube and Vector instruction queue.[^15] It shows the possibility of an RISC-V AI accelerator since Atlas's Vector and Cube can be replaced by RISC-V Vector and Matrix Extension implementations.

If we look deeper into Cube's pipeline, the Cube has a separated L0A/L0B/L0C Buffer, both fetching input from the L1 buffer. The L0A/L0B/L0C corresponds to Matrix Registers and Accumulation Registers in Xuantie's proposal, or Vector Register Groups and Tiled Accumulation Registers in SiFive's proposal.

It's known that the size of Ascend 910B's L0A/L0B buffer is 64 KB, while L0C is 128-256 KB. The Cube MACs/cycle count in HC31's presentation is (in FP16 or doubled in INT8). The Ascend previously had a short VLEN/DLEN(=2048) vector processor, which can't achieve enough throughput to process the matrix output (HC31's figure shows that the "Cube cycle/Vector Cycle" is not optimal). A relatively longer VLEN vector unit or more units can handle this task better, which has been reflected in the Atlas NPU evolution, as the separated architecture introduces a 1:N Cube vs Vector Unit ratio. However, the separated architecture brings overhead in Cube-Vector interaction, which might bring other problems.

Lessons learned from Ascend include that an AI accelerator generally requires a large TLEN (using Xuantie's term) to feed a large MAC, and requires a Vector Unit with a larger VLEN/DLEN. The large L0A/L0B/L0C buffer also shows that the current assumption for the RISC-V matrix extensions on the cache and register file might be inadequate.

### What RISC-V done, and what can it do?

Firstly, it would be hard to imagine for other architectures to have multiple matrix extension standards (IME+AME). Even though there are two TGs for two standards, only one standard (or even none of them) would likely be dominated. Compared to IME, AME is the relatively "register expensive" one (additional architectural state for matrix), while providing a higher throughput in return. The tradeoff between AME and IME remains a problem.

Another key problem is that the current (both Integrated and Attached) matrix extension designs seem to be uncertain about their real use case. For AME itself, there was a discussion [^16] on the role of vector operations, which partly turned into which application AME should focus on, between general-purpose processors or accelerators. Other discussions include whether it's for a far-from-RVV shared matrix unit or some RVV-coupled matrix units, and vector or matrix as input.

![](https://pic2.zhimg.com/v2-a2fe0330d758e7c4c689d306947e03e3_1440w.jpg)

chipsandcheese

![](https://pic1.zhimg.com/v2-7e167699ee8d4cae365111eb4905ad2c_1440w.jpg)

AMD Steamroller

It's still unsure why both IME and AME are highly reluctant to the idea of a "co-processor" or a shared unit, especially when AMD pre-Zen and ARM's Cortex A510 has introduced "Shared SIMD". Decoupling FP/Vector/Matrix from the Scalar Execution Engine (and possibly from the scalar core) will contribute to both the Zvma-flavor matrix extension and the Xuantie-flavor matrix extensions (by using only shared L2 cache instead of L1 cache, which might be helpful for the larger throughput in matrix extension.)

## 参考

编辑于 2025-03-18 22:49・日本[RISC-V](https://www.zhihu.com/topic/20075426)

[^1]: [https://riscv-europe.org/summit/2024/media/proceedings/plenary/Tue-11-30-Krste-Asanovic.pdf](https://riscv-europe.org/summit/2024/media/proceedings/plenary/Tue-11-30-Krste-Asanovic.pdf)

[^2]: space-mit/riscv-ime-extension-spec [https://github.com/space-mit/riscv-ime-extension-spec](https://github.com/space-mit/riscv-ime-extension-spec)

[^3]: riscv-admin/integrated-matrix-extension [https://github.com/riscv-admin/integrated-matrix-extension](https://github.com/riscv-admin/integrated-matrix-extension)

[^4]: Enhancing convolutional neural network computation with integrated matrix extension [https://riscv-europe.org/summit/2024/media/proceedings/plenary/Tue-12-15-Jim-Chun-Nan-Ke.pdf](https://riscv-europe.org/summit/2024/media/proceedings/plenary/Tue-12-15-Jim-Chun-Nan-Ke.pdf)

[^5]: Qualitative Comparison [https://lists.riscv.org/g/tech-integrated-matrix-extension/attachment/46/0/comparison\_A\_E.pdf](https://lists.riscv.org/g/tech-integrated-matrix-extension/attachment/46/0/comparison_A_E.pdf)

[^6]: Burst and Packing Analysis [https://github.com/riscv-admin/integrated-matrix-extension/blob/main/Presentations/Memory%20Analysis/Burst%20Analysis.pdf](https://github.com/riscv-admin/integrated-matrix-extension/blob/main/Presentations/Memory%20Analysis/Burst%20Analysis.pdf)

[^7]: [https://github.com/riscv-admin/integrated-matrix-extension/blob/main/Presentations/Workloads/AME\_workload\_analysis\_20240412%20(1).pdf](https://github.com/riscv-admin/integrated-matrix-extension/blob/main/Presentations/Workloads/AME_workload_analysis_20240412%20\(1\).pdf)

[^8]: About MM workloads of AI applications [https://lists.riscv.org/g/tech-attached-matrix-extension/topic/about\_mm\_workloads\_of\_ai/105478567](https://lists.riscv.org/g/tech-attached-matrix-extension/topic/about_mm_workloads_of_ai/105478567)

[^9]: RISC-V: changing the way AI/ML accelerators and computing infrastructure are built [https://lists.riscv.org/g/tech-attached-matrix-extension/attachment/214/0/file1.pdf](https://lists.riscv.org/g/tech-attached-matrix-extension/attachment/214/0/file1.pdf)

[^10]: RISC-V Matrix Extension Introduction [https://lists.riscv.org/g/sig-vector/attachment/10/0/RISC-V%20Matrix%20Extension%20Introduction.pdf](https://lists.riscv.org/g/sig-vector/attachment/10/0/RISC-V%20Matrix%20Extension%20Introduction.pdf)

[^11]: SiFive proposal for RISC-V AME extension [https://lists.riscv.org/g/tech-attached-matrix-extension/topic/sifive\_proposal\_for\_risc\_v/110189555](https://lists.riscv.org/g/tech-attached-matrix-extension/topic/sifive_proposal_for_risc_v/110189555)

[^12]: [https://scalable.uni-jena.de/opt/sme/micro.html](https://scalable.uni-jena.de/opt/sme/micro.html)

[^13]: [https://lists.riscv.org/g/tech-attached-matrix-extension/topic/vector\_operations\_in\_attached/104062362](https://lists.riscv.org/g/tech-attached-matrix-extension/topic/vector_operations_in_attached/104062362)

[^14]: [https://www.anandtech.com/show/14756/hot-chips-live-blogs-huawei-da-vinci-architecture](https://www.anandtech.com/show/14756/hot-chips-live-blogs-huawei-da-vinci-architecture)

[^15]: AI Core架构 [https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/800alpha003/devguide/opdevg/tbeaicpudevg/atlasopdev\_10\_0008.html](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/800alpha003/devguide/opdevg/tbeaicpudevg/atlasopdev_10_0008.html)

[^16]: Vector Operations in Attached Matrix [https://lists.riscv.org/g/tech-attached-matrix-extension/topic/vector\_operations\_in\_attached/104062362](https://lists.riscv.org/g/tech-attached-matrix-extension/topic/vector_operations_in_attached/104062362)