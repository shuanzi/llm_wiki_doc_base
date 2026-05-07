---
title: "OpenClaw + macOS（Mac mini）+ Tailscale Serve 远程访问踩坑全记录：从“能打开但离线”到稳定可用的修复路线"
source: "https://www.cnblogs.com/rioka/p/19670535"
author:
  - "[[板子~]]"
published: 2026-03-04
created: 2026-04-19
description: "这篇文章记录一次典型的 OpenClaw Control UI 远程访问踩坑过程：在 macOS 的 Mac mini 上运行 OpenClaw（Web UI 端口 18789），希望在另一台同一 Tailnet 内的 MacBook 上访问。过程会遇到 DNS、证书、Tailscale Serve"
tags:
  - "clippings"
---
这篇文章记录一次典型的 OpenClaw Control UI 远程访问踩坑过程：在 macOS 的 Mac mini 上运行 OpenClaw（Web UI 端口 18789），希望在另一台同一 Tailnet 内的 MacBook 上访问。过程会遇到 DNS、证书、Tailscale Serve、Origin 校验、Proxy 信任与 Pairing 等一串“看起来像一个问题、实际是多层叠加”的故障。

最终的目标是：

- 本机仍然用 `http://127.0.0.1:18789` 正常访问与聊天
- 远端（Tailnet 内）用 `https://<host>.tailxxxx.ts.net/` 安全访问
- 不必开启 “Use Tailscale DNS settings”（它可能导致“开了就断网”）
- 页面不再提示离线、版本不适用、origin not allowed、pairing-required 等

---

## 0\. 你遇到的现象通常长这样

### 现象 A：远端访问 <tailscale-ip>:18789 连接不上

因为 OpenClaw 默认只监听 `127.0.0.1` （loopback），外部 IP 上并没有监听 18789。

### 现象 B：Tailscale Serve 显示启动成功，但 curl https://<host>.ts.net/ 报 TLS 错

典型错误：

- `LibreSSL ... tlsv1 alert internal error`
- `tailscale cert ... lookup acme-v02.api.letsencrypt.org: no such host`

本质通常是 **DNS / 出网访问 Let’s Encrypt (ACME) 失败** 。

### 现象 C：远端终于能打开网页，但 UI 显示：

- `origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)`
- “版本 不适用 / 健康状况 离线”

说明前端页面能加载，但 WebSocket/后端握手失败。

### 现象 D：配好 allowedOrigins 仍然离线，日志出现：

- `Proxy headers detected from untrusted address... Configure gateway.trustedProxies...`
- `cause: pairing-required ... reason: not-paired ... code=4008`

说明你已经通过反代（Tailscale Serve）进来了，但网关认为代理头“不可信”，导致本地判定失效，进而触发更严格的 pairing 流程。

---

## 1\. 推荐的正确架构（避免把 18789 直接暴露给 Tailnet/LAN）

**不要** 把 OpenClaw gateway 直接绑到 `lan` 或 `tailnet` 然后在远端访问 `http://100.x.x.x:18789` 。  
更稳健、更安全的方式是：

- OpenClaw 仍然只监听 `127.0.0.1:18789`
- 用 `tailscale serve` 在 Tailnet 内提供 HTTPS 入口（通常 443）
- 远端访问 `https://<host>.tailxxxx.ts.net/`

这可以避免：

- 直接暴露控制面到整个局域网
- 自己折腾 HTTPS 反代/证书
- 一些 UI 对 “非 localhost 的 http” 产生 secure context 问题

---

## 2\. Step 1：先确认 OpenClaw 本机端口健康

在 Mac mini 上：

```bash
curl -I http://127.0.0.1:18789
lsof -nP -iTCP:18789 -sTCP:LISTEN
```

只要能连上、能看到 LISTEN（200/302/401 都行），就说明 OpenClaw 网关本地没问题。

---

## 3\. Step 2：Tailscale Serve 端点“必须可见”，否则远端永远打不开

在 Mac mini 上做一次“清空 + 重建”（强烈推荐）：

```bash
tailscale serve reset
sudo tailscale serve --bg http://127.0.0.1:18789
tailscale serve status
```

你必须在 `tailscale serve status` 里看到类似：

- `https://<host>.tailxxxx.ts.net/`
- `|-- proxy http://127.0.0.1:18789`

> 注意：不要看 `tailscale status` 来判断 Serve 是否生效。看 `tailscale serve status` 。

---

## 4\. Step 3：证书签发失败（acme no such host）的真正根因是 DNS

如果你运行：

```bash
tailscale cert <host>.tailxxxx.ts.net
```

看到：

- `lookup acme-v02.api.letsencrypt.org: no such host`
- 或 `nslookup acme-v02.api.letsencrypt.org` 超时

就说明这台机器的 DNS 配置不可用或 DNS 服务器不可达。

快速验证：

```bash
nslookup acme-v02.api.letsencrypt.org
```

### 修复方式（先救活系统 DNS）

