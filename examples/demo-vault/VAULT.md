---
title: "Local Agent LLM Wiki Demo"
type: vault-home
status: active
created: 2026-08-31T14:27:13Z
updated: 2026-08-31T14:27:13Z
---

# Local Agent LLM Wiki Demo

## 进入顺序

1. [Vault Profile](profile/VAULT_PROFILE.md)：主题、边界和领域语义。
2. [Persistence Policy](profile/PERSISTENCE_POLICY.md)：哪些改动可自动持久化。
3. [Overview](wiki/OVERVIEW.md)：当前知识概况。
4. [Index](wiki/INDEX.md)：内容目录。
5. [Knowledge Map](wiki/maps/Knowledge%20Map.md)：主要关系与入口。
6. [Operations Log](logs/operations.md)：近期摄取、查询、提升和维护记录。

## 资产分区

| 分区 | 内容 | Agent 默认权限 |
|---|---|---|
| `sources/inbox/` | 尚未注册的新资料 | 可读，可整理；不应把它当作已验证来源 |
| `sources/library/` | 已注册的原始来源 | 只读，不静默覆盖 |
| `wiki/` | 综合知识、Map、问题与决策 | 按变更政策维护 |
| `evidence/` | 摘录、转写、表格、图像解读等衍生证据 | 可新增、需保留来源链 |
| `profile/` | 本 Vault 的领域配置和约定 | 高影响修改需用户决定 |
| `logs/` | Append-oriented 演进记录 | 追加为主 |

## 核心原则

- 先维护已有知识网络，再考虑新建孤立摘要。
- 区分来源事实、跨来源综合、Agent 推断和未知。
- 不把 Agent Session 或搜索索引当作知识源。
- Binding 可删除，Vault 必须仍然完整可读和可迁移。
