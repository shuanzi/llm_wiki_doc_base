---
title: "TPU vs GPU 全面技术对比：谁拥有 AI 算力最优解？"
source: "https://mp.weixin.qq.com/s/peA089QQthXQbZiXAJOkKg"
author:
  - "[[NCL]]"
published:
created: 2026-04-19
description: "Google 过去依靠 TPU 形成的成本优势，在 v8 这一代被显著削弱了"
tags:
  - "clippings"
---
NCL *2026年1月15日 20:04*

作者：NCL

编辑：Feihong，Siqi

SemiAnalysis 最近对 Google TPU v7/v8 的深度拆解，可能是目前公开信息里少数能同时讲清硬件规格、互联拓扑与 TCO（Total Cost of Owenship，资产全生命周期总成本） 模型的系统性对比：文章中把 3D Torus + OCS 的设计哲学、以及 TPU 与 Nvidia GPU 在训练与推理中的成本结构差异拆到了可计算的层面。

但 SemiAnalysis 的结论需要打折来看：

**•** 文章中倾向于放大 TPU 的 MFU 优势（假设 TPU 40% vs GPU 30%），却没有充分讨论 FP8 精度下公开 MFU 数据的缺乏；

**•** 强调 TPU 在训练场景的 TCO 领先，却对推理场景下 GPU 凭借 FP4 算力的反超着墨不多；

**•** 详细介绍了 TPU 的软件优化，却淡化了这些优化本质上是在弥补 3D Torus 对不规则流量的天然劣势。

在这篇文章中，我们基于 SemiAnalysis 的数据框架，结合对训练、Prefill、Decode 三类场景做了再拆解，尝试对 TCO 效率路线进行更全面的分析对比，以下是三个关键结论：

**•** **TCO 的真正答案是“看场景”** ：训练和延迟不敏感推理选 TPU，推理 Prefill 和延迟敏感推理则 GPU 是优选；

**•** 3D Torus 和 Switch Fabric（NVSwitch / Fat-tree） 这两套互联体系的本质分歧不在于"谁更快"，而在于"对流量形态的假设"；

**•** Google 历史上靠 TPU 建立的 TCO 护城河，在 v8 这一代被显著削弱。

**01.**

**关键结论**

**1.** TCO 的真正答案是"看场景"：训练和延迟不敏感推理选 TPU，推理 Prefill 和延迟敏感推理看 GPU。

SemiAnalysis 给出的 TCO（Total Cost of Ownership） 对比结论需要打折看待。 训练场景下 TPUv7 确实能带来 45-56% 的成本优势，但这一数字建立在"TPU MFU 比 GPU 高 5-10 个百分点"的假设之上——而 FP8 精度下的公开 MFU 数据并不充分，Bytedance MegaScale 在 BF16 下已将 H100 优化到与 TPU 接近的水平。更关键的是，推理场景的结论完全倒转：GB200/GB300 凭借 FP4 算力优势在 Prefill 阶段反超 TPUv7 约 35-50%，而 Decode 阶段的实际性价比差距也远没有纸面 HBM 带宽数字显示的那么大。

**2.** 3D Torus vs Switch Fabric（NVSwitch / Fat-tree） 两套互联体系的本质分歧不在于"谁更快"，而在于"对流量形态的假设"。

3D Torus + OCS 假设通信模式可预测、可编排，因此能在万卡规模的常规训练任务中维持高 MFU；Switch Fabric 则假设流量不确定，用全互联换取对任意通信模式的容忍度。这决定了各自的甜点区：十万卡以上级别的训练负载，只能采取 Fat-tree；而千卡到两万卡的稳定训练负载，3D Torus 占优；几百卡以内的灵活实验、MoE 训练、以及延迟敏感的在线推理，NVSwitch 全面胜出。当 MoE 成为主流架构、在线推理场景持续增长，TPU 面临的适配压力只会越来越大——而这正是 NVSwitch 的舒适区。

**3.** Google 历史上靠 TPU 建立的 TCO 护城河，在 v8 这一代被显著削弱。

TPU v8 选择 3nm + HBM3E 的保守路线，而 Nvidia Rubin 激进押注 HBM4（20TB/s vs 9.8TB/s）、FP4 算力翻倍、甚至专为 Prefill 场景推出低成本 CPX 芯片。结果是：从 GB200/TPUv7 的 1.52× 训练 TCO 差距，到 VR200/TPUv8p 仅剩 1.23×；HBM 带宽性价比差距更是从 1.32× 收窄到 1.10×。这正是 Anthropic 需要重建 Nvidia 合作的原因：TPU 虽然在特定场景下找到了性价比甜点，但 Nvidia 的迭代速度实在太快，难以长期忽视。

**02.**

**TCO Comparison**

衡量推理成本最直接的指标是 per-token 成本（$/M tokens），即在相同 setting 下（包括但不限于模型大小、 context length、首 token 延迟和 Batch size），单卡 TCO（$/h/GPU）除以在该服务目标下可长期稳定实现的 tokens per second per GPU。

以 LMSYS 的数据为例：在 NVL72 GB200 集群上，单卡可达 13,386 output tokens/s，结合约 $2.28/h/GPU 的 TCO，推理成本约为 $0.047/M tokens。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Source： *SGLang and NVIDIA Accelerating SemiAnalysis InferenceMAX and GB200 Together*

LMSYS（Large Model Systems Organization）是一个由 UC Berkeley 主导的开源研究组织。

作为对照，H100 在相同测试设定下仅能达到 2,789 tokens/s（TCO 约 $1.42/h/GPU），对应成本约 $0.14/M tokens，约为 GB200 的 3 倍。

但 per-token 成本难以作为通用对比基准：训练场景没有统一的 token 产出定义；推理侧 TPUv7 尚未公开具体吞吐数据，SemiAnalysis 提到会在未来一两个月公布，届时我们就能更清晰地判断 TPU 在真实 token 成本上是否具备优势，不过主观上我不认为双方会拉出特别大的差距。

因此，下文退而求其次，用 TCO / Effective FLOPs 和 TCO / Bandwidth 等中间指标来近似推断性价比，为了进行这一对比，我们还需要先拆解训练和推理各阶段的实际瓶颈：

**1.** 在万亿参数级别的模型训练阶段，瓶颈通常会出现在算力和 Scale-out 通讯带宽上。训练时需要计算海量梯度并通过 All-Reduce 同步到所有节点，同时前向和反向传播的矩阵运算需要极高的 FLOPs 才能在合理时间内完成。

**2.** 在推理的 Prefill 阶段，在合理设计并行策略（尽量增加 pipeline 并行、减少 tensor 并行同步）的前提下，瓶颈主要会转化为算力而不是通讯带宽。原因在于 Prefill 阶段需要处理大量 token，能够触发高度并行的矩阵运算，使 GPU 长时间保持高利用率；同时，用 pipeline 并行替代大规模 tensor 并行可以显著降低跨 GPU 的同步与通讯开销，让芯片更接近算力上限地运行。

**3.** 在推理的 Decode 阶段，瓶颈通常会出现在内存带宽和 Scale-up 通讯带宽上。解码时每生成一个 token 都需要从 HBM 加载全部模型参数，但其实这一过程的实际计算量很小，GPU 大部分时间在等待数据而非计算。每个 token 生成都需要不同 GPU 之间反复传输 KV Cache 和激活值，频繁的小数据传输让通信延迟成为吞吐瓶颈。

这就导致训练和不同场景下的推理需要的性能不同，比如：

**•** 训练时更需要 FP8 和 Scale-out Bandwidth（TPU）；

**•** 而在推理 Prefill 阶段需要 FP4 和 Scale-up Bandwidth（GPU）；

**•** 推理 Decode 阶段需要 HBM Bandwidth 和 Scale-up Bandwidth（GPU）。

这也是 SemiAnalysis 在文章中拆开计算 GPU 和 TPU 在训练和推理场景下的性价比的原因。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

接下来我们会对训练、推理 Prefill 和 Decode 三个阶段 TPU 和 GPU 的性价比进行详细对比分析。

**场景 1：训练性价比**

SemiAnalysis 在考虑资金成本和运营成本（包含电费、租金和技术）后计算出了 TPU 和 NVDA GPU 的 TCO。并且强调 TPU 在宣传算力时比 NVDA 和 AMD 更保守，Blackwell 系列只能做到纸面算力的 75%，MI300 甚至只能做到 50-60%。

NVDA 和 AMD 在对外宣传峰值理论算力（FLOPs）时，会用芯片在极短时间内能够跑到的最高瞬时频率来计算，即使这个频率在实际工作负载下几乎无法长时间维持。而实际情况是， NV 和 AMD 使用动态电压和频率调节（DVFS）技术，会根据功耗和温度情况不断调整芯片的频率。

SemiAnalysis 并没有提到的是，TPU 也采用类似的技术以保护芯片，所以大多时候也无法做到纸面算力的 100%，很可能也只能做到 80-90%的纸面算力。

SemiAnalysis 提到，Google 凭借 3D Torus 互联架构，以及谷歌内部人员对于训练算法软硬件优化，能够做到在 FP8 精度下的训练 MFU 高达 40%，而 GPU 仅能做到 30%。我认为，这一观点其实是 SemiAnalysis 主观拉大了 NV 和 TPU 阵营的 MFU（Model FLOPs Utilization， 算力利用率） 差距。

目前 FP8 精度的公开资料并不够多，SemiAnalysis 的 MFU 也没有足够的证据表明是否属实。但是在之前广泛利用的 BF16 精度下，Bytedance 在 MegaScale 论文中将 H100 优化到跟谷歌 TPU 差不多的水平，只是目前在 FP8 出来的初期 Meta LLama4 在用 FP8 训练时 MFU 比较低，但是从 Llama3 的训练上看 Meta 原本的优化功底并不出众。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

综合来看，通过比较下面四款芯片的 TCO / Effective FP8，可以看出 Anthropic 通过采购 TPUv7 后能在训练成本上节省 45%，而谷歌内部能节省 56%：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**场景 2：推理 Prefill 性价比**

Prefill 由于可以多卡并行处理庞大的 prompt，所以更受限于单卡的算力，而 FP4 精度的优势能让 GB200/GB300 比 TPUv7 External 在 Prefill 阶段有将近 35-50% 的成本优势。

在 Prefill 阶段，若 N 个用户长度为 K 的 prompt 需要用 P 张卡进行推理，那么其中几个用户的 prompt 会作为一个 batch 传到一张卡上跑一遍整套 attention，并将得到 KV Cache 用 FP8 精度存储下来，这是在帮每个 token 看全上下文、算好“该关注谁”。

到了 MoE 阶段，Router 决定 token 去哪些 experts，这些 experts 分散在不同 GPU 且权重用 NVFP4 压缩存储，于是这些 token 被丢给对应 GPU 上的 experts 做一小段非线性计算，算完再把结果合在一起作为输出。

SGLang 通过上述这个混合精度推理的方式，充分发挥了 Blackwell 卡引入的 FP4 算力的优势，在硬件纸面 FP8 算力仅提升 2.25x 的情况下，依靠降低精度直接获得额外的 1.8x 提升，也就是 GB200 的 Prefill 效率为 H100 的 3.8x 吞吐。 这说明 GB200/GB300 在 FP4 上的算力优势，让其在 Prefill 阶段能反超 TPUv7 的成本优势。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Reference： *Deploying DeepSeek on GB200 NVL72 with PD and Large Scale EP (Part II): 3.8x Prefill, 4.8x Decode Throughput*

（这里实际上也有 MFU 的概念，只有超长 prompt （如 100k 以上）让 MFU 接近 90-100%，而如果 prompt 比较短， Prefill 阶段也会更被 Memory Bandwidth 和 Scale-up Bandwdith 限制。)

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**场景 3：推理 Decode**

