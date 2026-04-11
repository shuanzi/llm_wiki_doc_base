---
title: "RISC-V”安全”那些事儿（三） - RISC-V"
source: "https://forum.spacemit.com/t/topic/357"
author:
published: 2025-02-07
created: 2026-04-11
description: "RISC-V机密计算 \"机密计算\"是一个商业用语，它旨在解决云计算场景下的可信计算问题。云服务提供商（CSP）主要提供云计算服务，也就是向用户出租算力，他们通常需要维护一组服务器作为专用或分时资源出租给用户。 为了实现算力分配和管理的灵…"
tags:
  - "clippings"
---
- [活动比赛Competitions](https://forum.spacemit.com/c/competitions/21)
- [社区动态](https://forum.spacemit.com/c/11-category/11 "为更好地促进社区维护与发展，进迭于今天上线中文官方社区准则。")
- [K3](https://forum.spacemit.com/c/25-category/25 "K3 是全球首颗 RVA23 标准的 AI CPU
	SpacemiT Key Stone K3 系列芯片采用 RISC-V 同构融合计算技术，集成进迭时空自研的 8 个高性能计算大核 X100 及 8 个超宽并行计算 AI 核 A100，可提供 130 KDMIPS 通用算力及 60TOPS 通用 AI 算力，可流畅运行 300 亿参数大模型。")
- [Eco Software](https://forum.spacemit.com/c/24-category/24)
- [SpacemiT Lab应用案例](https://forum.spacemit.com/c/24-category/22-category/22 "在这里我们讨论硬件相关")
- [Bianbu OS](https://forum.spacemit.com/c/24-category/9-category/9 "一、问题解决")
- [BianbuCloud](https://forum.spacemit.com/c/24-category/6-category/6)
- [Eco Hardware](https://forum.spacemit.com/c/eco-hardware/13 "muse 专区是进迭生态产品专区。有关具体形态的讨论，请在子专题发表！")
- [K1MUSE PiPro](https://forum.spacemit.com/c/eco-hardware/7-category/7)
- [K1MUSE Book](https://forum.spacemit.com/c/eco-hardware/book/14)
- [K1MUSE Paper](https://forum.spacemit.com/c/eco-hardware/paper/15)
- [AI](https://forum.spacemit.com/c/ai/18)
- [K1](https://forum.spacemit.com/c/k1/8)
- [P1](https://forum.spacemit.com/c/p1/10 "P1 是一款高性能多通道电源管理芯片（PMIC），旨在为复杂计算系统")
- [RISC-V](https://forum.spacemit.com/c/20-category/20 "RISC-V 已迅速成为世界范围内处理器设计和实现领域领先的标准指令集架构 (ISA)。与专有架构不同，RISC-V 是一种向任何人开放的设计处理器的标准，向大家提供前所未有的革新。RISC-V 的意义、其对科技行业的影响以及 RISC-V International 在促进科技领域增长和发展方面的作用贯穿了从小型轻量级处理器到强大的高性能处理器的整个计算领域。从来自跨国公司的深度投资到与初创公司合伙的风险投资者，从大学课堂到国家，RISC-V 正在持续扩大市场份额。如今，RISC-V 社区拥有来自世界上 70 个国家和地区的数万名工程师为社区作出贡献。")
- [工具](https://forum.spacemit.com/c/17-category/17 "用于讨论各类工具")
- [文档反馈](https://forum.spacemit.com/c/23-category/23 "这里我们记录对官方文档的反馈意见")
- [其他](https://forum.spacemit.com/c/19-category/19)
- [所有板块](https://forum.spacemit.com/categories)

> [!info] Info
> 所有外发电子邮件已被管理员全局禁用。任何类型的电子邮件通知都不会发出。

## RISC-V”安全”那些事儿（三）

[RISC-V](https://forum.spacemit.com/c/20-category/20)

**RISC-V机密计算**

"机密计算"是一个商业用语，它旨在解决云计算场景下的可信计算问题。云服务提供商（CSP）主要提供云计算服务，也就是向用户出租算力，他们通常需要维护一组服务器作为专用或分时资源出租给用户。

为了实现算力分配和管理的灵活性，租用给用户的服务器通常通过虚拟机（VM）来呈现，CSP利用虚拟化技术将物理服务器”切割“成细粒度的虚拟机，这些虚拟机的资源可以通过Hypervisor（虚拟机管理器）灵活分配，并且虚拟机（VM）之间相互隔离，最终物理服务器的算力以虚拟机的方式呈现给用户，CSP通过虚拟化技术实现了算力的”池化“，并且能做到算力的灵活分配和管理，提高了算力的利用率。

从虚拟化技术来看，Hypervisor需要被VM完全的信任，就像操作系统上运行的应用程序需要完全地信任操作系统内核一样。由于Hypervisor可以任意地访问VM资源，而且Hypervisor的控制权是掌握在CSP手里，那就意味着CSP 必须被信任可以完全访问客户的 VM。然而，在传统的云计算场景下，租户和CSP之间存在如下的信任问题：

- 云租户的工作负载（特别是包含客户敏感数据的负载）可能被CSP访问到
- 云租户的敏感信息可能被泄露给其他租户（由于软件问题、错误配置或者其他漏洞);
- 云服务商和租户可能有相互冲突的商业目的， 例如，Amazon 为多家零售公司提供云服务，同时通过其在线市场与他们竞争
- 云服务商可能与租户的商业目标、国家安全目标和隐私法规相冲突的法规下运作

所以，为了实现真正的机密计算，使客户能够部署对隐私敏感的工作负载，机密计算的首要任务是要解决云租户和CSP(云提供商)之间的信任问题。

实现云计算场景的机密计算，同样可以采用TEE技术。相比于IoT TEE是将可信应用部署到TEE环境，机密计算技术需要实现的是将可信虚拟机（或者叫机密虚拟机）部署到TEE环境。

[![image](https://forum.spacemit.com/uploads/default/optimized/1X/ede6d1755aba622449c30feff46db92a62e63e1a_2_690x366.jpeg)](https://forum.spacemit.com/uploads/default/original/1X/ede6d1755aba622449c30feff46db92a62e63e1a.jpeg "image")

  
Deploying VM to TEE environment in Server Scenario

在云模型中，我们考虑以下参与者：

- 云服务提供商 （CSP） 运营所有基础设施，对所有机器具有物理访问权限，并控制除可信固件之外的所有平台软件。
- 云客户部署可能敏感的工作负载，以便在 CSP 托管的虚拟机中执行。
- Silicon Provider 是提供硬件和可信固件组件的可信实体。
- Adversary 旨在破坏客户工作负载的机密性、完整性和有限程度的可用性。

下图是云场景机密计算的通用参考架构，主要说明了基于 VM 的机密计算中的常见组件。

1. 普通 VM 之间可以通过共享内存相互通信 。
2. 普通 VM 与虚拟机管理程序通信 。
3. 安全 VM 通常不允许由虚拟机管理程序访问，而是由新的安全软件层管理。该软件层还可以监督其他虚拟化功能，例如处理 hypercall 和中断 。请注意，可能需要修改 VM 操作系统 （OS） 以支持在此新环境中执行。
4. 最后，需要提供新的安全机制保护安全内存区域，防止虚拟机管理程序直接访问 。  
The Reference Model of Deploying Secure VM to TEE environment

**RISC-V Confidential Virtual Machine Extension (CoVE)**

上述参考架构需要解决的核心问题是解决REE和TEE之间的隔离问题。那RISC-V是否可以仍然利用PMP/IOPMP隔离组件实现TEE机密执行环境呢？答案是不可以，原因是目前的PMP/IOPMP不符合虚拟机管理的用户场景。

前面介绍的IoT TEE的执行环境的资源通常是静态分配的，这些资源主要包括物理内存、MMIO以及外设等， 由于资源是静态分配，内存管理可以不依赖与操作系统按页方式的页式存储管理，直接将安全内存通过PMP静态隔离，不纳入操作系统管理。

TrustZone也是类似的方式，所以Arm也称TrustZone为Static TrustZone (Armv9 CCA架构也叫做Dynamic TrustZone)。

但是，虚拟化场景下的物理资源（物理内存、MMIO等）并不是静态划分的，而是统一纳入Hypervisor管理。由于Hypervisor (如Linux作为Type2 hypervisor) 通常通过MMU来实现页式存储管理，这意味着内存管理的颗粒度至少需要达到按页的力度（如4KB每页)。

同时，虚拟机资源的管理包括虚拟机的创建、销毁都是Hypervisor负责的，那么通过PMP去实现内存隔离的颗粒度也要满足按页的要求，这是PMP/ePMP无法满足的，PMP/ePMP基于region的管理方式无法做到像MMU那样的颗粒度和灵活度。

于是， RISC-V为了满足机密计算的物理地址空间的隔离要求，实现了page颗粒度的物理内存保护,也就是Page-based PMP和Paged-based IOPMP, RISC-V称之为SMMTT（Supervisor Domain Access Protection）扩展。

它主要用于支持多租户安全场景下的Supervisor Domain隔离，涵盖机密计算、可信平台服务、故障隔离等领域。smmtt通过对Supervisor Domain内存的有效管理和访问控制，实现不同安全域之间的隔离与保护, 限制Hypervisor对机密虚拟机内存的非法访问。

在机密计算场景中，smmtt 确保一个租户无法非法访问其他租户的内存空间, 能防止不同租户的机密数据相互泄露，增强了系统的安全性和稳定性。

RISC-V SMMTT定义了通过硬件保证的可信计算基(TCB) 保护使用中数据的机密性和完整性以抵御软件和硬件攻击的机制。同时， RISC-V 也定义了机密计算架构的软件规范，CoVE和CoVE-IO。

RISC-V CoVE和CoVE-IO，定义了基于 RISC-V 应用处理器平台上可扩展的可信执行环境的威胁模型、参考架构和ABI接口规范，以支持机密计算场景。

CoVE的ABI规范主要定义了TCB 和非 TCB 组件之间的 ABI 的非 ISA 规范，此 ABI 使 OS/VMM 软件能够管理机密工作负载，同时将 OS/VMM 软件、固件、开发人员和系统操作员置于 TCB 之外，并且也定义了 TCB 和工作负载组件之间的 ABI（例如 TEE VM）的相关非 ISA 规范。

RISC-V 机密计算参考架构如下：  
*RISC-V TEE Reference Model in Server Scenario*

以上便是RISC-V 架构机密计算的主要轮廓。总结一下就是，RISC-V重新定义了基于页表管理的物理地址保护组件（SMMTT， IOMTT包含在SMMTT规范中)， 旨在满足机密虚拟机场景的隔离要求。同时， RISC-V也定义了机密计算可信执行环境的威胁模型、参考架构和ABI接口规范，以支持机密计算场景。

**RISC-V TEE-IO (CoVE-IO)**

但有的小伙伴可能会问，那RISC-V在机密计算场景下是如何管理安全外设(TEE-IO)的，因为机密虚拟机（租户）往往需要将设备直通到虚拟机以提高I/O吞吐，而服务器下的I/O设备通常是PCIe设备，这些设备通常是可动态插拔的，机密虚机管理器是如何识别动态可插拔设备的安全性的呢？

早期的时候，设备的I/O虚拟化是基于软件来实现的，也就是I/O设备不会直通到机密虚拟机，因为当时还没有完整的规范来定义TEE-IO设备，于是所有的IO设备被当作Non TEE-IO挂在非安全Domain, 不受信任的虚拟机管理程序（VMM）使用由他管理的共享IO（不受信任）和半虚拟化设备接口将虚拟设备呈现给机密虚拟机，机密虚拟机使用VirtIO的方式访问虚拟设备, 比如Intel TDX 1.0就是这么干的。

基于软件的 IO 模型很慢，因为 CVM和设备之间的通信是通过共享内存（不受信任）完成的，这需要机密虚拟机在TEE domain内运行的应用程序的私有缓冲区和设备使用的共享 IO 缓冲区之间来回复制和加密/解密数据。

因为共享IO缓冲区是不受信任的，这就需要机密虚拟机在生产数据的时候将数据先加密之后Copy到共享缓冲区；而在消费数据的时候则需要先将数据解密之后再将数据Copy到CVM私有缓冲区。对于某些 IO 用例，例如网络和存储，这种IO方式与 通过IOMMU 实现设备直通的低延迟和高吞吐量相比，这种方法存在性能开销问题。除了性能开销之外，加密数据保护还不允许 TEE domain将计算卸载到传统的 GPU 或 FPGA 加速器上。  
*IO Transactions with IO Virtualizations (VirtIO) in Server Scenario*

TEE-IO 旨在从两个方面改进 TEE 的 IO 虚拟化：

- 功能：TEE domain和设备无需使用共享缓冲区来存储私有数据，包括与设备建立安全传输级会话（通常使用专有协议来调整特定设备的数据处理和转换需求）。
- 性能：消除在共享设备缓冲区和私有 TEE domain内存之间来回复制加密或复制解密数据所需的额外资源和工作，从而大大提高工作负载性能（就带宽和延迟而言）。

简单来说，就是TEE-IO能够建立IO设备和机密虚拟机之间的信任关系，从而将IO设备直通到机密虚拟机。  
*IO Transactions with IO Virtualizations (Passthrough) in Server Scenario*

RISC-V 机密计算为了实现高性能I/O 操作，可信执行环境虚拟机 (TVM) 必须扩展其信任边界，包含分配TEE-I/O 设备的功能。如果没有这种能力，TVM 就不得不使用半虚拟化 I/O，使用非机密内存区域，这会因上面提到的内存副本拷贝和加解密而影响性能，并且无法将密集计算卸载到加速卡。同时RISC-V CoVE-IO TG定义了 ABI 扩展，为机密 VM 分配的设备提供对机密内存以及 MMIO 和消息信号中断 (MSI) 的安全直接访问，从而消除对半虚拟化 I/O 的依赖。

RISC-V TEE-IO 依赖于以下扩展和行业框架：

- CPU：smmtt扩展， 提供机密计算隔离环境
- 传输：使用 PCIe selective IDE 流进行端到端数据保护
- 设备：允许 TEE domain 使用 SPDM、IDE 和 TDISP 等功能、行业协议将TEE 和 TCB扩展到他们选择信任的 TEE-IO 设备

RISC-V完整的TEE-IO软硬件框架如下图所示：  
*The Overview of RISC-V TEE-IO Architecture*

**结束语**

我们既要铭记计算机之父图灵“机器也许有一天能像人类一样思考”的远见，也要直面爱德华·斯诺登（Edward Snowden）“隐私已死”的警示。正如著名的网络安全专家 Bruce Schneier 所言：“Security is a process, not a product.”（安全是一个过程，而非一种产品), 唯有将安全的基因融入技术的每一处脉络, 方能在数字洪流中筑起可信的方舟。

**参考资料：**

\[1\] “RISC-V Privileged specification” [github.com/riscv/riscv-isa-manual/releases/download/Privv1.12/riscv-privileged-20211203.pdf](http://github.com/riscv/riscv-isa-manual/releases/download/Privv1.12/riscv-privileged-20211203.pdf)

\[2\] “Trusted Execution Environment: What It Is, and What It Is Not.” [Trusted Execution Environment: What It is, and What It is Not | IEEE Conference Publication | IEEE Xplore](https://ieeexplore.ieee.org/document/7345265)

\[3\] “Confidential VM Extension (CoVE) for Confidential Computing on RISC-V platforms.” [GitHub - riscv-non-isa/riscv-ap-tee: This repo holds the work area and revisions of the non-ISA specification created by the RISC-V AP-TEE TG. This specification defines the programming interfaces (ABI) to support the Confidential VM Extension (CoVE) confidential computing architecture for RISC-V application-processor platforms.](https://github.com/riscv-non-isa/riscv-ap-tee)

\[4\] “Confidential VM Extension I/O (CoVE-IO) for Confidential Computing on RISC-V platforms.” [GitHub - riscv-non-isa/riscv-ap-tee-io: This TG will define AP-TEE-IO ABI extensions to provide Confidential VM-assigned devices with secure direct access to confidential memory as well as MMIO, removing the dependence on para-virtualized I/O.](https://github.com/riscv-non-isa/riscv-ap-tee-io)

\[5\] “RISC-V Supervisor Domains Access Protection.” [GitHub - riscv/riscv-smmtt: This specification will define the RISC-V privilege ISA extensions required to support Supervisor Domain isolation for multi-tenant security use cases e.g. confidential-computing, trusted platform services, fault isolation and so on.](https://github.com/riscv/riscv-smmtt)

\[6\] “RISC-V Shadow Stacks and Landing Pads.” [GitHub - riscv/riscv-cfi: This specification is integrated into the Priv. and Unpriv. specifications. This repo is no longer maintained. Please refer to the Priv. and Unpriv. specifications at https://github.com/riscv/riscv-isa-manual](https://github.com/riscv/riscv-cfi)

\[7\] "RISC-V Security Model " [GitHub - riscv-non-isa/riscv-security-model: RISC-V Security Model](https://github.com/riscv-non-isa/riscv-security-model)

\[8\] "RISC-V IOPMP Architecture Specification " [GitHub - riscv-non-isa/iopmp-spec: This repository contains the specification source for the RISC-V IOPMP Specification. This document proposes a Physical Memory Protection Unit of Input/Output devices, IOPMP for short, to regulate the accesses issued from the bus masters.](https://github.com/riscv-non-isa/iopmp-spec)

\[9\] “PMP Enhancements for memory access and execution prevention on Machine mode (Smepmp)” [riscv-tee/Smepmp/Smepmp.pdf at main · riscvarchive/riscv-tee · GitHub](https://github.com/riscvarchive/riscv-tee/blob/main/Smepmp/Smepmp.pdf)

\[10\] “SoK: Confidential Quartet - Comparison of Platforms for Virtualization-Based Confidential Computing”

- [【进迭时空双周报】-（20250127-0208）](https://forum.spacemit.com/t/topic/362)

8 个月后

每一期都是这么精华！爱了爱了