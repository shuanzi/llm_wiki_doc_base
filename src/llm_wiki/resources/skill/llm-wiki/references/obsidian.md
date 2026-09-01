# Obsidian Compatibility

## 原则

- Vault 只依赖普通文件系统、UTF-8 Markdown 和相对路径。
- Obsidian 是优秀的浏览与人工维护界面，但不是运行时依赖。
- `.obsidian/` 可以随 Vault 迁移，也可以删除重建；其中不保存唯一知识。
- 核心结论不能只存在于 Dataview 查询结果、Canvas 二进制状态或插件数据库中。

## 推荐实践

- 附件放在 `sources/assets/`；
- 新资料先放 `sources/inbox/`，确认后注册到 `sources/library/`；
- 模板位于 `wiki/_templates/`；
- Map 和 Index 使用普通 Markdown 链接；
- 可以按个人偏好启用 Backlinks、Graph、Templates、Canvas 或 Dataview；
- 启用自动更新链接前仍应通过版本控制保护批量重命名。

## 兼容性检查

Agent 写入后应确保：

- YAML frontmatter 起止完整；
- 相对链接不逃逸 Vault；
- 文件名不使用跨平台非法字符；
- 图片和附件使用本地相对路径；
- 页面即使脱离 Obsidian 也能看懂主要结论。
