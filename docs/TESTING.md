# 测试策略

## 1. 测试层次

### Unit

覆盖路径处理、Managed Block、Frontmatter、Source 哈希、Skill fingerprint、绑定元数据、符号链接所有权与跨平台文件名。

### Integration

在临时目录创建真实 Vault 与 Binding，执行完整 CLI 操作并运行 Doctor；同时注入损坏 JSON、非 UTF-8 文件、未知符号链接、路径逃逸、模式漂移和陈旧 Binding 场景，验证安全失败且不破坏用户文件。

### Portability / Recovery

复制 Vault 到新目录、删除/重建 Binding、重新指向移动后的 Vault，验证持久知识无需旧 Harness 或 Session。

### Packaging

在临时虚拟环境中使用 `pip --no-deps --no-build-isolation` 安装项目，再调用安装后的 `llm-wiki` 完成 init/attach/doctor/detach。

### Agent Eval Contract

`evals/cases.json` 定义 Orient、Ingest、Query、Promote、Reconcile 和 Boundary 六类场景及可观察结果。由于语义行为依赖实际模型和工具权限，MVP 将它们作为可复用跨 Harness Eval，而不伪装成确定性单元测试。

## 2. 一键执行

```bash
./scripts/run-tests.sh
```

执行顺序：

1. `compileall`；
2. `unittest`；
3. Kit Doctor strict；
4. 端到端 Shell acceptance；
5. 临时 venv 安装与 CLI smoke；
6. 生成/更新 `docs/TEST_REPORT.md`。

任何步骤失败都会以非零状态退出。

## 3. 通过标准

- 所有自动化测试通过；
- Doctor 对干净 Kit、Vault、Binding 无 error/warning；
- Source 改写必须被检测；
- 非托管 Skill 不能被默认覆盖或删除；
- 完整 detach 后 Vault fingerprint 不变；
- 复制后的 Vault 无需 Binding 即可通过 Doctor；
- 安装包不下载第三方运行依赖。
