# `development-plan.md` Review R2

## 1. 总体结论

这次更新是有效的。

和上一轮相比，文档已经把几个最关键的工程约束收紧了：

- `kb_draft_patch` / `kb_apply_patch` 的职责边界已经明确
- `append` 已改为幂等语义更强的 `ensure_entry`
- patch 状态机已经定义了唯一真相源
- `failed` 与 `drafts` 已物理隔离
- 失败恢复路径已经从“仅 warning”提升为显式的 `resume / rollback / force-clear`
- schema 迁移也补上了页面级迁移标记

我的判断是：这份计划现在已经接近“可以直接开工”的状态。主线没有明显问题，剩下的是两处实现级语义还需要再补一刀，否则后面会在边缘场景里留下漏洞。

## 2. 剩余问题

### 2.1 `rollback` 还不能完整回退 `create` 动作

当前文档把 `rollback` 定义为：

- 根据 `in_progress.json` 中的已完成文件列表
- 配合 `git checkout -- <files>` 回退已写入的文件

这个定义对“修改已有文件”是成立的，但对“本次 apply 新创建的文件”并不成立。

原因是：

- `git checkout -- <files>` 只能恢复 Git 已跟踪文件
- 如果本次 apply 执行了 `create`
- 而这个新文件尚未被提交
- 那么 rollback 时它不会被删除，只会继续作为未跟踪文件留在工作区

这意味着当前 rollback 语义对新建 wiki 页并不完整。

建议补成下面这种更精确的设计：

1. `in_progress.json` 中记录已完成文件时，区分：
   - `created`
   - `modified`
2. `rollback` 时：
   - 对 `modified` 执行 Git 恢复
   - 对 `created` 显式删除文件

如果后面还会支持目录级创建或 rename/move，这个记录结构最好从现在就按操作类型设计，不要只存一个扁平“已完成文件列表”。

### 2.2 schema 迁移规则引用了一个未定义字段

当前文档在 schema 规则部分写到：

- 有 `schema_migrated_at` 且日期大于等于“当前 schema 版本生效日”时，按当前 schema 检查

但 `kb/schema/version.yaml` 里目前只有：

- `schema_version`
- `min_compatible_version`
- `migration_grace_until`

并没有“当前 schema 版本生效日”这个字段。

这会导致实现时无法稳定判断：

- 什么时候算“当前 schema 已生效”
- `schema_migrated_at` 应该和哪个时间点比较

建议补一个明确字段，例如：

- `schema_effective_from`
- 或 `schema_released_at`

只要文档中把这个时间点定义清楚，lint 规则就能真正落地。否则现在这段逻辑还是依赖隐含假设。

## 3. 我对当前版本的判断

到这一版为止，这份计划已经不再是“方向正确但约束松散”，而是进入了“主干可实现，仅剩少量边缘条件待补”的状态。

更具体地说：

- 架构方向：成立
- MVP 范围：合理
- 工程约束：基本闭合
- 剩余问题：集中在 rollback 细节和 schema 生效时间定义

如果把这两个点再补齐，我会认为这份 `development-plan.md` 已经可以作为正式开发底稿直接进入实现阶段。
