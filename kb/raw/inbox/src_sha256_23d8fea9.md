---
title: "RISC-V 中开发 Java 是一种什么体验？ 让 Dragonwell JDK 来回答"
source: "https://zhuanlan.zhihu.com/p/624821788"
author:
  - "[[阿里云云栖号​已认证机构号]]"
published:
created: 2026-04-11
description: "01 背景介绍1. Alibaba Dragonwell 发行版Alibaba Dragonwell [1] 是一 款免费的 OpenJDK 发行版。它提供了长期支持，包括性能增强、安全修复以及 Dragonwell 上专有的一些特性，比如 Wisp 协程、多租户、JWarmup…"
tags:
  - "clippings"
---
## 01 背景介绍

## 1\. Alibaba Dragonwell 发行版

Alibaba Dragonwell \[1\] 是一 **款免费的 [OpenJDK](https://zhida.zhihu.com/search?content_id=226980324&content_type=Article&match_order=1&q=OpenJDK&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzYwODU3MDUsInEiOiJPcGVuSkRLIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjI2OTgwMzI0LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.V6hMAvnrDdj4B5OO9msRTSwwUu6P7RxzSClIJ6pDV4g&zhida_source=entity) 发行版** 。它提供了长期支持，包括性能增强、安全修复以及 Dragonwell 上专有的一些特性，比如 [Wisp 协程](https://zhida.zhihu.com/search?content_id=226980324&content_type=Article&match_order=1&q=Wisp+%E5%8D%8F%E7%A8%8B&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzYwODU3MDUsInEiOiJXaXNwIOWNj-eoiyIsInpoaWRhX3NvdXJjZSI6ImVudGl0eSIsImNvbnRlbnRfaWQiOjIyNjk4MDMyNCwiY29udGVudF90eXBlIjoiQXJ0aWNsZSIsIm1hdGNoX29yZGVyIjoxLCJ6ZF90b2tlbiI6bnVsbH0.XWu5DJv3jBKre4nA48IXxce7xcznNPYJh0O-_KBO9Ak&zhida_source=entity) 、多租户、JWarmup、 [G1 elastic heap](https://zhida.zhihu.com/search?content_id=226980324&content_type=Article&match_order=1&q=G1+elastic+heap&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzYwODU3MDUsInEiOiJHMSBlbGFzdGljIGhlYXAiLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjoyMjY5ODAzMjQsImNvbnRlbnRfdHlwZSI6IkFydGljbGUiLCJtYXRjaF9vcmRlciI6MSwiemRfdG9rZW4iOm51bGx9.crXzzonUGopOUwQWFcEigyw-vRHqusT_P2G8wriEx80&zhida_source=entity) 以及 serviceability 上的特性 \[2\] 等等。Dragonwell 包括 8、11、17 三个版本，而每个版本又包括 standard (和 OpenJDK 基本保持一致) 和 extended (基于 OpenJDK，搭载了 Dragonwell 的各种专有特性) 两个子版本。而我们当前介绍的 **RISC-V 后端支持是在 Dragonwell11 上的 extended 版本上** ，已在 2023 年 2 月正式 release，其中 Dragonwell11 上的特性如 Wisp 暂时还不支持。

## 2\. RISC-V 指令集架构

RISC-V \[3\] 是一个基于 RISC (精简指令集) 的指令集架构。 **它主要的特性是开源、模块化、可扩展性以及非常精简的指令集** 。当前的 RISC-V 主要应用于物联网；而后续进入服务器领域也是未来可期的。同时，得到 Arm 等商业芯片指令集的授权都需要支付高额的商业费用，而 RISC-V 是完全开源的指令集架构，芯片厂商可以根据自己的需要做定制化。当前的商业 RISC-V 处理器有如 Alibaba 玄铁 C910 处理器、SiFive 的 RISC-V 半导体 IP 核等。从开发的角度而言，它们也都是使用体验很好的处理器/设备。

## 3\. OpenJDK on RISC-V

在 2020 年的年末，华为的 Bisheng JDK 团队开源了基于 OpenJDK 的 RISC-V (64位) 后端实现，约 6w 行代码的 initial load \[4\]。Alibaba Dragonwell 团队也同期参与到了 RISC-V 后端研发当中。从 Alibaba Dragonwell 团队的角度，在去年社区成立 openjdk/riscv-port repo \[5\] ，随后 RISC-V 后端正式合并到上游 openjdk/jdk repo \[6\] 到现在，我们对 OpenJDK RISC-V 后端的贡献包括在 OpenJDK 上的 RISC-V "C" 压缩指令扩展这个特性的实现；20 余个 bug fixes；部分 enhancements 和 refactoring；以及部分 Loom (协程) RISC-V port 的支持等。其中 C 扩展的实现已经在 OpenJDK 20 上的 RISC-V 后端中默认开启，可以减小 ~20% 的后端 Java compiled code 的 code size footprint。

## 02 Alibaba Dragonwell11 on RISC-V

## 为什么是 JDK11？

JDK11 是当前的主流版本。国内的 Java 客户大多都在使用 JDK8，但现在已经有越来越多升级到 JDK11 的趋势了。默认的 G1 GC (CMS 在后面 JDK 版本中已经弃用)、更好的性能、AArch64 后端更好的支持、AppCDS 特性、Safepoint 的 Threadlocal Handshake、能提升代码性能的 Segmented Code Cache 特性等都可以让 JDK11 相比于 JDK8 有更多的优势，也是用户升级 JDK 的动力所在。虽然 JDK11 的确是当下的主流版本，但是社区上的 RISC-V 后端是在 19/20 这两个版本中支持的，因此这对于很多 Java 应用的维护者来说，升级到这么高的版本的确是略有些遥远且工作量颇高的事情。所以，如果要尝试在 RISC-V 上开发 Java 应用的话， **能继续使用 JDK11 应该是一个比较好的选择** 。

## 硬件特性支持平头哥 RISC-V 芯片

因此，Alibaba Dragonwell 团队将 OpenJDK 上游的 RISC-V 后端移植回了 Dragonwell11 \[7\] 上，我们会长期维护 Dragonwell11 的版本和后端，同步上游社区的 bug fixes 保证用户的使用体验。从兼容性的角度上讲，我们完成了 [QEMU](https://zhida.zhihu.com/search?content_id=226980324&content_type=Article&match_order=1&q=QEMU&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzYwODU3MDUsInEiOiJRRU1VIiwiemhpZGFfc291cmNlIjoiZW50aXR5IiwiY29udGVudF9pZCI6MjI2OTgwMzI0LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.3KEdeWL7_GopLo2cz7x6zhUjfa9kYEsJhkyHzUsFCL4&zhida_source=entity) / SiFive 开发板 / 平头哥开发板 上的验证，以及 JCK / jtreg / SPECjbb2015 等各种 benchmark 的支持。Dragonwell11 上的 RISC-V 和上游大部分保持一致；包括基础的 RVI 指令集支持的同时，我们还支持一部分平头哥芯片专有的指令集和其生态，如果在平头哥的硬件上如 C910，则可以使用 -XX:+UseCSky 开启相关的支持。与此同时，我们还支持一些基于 RVV（RISC-V 的向量指令扩展）-0.7.1 的 vector intrinsic 的向量化，在支持 RVV-0.7.1 版本的（如平头哥的一些 RISC-V 芯片，如开启 vector 支持的 C910 等）开发板上可以自动开启。由于搭载 RVV-1.0 版本的芯片现阶段实际上很少，所以 Dragonwell 可能是目前唯一能够在硬件上运行 RVV 的 JDK。

![](https://pic2.zhimg.com/v2-bbf57f2c57af7a220c45d4491f839d81_1440w.jpg)

## 二进制版本下载

Dragonwell11 的二进制版本 \[8\] 已经于二月份发布，有兴趣的开发者可以直接从 Github 链接下载。此外，Dragonwell11 的 RISC-V 版本已经集成进龙蜥的 Anolis 源中，如果是使用 Anolis OS 的用户可以直接使用 yum 源来安装 Dragonwell11 JDK。

## 使用方便的 QEMU Docker 容器镜像进行模拟

RISC-V 现在还在快速发展阶段中。因此面临着硬件资源有限的问题： **开发者有时并不容易得到硬件设备；拿到硬件设备之后还面临着需要搭建环境、初始化网络等比较麻烦的操作** 。在这种情况下，有一个模拟器就是非常有必要的了。主流的模拟器是 QEMU，如果把 QEMU 内置在 Docker 镜像当中，用户就可以得到最大程度上的使用便利：用户可以直接在 x86 机器上一键模拟 RISC-V 程序。并且，镜像是 portable 的：因为容器镜像可以随时迁移到其他机器上去。我们维护了一个 RISC-V QEMU Docker 镜像的仓库 \[9\]，使用 Debian 的 RISC-V 源。用户可以直接查看 README 手动构建一个 QEMU Docker。省力一些的话，用户也可以直接将镜像 pull 下来：

```
# 现只支持 x86 宿主机

docker pull multiarch/qemu-user-static && \
docker run --rm --privileged --net host multiarch/qemu-user-static --reset

docker pull alibabadragonwelljdk/riscv-qemu && \
docker run -it --rm alibabadragonwelljdk/riscv-qemu /bin/bash
```
![](https://pic4.zhimg.com/v2-be009916feef30454114da3e2f23cbc1_1440w.jpg)

## Demo：Springboot 示例

SpringBoot 是非常优秀的 Java 应用框架，我们可以从官网上 \[10\] 下载其 Hello World demo 并使用 maven 构建。

我们也提供了一个预编译好的 SpringBoot demo 以供演示用：

*[dragonwell.oss-cn-shanghai.aliyuncs.com](https://link.zhihu.com/?target=https%3A//dragonwell.oss-cn-shanghai.aliyuncs.com/demo-0.0.1-SNAPSHOT.jar)*

我们可以在实际的物理开发板上启动 Java 程序；也可以在上述的 QEMU Docker 中用同样的命令启动：

![](https://pic1.zhimg.com/v2-e6346404de357d7903f98900e9ddea14_1440w.jpg)

图/启动一个简单的 SpringBoot Hello World 程序 (实际启动时间可能与图片上有差别)

## 03 致谢

感谢华为 Bisheng JDK 团队的开发同学们的工作，感谢中科院软件所 PLCT 实验室团队对硬件设施方面给予的帮助。感谢社区 RISC-V 后端的 reviewers 的各种帮助。我们也会持续输出并不断反馈社区，在社区的维护上贡献我们的力量。

## 04 总结和展望

RISC-V 是一个有前景的指令集，中立和开放是它的两大优势。在成立了 Datacenter (数据中心) SIG 和 HPC (高性能计算) SIG 之后，RISC-V 也开始逐渐向高性能方向逐渐演进。除此之外，就 RISC-V 的软件生态而言，RISC-V 上的各种 toolchain (GCC、GDB 等) 的支持也已经十分完备，各种操作系统 (Ubuntu、Debian) 等都已经支持了 RISC-V 指令集，各种开源社区对相关软件的移植的支持也非常积极。 [Debian-port](https://zhida.zhihu.com/search?content_id=226980324&content_type=Article&match_order=1&q=Debian-port&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NzYwODU3MDUsInEiOiJEZWJpYW4tcG9ydCIsInpoaWRhX3NvdXJjZSI6ImVudGl0eSIsImNvbnRlbnRfaWQiOjIyNjk4MDMyNCwiY29udGVudF90eXBlIjoiQXJ0aWNsZSIsIm1hdGNoX29yZGVyIjoxLCJ6ZF90b2tlbiI6bnVsbH0.PHH9CaX2H88DAdNemNMvid1l3P8Ot1xG2OHUAHr9EJw&zhida_source=entity) 上大约 95% 的软件包都可以在 RISC-V 上使用 \[11\]，因此用户的开发流程是比较流畅的。相比于 x86 平台的一些复杂指令及一些历史包袱，RISC-V 具有着较新、指令集简单、较强的拓展性等特性，已经 ratify 了多个指令集扩展。随着社区的蓬勃发展，我们相信 RISC-V 架构有着光明的前景。

**相关链接：**

\[1\] *[dragonwell-jdk.io/](https://link.zhihu.com/?target=https%3A//dragonwell-jdk.io/)*

\[2\] *[https://github.com/dragonwell-project/dragonwell8/wiki/%E9%98%BF%E9%87%8C%E5%B7%B4%E5%B7%B4Dragonwell8%E7%94%A8%E6%88%B7%E6%8C%87%E5%8D%97](https://link.zhihu.com/?target=https%3A//github.com/dragonwell-project/dragonwell8/wiki/%2525E9%252598%2525BF%2525E9%252587%25258C%2525E5%2525B7%2525B4%2525E5%2525B7%2525B4Dragonwell8%2525E7%252594%2525A8%2525E6%252588%2525B7%2525E6%25258C%252587%2525E5%25258D%252597)*

\[3\] *[en.wikipedia.org/wiki/R](https://link.zhihu.com/?target=https%3A//en.wikipedia.org/wiki/RISC-V)*

\[4\] *[mail.openjdk.org/piperm](https://link.zhihu.com/?target=https%3A//mail.openjdk.org/pipermail/discuss/2020-December/005657.html)*

\[5\] *[github.com/openjdk/risc](https://link.zhihu.com/?target=https%3A//github.com/openjdk/riscv-port)*

\[6\] *[github.com/openjdk/jdk](https://link.zhihu.com/?target=https%3A//github.com/openjdk/jdk)*

\[7\] *[github.com/dragonwell-p](https://link.zhihu.com/?target=https%3A//github.com/dragonwell-project/dragonwell11)*

\[8\] *[github.com/dragonwell-p](https://link.zhihu.com/?target=https%3A//github.com/dragonwell-project/dragonwell11/releases)*

\[9\] *[github.com/dragonwell-p](https://link.zhihu.com/?target=https%3A//github.com/dragonwell-project/docker-qemu-riscv64)*

\[10\] *[start.spring.io/](https://link.zhihu.com/?target=https%3A//start.spring.io/)*

\[11\] *[wiki.debian.org/RISC-V](https://link.zhihu.com/?target=https%3A//wiki.debian.org/RISC-V)*

文/郑孝林

**[原文链接](https://link.zhihu.com/?target=https%3A//click.aliyun.com/m/1000371001/)**

**本文为阿里云原创内容，未经允许不得转载。**

编辑于 2023-04-25 16:41・北京[Java](https://www.zhihu.com/topic/19561132)[RISC-V](https://www.zhihu.com/topic/20075426)[JDK](https://www.zhihu.com/topic/19619153)