Decode 阶段主要受制于 HBM Memory Bandwidth，但当推理追求低成本去用更大的 Batch Size 时， NVLINK Bandwidth 会逐渐成为瓶颈。所以， SemiAnalysis 认为 TPUv7 能在推理阶段靠低 40-50% TCO / HBM Bandwidth 有一定优势，但是因为这步骤实际也和 Scale-up Bandwidth 很相关，所以实际性价比差距并没有这么大。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

在 Decode 阶段，模型每次迭代为 N 个用户各生成一个新 token。每张 GPU 需要从 HBM 读取所有用户的 KV Cache（FP8 格式）和模型权重来计算 attention，小 batch 时这个"从显存读数据"的过程主要受制于 HBM Memory Bandwidth。

但当追求低成本用更大 batch size 时，计算量上来稀释了单卡带宽压力，此时跨卡通信开始显现：attention 算完要 all-reduce 同步结果，MoE 层 Router 把 token 路由到分散在各卡的 experts（NVFP4 压缩权重）又触发 all-to-all 通信，最后再汇总回来。

大 batch 下跨卡数据交换量激增，NVLink 带宽逐渐成为新瓶颈。Decode 阶段性能瓶颈本质是随 batch size 从单卡 HBM 带宽动态迁移到多卡 NVLink 带宽。

**03.**

**互联结构对比：3D Torus vs Switch Fabric**

GPU 路线下的 Switch Fabric（NVSwitch / Fat-tree） 和 TPU 路线下的 3D Torus + OCS 代表了两条截然不同的互联哲学。同样也会对 TCO 带来影响，在这一部分我们会对这二者进行对比，在对比之前，我们会先对 Google TPU 的 3D Torus 路线进行分析。

**Google TPU 的 3D Torus 路线**

**Google 的 OCS 路线**

传统的电交换架构里，每跳一次就要做一轮电→光→电的转换，功耗和延迟都会往上叠。Google 用 OCS（光电路交换机）替代传统的电分组交换，核心诉求就是把功耗和成本打下来。目前 Google 主要用的是 AVGO 的 MEMS OCS，不过市面上也有其他路线，比如 Coherent 做的 DLC （数字液晶） OCS。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

OCS 的直观理解是一个由上百个小镜子组成的“可调角度镜墙”。对于一个 136x136 OCS 来说，光从输入光纤进入后，会依次打到两组 2D MEMS 微镜阵列上。每组阵列里有 136 个微小镜面，镜子都能在电信号驱动下独立倾斜。只要把每个镜子的倾角设对，交换机就能把某一束入射光精确“折”到指定的输出光纤上。这样一来，路径一旦建立，后续数据就在光域里直通，不需要每跳都做光电转换。

到 2026 年，Google 主力用的是 300x300 OCS，其中有效可用端口是 288 个。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Coherent 走的是另一条技术路线——用 DLC 代替 MEMS 镜片。电信号让液晶分子重新排列来改变光路，整个过程没有机械运动部件。DLC 方案的好处是成本更低、驱动电压也更小，但缺点是切换速度慢很多。不过对 Google 的 AI 训练集群来说这不是问题，因为这类集群的通信拓扑大约一周才重配一次，OCS 切换速度慢一点完全可以接受。

**TPUs 的 3D Torus 是如何实现的**

3D Torus 是一种网络拓扑结构，每个节点在三个维度上都与相邻节点相连，并且每个维度的首尾相连形成环状。TPU Pod 采用这种拓扑来实现芯片之间的高带宽、低延迟通信。

一个 TPU pod 由 4x4x4 = 64 个 TPU 组成，和大家普遍认为 TPU 基本采用光互连相反，实际上， TPU Pod 内部以铜缆和 PCB 互联的，一个 Pod 有 16 个 Server，每个 Server 上的 4 个 TPU 是用 PCB 线互联，而 16 个 Server 之间则用铜缆。

TPU Pod 之间则是使用光互连，我们可以把整个 Pod 看成一个立方体，6 个面每面 4×4 共 16 颗 TPU，理论上，如果 6 个面各自独立接 OCS，需要 16×6 = 96 条光连接；但 3D Torus 允许对立的两个面共用一台 OCS，把 6 个面的需求两两合并成 3 组，实际只要 96 / 2 = 48 个 OCS 端口（或单元）就能把所有 Pod 之间的光互连铺出来。

下图是 SemiAnalysis 所给的 TPU Pod 分别需要多少 PCB 线，铜缆和光模块：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**TPU Cluster Size**

在这个 TPU 集群里，最大能做到多大，本质上是被 OCS 端口总数卡住的。以现在的 v7p 系统为例，每台 OCS 等效是一个 144×144 的交换设备，一共 288 个可用端口（144 in + 144 out）。集群里配了 48 台 OCS，所以总端口数是 48 × 288 = 13,824。之前算过，一个 4×4×4 的 TPU 立方体需要 96 个端口，那么最多能挂的立方体数量就是 13,824 ÷ 96 = 144 个，对应最大集群规模 144 × 64 = 9,216 颗 TPU。

如果未来 OCS 真正升级到 300×300 规格，每台有 576 个可用端口（其中 24 个做冗余备份），那同样是 48 台 OCS，总端口数就变成 48 × 576 = 27,648。按每个立方体仍然吃 96 个端口来算，可以支撑 27,648 ÷ 96 = 288 个 4×4×4 立方体，对应的最大集群规模直接翻倍到 288 × 64 = 18,432 颗 TPU。也就是说，在固定 Pod 拓扑不变的前提下，单台 OCS 端口数的提升，会线性抬高整个系统可扩展到的 TPU 数量上限。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

SemiAnalysis 提出， 一个 TPU Cluster 理论上可以拓展到 147,456 颗 TPU：

**•** 通过传统的 Fat Tree 结构扩展到用 4,608 台 64×200G 的 ToR 交换机，首先把机柜里的 TPU 数量拉上来；

**•** 再通过配 2,304 台 128×200G 的 leaf 交换机和 2,304 台 128×200G 的 spine 交换机，叠成一棵三层 fat-tree；

**•** 最上层再挂 256 台 300×400G 的 OCS。

但由于链路层次多、带宽被一层层拆分稀释，单颗 TPU 实际能拿到的有效通信带宽比较低，也就是说绝对算力规模虽然堆上去了，但实际效率却被 Scale-up 网络带宽拖住了。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**3D Torus 和 Switch Fabric(NVSwitch / Fat-tree) 对比**

Switch Fabric（NVSwitch / Fat-tree） 和 3D Torus + OCS 代表了两条截然不同的互联哲学。理解它们的差异，可以从三个维度切入：互联模式假设、规模边界、优化目标。

**维度 1：互联模式假设**

**1.** Switch Fabric（NVSwitch / Fat-tree）的假设互联模式不确定

NVSwitch 在单域内（如 NVL72 的 72 张 GPU）用交换芯片实现近似全互联：任意两点通信通常仅需 1–2 跳，延迟几乎恒定。因为全互联拓扑使任意 GPU 对都可以直接或通过一跳 NVSwitch 到达，无需预设固定通信路径，天然适配 All-Reduce、All-to-All、点对点等各类不确定的互联模式需求。

代价是 NVSwitch 芯片的总交换带宽和端口数有硬天花板，单域规模被锁死在几十到百卡级别；一旦跨出域，就必须借助外部网络，带宽和延迟同时断崖式下降。

超过单域规模后必须要借助 Fat-tree（InfiniBand / Ethernet 的多级 spine-leaf 交换机堆叠），通过堆交换层级来堆带宽，是目前唯一能把集群推到数十万卡的方案。代价是每多一级交换就多一跳延迟、多一份成本和功耗，且跨域带宽（典型 100 GB/s/卡）比域内 NVLink（1.8 TB/s/卡）低一个数量级。

**2.** 3D Torus + OCS 假设通信模式可预测、可编排。

核心不是做“任意两点直达”的通用互联，而是把训练里可预测、可编排的关键通信（梯度同步、张量切分聚合/分发、stage 间激活传递）压成路径和时序都固定的稳定数据流。关键不在于“够不够短”，而在于路径/顺序可确定、可提前规划并与计算重叠，从而长期把链路喂满。对熟悉 LLM 结构与并行拆分的团队（如 GOOGL）来说，更容易把 DP/TP/PP 映射到合适的物理维度，把需要频繁交互的分组放在物理上更“近”的区域，从而把这种“可排程”的优势放大。

这一代价是它对"流量长什么样"有强假设：一旦流量变成不规则或偏斜（典型如 MoE expert routing），某些维度的链路会被过载，且难以通过动态路由避免。单 Pod 上限约 9k 芯片，超出后跨 Pod 带宽骤降。

**维度 2：规模边界要分场景分别讨论**

**1.** 在 LLM 训练环节：

**•** 百卡规模（适合研究员个人小实验）下 NVSwitch 占优，因为训练里的 TP/DP 梯度同步等关键 collectives 往往能压在单个 NVSwitch 域内，all-reduce 延迟低、带宽高，NCCL/框架并行策略也更容易稳定执行。

**•** 千卡到两万卡规模（适合 Post-training 和中大型训练实验）: 3D Torus 占优——除非 MoE expert 数量较多。

训练通信大多满足"可预测可编排"条件，3D Torus + OCS 借此将单 pod 推至万卡级并维持高 MFU；GPU 同规模只能走 fat-tree，层级深、调度开销大，MFU 更易被拖累。但 MoE 的 EP 通信本质是不规则 all-to-all：Expert 越多、负载越偏斜，通信瓶颈从"可排程的稳定流"转向"难被拓扑对齐的不规则分发与汇聚"——正好触发 3D Torus 对流量形态的强假设失效。这让万卡 TPU Pod 的扩展效率在高 Expert 数 MoE 中更早下滑，整体训练效率反而不如同规模 GPU 集群。

**2.** LLM 推理

LLM 推理要拆成 Prefill 和 Decode 两段看，Prefill 是算力瓶颈，Decode 是互联带宽/延迟瓶颈。

1）在推理的 Prefill 阶段，Prompt 可以被多卡并行处理，此时 GPU NVSwitch 更占优势。

因为 workload 更容易进入 compute-bound: 谁的低精度算力更猛，谁就能更接近满负载地把 token 吞下去。GB200/GB300 的 FP4 精度算力能 比 TPUv7 在 Prefill 阶段有 35-50% 的成本优势；NVL72 的 130 TB/s bisection 带宽和 1-2 跳的低延迟 fabric 可以保证多卡并行处理长 prompt 时几乎不受通信瓶颈限制。

2）在推理的 Decode 阶段，瓶颈通常出现在 HBM 带宽和 Scale-up 互联上。更具体来看：

**•** 对于延迟不敏感的离线大 batch 推理，TPU + 3D Torus 有性价比优势。当 batch 足够大时，通信与调度开销更容易被吞吐摊薄，torus 的带宽也能被利用起来，这时 TPU 有比 GPU 便宜 30-50% 的内存带宽成本（TCO / HBM Bandwidth）。

**•** 对于延迟敏感的在线小 batch 推理，GPU + NVSwitch 优势放大。由于这时请求更碎、更随机时，torus 的固定 6 方向链路更容易出现热点和延迟抖动；而 NVSwitch 能让任意两张 GPU 互相传数据都基本是一跳直达，延迟更稳定可预测。由于这时瓶颈变成了 Scale-up 互联了，而 GPU 的互联性价比（TCO / Scale-up Bandwidth） 和 TPU 相差不大，所以这时 GPU 能靠更好的用户体验胜出。

**•** 对于多 Experts 的 MoE 推理，GPU + NVSwitch 优势更明显。MoE 的 expert routing 本质上是不规则的 all-to-all，token 会被 gating 分发到分散在不同芯片上的 expert，流量模式和 torus 的 6 邻居固定拓扑天然不匹配。结果往往是热门 expert 所在的芯片会在某一个 torus 维度上形成持续热点，带来排队和尾延迟抖动。相对地，NVSwitch 能把“任意 GPU 到任意 GPU”的传输基本压成一跳直达，把 dispatch → compute → gather 的通信开销压到亚毫秒级，延迟更稳定、可预测。因此，Expert 越多、负载越偏斜、路由越不规则，NVSwitch 的延迟确定性和体验优势就越大。

