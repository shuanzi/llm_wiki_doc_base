---
title: Persistence Policy
type: profile
status: active
created: {{CREATED_AT}}
updated: {{CREATED_AT}}
---

# Persistence Policy

## Agent 可自动写入

- Source Record、局部事实、限定条件和证据链接；
- 不改变主结论的增量更新；
- Index、Map、反向引用和操作日志；
- 可复用、相对稳定且证据充分的分析结果；
- 明确标注的不确定问题和后续研究缺口。

执行后应给出变更摘要。

## 需要用户决定

- 推翻或重写核心结论；
- 批量合并、拆分、重命名、移动或删除；
- 改变 Vault 范围、领域分类或自动持久化策略；
- 无法凭来源权威性、日期或适用范围解决的冲突；
- 引入敏感、版权不清或体量很大的外部资料集。

## 默认不持久化

- 一次性格式转换；
- Session 计划、工具日志、缓存和临时搜索结果；
- 无证据且未明确标为假设的猜测；
- 与本 Vault 范围无关的普通聊天。
