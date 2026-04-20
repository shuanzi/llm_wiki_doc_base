# 项目进度（Live）

> 更新日期：2026-04-20
> 依据：`README.md`、`kb/wiki/index.md`、`kb/wiki/log.md`、`scripts/validate_e2e_v2_ingest_safety.ts`、`scripts/validate_kb_search_wiki_resolve_link.ts`
> 归档参考（非 live 事实源）：`archived/docs/session_2026_04_12_status.md`

- [x] V2 工具层已完成：8 个 `kb_*` 工具与 MCP 暴露已就位（`src/tools/kb_*.ts` + `src/mcp_server.ts`）。
- [x] skills / conventions 已完成：`kb_ingest`、`kb_query`、`kb_lint` 与 `kb/schema/wiki-conventions.md` 已落地并被 README 声明为当前流程。
- [x] E2E 安全化已完成：`e2e_v2_ingest.ts` 默认安全模式（临时 KB）、显式 `--kb-root`、`--commit` 目标保护与幂等性校验；安全验证脚本已提供（`scripts/validate_e2e_v2_ingest_safety.ts`）。
- [x] 正式 wiki 内容落盘样例已完成：2026-04-19 已新增 `src_sha256_08e04538` 与 `risc_v_matrix_extensions` 相关 wiki 内容，并更新 `risc_v` / `index.md` / `log.md`；其中 `src_sha256_08e04538` 的 raw source 与 manifest 仍未回填，不代表完整 source registration 闭环。
- [x] analysis 首篇已完成：`risc_v_trust_chain_analysis` 已在 `kb/wiki/index.md` 与 `kb/wiki/log.md` 记录。
- [x] lint 能力补齐已完成：`kb_lint` 已补齐“直读 `page-index.json` 建全局视图、dedup 规范、完整 pass 写 log（含 clean pass）”的流程约束。
- [ ] 完成一次“完整 lint pass”并写入 `kb/wiki/log.md`（当前 log 未见 `lint | ...` 条目）。
- [ ] 完成 Obsidian compatibility GUI spot-check（backlinks / graph 目视核验）。
- [ ] 完成 Phase 3 remediation 的 Codex review round 2（历史快照 `archived/docs/session_2026_04_12_status.md` 中该项仍为 pending）。