**维度 3：TPU 软件优化**

SemiAnalysis 花了不少篇幅介绍 TPU 为推理场景进行的算法优化，本质上是谷歌在在软件/编译器层面试图缩小 TPU 与 GPU 的差距，把 TPU 原本不擅长处理的"不规则/动态"访存与通信，重新包装成“可预测、可流水”的稳定数据流，从而让 3D Torus 的带宽被充分利用起来。

**1.** TPU KV Cache Management

GPU 用 paged attention 把 KV cache 当虚拟内存来管，按需从分散的地址把数据块抓出来再拼起来（scatter/gather）。这会带来大量随机地址访问和不连续读写，但 GPU 的高带宽显存加上强大的随机访存单元能容忍这类不规则操作。

TPU 的随机访存能力较弱，硬件更偏向批量、连续、可预测的数据搬运；一旦访存模式变成"动态地址 + 随机抓取"，延迟和吞吐都会恶化。

为此，Google 改用"预取 + pipeline": 提前把下一条序列需要的数据块搬进芯片，用矩阵计算把搬运延迟盖住，让内存访问重新变成时序可预测的稳定数据流。

但对应的代价是灵活性不如 GPU：一批请求的结构必须提前确定，对请求随机到达、长度高度不一的在线场景适配成本更高。

**2.** TPU All-fused MoE Kernel

GPU 跑 MoE 模型的传统流程是先把 token 按目标专家排序，再分发到对应专家。排序本身是 GPU 擅长的并行操作，且 NVSwitch 能让传数据和做计算同时进行、互不干扰，所以这套流程在 GPU 上跑得很顺。

TPU 上的情况完全不同：它排序慢，而且很难一边搬数据一边算。如果按传统流程走，"先排好队再一起发出去"这一步就会卡住整个流水线。Google 的解法是干脆不排队——改成"轮到哪个专家就处理哪个专家"，一个一个来，把排序这个麻烦事直接跳过；同时趁着某个专家在算的时候，后台悄悄把下一个专家要用的数据搬过来，让搬运和计算交替进行、互不等待。

但这只能缓解单集群内的调度开销，无法改变 3D Torus 对流量形态的强假设：一旦专家数量多、负载偏斜、路由不规则，某些方向的链路仍会被过载，延迟难以被软件优化消除。

**3.** SparseCore

GPU + NVSwitch 天然支持任意两个 GPU 一跳直达，分发和汇聚的通信开销被压到毫秒级，通信与计算分开跑是互联层面的默认能力。这在面对 MoE 稀疏激活带来的动态 all-to-all 路由时尤为关键，确保 token-to-expert 分发不受拓扑限制。

TPU + 3D Torus 在处理 MoE 的不规则通信时，分发和汇聚容易卡住。Google 的应对是在芯片内加一个独立的稀疏计算单元（SparseCore），专门跑 MoE 的分发汇聚，和矩阵计算硬件级并行。这在本质上是在硬件层承认 TPU 需要“类 NVSwitch 的通信-计算解耦能力”。

如果 Mosaic 编译器成熟、SparseCore 落地，能把 TPU 的 MoE 上限抬高、更接近 GPU 的灵活性。但这也会让 TPU 会浪费一些片上面积在 SparseCore，影响 Tensor 算力提升。

可以看到，TPU 的在推理场景的优化方向始终是“让不规则变规则”，而 GPU + NVSwitch 的设计哲学是“从一开始就容忍不规则”。前者需要持续投入工程资源去适配每一种新的工作负载，后者则提供了一个更通用的底座。

当 MoE 成为主流架构、在线推理场景持续增长，TPU 面临的适配压力只会越来越大，而这正是 NVSwitch 的舒适区。

**04.**

**产品侧对比：NVDA Rubin vs Google TPU 8**

**Google TPU v8：双轨策略与成本结构重塑**

Google 在 TPU v8 上采取“双供应商”策略，本质是降低 ASIC 的利润抽成。TPU v8 分为两个 SKU，这两个 SKU 分别和不同的供应商合作：

**•** TPU 8AX（代号 Sunfish）：与 Broadcom 合作，沿用 N3E 制程，2 compute die + 1 I/O chiplet + 8 stack HBM3E 12-high，内存带宽为 9.8 TB/s， 相比 v7 提升 ～30%（9.6Gbps pin speed）。

**•** TPU 8X（代号 Zebrafish）：与 MediaTek 合作，N3P 制程，1 compute die + 1 I/O die + 6 stack HBM3E 12-high，采用 MediaTek 自研 224G SerDes。

Google 选择 MediaTek 的核心逻辑是“Customer Owned Tooling”模式。

Broadcom 对整个 SiP 封装（包括 HBM）叠加了可观的利润率，尽管 Google 几乎全权负责计算单元的前后端设计，Broadcom 只贡献 PHY 和控制器。而 MediaTek 更灵活——Google 可以直接从 SK Hynix 采购 HBM，绕过设计公司的 margin 堆叠。考虑到 HBM 占封装级 BOM 的最大头，这个设计成本影响巨大。

然而这个选择的代价是工程资源被分散、tape-out 周期拉长。没有 Broadcom 手把手带，TPU v8X 的流片时间远超预期，直到本季度才完成。

**Nvidia Rubin：激进提速、推理专项优化**

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Nvidia 在竞争压力下临时加码了 Rubin 规格。

**•** 原计划：1800W 功耗，13TB/s HBM 带宽。

**•** 最终规格：2300W 功耗，20TB/s HBM4 带宽（10Gbps pin speed）。

这不是常规迭代，而是 Nvidia 对 AMD MI400 和 Google TPU 双重威胁的应激反应。

Rubin 代际最主要的更新是显著倾向于优化推理的性能和 TCO，甚至新推出了针对 Prefill 场景的 CPX。

**1.** FP4 算力翻倍

GB300→VR200（Rubin）在"同为 3nm 级、还是两块大 die"的前提下把 FP4 FLOPS 拉到近乎翻倍。本质不是制程奇迹，而是把原本给互联/IO 的面积和功耗预算统统挪去堆 Tensor/SM，再叠加更高 TDP 和频率上限一起堆出来的结果。

具体来说，Rubin 仍采用两块 3nm 计算 die，但在两侧加上独立 I/O tile，把 NVLink、PCIe、NVLink-C2C 这类 SerDes 大头搬出去，大约释放出 20–30% 的逻辑面积配给更多 Tensor Core 和 SM，同时从 Blackwell 世代的 4NP 切到 3NP（Nvidia 定制 3NP 或标准 N3P）带来逻辑密度提升，使得在“同工艺、同 die 数”下可以塞进显著更多做 FP4 矩阵乘的阵列单元。

在此基础上，Rubin 整卡 TDP 被推到约 2300W，既有利于时钟略微抬升，又支撑了更大的 Tensor Core systolic array——从 Blackwell 的 64×64 到 Rubin 的 128×128。

**2.** HBM4 带宽要求反复上调

为显著增强推理 Decode 阶段，Nvidia 在过去几个季度里多次上调 VR200 HBM4 的性能规格，从早期的 8Gbps 到现在的 10 Gbps，HBM4 bandwidth 从 16.4TB/s 来到了 20TB/s。而同期的 TPU v8 虽然也略有上调，但最终版本还是停在 9.6Gbps 的 HBM3E，对应 9.8TB/s。这让 Nvidia 阵营在内存带宽这条推理 Decode 的关键瓶颈上巩固优势。

**3.** CPX 推理专用芯片

为了进一步提升推理 TCO，Nvidia 在 VR200 NVL144 里引入 Rubin CPX，本质是在系统层面把“推理的 Prefill 计算型工作负载”从“需要高 HBM 容量 + 高 NVLink 带宽的通用 GPU 路径”里拆出来，做成一条更便宜、但更贴合 Prefill 瓶颈的专用算力芯片。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

CPX 在仅相当于 R200/VR200 的 1/5–1/4 BOM 成本下，仍能实现 60% 的 FP4 算力，从而进一步巩固了其在推理 Prefill 环节的 TCO 优势。

Nvidia 通过 CPX 主动降低单位算力的内存与互联 BOM，把同等预算更多地押在“有效 Prefill 吞吐”上，从而在 TTFT（Time-to-First-Token） 这条关键体验指标上，继续拉开和其它体系（例如更强调 torus/内存带宽性价比的路线）之间的差距，形成“Prefill 阶段优势 = 更高吞吐 + 更低 TCO”的护城河。

R200 NVL144 CPX 机架进一步放大了这一优势：每个 compute tray 同时搭载 4 张 Rubin GPGPU（2 die + 288GB HBM + NVLink）和 8 张 Rubin CPX（1 die + 128GB GDDR7 + PCIe），实现了 Prefill 与 Decode 的物理解耦。

高性价比的 CPX 卡专门消化 Prefill 负载，GPU 卡则保留 NVSwitch 全连接拓扑来服务 Decode 和 MoE 路由，避免两阶段混跑时的相互干扰，从而在 Prefill 阶段的 TCO/Token 上拉开与竞品的差距。

