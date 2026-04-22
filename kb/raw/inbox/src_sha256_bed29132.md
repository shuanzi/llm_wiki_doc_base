---
title: "Docker Containers on RISC-V Architecture"
source: "https://carlosedp.medium.com/docker-containers-on-risc-v-architecture-5bc45725624b"
author:
  - "[[Carlos Eduardo]]"
published: 2019-06-24
created: 2026-04-11
description: "Docker Containers on RISC-V Architecture Containers are part of the vast majority of daily interactions with software and the cloud these days. From building applications in a reproducible way to …"
tags:
  - "clippings"
---
Containers are part of the vast majority of daily interactions with software and the cloud these days. From building applications in a reproducible way to defining standards in deployment, containers brought ease and agility to IT.  
容器是当今与软件和云日常交互中绝大多数部分的一部分。从以可重复的方式构建应用程序到定义部署标准，容器为 IT 带来了便利和敏捷性。

[RISC-V](https://riscv.org/) is a free and open-source instruction set enabling a new era of processor innovation through open standard collaboration. Born at the University of Berkeley, RISC-V ISA delivers a new level of free, extensible software and hardware freedom on architecture, paving the way for the next 50 years of computing design and innovation.  
RISC-V 是一种免费且开源的指令集，通过开放标准的协作，推动处理器创新的新时代。诞生于伯克利大学，RISC-V 指令集架构在架构上提供了新的自由、可扩展的软件和硬件自由度，为未来 50 年的计算设计和创新铺平了道路。

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*SCLwwcWCHrBEMiU4vBHpZA.png)

Together they bring real openness to the future of cloud ecosystem by having a top-to-bottom open solution ranging from the hardware to the end-user software.  
它们共同为云生态系统的未来带来了真正的开放性，从硬件到最终用户软件，拥有自上而下的开放解决方案。

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*M5Z1drF9Z7CnDLI-c0pZQQ.png)

Me presenting at the Systems Summit in Switzerland 我在瑞士系统峰会上发表演讲

In this article, first I will show how to have a Risc-V virtual machine, install Golang and Docker into it, then run and build containers in this environment.  
在本文中，首先我将展示如何获得一个 Risc-V 虚拟机，在虚拟机中安装 Golang 和 Docker，然后在该环境中运行和构建容器。

### Risc-V Virtual Machine Risc-V 虚拟机

To start with development, I provide a Risc-V Virtual Machine based on [Debian](https://wiki.debian.org/RISC-V) Sid with a complete enviroment where you can start developing and building your applications on the Risc-V architecture.  
为了开始开发，我提供了一个基于 Debian Sid 的 Risc-V 虚拟机，它提供了一个完整的开发环境，你可以在 Risc-V 架构上开始开发并构建你的应用程序。

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*tF84OFG8FDxtY-D17hVAkQ.png)

