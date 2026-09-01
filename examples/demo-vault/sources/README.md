# Sources

- `inbox/`：用户或 Agent 放入的待处理材料。
- `library/`：通过注册形成的持久原始来源；文件名带内容哈希，注册后不得静默修改。
- `assets/`：图片、附件和网页裁剪资源。

推荐命令：

```bash
llm-wiki register-source --vault /path/to/vault /path/to/file
```

该命令只负责复制、哈希和创建 Source Record，不进行语义摄取。Ingest 仍由 Agent 完成。