**TCO 变革**

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E) ![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Google 历史上靠 TPU 建立的 TCO 护城河，在 v8 这一代被显著削弱。原因有三：

**1.** 制程保守：TPU v8 仍在 3nm + HBM3E，Nvidia 上 3nm + HBM4，AMD 同期瞄准 2nm + HBM4。

**2.** 内存带宽落后：HBM 3E（9.8TB/s）vs HBM4（20TB/s），差距约 50%。

**3.** SerDes 节奏慢：尽管为 Broadcom SerDes 付出高昂成本，Google 直到 2027 年才迁移到 224G。

Google 的问题不只是设计选择保守，还包括供应链效率。从芯片制造到组装成机架再到跑起负载，Google 的周期比竞争对手更长。

如果 Nvidia 按计划执行 VR200 和 VR300：

**•** 外部客户：TPU v8 从"有竞争力"变成"不占优"。

**•** 内部负载：Rubin + Kyber rack 的 TCO 可能追平甚至超过 TPU v8，即使是 Google 自己的训练任务。

这正是 Anthropic 需要重建 Nvidia 合作的原因：TPU（以及 Trainium）虽然在特定场景下穿针引线找到了性价比甜点，但 Nvidia 的迭代速度实在太快，难以长期忽视。从全球 FLOPs 出货量看，Nvidia 仍是绝对主导。

排版：傅一诺

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E) ![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E) ![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

延伸阅读

当 AI 接管钱包：Agentic Commerce 如何重构互联网经济？

深度解读 AGI-Next 2026：分化、新范式、Agent 与全球 AI 竞赛的 40 条重要判断

拾象 2026 AI Best Ideas：20 大关键预测

Benchmark 新合伙人 Everett Randle: 忘掉 SaaS 逻辑与毛利率，AI 时代估值看单客价值

AI 医疗全景更新：为什么硅谷 healthcare 领域出现了最多的 AI 独角兽？

内容含AI生成图片

继续滑动看下一个

海外独角兽

向上滑动看下一个

![kimi](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAEv8SURBVHgB3X0JmBzVde6p6p5Fo22079JolwAtSCxaQAiDQBgjwEu+L9iOlxgc57NjbOA9YkcSYF4+x1sgeU6c5BmMk7B4FRiDhG0Qq4RAQvsuNNp3abTMSDPTXfXOf869Vbeqe6RZJCFy9Y26u7q6lnvOPec//zn3lkf/A9vdd99dVVpaOj4Igirf9wfl8/lKz/Oq8IfvwzCsKvY7/r6aX2r4+xp+j79qPsY23rYcn7///e8vp/9hzaMPeYOwS0pKprOAxrHgphvhVtK5aTX8t5yVCorwKl6/+93vVtOHuH3oFOCBBx6oPHHixHju/FtZ2Lc1NZrPV2PFgzIs5+t44gc/+MFC+pC1D40C3HvvvRjdn+MOv43O3Qhva4PbmMd/z37ve9+bRx+CdkErwH333TeehX4rv72bWiD0+vp62r9/Px09eowOHNjPnxvo2LGj/Plo9D22xQ3dEFKnTp2orKyMysvL5LVnzx78Ws6vPalHjx6yrbnN4ImFmUzmwQvZTVyQCoDRzi9z+W96c/bfsWMHC/oA7di+g/bzK4QNgVrBxrdpX93vfP4LzPYM/+Up2S3x7zt16szK0J0GDBggStG/f39qZlvIfw9eiC7iglKA5goeI3jNmrW0efNmHun75LM237xCoJ75g0AzZhu+D5193M92f/e3rqKQ814/l7UrpwGsBMOGDePXAWJBTteMVXiQo4mf0QXSLggFaI7gVehrWOhbeMQjMnMv3R3ZaHZUp2/PFaa7vx35xX6btiBBdBxPNpdQ6Of45yFbhoF08cUXiYU4nTJcSIrwgSrA/fffX5XL5R6n0wh+546dtHrNahF8ff0pKm6e7TZryt193JGedgn2GPZ77GuthVfkN/rqJX7O+3v51HlDVoRL+G80u4kB1FQDYGSM8I0PEiN8IApgQrmv421T++zcuZPeemsRj/adVDiaIQjXX6dNdFrgaVPumv5iv7XHda1BrDie15R7oOgYYRiIogA8TpgwUSzD6bqkQ4cOj3K/1NB5buddAWDuuQMfbyp+h+BffHG+AXJucwWSHqnpljbzvhFawIJxj+ccXT66gJCMEH1KYouwyLnTyuA2VTa4hMmTJ7EiXEzFGtwC98kXzjdQPG8KYEY9/Pzdxb7XEf+WIPpkS3dsutPTYI6a2Pd02/SzCtsVMDn7+kU+s++nLMX4gZz9POcY9phQhI40c+bMJiMIJrgeYQ7hG3Se2nlRAPh65uNfKTbqjx07RvPnLygieLQ0AENH+6n37n6uQqRHqD2GvleLoJ/D0FoJa1nCM1wL9rOCL4Yr0tfkXqueAy4BFqEYWIQ1YGxw7fnABhk6x+2ee+75HHcwWLHe6e+WLVtGzz//Ah0+fMhsSSP7dIhWbHt6nzQGoCLHNls8++qb0e8qgPmTw/hUHEvY42aoqVCxqTF24MA+Wrt2HeVyAUcNBdagkpNQn58yZUo9W8XFdA7bOVUA9vf/yNr8XX5b7m7HqH/22WdpxYoVlM+7ppwo2YGuMNMd6lPTEUFACSGZzRj1KmzdqEIninFFEgPoj1wz7ipWxvlt2Izr9qNXj60Hzp3P5ySkhSIMGzY8zTSiz2ayEsA1vkrnqJ0TFwB/X1tbC6B3W/q7ZcuWi6+vrz9JVDTWTrN06dFmTaqnv/DM9yEj7wLzb5TBE+nzrva7pgge9zzpCMAKMH+a67atKQuUN0rnKjwrhJ+nduUd6Morr6Dx48dTuiFcbN++/RfORZRw1hXA+PvfsvATdwIiZ9GiRbR06VJKh0yFIyU94h2BQZBF/W6RUBEC98x+PJJDjFoge9daeOa3oRdvE3CXiY4ThhRZjfhc1uy7yhYrZxxOWkVSBfK8+J6BPXwf0UbsviZMHE/XTLuW0u1c4YKzqgBNgT2Y/HnznmW/d5BczS/0q8WAFEX+2WA1/qyC1K+bshZWSPY4xajfUPy7nhkKY49TjHcg53fu8QujicTxo21WASjxvSdn1n7IZkpEUTt27EQf//gnCgDiuVCCs4YBmhI+kjS//vWv6ciRw87WtMktIpiIdInNqfhw05HRr80bz0tjgLRpdsMzI2sRAExwqJYiPB3ALLbNNeXp0NEr+tuYb6DUvr5aKT78yZP1tGXLZskxpHBBJdzqtGnTnn3jjTfOijs4KwrQlPCRrAHYq61Vf5/U/mKdSpS2Al7iPzNWQ2uySQXneyasS/8+Nr9h6I7GeD8l9TzHBVjl8YtcX3zdXoIxLLKfGhdVMC8Uq5W8RnMeLz4urjE0Vq2+4SStXbORunXrSl26dHHu6ewqQZsVoCnhI3Hz/PO/lzDHmvo49iaiM4RJcSsGBIPEHujkEEpQkAs4s4eLr8l1TUSFOIWiz14UVeC7LMXA0vmtZ5TLa/paPO5+C2Q9RxHsvtyvtHHjBnEFoJSddtaUoE0KALTP4G5RMeHPnz+fYh9OTYxQd1sx5EyU9rGhp4ydZ0e9De30S+d4bnjpR9dgfmLeux1uTbQdsWRevcT+MYgzbiT0daR7rrtKvi9s1g0pHPUFh7jXi4Ploz7ZsuV96ty5qBJMv+GGG55ZuHDhKWpl86kNzYR6Ve62WPg25i5mQl1/TRSDNEpttzy8/ZwxJtUj1V2EdtppUAxKuJiM+W2xWoCsc+z0uZ3fh/GINiKTURsrC+4xH12b7CnbssZFGODnKLcXAUf9LRQKiuSXVVK29zgqqfoI+eVdeZesc76QFix4ifmCteQ2RFqQAbWhndlGNtGY5JlLqWwefP68ec+R3lya2HEFi1aMsiVqMvwTAsUTc6mjI0NxfGZ9aWi9DRXy8C4HkD4+Jc4fm2N7jQ7ljPsKbSbSp6Tvd0exbZl4G647VArZ9zNy+dlB06hi+mwW/DWJq2isfpVq599D+b2r+ag5stbplltuoaFDhyb2bUv+oFUu4L777kMq97vuNoR6QPuc35fPiZx5k7G9/c4tsvAcl+FajDB1XCv4wEHvoQZWXsofS7PCSZtmuz3vXEMm9VtXSc0+5NQBeE1ZL3Ku3QWQOvorps+hDrf9lDKVVZRu2FZ+2V1y7sbq14yu+1RdXU2DBlURE0PxHYThpMmTJ1czz7KCWtharAAAfcxTP00OvQvhP/PMM3AJ9pJSgM+29KhzY3Vnr8RvvdR3LpPmugdjJbww9VvT6Q7IinMAmdjPkx+FaElARlSIT6xVIeMmioWarsIlS9RABZeN+wK1n/lDOlODZQj3r6LGAxsk+snnA9q+fYdYATdE5HuYzqDwmZaCwhZjACB+SlXoQviowE12WlNmHc01kelUqh+FQvq7uNrGs2Y+YXKtWS/R38jXnrM9onkSPluPpYIRNO5l5b3vZZxz2++p8Lo9c3woEJVSbOq9aLtaCrcP7LVg9H+bmtsqZv0HZdp1iu7/6NEj9LvfPevUQkqrhGwAzKkFrUUKgOROGvS98sorUbm1qwASq6dMXyEL6Jh5LxamjmIXXNltRIWj21qBRuf4aUImsJCdYotjASILxMsZP+ubV/c6g4ipc6/bCw2uYIWyPlp/l9f3xjKElC4XIyobdTv5Rcx+U80rr6RM7/HRvcJa7dt3gJYsSSYKIZu6urq51ILWbAUwhZuJYg6kc5cuXUbFR3u6pVG/3WaAVRRmESUBhEvMmD/P+W0R4cS3Zs9phBWmcYErLCLXbHsRgjfRholA7O9D81tsz2SSCu3ZiCD6je9EAj4Lcwy1tJVUTXOuXQfKe++t5L/3Evuxe77byKpZrVkKALOCMi53G/w+snrxRbnhlN3mtrDoe9f/hkb4oec5KuI7oz8wymKTPOnjF/PBbjQQpM7vGcOQp6RS2lFP0egPo232mF70HmlddVGeuQ/9Xn+jQDV0ytgyLRj9tvnlXcimrQMDCHP5RkmwHT9+PLEvZNVcV9AsBUABZ9r0w++fOgX+IS346CLMO9dnF+xFUbqWVNjSYaGGc0r04BunSAPWPAidUM9xI4lzWbPvhH8RhoivS8/hcgIUnb/gUj0X2OXNrnEoKFRu5PdtsspckxcaNNE66iU4VUNJQKvXiKhLeZe4QVYss7ubc9wzXg1QP6XifYz8pN+3rz4VIl93n2TT0ZJxCDwLnHzHC4SUcAPSkWnUHaauIVCELwxdmuK1+xdaKM/SupGFiYGb9HfgKrurdNZVqDuJ8g7RGPCNvFxL07IGXsAOqg4dOpiwUD/v2LFb3HGqzTWyO207owIwsvxH9zNMf3yyYqPPmMxI+4spgY7s0I4Km9zhH3nR79KXaM+RDv2cEU/kULzu9cXfJ0Gnc92eF5n9pD83lsFLWzWfki7F7QerrPZe43qA1jTwAFAAHLu0tCQKt6FojY2Nsn3lyuUiG7eZORenbae9KiZ8Pp+u6sHoV9Mvl0BJIRQbWUSFyJ1E4J4x4xFxI18HZnvaXLo+Pn2e2B9H/ICTOk5aJ3PbYXzdXjTHIGb34rSzWqRknsG97ozZr1G/9cDMaUgZd0umyD00rwU11XRi3l+S4hWl11FZDODZvqIDn0uJr1OnGpkunp/++fQzAcIzXc1c9wMqd1evXu1sUY33klNl9JsCJG/MZwT2LLzyotGvr74z/gNK0rfGjxdMzLACtmaYBNhJeOYFUQIobm6VrmeuIZM4pprrwJzVtR6xa/N8XxI51qLJvjh9mFO+wUsNEM+eu3kNwj/29Ccoz68KTAMZfPD7IITq6k6KQvTt20cUAfLBrOhUm3u6czSpAGb0V7nbbJInvpv4z3PDuGIjNLKeoZ7UB5WaMXhLO/3WWbcKota/vPMXxNtyjbRl8xaKgaEFZKooFr+FECh499CGZDEdrb7e3kNIVBCre2Yf/c2cOXO40xv5r4H/8uZ9jhrqG6mh8aS8zzXG2xsb9e/ggUNUWdmZIsXBCGbSKLd3uQg3qNlmXqsTn2HykQeo+cllvO/K6Prwa7B/9XxesT4G33DoB6Aue7z55puUaqe1AllquiU0B1k+ZfuaarEPFHDnWgZbbSNpW+NPcVOhU1LF+1ZWNo/EqqoaFKFqxRppPbZ+PTCX5HACUnWTrudPW5Qwsh5zZs8VBWhNq6k5Kn9QJj1eTu755OJ/4r9/TpzPdS3aH6EBj1mDPzTK0HUNQspmS0TZsG3Pnn1UUpJlt1BCW7dWyySb1MQTyHJhsWssagHMahxV7rZkzE8UmfQU+Ivz2a7Z8026NmfOqKZezLMcysAvrwUIOcIJLhDLU9JMWz+cZuSckE/2VeHYGgDbLXNmP8jCn0utadXV2+j6669j08yK6gc6GFj4EdD0jNUSV+H0o2cSTZacMtR1GOh1x65Vf5MtUSWCdYR7gHKnw0I6jRVoygUUGf120QU39i7W3NFkGipxxZ3bEMkthzJpXrXb1PyWd3IGtrluIb6OxGFDV0F8owdZGWmhsyNG/Zw5s6k1DfMdIHwoQRBoCZvMMzTuSvIOoa1nyKSuN2uUNZVN5K8zGS0bQ4gLV2QHUiaToT59+lKnjp1kG4ihgwcPpi+rqCYXKICJHae727SUO91iJdBaNgfskPpcHXw2nLIoiWJhO3G11wqEnACHUc7fXlusqDE2IXJTz0kSygLIrBF+68w+hH/ddddzxq5agBny/hHX5HmyTZTAtx3hUtQZAa/k4igv/p2d1IJRn83q5JKQBxVSwwMHVtGgqoGoDWClC+n1119PX9p0LLmT3ljQ42xKCpB/IbJ0zb+2JOpXAeiWlJsINbASmjS0hZCeYxma21wQKldOsXBTkYMtKae45Ct2BR5pQkdH3ew532rDyF/Owr+O/f4RstYILsDPaBgJ8wyLoCbeRBteDGAjFxb6Tn+R9BmAnh31Qd4qNoPjoJEBYC2tW7eaNmzYINeBEHHXrl2CBdxWbKJOsSE33f0A819o7ot9Tm2zo1xeTajlmt3Q/W3QxHFP1xyKN/ptmPrevsaJHSiAxulocTIISjF3ztw2j3yAPnsfLDOZ+pbPqV/3LP6RUjDzXnQxGVHF9+P0mbm3UJQhL1ERjt+xY3txATU1WgZQUlIigxEg8eTJk+nL/Hp6Q0IB7rnnnsS6e2CWVq9eS0nBOIjaXKgt0oiKJx1zVShUV0jpoo6WNJdqdo8bGodjXUqQCE8D43Y0g2fSweyfZ8+ew6P/76g1DcK/4YYbJC6XEW9mL/m+vSIe+VEpe04UTkCdtfDklKFZckkAcobcaiMFlGY/UgII52xsbJDfACMg/JRzhnpdDQ3uamhUmQaDCQXA4ovu53jKtjvKqIltcThHTp2eOw07OfSt0rTE7KdbMUBqzu+75wnN5A+9zsCcMpvV382d20aff/1H6MiRIyKw0tJSEZKfwbGVg8j4WnmklkZrCDxfLaGtbgawg//2hcTU2sEod2CUIgwtJIiVQkFhDBixT6fOneT9tm3bjQWPG9ZadD/7qS8TPkJHfxLcxf7fbYYxi8AdieaGACkeUbJmrvAYcfVwSy1Bmhp2lC2aCKr+H2AJnat/GhmAYIK/b22ot2LFSpox4zo6fqxOLEt9Y61QsnivMXpe7kuF5Jl+8ORa8B0EHkcyecVDgU11Oe4Jd8qhpFgvSTYZF8P7V1RUcHKovVixkycb5PUouyFUC2GNw23btiWuGQttuqniSAGMaYi+gPnX1bjSPtZVhjjUikMuLwZ1YvYC5yehvQjHLKdj+ZY2F+zZqCQwfzp6Muzz/Uwo4VcmkzX+My9mv/UjfyWHejzyubNB/fp8bC0nC6JRKaF/GBhSzBeBt29fTra/IsUgwxGAvpZwUc27hI1eECmJO0awH1yNMJINjXzcdlEkBhyA7zEDe8uWLQWlY1hq136IFIAvJGEakit2FPPT7oh1BQfNzam/g58L0wCn2Ci3WKAlClAIHm2dfQz8MmTTs75XElG1qB+cM3d2G+N8NfuW0BKSizTs86W+0JrsrPQBRi/+nTrFypIJ2P1kjGBNGVmUMbRhoU/KnGZFSYIgMMfMRyEt3E19wylRZhwfSSI0TRercnXv3p3Wr1+f7DldbldapADp6dyo8Y9beuTrtsIkS1op0n9BMs/vWdDjxsLNbW48b4FoxrEuOFcuCvHQSRj96Jg5c/5WKN7WNBX+DCZbTpjYPEM2txDXAeC8jVpWwKbb91W5NQzUOQ0QmCaSsmSQnfIGrByenyNLWaslk4OSDROxrV27dtS5cxcxsI2s2A0Nmn/AvWMiLn6DvEH37j1p06bN6duIsJ6c2ZA/CQVIWoBipp+oUCnS2CA54r2Ez7ZabrTIa6SWYQAbyhl2zZzBCsHjEe9RuQAz62vz+Qbx9633+UD7N7LPPyEC1LAyZzKAvhE0Gp87LI3v11PgBldUWtKONFLh32bMgAjje/G9sui647IGM9dCKp/1XOXl5XwNanXUwuQN4vdMpKNrMlRXb6HDhw8n7gORHpbZ1zNya2xsLBB+nPM3dxCFHu7EDfd73/lzFcTZz3e/dyt1KRoFzW8ubsgYUxRvg18OqcGMolA6bc6cB1pt9leuXMnCn0FHjx2mTDZjogq9b88wdVoJTcbyOFXKQVYsRcDXlGMl1GRZYPx+PLIVMzSyPBs0UvA0eygWRuoKc6a7Qh7lNXTo0BFyB6dGEV6Cle3QAQtglxaQQnjGgvzGfJ7ufok5/eTE+U37btssqnfRvQsO7WkC57AmCA6tG6CWGYCENQkodJhApV7ja0Z/zJ79rTb5/BkzbuCRX0uw4EE+b/rXhmlaFo7OBymjt5c1IZ/6eM/4c3s9FJXAa+2AdIXUMBDZugg5jp8zimDcGwu5pAThZtZkNa3FI0MAZSUysFPKUT0ErLBv3770bY2PehFP23C/0dU5bUv69DhhklYQd1v6vVEKm4jxzNEkxekmcFrStI4/Or8zv19GlXPc2bP/rtVof+VK9vkzZvCIOyQgDqMM9GsY2CqfOHMnZzNWAeUOwBy6lGwoxBOUoKKiTBShoqKDKItOQ8s43ayRhL03VagwETUBx0IMl112GU2aNJmGDx8mx8c2uxS+1gcQW/KTzBZ2LLAA3K7Bf9b5JFwAVuCO/XvSryfr4jyiAo7AbnOXcvWSu5icgB5PI4aQLFPWkuaafO0wsGWK/PXcP/rRj+hv/uZr1JqGkY9FHWvY3EbVPaGCtSB0U8/mXll4+SAv1ifjg5XTfTBiEX0AE8BPw1plsxWyDTn8BoRpAIsmEwgat7ExMIkjU18RaCLZZgSHDB9KBzjjt3/fATl3t+49OP6vIRCB4Dfat+8gioD1lcEFDB8+PHFvlvH1TYYoiv+hQacv/EgcxnSCO53KCtwtuoitR5w5JEpii7CFLsDijlgh7VTr0JjXxx77f60WPnz+9ddfL4kd31MAKzx8qLX+Ga/Euc/UVPGQzPJ3ek0QNIRaUloiI74kWyo8PQo68/lGsd+lJWVUVl4iwhZl8UDytIsigNAUhOC4WHTj2JGjbN5PUN2pWkH/Q4YMpn4D+lN7DgG7d+8q9QFdu3aVy8HxUMqX5gMABH0+aKIMZ//+A1SI7pviAOx2NymT5ujT+zaBJ8K0NTlTS/MGVrn0Gh577DH6i7/4HLWm/fzn/0mXX3655NUxmshl83CeIBRAR/Z+ohVG43uTuD+0/IQi81y+Xr6HlQBLB18NE19WViIRAgQJi6BTx0OpkNL43xcl1ChDOQR8d+jgIUmpY5eDjNvqauuoXVk7CRGxmAR4Dxxn4MCB8qrYLm54shqOmDD/eMRK3NKjLFVcUTQ0lNunpEVoqsW/b7H1Pw17+Nhjj7dJ+F/60hfIpmQFvQcmlg+9mNK1ZWaeSzv7JuTzxP/b2cbYpllBkhGP7+rra8U829DxFLN2ZWUaIvbu3VfM/66de8yx5KCyL0AemMzdu3dTt27dIuRfU3OMcpwUgsJCqfA9MoR4b+ngdNm4PFYvXfqVDP/I6WSvCeLHfp/e7o7oJJCMV+y04SD6NKSWWQA9nmdDU5Ml05H/F9Sa9vOf/xcL/y7SNXssrgjEp5cAdZsJJ4JZPAWhdpUxLfnSmkc11Xa6GKhoktculd1NgQjyBb4oVmNjveAC9AcsAGhcXVHNhpo64gEcUQ+A42LNoN69e0eoH399+vSWVDSmjUPBcEy7VgPcAY5/6lTCBeD3VT4erOhuTJqJpA8vvi1t2p2Qj+KETHJf97eOS2ixGdDEiYa9GRH+5z7XWuE/wcL/osThQd5X9jDUxA4SNPmcgjLL5EVzFsUCGFrX1wUmUaAJ4fkmFEURSDbr0/ETR4zQDbUrrsWPmEtlCkND8Jil6vnYqALGtShPoAwfij+mTr2KzXiZrDW8Zu1aEfThwwcF+UMpevToSWWl8RoCBw8mXQBfQ+dsGgOoBbBCDqhwsYZio9qMZEcwxYs8iilR+rfNa15KVx577D/aMPJ/Tl/84hfZz5YaCllHvy5Jo+AO/jzL4E1HFZRAp5GFIkdN3wo+oLwCwFBnEIeG5/BMLgIWv6SkVFhJO5cw65cqe+dpGTx0Q+kEthJhg5BBGZR68fe5xlAqtLCG8N69u9i/DxB/bzkIxP2I+SE3LMKN46GBpML5k33oVeGqEwqgZcdp4Rbz52GR7T4ll0pNj3prEYiKW5KWgkA9lvr8tglfJ6rkKZ4/kHWuTbNryLppvsHOCiJD9sSA0JI2MPX5oIE8U+cn1LGPqV0VfJxTMoobmb/HPvmgXu4nKwCQeYYcu4NcnTB4OG9gIBXSyMQsIXIIa9asFmuAnASsNuje0JSOgfjp3LmzKIpiBi2AgeK5TVwA/1fEArgtoKQZTwu1KRfgpX5v3zv1f5FxcX/X3KYupm3Cf8KM/BJSps21SA3iq0tKfBmNoanpU4rXEj+hjvxQp4JF8xJ9FjjVky4/oyMQghWbwCCwoqK9jEYtTCmR4ylR5FFDIwu+nETJGhtVFjgk2EcoC4gzKBNC9REjRsqot+EhhK8Cz5tyME+iCq1JCCQaSDe/2Lq+hbV2xSpu0xbBFbSrFH7qs2km5RnahFBB+Hj6Nm7cRBb+T1stfCDkr33tbsqygKW23rJ5YaihmFfO77PS2QjZIEiAMVEWBoLl5e0k/y9UrQhQOTVYhCCnSR2pPTShY0bSFVmJBOrqavlzmWT+ysqyvF+JnAfEURhgH8wfUFyhYSCfw88YejmIlOX997dIOVhdHYd/5WXyXMO+ffuJEiiXgN83MC1cKYoSz+0ge69VBcOuOMp3Rr87yyZSEmveyfkcFnkf4wnxj5JRK4YVztyWLl3SauGjIY6+995vCsgSxs6MfhFyxhfQVVpq436PSZUeYkIzWY2GTnEYp6STLvIoJt5TXwvkHgQNUdUPRrkifFV0WAZYgtLScuNWciaaIUkfI0QU8imafJqRfhoxYphmNvnTJZeMoc4y7YxktIOgwszhffv2CuEDBais7CKWAegfitmVw8Z0K2J343DP8wq/S5Z3pYVuX10rYU8T+/yoeFQQNDa5+56/Nnv2bPrlL3/BoVOVlFxpnJ3RZI8XCh2LEVh36oQ8xKqhnnPuDXkmWjRdKwkoebCUJqI0LewKTgtDPUNz19fnTJLKFyIJPIDFE5pRJPHvwiGY/YAD8D0MAQpA4d8nT7qSNm3eQHv27pWRDdOO3wMAIi+ABgUAU4j9hw4dIqzjnj17CvqgiALY0eyWVQdF9iFnu7uunjvaLZkSOjcaUhIkOkmVD0AJsPDiSy8toE984lPSmQi5IH/fsHda1eNJ/F1eUSIKcvLkCcMRaF/ZhaDjtQm0z4AbQNtqYQjQf5mpFFYuQXGHXWzKmHv4eFNRBWsCDKKKFbDbOiyupw8TRTfN/GjE8IHowahH7I8/cAl2qfkhQ4ZIYSgmj5SWlBTcfxEFcDe5vrkplG4AXfTepDE9Lc2O6/6aAnqBc56WAsGz0zCr5sknn6L77//fci0ww9rimj0dYXVC2SomAMFTYpQ6K9m/0H0iSRQl6HwAySR6vilH15VCdQUTkzaWs2TMubWuEhYJeEHPr1PRoQSHONbHbK3jjNeQVezdu5d52HVPWVcYox24AFYAkQAeYjl06DC68sorC+69oMfBSxeO5LQv8FLvk0DPS2C+tOK4rsDMkjGd/UE3FIlu2rSBiZUqIVhkGlY2nkouRZj5nIwyCFCvGViGR3te+QItETMMocEEoc2GUyCVvEmrGkQjXL4PdE4BStYlcjDWBSP9BJt0rBIKMAcMg+xfbe1xKQfr0KGjXA0SQLhm7I+aAPwWbgRKYmsV3Oab59hGray8nJIj2gVxxbYl30dFmaITnqMERElMYJIlnjJeESb4gNugQYNo6bvv0p13fkk6FaweWDyttPWMkFjsOZ2ZI6PXN6uBmWZXE4vr/FmgqEbmeL9U3ADci+YYLI2MiAHb4WJg5m3srsLXruzbt7+YdtQAQAkBBFH0CcLn0KGDVHvihAhfS+BC4QaQ0IILeOONN+jSSy9N3Ctk34QLSJvsNKnjpd7bUihP2VxfmTBVbfcYLrYwCDskKuQXPtgGEuWHP/wRPfroo2xW+7IpDaPJmWRAns1jCKcRWALMzn7W/tHRb5Q9gFUoESwhJd2ZvEg1yNvJMTpwEMM3NGjlbzZTLtt1wkk5nThxTMJ0CBtz//bt2y/zAtGGDBkmox9K26dvX77uXrJ99OjR0WuRSb414AGq3S2dOrWnwhFfzA1YH2cRvZo8EW+ombMkX2B5gny0TX97JozxwbXPfvaz9IeX5tPIESPMlryMVICp0DyWXlK9lDMmX+nhyJIZC4davsA8iAoJHQHEVKKhnp832MHMIsp6JtWcoVMNtWQXqsDvQP507dpNav3h40+dqhPeH+6qG2+H9RjJ5FBHthI9e/fgBFEfqWuAUsFlIIHkNpZ9Dc68zd1Y2dk+nsSOSgfYSEsrgu8c0DPlWBYYZqKOi/f1Usd2levsgcB/+qdH6aGHHqK2tkFVg2jlqhV0333/S0YVzHZ9vS3iVPOslTz4BxpdkbbkDyg0mKAkUnYdLNjHYiALJDW7KHSwjZikXF6PB1cCkmf58hWC+OEKYA3g50EG7di5TcLANWtWUS2Hl2VsMbBfX7YGo0aNojFjxhSkg7kdhQVIrC4NwBCbapf+JXNjaetgRrCzZk3sMmLTps0u2BR/TnIGZ8cCPPTQg/SNb3yDX78j07WxxHpb27e//W36zW9+wxFDf04Nq3u0fYF5gCJUM/nTLluj96qTPjyj7EInR27PiX5kKZicmTCigwTYQy1EGKV8gQsQnuKx9EhOnThxkrOCV4tFAE+wa/du6typI/XkBBEKThAJfPrTn+btuxhE1ibuSZ5CNnXq1FH8fqbdCPJg8+ZNRAV0rsbD5JSFKwBSNswrsBb2d84TMqLiRxsvJ5nE8ePH0q233kptaRj1ELyNr7dt20rPPfe8gLtRo0ZSWxpG06xZt5pZ06tM2tY3o9c2T2cGyQJYzM1ntMgjNHG90sehvvetEikewD/gDZuIgmuwE0hKeWAePHhIyKNypn2R8Rs0aKBUB6MrEeL16tVbWM0D+/dJadiVV0ySKmIUjmzavJkG9O8v1UJOe6YIBgC9mCZ2DLr30mAtiJC8bAsLQV5cMxfG+yX4Bd3XOwsPMFPhP6TXIELJyTVXV29loufjohhtbVCkf/3Xn9APfvADVWLJF2RMFGBCP1kzsFFuD8hfCZ5A2Ea7MAaaLB4VmqpgabhupIxzUkgqcw59nW6PwpGBA/vJsRCRoPADIBDhKKp+16/fQBs3rmPrpOVieNrYy6+8LM8WeP75551wNtGW+3yw5e4WkAna0rG7IBaKkR5FFy6PZA0tyEtHChlKPv1Djx0vw2ZzAzlqS7MjP3IlIXxvqXMbHj30nQflWXxnwyX81V/9Fa1bt4ExwgC1jKE7OLIGCGuOACM2oLyUfIVmriLIJOT6YxcZXzdKzoNoShgqeupFgHV1WqsB04+JIRD0nXd+mRH+KLrxxhsliVV7oo727T8gNPH4S8fLubdv305vchjoPmVEesTzanzzFMoIB4BRspMM41p0y2QElKzaMcvAJJZCdesBrQWITqmdRVbgLotYLNJoXoPgY+HHFiY0o9CGUrj26u1bZAEn1AG0tcEarF+/lr76ta9SdO2mriCMsnahgEa4hYaGk5KwQX9poYYLim2/BMoqSh0iGbYxa0Z6Z3EdWBUEtZt4cMQqBqgvv/wKLVv2Hu1loZeVlzIALKX27bTgFOBv4mWXSQSQeghlzfe///3lVmrV7jc9e9rHk9lwzca35i9wrINdDyDhz9ECZ5d4/9D+b7FAG5E/AB/+dIauC6yMIphVFaJl4jjdWl29nb74xb+kb36zVc9ZKmjf+9736N/+7d/EJ2vhqCCBaASHJksUmFpBVJXZKew6ayiIqpnRNRUsPJh6GT6BgkD49rVrVwuww6xkfa0R2rehoV4UATyA1h5W0s4du2jNqtVCDp04dpyP2S592WL5fXOBr7rfDBgwwFw4RTSlNhe4GT+WWGrdCtMFgW5z3EQ0Jy7joOSWRQHfeehh4/MN/ojQNVFiybgCskmB6j//8/9llzBElnNra/vsZz/DLmEdK8K/06CBgygePHqfYFhRa4g0MEaz1haqkgpEMBlRuAikmmUqeFQfqIU6w4YNFdmAE8BoBmGFeZwTJkwU1929ew/q3q07s38oFhkq37/++mtUztlL5ALcxtclD5gSCTEaTeGAHiaDhRmsdrEDsyhy6IJAj5KPhnFjfzvFyUvsHy8Gaatq8hQ/+r35LgCj/kGM/ITiZM0hLDNnldCGqV5CMLgnWAMgaCjD2Wif+cyneaSuo6effpruuOMOpmvHiik/yaSNVudYYfuSW4CQ4RayGY1aEPZBwBo14Ii6L64Xq4Ai2YO43mb/QPX+6U9/ktnC+HzTTTdzhvM2cReIFL7ylb/m7GHv9EMncbyFtqfgKxa6XyLGLCvX8EUWeXB8dfxEzDQ55II/e+FeYl91x6njWSsR1do3r2Hke/b4JixVEGX3CBPniS2EvQ8iO32s5uhhuueb99GXv/zlaLWttraPfexj4hYWLXqLefi3JC/foUM7mSGk5lgjAoRpDVIbqNeF4hMtLjFT3k2GUZQkmxXLsXz5e8IXoMEd3H///RKiwr1gfcBf//qXsh0kEfIBWD8Y1sBtdtBLjwMIppNCPbv3oHgGqwrYAsJ45m0auFmq1/IBtrPtkuoOMWRGavQYFnlp/kra+luKfhvPlLWj37aYhtZ1iu00bI23hc0LAqkA+tnPfkYTJ048K1GC27BgdK4xR7V1x6QCKC+jXh/60K4dFKPCuFq7IIRGD5h/mA/yZhnYWklH28JPcBFIBKGId+2a9fT222+Lkvm+Jq5ee+01uTcs9NGvX7/E9fD25fYR9NGQ44M+6+4Ef6P9pSyVnasuPwlsjaAL/JKMX8wm2tW6ddkUffVS/tqCwtOtXV2suSRK1kQjlpnMpM6NE5RoeGhm2SDm1vQ3FlzQEGnXrt107bXT6eGH/w+drQZzjuqihvq8ScnCzNeKMGtrT4kQIVSdT6iLSMENBIHiGISF+bwvmclu7OPtMcHawl0vX7GMR3tXUwdwShaKRsEorMC+vfupqqoqfUmRy48UgDtlnrvHRRddrL7fDyiieD2dsBCHcKQXGLqULhnM4FNUBSRjz/zWs49lS7sKtJZwAdaaZAWpynETRFR8ntCswaMEjY4umcXLyqA1eQjZdHvHjp2EbXv44Yfok5/4s7NiDTTN61F5mZp+CLq8vIOQNWAFwev37Nlbzl9alhWgiFGPOtNOlR00c4g6Y/b7Y8eOEbKuffsKUdZjjPBRb4iFIK648jIJDTdu3MSAdC1dccWVsiCFnSRqGyveE9G12TfMGUMrEnwAsIAuSxKYjksLjih2DTHgksSIsyR76D5nN2IOXYthtoctYQM9IjcqCe0oNxGFgyd0OpdZRSSawZtldFymUSzvi5HYv38/mRl09Ohx8bG/f+E5mjHjesmlt7VpClhJHEzdxnVjAW7wA1jmDWVm8NMnjtdR126dxW2g5uCKKybT8JEjhN+H1Vq4cKHwNPZxMVCirVvfZ5awL23csFmAYGVlJ2EHMc0fAxHvnVbDLOZC+yHqpUceeQTCT7mBIToxMRHyxSGeZx/yxB2MxEVkAUL3UW/p8JAcQTtAMZFMalaXRtSJtrxRiYzU5YfmvBGR5ZkkTFTLl5cRJQszyXdYduWYKAniatTug6vBbOmPfOQjxKQJtbahyLNDR338O4AZQjYIEImarl27yErf8N/9+vUhnR4eyvaLL76YXlv4Kq1bu0GprIwWmmJwgmTCb6BEiC7+9Kc/0s6d23n0bxRA2I//du/ZzQp0ReJa0pY+Dbt/5n646KKL5OKVR06Gg+bWSF1AGDFbkt93ljyL/S+R51DBBeAxbBkPIORUlJsgZeDkCaCBKb7QqV3inkK7iocX3bYqrERA7FvL5ffwsVgACvdjl8dH/h37f+tb32Jkf0srXULI4eAlNJB9cd3JU3T40EFZyg0jH1YVsXxV1WBZmUWmjbECHDp0SD7D6HZmF4Hv+/TuQ8OHD5XKIGT+0LBfz57dZYHKw4drWMG6SSHqYfb/H//4J6KlYuJ+8xKDPKEAxjQk3ABKiuGTbOWO78cLRemadfFqViiYjFO91vxbXxzGiN/BC9GFtTAZpMSkVSxf191PPIEEdGyjKkYKW8A6AfRZM4oRg6OcOHFcOHrcI0qyUJixa9cOEiKHt7+04CVZHxAxfksahLxl81bavXsHHTt+VJZyRU4C+AMjGQqA1xkzbmQr0V2uHcANkz5xP6hDuOii0dSuolwQPZJCUAjU+4OOxvFAAuFe6pluRkYXCowKIFiJ+L69amYtT2sB0B51P6CiVBcr1NBJV99U060LIqoIRCjgsX0tdrCC9hLIPs4RxJZBTXVLk0Huo1hDz6zG6VoVoH0UU4S6t0YGcdYSa+jgVmDqt23byQCtnP2pFleEpmQbqVuMSCg1YuzKLkyx7twj5Mqdd95VbN2dog19tn//btq1YzcNHzpczg3hoEwceXxwBvDvq1atlFBv/PiJUtwBxcCydL169+AwbzFdffU0YRHXrFnL5n2XsIt79+2lSydMEH4AlnrUyFEyX3Do8GGsLH3Tl7IwvaFAAdI+AhqHp1JJl/PIKC+voNKS0mRuwPzpREazdp3dlhj1MfcfWqbOSRF7LVgqznIAvmNxEg7EKIVl/6JHv3nxY2EBymDlZBmXfKOUXEkxZtYC2fgP/vqkmN1ARt6TT/2cGbnR9NWvfvWMigDhwpVccsko8f+IMlDTj0rd2tqTtHjxYnr//a0yvx+AbfPmDTzaKwTQbdq0ier5fAjLUSJ+6NBhGeGNbD0+wtaoavBgYQKHcHoY8oFLmDZtGl17zXTq2iWJ/tndPVhwbekNyBBRSlMmT5kkNw5/BICETvLMA58jU2/SxGGCCCKKwZoXh/8UxpFAGO8bhs3HALGC5ePIwnNAZcT6BUm4Ef1WJ1xi9S+Z9MGKcMnFY7XiJm+vJy9l4JoM0xU5JUnD29uVtRfc89RTT0vB5de//vXUI/WSrQQFHYeOUP+BA+jmW26h1WtWC0q/8sorpMATi0Jgbj+sA8Bip04dpHgD+Xy8Aow+99zvOFLoJH4e2OXlP/6Rtm/bzpbOYyvRk5WmvSjN3r17BGOk2kJL/ritKeYFmjLdfgCx0KlTF0kyyGLGnlsASVLUoBktuyy6WxqGEQffnEuaY7v6BpIeEsNb19Hcpokka0ks4rBNjxtEuCDKBoapqiUP9Uw+g7MTLJQVYkol9PUaOK1aIbN48/kcxeXZvuyDUixM7sRoREz+05/+O82b9xt2Iz0E8IFRvPrqq2VmDubu9e7Vi/pxmImsHR74CJ9dx2Z+7do14u9R4AE2D1hj8OAqWrLkHVEspHOxsANIHfj7kSNH0m9/+1t2E+OZEl5OR5jqhdUABXz7bbezIpeyq+oqxy4i04LmURPt3nvvfYUcJYCZ+8UvfikCB7AA3Qh/FS2l4iWzfDp3LjbvMUMXOIjcZAOt4HgzHgmnKN5dYs5zhKZgsbp6M8X669QlWiXzbO2CSUrZyMRZjAoRjmbl9J66dq2kvXv2SQIMnLwNe2PQS5rJCy3pRBI5qIuop3blHWmohM5ZWs2pWKzahX6CEEE3VzIhs3r1Cnp/y1YW8hA6xIKF34YFAAfQsWMHQfcjR49ixN9fQnCsSbj0naWySOUNN17PVuA5IXjefPMNcUvIEsKdTJ9+Lb216E2pBRjI2UiAzEjIDP7Ysg+mIq1J6D1lypRt/PJ5+xlsFQALMkwwfRgZtlPceDz5uFa7XQWUDAPtXkZwEtKV0BH2w2Cz9Jl7NZyoOSKvR2uO6eeaI+aZPI6gPSvoGBjGzQGk2N0PoqvAJM88YxZk5EqyZQK88kG81LvvU1TgqSSYLhNXIkkZ8wwgFGxmynXlbuYVQOCU8HuUbF/Ccfyhw4eoN2MohGPAR1CIpe8u4/0zsrBDjx69hAFECfe4cZfKVK7u3btxtHBMavzWrVtPM26YIZEYsAcwAYpBgF0mT54s2AEZwd2798hagHhySZHKn2+89dZbiYzvGRWAf1DNSjCd31bZbUg5YmUKrF+XkzVzMoKcYQnihZLTlb4eJUqeiCg54cRJ19r6erJuxI5+cn7vEyWWhDfH9uIFo5NVRvFvtaI23g6ELw92kGVddOEmuQbPCt6uAWyXaNdrk/n8AhazLGxVliDU2b0NjY2kK3bXCCDDusJI3/76V7+SX2NpN9TyAdjBNcCCYF1/vC5a/BZd95HrqGOHjjLIsny9ndiXz+fwc9y4sbRg/gIR8rBhI4T9Q6kXZABM8LGbZzKNXCbWKJZFNPq/QE20M8HuhN9AvAw/VFdXL34PKUpw0RoBWE/smHuyI9MTzKBVwVlKMoPWQpAJ23JR5GBDRVUKO09e6+3iUjW7YnbWIYbSiSid74iCDLcaGQKwC0zJk8zCnMl/6HVLzkBIQnsstTKItzHRo6J9GQurk3DxmFCTy+uTPU+e1PUAR40cTcOHjaQunStpxLBRgvhRxwdhDxjYn0d4T8noYR7/8BEjBBt0ZmEO498MZRcBSwHaeNbNt9LuXXvE72O0Y20EgL1ejCtGjRohFmPJO++KWylS/FnU99t2WvalmBXo16+/WAF0HjoTmqqramgVK268tLSdMoOefeZtHOcj6aKFD9a+xmDM8vgCMD0ntezZRZn1gRAortRl2MzEC0+/00JQU4Tq5cg+zCp+IENo5s3ZpJWxEF7enNdao7yzZEFefLHCAS14AeDt1rWHKD/YPERFyMbheHCNJ0/W8QhvYNCn1K6sBspJn127dkqJFkJphHOIqAQfICt44qQAwHGXjqPf/Po3QgW/9tqrwhd06dKJVq1eIxEDQscNGzaK74c7mTbtGv67ml1BNX/Xg9xACiE9j/6/pdYqABrHlK+y/7vbfobvgZZhTroudhzPi9dHnHji36DlWNEK/QnaNTSzYu36t76nT9fQpVMyZrWQ+NGqYj+iUe6TJX5wHty4hmMUpXbjNX5CsrNpIwFTvOJXXNFkk1zWOtn5DuYKZDe7b9bU8etn4EbBDqL4WQndTjLFW1FRKufEiL711ltkyhZcQT3H7Du272S/flzm9QG5Q5CY3Ll27Vq66JKLqQfTubV1J2QSKVYCWf7eMkb/hyXxc+PMG6XKdycfY8CAQbJi2KBBgwXoLV68SPrDThF3G8vpJk5k1bRJAXAAtgLohel2GwCL+q9SMUUwibIuTV7XuM3JOni5KE2cfjCkzolXAQV5ywxYoKhRAdKnAFa5fFx5BOIGVbIYZeXlpYJD7BM1bEZScxXmAQsRig/VPYQxbxHjEU/2D60bCd1wNcY1qriaE8Hzh7QuDzNz6uTeYRkhgD2cgBk2bLiYdzy+FWb6/S2bWQF2CB6ACYcFQ/iICRs33jhTOIgX2b8PHjxIFASx/7JlyyQZd/nlV1ADu5Wd7AIwHbxq8AC2DK/Lk0mR6LFFonDNqfZgmvYt1ppFvTFQeiRdMYSFlK+5ZppQp/CV8EW2IkWmMxkBYLaqnMg3qeIwjLgELGSIukNJzIRuIkmXVkWplMw5MPPkQlM2hfOh8EFHrBGRzNW2zJ1VhKyxAnbalnPbkcLodepyrOYhDebhkr55wIW1KDZkxPH79RtgFl/yhafvwiHknj17xbxDSRDWATRjIieEjlDtmquvoe5duzM2GCnr/MFVgAd46skn2QUcFwyw5O0lkvQZN2683APcAoSdZYvqs6K9+MJ8Oe5HP/pReuedJcJeghtwG2TFRNAj1IzWrAwMU5Wn+IJRRfp5uw0dght7//33xR8jfIFAO3XuwNtrxUrg+759ewvShpUwF0fWzw4aWCUzXmRxxLwXLYUOYISQTD4bVs+icI3d9fEycEHI20NZtBQ7FqjiBhMXeGHsG+2q5KFZxlXW2dcFmys5VBMAJ493SSqrKku83Brm6aFAExFBx44VUnsHUzx8+Ah69913+LutAg4xKwkovU+ffnxPx8R3I2WLWb2o5kWEMIG5fPTRkiVLxJ3gD2sS2ZU98YSynqwU+9m6YC2AsWPHy7VhsuiECeOpCIF6+9///d+vp7OlAGgAhBx3duFOmGS3gW6EYMENSElTLn5kGkIgdBoWMYYgYf4qGQ3r8+zKmDSpiBYztmjc8z2DvHNmzfsKOQbcCbh0XQP3lOwLdIwRaUGdCkcjEEvdqtD0ad3J0nYyCqSLP8CVQMnq6+tMibbiPcl8RhxjSD2664qcsHSotUNsjwoiZN6Qpt3FZhpkDrJ3qNnDBBQs2oz7QcQEzh/74v4xSJATAAbAvcBigNmDOwEf0KNHVxb02GiGb5bvE64hy8fB+WEZMJO4o1kLyDbuh0c5q/sTamZrfvaFZNHhB9KuAKtOwP+IyWtXJtU0vXv3obh4hGRUIW7WZVAD0Xa8hymzU5a78w1r55aJcGBB7OIHuEyET/K7QMuj9NFogVlo2Ys4erUSmWg+QxCoAsXsY0wUQVnhZnRpuIzhCGyOQZsNSTUBpgswtmvXXq4VnP3YsRcLYq+s7Cazb2C9JLRjZQcGwEAAQOvB26BwF42+2CTXFFBDierZKrz66qsCALENo//NNxdJaRfQPawaBhkszw3XzxDFuPyKiTSMlc5tJua/m1rQWpSEhyvgqOBZ7uzP88dyOQB3HDQUqUvw2UDDSFzgAYn65Iv6SEB2VWwIXytdT5knbIai1RgpwAwAebAOupauTrFCR8Iq+F4M+CQpRSasM6t3qGCdRRrI1ixkom0YZQIwzdq5sCK5XIMQQZ4XRLE0rrFduwpW7koJ82AppnBiDAydXZUb/P24ceNIgWuWCZqt4gaWvbdUrAQmcqxbt1EyjBB2125dRTmRFcREkvZ8v6ij2Fq9jUYyjsLyL68ufJV9/Ex59CsYUTCwI0cOl2XkYTH6c5oXlieVPKvh808+E+pvkwKg4QRTp07FM2Wihw+iM3FDqFcDsAnMdCYUPHhSaVMqqBgs1uHDRwQF6xr8mo6FG4EyQKB2SXQIRaYyG87dMnJ4Vh6mSUFxgMI7d+4oSNz34mhBjY/OqrXhY+QCMOXaLJysxar6OxRjwkrhulF0CVMOgZeXl4gLs4+ew72BuwcdjXw7ANgrr7wsAlm69F1B5cjGDRs6QjJ3GBiorJo16xYZAOANQO/ClyMMvO22WZLShRLs3LVDlAKsH9b0g3W89NLxkofBoELBCqqSQMsHQUH53N8y6p9PLWytmpMNXjmNB3DjUALMtEEVUfv2HaPFJlCzdvnll4nJRApUlkVt0JBR1+JTggajDNQyTClCG3Q4FkUcwMkNEEfHGPFCwaAo8N0w35gBow9Iyhj0z9fSvr0WSDBAg6+0I138pnngAppd6Qu/yxtqG9YKCgmXNmvWLBbmPhEgAN5Hb76ZGbndLPQRMtkDQtm5cwdz8lPY1+/idKw+4gXJGiwkAYoc9zdgQD/h/Q8cOMgKsV3AMlb7AqePSZ2LF79NgzkjCB+PdYBA8Y4efRFnYfuyhVkiABMDZTRHG3gqSHqSB7cH2e9/l1rRWj0pf9GiRfPZEuBpI6PsNsEBfKHIhNVyVguVKVddhYTFZgErBw4cEgGB2YIQoSC2k7B97Jjx0vm4YQgd6WcIEvHyju3b2PeNE0uBjBkwAkYp4un4WTgZsRRQLlucYl2QJnhU0RQvxIAVv+nSpYcoF0qoL710guT2IST4/K3sh+Hnj584ysmdI9F3kyZdIeYZgoPig6cAAARqB6JHMQ2STH379ROkDwUAT4ApXjbiQeX1mDFjZZQPHDBQVvIAYMR1rFrJjCvfL8591VSklodKX7gNbB8L/yvUytamVRmYiFjAHYrVRaLVh3r07CGlU3V1x8VvY8kzMFbr2Hdh5ID+3Lp1m9wUBIPKVwgFggS5g07BcqcwsQBRGF0oxEQNPIgPdBSEAuIFcTjKufS5O7A2ebPEmj7owT6WDaYYEYU+Rate6hvwHiXa2Ac8PoR78cUXaWTDeGDqVVP5mtdJVu6qq6eKOR7KBM/2Hdtk0sUmBmirmZ7FtcOcg7HLoUyb43wQNrBiEBZWWwE/gJk6uF6EgFOmTBUmFVm7o0drZLo3LAPIL4SFcKm43lmzPiY8P+r/0HfpBtDHx7iJXe8pamVrkwIYULjAPHY+WnYeYAfPrIWQlr+3go4eq+EOqmSma7CY2169+si8ehQyQEkwEweEyR7k4g1NAPR76fgJ3OHbBViiaAL7gH/HkzLgZ+ETIVBYExRhAD8gvQr+wU6hQkeCNKpjmnU0I/CRI0fJKMQ+oKFRuLFz527BK3BRAG6Xcnx+iiMXzMGr4pGOCttKjuX3siAlB8KXiGvBSIWVq6zsKqTYDlbOE3xcLNKA6AiKgQQOrAQsHY6Psi4oK5QaeYD+TCht3LhB6iDe5eQPsMDtt98uIeFbby0SMIwHWNkHP9gm6/tkMtc+/PDDe6kNrc3rsgAUIjJIKwFSxqhwnXj5RHYJaxhkZYQ0QpUtrAQZQIVpy7K2LRNI6DygbjxBo7JrZ3EBYORAicIHgnCBuUWnYHThFQQL9gMRhRi7C/PwGDGDBvWTkBQKAN8O4ARghbx5vXlgA5ZZRZwOMgX4BdamC1umyZOm0G9/M8+kumvZIuRo8pQrxCy/YpZdAZaYOPFSwSpwM8jLo1wbgkSYV80jfNKVk+ill16S6VsYzUgDH+PBgEgBCldRUS5P/MC1X3vtdbSeweGNM6+j//7vpzgKuEnYQgDhdHmXFX6xEq+WtrYvzENNKwEAEeLnMWPH0ErGBeC5MyyMO+74c9rELNoJJkPQgeg8+LcjR46K6dy1ewf17d+PlaKSDkhI2Z47ewJt2LieO+ZmidchGLgIAEBgAvhtuI0+zDxu2LBeqmJgbm+88QYZTeAUYEanTJ0sIG0871/OnVvJuAWlW0sYwY8aPYrWrlknnb5p80Y5HmbtIuybNHkyPf3kU8zI9RJA1445DNTtwwogMsGsIlTq9mEl6MHWb9v2rRKvIgdgWT5YMliu/v0HCu7A5337Dkjl9YsvviBl3wgtsawLuBONcpKA72wKH+2sKABaU0oA04Xih6ohVfKETAhvCLuCgYMGsCAuF2wAk75DfOsIuokFjHq23RxqhaY+fu2aNeI/165dLyNn6dJ3qEPH9tETMqBgHZhNg++EYsDHT59+De1l8mQAAyv4bzxmdfiI4dSfSatXOVwdyPE5snAQxNJ3l7LVydC69etp+rXXiqW46aaPygQO7Ne3Xx+q4PDtMKdwAew2sWKpRerEytGDlfRgZNHgw3sxQAXx88ILv5dRDsILrg7XAWuH0BXv9TGv9Zw5nCUCnzhxnLgNRAmwJCWp1b3PtvDRzpoCoDWlBALSmOHrzv4ZIA2uAIUUGBmoLbjmmmsEDPWX5c85t86mFjH5NgaL27ZV0+AhQ9hanBDhYnIkMMZ2jq+nTZ8upMhwBmfwnet55F/JZncPj0SMtNs+/nEmZN4T1I0qW+AHdCwUD+eAoDes38A5+PHCBFbzfnfddaekqjEfEIsvISsHFL+CrQiWXoHLgMkGlwEXh/sAXXWEowOAg/YdKhi9r5QFH2DqEV7GhBJHP3x/XbGKBysAiDLgAuQU4ILWrF3NbmiqKEwR4S/nfrzpbApfZENnuUEJGK0/wReL8HCU+x0KFjG6wX1DKQ7zqIAJBVuGKtnnnn1WKmG3M5iCiYUPRGcM4FG74KUFTKNeJHE/BNyVQdn+/XtpBXd2NXc0iiK2c6iImB0RxSc/+Sl6Z8m7Ysbv+PSnmUM4KiHk9TOup5/85CeCIdD5OAeWU0WkUsHKuYNj8OUrlguuePHF+fTXf/0VYeMWLHhJgJ99CjeEDyuAhA5YxC0c6pax6d7Gv4ebq2WXozmAUrOI4ynZD9aw/wBOHbcrl2sCqMR1IxmFkBDXla7qQajHbvD2tgK+Yu2sKwAaogMmi55J1xGgoWiyjIUOS3CcSQ9MYsBoQ/w/ZNhQOsR+/WIWIpTihz/8oYSJV8nz8UplFPXo2U3YOwDA0Wa/vn10ahdoUqBxuBnE6ldOniScAkJPPAZmGANORBVY4g1hHEYmFmTCiN23d68o2wSOCt5eslh4iI4dOnPyReldxPCYR4DrQI4fwkfJ9x/+8AfhJEDb4h6wEMRJFjisB/AJzt2RQ0TgjTHjxoqPRwg4beo0eTg1mEQoLfh9HCfdkNxBTV9bQr3TtXOiALaxEixkJcAsSzCG5XY7zFsJJ2AQL2tGrSPntt+REYGlXU+crKVFHAK9zyMOCZAaBooLFiyQoserGMQdPsLugn071r5DJ2N5NAgFGGKgcSPyiBQ215OnTJZQDhYG+fT32KSjrgDgCr4cPD7Krr505530X//5nyJUFGnACowaPVJ4eRwLAO0oWwIgcpRgr1jxnvHrx2VuHtwZwCP2BTYAeD3OYSpGfiNTwPX8N278OJnAeYoJp2FDh0uqGCAVSuzO4TOthjHOV3gQtIrha247pwqAxkqwmEf5M2lcgAbhgx/HevYQIJ6uvXbdWprJAkCoBd6gn1ntAqHYjm07ZL3bqkGDhVlEbgGmGKMHfhmxNwQE9wLLMWDQQAFl8377W5o/fz4rz1S6GgQP8+2wPBjxIJbGsmBQkrb0vWVyHEQNt3DYtmzpMtq+TYkfEFEIa1A2jrxGr969xSWgMAb8ALABzo17AmBFuAveAe4ODCNA6nHO8kGZwQ3gyR/4LSj0dAPYQ2KHR/5COsftnCsAGnABK8Kj6fwBGthAmD4oAkI8hEuTmSmDAuzkSADtPRYIKFsIEzH+K6+8IinTsWxS/8gmGIoAkw9kDYF+5jOfoVWrV9GTTz4pIRwSKkjPolBjxowZsi+yeTj+gj+8JBMw2zPKh+8FGHvj9ddlKRZYEwhPRj5q7flaZ978Udq/dz8D2m6yGhiII4SysGpwKSCkECZ27dpdYnyQTmA9oeB7OK8wjM8rU8XZxRRbvhUmn/39n58Lf1+seXSe27333judb/Lx9PMKbUPmEGTNKPaLR44eoW5M7HRi3PCznz1OM66bIf4U4SRCvDEcxoFLQGHkd77zHcEFyEgC2EEYjz/+OH3slo/J6BzMiqPUq044geAwYrNseue/+CLt5Kjix//yL/SrX/6SsixMmY3LVgJu5W1O1owZcwnjh50y0WOvEEqY6TtMLAvoYF1LISOTNaDECEWxOhdAHo4BawOLFi/Fm2wY9dwnX3BX7zgf7bxYALehsghRAncaMjjT098jlgZ7h6pi8AO/+91ztJHDu/vuu0/CrRdeeIF69+kt1gDPzkGHw/RjvhzA5F133SUCgALcdNNNIvCnnnpKWDwIBD7frtSxgSlYRB2gWgE8f/HMM7IaCKICLK+6eNFi8fNDOLsJsgrP6Xuaj5XjY0Oh6li4FskjREU4+/vf/15AHiIOKNwnP/lJKRCBxUnP2HHag6yMX2huGdfZbOddAdBMlLCQ/fATxhKMSu8DgmTr+1vMs/yyOjOWBQBiCAUoYPkQux9nEAgwN/OmmeJKQA7Bj9saBXD+MLn43bx584T7h4mG/x5sFll4e/FiAWJQHGTt4JYOsuCvuvoqsRZQGiw1/9JLf+DoYKD4/EkcYcByYBYPgCgUCqgeCofqJZh8i0nS5dpOW8j3di2qd88Vyj9Ta+m6bGe1GVLjdh7dn+fXucXcQmepeetEvdmXg0zCFG3MgAEjByHDFCPphDAPMTSKNaYzQfTEE0/Iun+PPPKICAbZuH/4h3+gl19+WUalFrH2EAEB/YNogtWAcgAjICcg6Vk+Hkw7Urwj2epgYgdC1XfffVcU0BI2GPFQQJh+KIw7PatIW0iaw19IH3A77xjgdO10iuA2ECtYCh1CBBF07733CIoHozaBRx1WAoc57tCxg1T9bNiwIQq1YN4xWmGyUXiBkYpYHqttIhePMA6WAb7+H1l57rjj04wlHpORP5AJqSVsLcA7zHt2nixOgSdzwLog6jjNSLdtIV0ggrftglIA2wAU+WUuFcEIxVovTtBITWGgU8JBx2IUgjv41J99ijZv2CQuBaN70qRJtGrVKlkfGA99wJNDf/zjH4sCvLzwFbEiSNUCSC5etEhA6R6mlUEbY2burFtukcWlO7Ll0LWFmtUW0gUmeNsuSAWwjYVSxQTLA+yTrzmTVXAbzDL88G4WGniD60EuMRYA3YsoAXPsWclkUQUQTwjjVq7kUDOjE0IQ+yNERAUuavp0QmeJM9WsWQ3FmY+a+XnL6QJtF7QCuO2ee+65jTsTZBIeKlRJF2arYUWdx9f5xIU42ou1D40CuM24iM/zH+qxx9MH2Mw8CWRA5zGgXP7AAw+cneXGz1P7UCqA2+AmGLiNZ9Q9nYVgFeJcWQgIt5qF/iq/LufzLuQoo5o+xO1DrwDFGkcT41kZoATjWVhV/DrIfK7kz5VN4Qk76wlPUsMfK9VR+55DxOUfdmEXa/8fQ79G5HHSfbcAAAAASUVORK5CYII=)