查看你正在用的网卡 DNS：

```bash
networksetup -listallnetworkservices
networksetup -getdnsservers "Wi-Fi"
```

临时改成可靠 DNS（验证用）：

```bash
sudo networksetup -setdnsservers "Wi-Fi" 1.1.1.1 8.8.8.8
```

DNS 恢复后再跑：

```bash
tailscale cert <host>.tailxxxx.ts.net
```

成功后，你再决定要不要把 DNS 改回去。

---

## 5\. Step 4：远端机器不开 “Use Tailscale DNS settings” 也能解析 \*.ts.net（Split DNS）

很多人（包括我）会遇到：远端 MacBook 打开 “Use Tailscale DNS settings” 会导致上网异常。  
但不开的话，又解析不了 `*.tailxxxx.ts.net` 。

正确做法是： **Split DNS（只把 tail 域名交给 Tailscale DNS）** 。

在远端 MacBook 上：

```bash
sudo mkdir -p /etc/resolver
echo "nameserver 100.100.100.100" | sudo tee /etc/resolver/tailxxxx.ts.net
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

然后测试：

```bash
nslookup <host>.tailxxxx.ts.net
```

这不会影响公网域名的解析，也不需要开启 “Use”。

> 注意：把 `tailxxxx.ts.net` 换成你自己的 tailnet search domain。

---

## 6\. Step 5：能打开 UI 但提示 origin not allowed —— 配 allowedOrigins

当远端能打开 `https://<host>.tailxxxx.ts.net/` ，但页面提示：

`origin not allowed ... allow it in gateway.controlUi.allowedOrigins`

说明网关做了严格的 Origin 校验。

在 Mac mini 上：

```bash
openclaw config set gateway.controlUi.allowedOrigins '[
  "http://127.0.0.1:18789",
  "http://localhost:18789",
  "https://<host>.tailxxxx.ts.net"
]'
openclaw gateway restart
```

注意：

- origin 只写 `scheme://host[:port]` ，不要带路径，不要带末尾 `/`

---

## 7\. Step 6：allowedOrigins 配了仍然离线 —— trustedProxies + pairing 才是关键

如果日志出现类似：

- `Proxy headers detected from untrusted address... Configure gateway.trustedProxies...`
- `pairing-required ... not-paired ... code=4008`

这说明你是通过 **Tailscale Serve 本机反代** 进来的：  
网关看到 remote=127.0.0.1，但 `Forwarded-For` 是远端的 100.x 地址。  
由于 127.0.0.1 这个代理没被信任，它不会把连接当作“本地/可信”，从而触发 pairing。

修复：

```bash
openclaw config set gateway.trustedProxies '["127.0.0.1/32","::1/128"]'
openclaw gateway restart
```

然后你需要做一次 pairing：

- 远端浏览器重新打开 UI，触发 pending pairing
- 在 Mac mini 本机 UI（ `http://127.0.0.1:18789` ）里批准该设备（Approve / Pair）（ `openclaw devices list`; `openclaw devices approve <requestId>` ）

完成后远端 UI 的 “健康状况 离线” 会变成在线，版本信息也会正常显示。

---

## 8\. 最终“稳定可用配置”清单（建议保存）

### OpenClaw（Mac mini）

- `gateway.bind: loopback` （仍只监听本机）
- `gateway.controlUi.allowedOrigins` 包含远端访问的 `https://<host>.tailxxxx.ts.net`
- `gateway.trustedProxies` 至少包含 `127.0.0.1/32` 和 `::1/128` （因为 Serve 反代来自本机）
- 已批准远端设备 pairing

### Tailscale（Mac mini）

- `tailscale serve --bg http://127.0.0.1:18789`
- `tailscale serve status` 可看到 `https://<host>.tailxxxx.ts.net/ -> proxy http://127.0.0.1:18789`
- `tailscale cert <host>.tailxxxx.ts.net` 成功

### 远端访问端（MacBook）

- 不开 “Use Tailscale DNS settings”
- 用 `/etc/resolver/<tail-domain>` 做 Split DNS 指向 `100.100.100.100`
- 访问 `https://<host>.tailxxxx.ts.net/`

---

## 9\. 一句话总结：真正的修复路线

如果你也遇到“能打开但离线”的 OpenClaw 远程访问问题，按这个顺序做，基本不会走弯路：

1. 确认 `127.0.0.1:18789` 本机可用
2. `tailscale serve reset` + `sudo tailscale serve --bg http://127.0.0.1:18789` ，确保 `tailscale serve status` 里有端点
3. 修复 DNS 使 `tailscale cert` 能访问 ACME
4. 访问端用 Split DNS 解析 `*.ts.net` （不开 Use）
5. 配 `gateway.controlUi.allowedOrigins`
6. 配 `gateway.trustedProxies` （信任 Serve 本机反代）
7. 在本机批准 pairing

到这里，你的远端 Control UI 应该会稳定在线。