The VM tarball can be [downloaded here](https://github.com/carlosedp/riscv-bringup/releases/download/v1.0/debian-riscv64-20181123.tar.bz2). Unpack with `tar vxf debian-riscv64–20181123.tar.bz2` and run with the `run_debian.sh` script.  
虚拟机 tarball 可以从这里下载。使用 `tar vxf debian-riscv64–20181123.tar.bz2` 解压，并用 `run_debian.sh` 脚本运行。

Log-in on another terminal window with:`ssh -p 22222 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@localhost`, the root password is “ *riscv”.*  
在另一个终端窗口中用 `ssh -p 22222 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@localhost` 登录，root 密码是“riscv”。

Soon I will also provide a Fedora development VM, the link will be added here.  
很快我也会提供一个 Fedora 开发虚拟机，链接将在这里添加。

### Install Golang 安装 Golang

Go [support on Risc](https://github.com/4a6f656c/riscv-go) -V architecture is not upstream yet. You can check the progress on [this issue](https://github.com/golang/go/issues/27532). Many of it’s modules have already been upstreamed like `x/sys` and `x/net`. Also many libraries and applications already support the Risc-V architecture like [VNDR](https://github.com/LK4D4/vndr), [GitHub’s Hub](https://github.com/github/hub) (git client), [Labstack Echo](https://github.com/labstack/echo) framework and more. Check the tracker on [https://github.com/carlosedp/riscv-bringup](https://github.com/carlosedp/riscv-bringup).  
Risc-V 架构上的 Go 支持尚未上游。您可以查看此问题的进展情况。它的许多模块已经上游，例如 `x/sys` 和 `x/net` 。此外，许多库和应用程序已经支持 Risc-V 架构，如 VNDR、GitHub 的 Hub（git 客户端）、Labstack Echo 框架等。请查看 https://github.com/carlosedp/riscv-bringup 上的跟踪器。

To install Go, download the tarball [from here](https://github.com/carlosedp/riscv-bringup/releases/download/v1.0/go-1.13-riscv64.tar.gz) and install with the commands:  
要安装 Go，请从这里下载 tarball，并使用以下命令进行安装：

```c
# Download the tarball into the VM
wget https://github.com/carlosedp/riscv-bringup/releases/download/v1.0/go-1.13-riscv64.tar.gz# In the VM, unpack (in root dir for example)
tar vxf go-1.13-riscv64.tar.gz -C /usr/local# Add to your PATH
export PATH="/usr/local/go/bin:$PATH"# Add to bashrc
echo "export PATH=/usr/local/go/bin:$PATH" >> ~/.bashrc
```

And you are ready to develop in Golang on Risc-V!  
现在您已经准备好在 Risc-V 上使用 Golang 进行开发了！

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*UlCsE2GfN6rG96VTYC3sTw.png)

Test the hello code from https://golang.org/ 测试 https://golang.org 上的 hello 代码。

### Install Docker 安装 Docker

After starting your VM, download and install the [Docker deb](https://github.com/carlosedp/riscv-bringup/releases/download/v1.0/docker-19.03.5-dev_riscv64.deb) with:  
启动你的虚拟机后，使用以下命令下载并安装 Docker deb 包：

```c
wget https://github.com/carlosedp/riscv-bringup/releases/download/v1.0/docker-19.03.5-dev_riscv64.debsudo apt install ./docker-19.03.5-dev_riscv64.deb
```

Reboot after install.安装完成后重启系统。

Now you can do `docker info` and `docker version` to check if it’s working (in case docker fails to start, just run `sudo systemctl start docker` again.  
现在你可以使用 `docker info` 和 `docker version` 来检查是否安装成功（如果 Docker 启动失败，只需再次运行 `sudo systemctl start docker` ）。

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*QoQg6ej38Zzpj2LsRv6Sqw.png)

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*j8QOnRJ_-fMMX9bVNTdGyA.png)

### Running Containers 运行容器

As a test, I already pushed a container to DockerHub with a [hello-world](https://echo.labstack.com/guide) web application using [Echo Framework](https://github.com/labstack/echo).  
作为一个测试，我已经使用 Echo 框架将一个包含 hello-world web 应用的容器推送到 DockerHub。

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*LnYB7wyoGpqy92SDM9QfjQ.png)

The source for this small application and it’s Dockerfile is in the [Risc-V Tracker repository](https://github.com/carlosedp/riscv-bringup/tree/master/echo-sample).  
这个小应用程序及其 Dockerfile 位于 Risc-V Tracker 仓库中。

Run this container with `docker run -d -p 8080:8080 carlosedp/echo_on_riscv` and test it with `curl http://localhost:8080`  
使用 `docker run -d -p 8080:8080 carlosedp/echo_on_riscv` 运行这个容器，并用 `curl http://localhost:8080` 测试它。

### Building Containers 构建容器

To build a container, just follow the default path of building your app, creating your Dockerfile and running `docker build` like the example from [the repo](https://github.com/carlosedp/riscv-bringup/tree/master/echo-sample). Checkout that tree and use the Makefile for convenience:  
要构建一个容器，只需遵循构建应用程序的默认路径，创建 Dockerfile 并像仓库中的示例一样运行 `docker build` 。检出该代码树并使用 Makefile 以方便操作：

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*SLu8vulYN1ILHvYpUpeY4A.png)

Currently, there are no official base images supporting Risc-V but I’ve provided some on my [DockerHub](https://hub.docker.com/r/carlosedp/) account:  
目前还没有官方的 Risc-V 基础镜像，但我已经在我的 DockerHub 账户上提供了一些：

- Debian Sid (Multiarch) -> `carlosedp/debian:sid`
- Debian Sid Slim (Multiarch) -> `carlosedp/debian:sid-slim`
- Busybox (1.31.0) -> `carlosedp/busybox:1.31`
- Go 1.13 (Multiarch) -> `carlosedp/golang:1.13`

## Build instructions 构建说明

For more details on building packages from source, check the tracker repo on [https://github.com/carlosedp/riscv-bringup](https://github.com/carlosedp/riscv-bringup) where I have instructions for Docker, Podman, Golang and more.  
关于从源代码构建软件包的更多详情，请查看 https://github.com/carlosedp/riscv-bringup 上的跟踪仓库，我在那里提供了 Docker、Podman、Golang 等的说明。

## Conclusion 结论

Container use on Risc-V architecture is pretty functional. Now the heavy work is to upstream Go, implement CGO support and have base images to build software.  
在 Risc-V 架构上使用容器功能相当完善。现在的主要工作是将 Go 上游化、实现 CGO 支持，并准备用于构建软件的基础镜像。

If you have suggestions, want to join and start providing support to some projects, message me on [Twitter](https://twitter.com/carlosedp) or open an [issue](https://github.com/carlosedp/riscv-bringup/issues) on the tracker repository.  
如果你有建议，想要加入并开始为一些项目提供支持，请在 Twitter 上私信我或在跟踪仓库中打开问题。