# LLM Wiki v1 开发计划

> 基于 `llm-wiki-engineering-plan-v1.md`  
> 创建日期：2026-04-10  
> 技术栈：Python 3.11+ / SQLite / Git / Markdown

---

## 总览

整个 v1 开发分为 5 个 Phase，每个 Phase 内部按任务拆解为若干步骤。每个步骤标注：

- **产出物**：完成后应存在的文件或可运行的能力
- **前置依赖**：必须先完成的步骤
- **验收标准**：怎样算"做完了"

依赖关系图：

```
Phase 0 (基础设施)
  │
  ├─► Phase 1 (Ingest MVP)
  │     │
  │     ├─► Phase 2 (Query MVP)
  │     │
  │     └─► Phase 3 (Lint MVP)
  │
  └─► Phase 4 (增强与演进)
```

---

## Phase 0：基础设施搭建

> 目标：建立项目骨架，让后续所有模块有统一的目录规范、数据库、配置和 schema 约束。

### 0.1 项目结构与包初始化

**前置依赖**：无

**工作内容**：

1. 初始化 Python 项目结构：

   ```
   llm_doc_base/
     pyproject.toml          # 项目元数据、依赖声明
     src/
       kb/                   # 主包
         __init__.py
         cli.py              # CLI 入口
         config.py            # 配置加载
         models.py            # 数据模型 (dataclass / Pydantic)
         db.py                # SQLite 操作封装
         git_ops.py           # Git 操作封装
         source_manager.py
         parser/
           __init__.py
           markdown.py
           web.py
           pdf.py
         compiler.py          # Wiki Compiler (patch plan 生成)
         patch.py             # Patch Applier
         query.py             # Query Engine
         lint.py              # Lint Engine
         llm/
           __init__.py
           base.py            # 模型抽象接口
           openai_compat.py   # OpenAI-compatible 适配器
     tests/
       __init__.py
       conftest.py
       test_source_manager.py
       test_parser.py
       test_compiler.py
       test_patch.py
       test_query.py
       test_lint.py
   ```

2. 配置 `pyproject.toml`，声明依赖：
   - `click`（CLI 框架）
   - `pyyaml`（YAML 读写）
   - `trafilatura`（网页正文提取）
   - `pymupdf` 或 `pdfplumber`（PDF 文本提取）
   - `openai`（OpenAI-compatible 模型调用）
   - `gitpython`（Git 操作）
   - `pytest`（测试）

3. 配置 CLI 入口点 `kb`

**产出物**：

- `pyproject.toml`
- `src/kb/` 包骨架（各文件可以只有占位）
- `tests/` 测试目录
- 可运行 `kb --help`

**验收标准**：

- `pip install -e .` 成功
- `kb --help` 输出帮助信息
- `pytest` 通过（即使没有实际测试用例）

---

### 0.2 Workspace 初始化命令

**前置依赖**：0.1

**工作内容**：

1. 实现 `kb init --workspace <path>` 命令
2. 创建标准 workspace 目录结构：

   ```
   <workspace>/
     config.yaml             # workspace 级配置
     kb/                     # 知识域容器（空）
   ```

3. 实现 `kb create-kb <name>` 命令，在 workspace 下创建一个 kb：

   ```
   kb/<name>/
     raw/
       inbox/
       processed/
       assets/
     wiki/
       index.md
       log.md
       overview.md
       sources/
       concepts/
       entities/
       topics/
       analyses/
       reports/
     schema/
       AGENTS.md
       page_templates/
         source_summary.md
         concept.md
         entity.md
         topic.md
         analysis.md
       workflows/
       lint_rules.yaml
     state/
       manifests/
       patches/
       runs/
   ```

4. 初始化 Git 仓库（如果 workspace 尚未 git init）
5. 生成初始 `index.md`、`log.md`、`overview.md` 占位内容

**产出物**：

- `src/kb/cli.py` 中 `init` 和 `create-kb` 命令实现
- 初始模板文件

**验收标准**：

- `kb init --workspace ./test_ws` 生成完整目录
- `kb create-kb riscv-tee` 在 workspace 下生成一个完整的 kb 目录
- 生成的目录结构与方案文档第 6 节一致
- Git 仓库已初始化

---

### 0.3 配置系统

**前置依赖**：0.1

**工作内容**：

1. 定义 `config.yaml` schema：

   ```yaml
   workspace_path: /path/to/workspace
   default_kb: llm-infra
   models:
     planner:
       provider: openai
       model: gpt-4o
       api_key_env: OPENAI_API_KEY
     writer:
       provider: openai
       model: gpt-4o
       api_key_env: OPENAI_API_KEY
     query:
       provider: openai
       model: gpt-4o
       api_key_env: OPENAI_API_KEY
   review:
     auto_approve:
       - source_summary
       - index
       - log
     require_review:
       - concept
       - entity
       - topic
       - analysis
     force_review_threshold: 5   # 修改文件数超过此值强制审核
   ```

2. 实现 `config.py`：加载、校验、合并默认值
3. CLI 所有命令从 config 中读取 workspace 路径和模型配置

**产出物**：

- `src/kb/config.py`
- 默认 `config.yaml` 模板

**验收标准**：

- 配置文件缺失时给出明确错误提示
- 配置项可被 CLI 参数覆盖（如 `--kb`）

---

### 0.4 SQLite 状态数据库

**前置依赖**：0.1

**工作内容**：

1. 编写 `state/schema.sql`：

   ```sql
   CREATE TABLE IF NOT EXISTS sources (
       source_id TEXT PRIMARY KEY,
       kb_id TEXT NOT NULL,
       title TEXT,
       source_type TEXT NOT NULL,
       content_hash TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'registered',
       created_at TEXT NOT NULL,
       origin_url TEXT,
       file_path TEXT
   );

   CREATE TABLE IF NOT EXISTS pages (
       page_id TEXT PRIMARY KEY,
       kb_id TEXT NOT NULL,
       path TEXT NOT NULL UNIQUE,
       page_type TEXT NOT NULL,
       title TEXT,
       updated_at TEXT NOT NULL,
       review_state TEXT DEFAULT 'auto'
   );

   CREATE TABLE IF NOT EXISTS patches (
       patch_id TEXT PRIMARY KEY,
       kb_id TEXT NOT NULL,
       operation TEXT NOT NULL,
       source_id TEXT,
       risk_level TEXT DEFAULT 'low',
       requires_review INTEGER DEFAULT 0,
       status TEXT NOT NULL DEFAULT 'pending',
       created_at TEXT NOT NULL,
       commit_hash TEXT
   );

   CREATE TABLE IF NOT EXISTS runs (
       run_id TEXT PRIMARY KEY,
       kb_id TEXT NOT NULL,
       run_type TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'running',
       started_at TEXT NOT NULL,
       ended_at TEXT,
       artifact_path TEXT
   );

   CREATE TABLE IF NOT EXISTS page_sources (
       page_id TEXT NOT NULL,
       source_id TEXT NOT NULL,
       PRIMARY KEY (page_id, source_id),
       FOREIGN KEY (page_id) REFERENCES pages(page_id),
       FOREIGN KEY (source_id) REFERENCES sources(source_id)
   );
   ```

2. 实现 `db.py`：
   - `init_db(kb_path)` — 创建或迁移数据库
   - `get_db(kb_path)` — 获取连接
   - 基础 CRUD 函数

3. 在 `kb create-kb` 时自动初始化数据库

**产出物**：

- `src/kb/db.py`
- 数据库自动创建逻辑

**验收标准**：

- `create-kb` 后 `state/state.db` 存在且表结构正确
- 基础 CRUD 通过单元测试

---

### 0.5 Schema 文件：AGENTS.md 与页面模板

**前置依赖**：0.2

**工作内容**：

1. 编写 `schema/AGENTS.md` 初稿，覆盖方案第 9 节要求的全部 10 项内容
2. 编写页面模板文件：
   - `page_templates/source_summary.md`
   - `page_templates/concept.md`
   - `page_templates/entity.md`
   - `page_templates/topic.md`
   - `page_templates/analysis.md`
3. 每个模板包含标准 frontmatter 和正文骨架
4. 编写 `lint_rules.yaml` 初始版本

**产出物**：

- `schema/AGENTS.md`
- `schema/page_templates/*.md`（5 个模板）
- `schema/lint_rules.yaml`

**验收标准**：

- AGENTS.md 覆盖方案第 9.2 节列出的全部 10 项
- 每个模板 frontmatter 字段与方案第 7.4 节一致
- 模板正文结构与方案第 7.5 / 7.6 节一致

---

### 0.6 模型层抽象

**前置依赖**：0.1, 0.3

**工作内容**：

1. 定义模型抽象接口 `src/kb/llm/base.py`：

   ```python
   class BaseLLM(ABC):
       @abstractmethod
       def complete(self, messages: list[dict], **kwargs) -> str: ...

   class ParserModel(ABC):
       @abstractmethod
       def summarize_source(self, parsed_source: dict) -> dict: ...

   class PlannerModel(ABC):
       @abstractmethod
       def plan_ingest(self, source: dict, wiki_context: dict) -> dict: ...

   class WriterModel(ABC):
       @abstractmethod
       def render_pages(self, patch_plan: dict, wiki_context: dict) -> dict: ...

   class QueryModel(ABC):
       @abstractmethod
       def answer(self, question: str, page_context: dict) -> dict: ...
   ```

2. 实现 `openai_compat.py`：通过 `openai` SDK 调用任何 OpenAI-compatible API
3. 根据 `config.yaml` 中的 `models` 配置动态实例化对应模型

**产出物**：

- `src/kb/llm/base.py`
- `src/kb/llm/openai_compat.py`

**验收标准**：

- 可通过配置切换不同 provider/model
- 单元测试中可用 mock 替代真实 API 调用

---

### 0.7 Git 操作封装

**前置依赖**：0.1

**工作内容**：

1. 实现 `git_ops.py`：
   - `commit(kb_path, message, files)` — 暂存指定文件并提交
   - `revert(kb_path, commit_hash)` — 回滚指定 commit
   - `log(kb_path, n)` — 获取最近 n 条提交
   - `diff(kb_path, commit_hash)` — 获取指定 commit 的 diff

2. Commit message 遵循方案第 13.3 节规范：
   ```
   ingest(src_xxx): ...
   query(saveback): ...
   lint(repair): ...
   ```

**产出物**：

- `src/kb/git_ops.py`

**验收标准**：

- 在测试用临时 Git 仓库中执行 commit / revert / log 通过
- Commit message 格式符合规范

---

## Phase 1：Ingest MVP

> 目标：跑通 source -> parse -> summary -> patch plan -> review -> apply -> index/log 更新 -> git commit 全链路。

### 1.1 Source Manager：登记与去重

**前置依赖**：0.4

**工作内容**：

1. 实现 `source_manager.py`：
   - `register_source(kb_path, input_path_or_url)`:
     - 判断来源类型（local file / URL）
     - 计算 `content_hash`（SHA-256）
     - 查询数据库去重
     - 分配 `source_id`（格式 `src_YYYYMMDD_NNNN`）
     - 复制原件到 `raw/processed/`
     - 写入 `state/manifests/<source_id>.yaml`
     - 在 `sources` 表中插入记录

2. 实现 `kb ingest <path_or_url> --kb <name>` 命令的第一阶段（仅登记）

**产出物**：

- `src/kb/source_manager.py`
- CLI `ingest` 命令（登记部分）

**验收标准**：

- 导入一个本地 Markdown 文件后：
  - `raw/processed/` 下有原件副本
  - `state/manifests/` 下有对应 manifest YAML
  - `sources` 表中有记录
  - `content_hash` 正确
- 重复导入同一文件时，提示已存在，不重复登记

---

### 1.2 Parser：文档解析

**前置依赖**：0.1

**工作内容**：

1. 实现 `parser/markdown.py`：
   - 按 heading 切分 sections
   - 提取 frontmatter（如有）
   - 输出标准中间格式（方案第 7.2 节）

2. 实现 `parser/web.py`：
   - 使用 trafilatura 提取网页正文
   - 下载页面并保存到 `raw/processed/`
   - 输出标准中间格式

3. 实现 `parser/pdf.py`：
   - 使用 pymupdf/pdfplumber 提取文本
   - 按页或按段落切分
   - 输出标准中间格式

4. 统一输出格式：

   ```json
   {
     "source_id": "src_20260407_0001",
     "title": "...",
     "source_type": "markdown|web|pdf",
     "sections": [{"heading": "...", "text": "..."}],
     "full_text": "...",
     "metadata": {"lang": "...", "author": "..."}
   }
   ```

**产出物**：

- `src/kb/parser/markdown.py`
- `src/kb/parser/web.py`
- `src/kb/parser/pdf.py`

**验收标准**：

- Markdown 文件解析后 sections 拆分正确
- 网页 URL 解析后得到正文（不含导航/广告）
- PDF 解析后得到完整文本
- 三种格式输出结构一致

---

### 1.3 Wiki Compiler：Patch Plan 生成

**前置依赖**：1.1, 1.2, 0.6

**工作内容**：

1. 实现 `compiler.py`：
   - `generate_patch_plan(kb_path, source_id)`:
     - 读取 parsed source 内容
     - 读取当前 `wiki/index.md`
     - 读取相关现有页面（通过关键词匹配标题）
     - 调用 PlannerModel 生成 patch plan
     - 返回结构化 patch plan

2. Patch plan 格式（方案第 10.2 节）：

   ```json
   {
     "patch_id": "patch_YYYYMMDD_NNN",
     "source_id": "src_xxx",
     "create": ["wiki/sources/src_xxx.md"],
     "update": ["wiki/index.md", "wiki/log.md", ...],
     "reasoning_summary": ["..."],
     "risk_level": "low|medium|high",
     "requires_review": true|false
   }
   ```

3. 为 PlannerModel 编写 system prompt，约束输出格式

**产出物**：

- `src/kb/compiler.py`
- Planner system prompt 模板

**验收标准**：

- 给定一个 parsed source，能生成格式正确的 patch plan
- patch plan 中 create/update 的文件路径合法
- risk_level 和 requires_review 根据影响范围正确判定

---

### 1.4 Writer：页面内容生成

**前置依赖**：1.3, 0.5

**工作内容**：

1. 在 `compiler.py` 中扩展或新建 writer 逻辑：
   - `render_patch(kb_path, patch_plan)`:
     - 对 `create` 列表中的文件：调用 WriterModel 生成完整页面内容
     - 对 `update` 列表中的文件：读取现有内容，调用 WriterModel 生成更新后内容
     - 输出包含新建文件内容和更新后文件内容的结果

2. 新建页面必须遵循对应模板的 frontmatter 和正文结构
3. `index.md` 更新：在对应分类下追加新条目
4. `log.md` 更新：在文件末尾追加本次操作记录

**产出物**：

- Writer 逻辑（在 `compiler.py` 中）
- Writer system prompt 模板

**验收标准**：

- 生成的 source summary 页面 frontmatter 完整且正确
- index.md 更新后保持分类结构
- log.md 追加的条目格式符合方案第 8.2 节

---

### 1.5 Patch Applier：审核与执行

**前置依赖**：1.4, 0.4, 0.7

**工作内容**：

1. 实现 `patch.py`：
   - `save_patch(kb_path, patch_plan, rendered_content)`:
     - 将 patch plan 保存到 `state/patches/<patch_id>.yaml`
     - 将各文件 diff 保存到 `state/patches/<patch_id>/` 目录
     - 在 `patches` 表中插入记录

   - `apply_patch(kb_path, patch_id)`:
     - 读取 patch 数据
     - 写入新建文件
     - 覆盖更新文件
     - 更新 `pages` 表和 `page_sources` 表
     - 调用 `git_ops.commit()` 提交
     - 更新 patch 状态为 `applied`，记录 `commit_hash`

2. 实现审核判断逻辑：
   - 根据 `config.yaml` 中的 `review` 配置判定是否需要审核
   - 仅更新 source_summary + index + log → 自动通过
   - 影响 concept/topic/analysis → 待审核
   - 修改文件数超过阈值 → 强制审核

3. 实现 CLI 命令：
   - `kb patch list --kb <name>` — 列出 pending patches
   - `kb patch show <patch_id>` — 显示 patch 详情和 diff
   - `kb patch approve <patch_id>` — 标记为 approved
   - `kb patch apply <patch_id>` — 执行 patch

**产出物**：

- `src/kb/patch.py`
- CLI patch 子命令

**验收标准**：

- 低风险 patch 自动 apply 并生成 git commit
- 高风险 patch 进入 pending 状态，需手动 approve 后 apply
- `git log` 可看到规范的 commit message
- patch 元数据保存完整
- 重复 apply 同一 patch 时不产生重复操作

---

### 1.6 Ingest 全链路串联

**前置依赖**：1.1 - 1.5 全部

**工作内容**：

1. 将 `kb ingest` 命令串联完整流程：

   ```
   kb ingest <path_or_url> --kb <name>
     → register source
     → parse
     → generate patch plan
     → render pages
     → 判断是否需要审核
       → 自动通过：立即 apply + commit
       → 需要审核：保存为 pending patch，提示用户
   ```

2. 处理边界情况：
   - 重复 source 的检测与跳过
   - 解析失败的错误处理
   - LLM 调用失败的重试逻辑

3. 编写端到端测试

**产出物**：

- 完整的 `kb ingest` 命令
- 端到端测试用例

**验收标准**（方案第 10.4 节）：

- Ingest 一个 Markdown 文件后：
  - `sources` 表中有记录，status = processed
  - `wiki/sources/` 下有 source summary 页面
  - `index.md` 已更新
  - `log.md` 已追加
  - `git log` 有对应 commit
  - 变更可追溯到 patch 和 commit
- Ingest 同一文件两次不产生重复页面

---

## Phase 2：Query MVP

> 目标：基于现有 Wiki 稳定回答问题，并给出导航建议。

### 2.1 Index 读取与页面定位

**前置依赖**：Phase 1 完成（需要有 Wiki 内容可查询）

**工作内容**：

1. 实现 `query.py` 中的页面定位逻辑：
   - 解析 `index.md`，提取所有页面链接和分类信息
   - 根据用户问题，从 index 中筛选候选页面
   - 支持两种定位策略：
     - 关键词匹配（从问题中提取关键词，匹配 index 条目）
     - LLM 辅助选择（将问题和 index 内容交给模型判断）

**产出物**：

- `src/kb/query.py` 中的页面定位部分

**验收标准**：

- 给定一个问题，能返回相关页面路径列表
- 优先从 index 导航，不直接遍历文件系统

---

### 2.2 页面读取与答案合成

**前置依赖**：2.1, 0.6

**工作内容**：

1. 实现 query 核心流程：
   - 读取定位到的页面内容
   - 将页面内容 + 问题交给 QueryModel
   - 输出结构化回答：

     ```markdown
     ## Answer
     <结论>

     ## Sources Used
     - [[concepts/transformer]] — Transformer 架构概念页
     - [[topics/attention]] — Attention 相关主题页

     ## Gaps & Conflicts
     - 当前知识库中缺少关于 ... 的内容

     ## Suggested Reading
     - [[topics/xxx]]
     - [[analyses/yyy]]
     ```

2. 为 QueryModel 编写 system prompt，强制要求：
   - 优先基于 Wiki 页面回答
   - 标注引用了哪些页面
   - 指出知识空白

**产出物**：

- `src/kb/query.py` 完整实现
- Query system prompt 模板

**验收标准**（方案第 11.4 节）：

- 回答基于 Wiki 页面内容
- 回答中包含引用页面列表
- 能发现知识空白并给出建议

---

### 2.3 Save-back 提案

**前置依赖**：2.2

**工作内容**：

1. 在 query 流程末尾增加回写判断：
   - 让 LLM 评估回答是否具备长期价值
   - 如果是，生成 save-back proposal：

     ```yaml
     save_back_proposal:
       suggested_page_type: analysis
       suggested_path: wiki/analyses/xxx.md
       reason: ...
       requires_user_confirmation: true
     ```

2. 实现 `kb save-answer <answer_id> --as <page_type> --kb <name>` 命令：
   - 将回答内容转换为对应模板格式
   - 生成 patch plan
   - 走正常的 patch 审核与应用流程

**产出物**：

- Save-back 提案逻辑
- `kb save-answer` 命令

**验收标准**：

- 高价值回答能触发保存提案
- 用户确认后回答被正确回写为 Wiki 页面
- 回写走 patch 流程，有 commit 记录

---

### 2.4 Query CLI 命令

**前置依赖**：2.1 - 2.3

**工作内容**：

1. 实现 `kb query "<question>" --kb <name>` 完整命令：
   - 输出结构化 Markdown 回答到终端
   - 如果有 save-back 提案，提示用户是否保存
   - 记录 query 到 `log.md`

**产出物**：

- 完整的 `kb query` 命令

**验收标准**：

- 命令行可交互式提问
- 回答格式清晰可读
- `log.md` 记录了 query 操作

---

## Phase 3：Lint MVP

> 目标：让 Wiki 具备基本的健康检查能力。

### 3.1 Lint 检查项实现

**前置依赖**：Phase 1 完成

**工作内容**：

1. 实现 `lint.py` 中的各项检查（方案第 12.2 节）：

   - **坏链接检测**：扫描所有页面中的 `[[...]]` 链接，检查目标文件是否存在
   - **孤儿页检测**：找出没有被任何其他页面链接的页面
   - **未收录页面检测**：找出存在于文件系统但未出现在 `index.md` 中的页面
   - **Source 缺失检测**：找出 frontmatter 中未声明 `source_ids` 的页面
   - **页面空壳检测**：找出正文内容少于阈值（如 50 字）的页面
   - **长期未更新检测**（可选）：找出 `updated_at` 超过 N 天的页面

**产出物**：

- `src/kb/lint.py` 中各检查函数

**验收标准**：

- 每项检查能正确识别问题
- 单元测试覆盖正常和异常情况

---

### 3.2 Lint 报告生成

**前置依赖**：3.1

**工作内容**：

1. 实现报告生成：
   - 输出 Markdown 报告到 `wiki/reports/lint-YYYYMMDD.md`
   - 输出 JSON 结果到 `state/runs/lint-YYYYMMDD.json`
   - 报告格式遵循方案第 12.3 节
   - 在 `runs` 表中记录本次 lint 运行

2. 实现 `kb lint --kb <name>` 命令
3. 支持 `kb lint --kb all` 扫描所有 kb

**产出物**：

- Lint 报告生成逻辑
- `kb lint` 命令

**验收标准**：

- 报告文件正确生成
- 报告内容准确反映知识库健康状况
- 运行记录写入数据库

---

### 3.3 Rebuild Index 命令

**前置依赖**：Phase 1 完成

**工作内容**：

1. 实现 `kb rebuild-index --kb <name>`：
   - 扫描 `wiki/` 下所有页面文件
   - 读取每个页面的 frontmatter
   - 重新生成 `index.md`，按 page_type 分类
   - 同步更新 `pages` 表

**产出物**：

- `kb rebuild-index` 命令

**验收标准**：

- 重建后 index.md 包含所有现有页面
- 分类正确
- 与数据库记录一致

---

## Phase 4：增强与演进

> 目标：在 MVP 稳定运行后逐步增强能力。以下为候选任务，根据实际使用反馈确定优先级。

### 4.1 SQLite FTS 全文检索

**工作内容**：

- 在 SQLite 中创建 FTS5 虚拟表
- Ingest/Update 时同步更新 FTS 索引
- Query 时先走 FTS 缩小候选范围，再交给 LLM 精筛

---

### 4.2 Lint 自动修复 Patch

**工作内容**：

- Lint 检测出问题后，自动生成 repair patch plan
- 走标准 patch 审核流程
- 支持 `kb lint --fix --kb <name>`

---

### 4.3 多 KB 全局搜索

**工作内容**：

- 支持 `kb query "..." --kb all` 跨知识域查询
- 合并多个 kb 的 index 信息

---

### 4.4 Obsidian 兼容优化

**工作内容**：

- 确保 `[[wikilink]]` 格式与 Obsidian 兼容
- 生成 `.obsidian/` 配置文件模板
- 支持 Obsidian 侧边栏导航

---

### 4.5 更细粒度的 Provenance

**工作内容**：

- 页面中的关键声明标注 `source_id` + section 引用
- 扩展 `page_sources` 表增加 claim 级别映射

---

## 开发顺序总结

```
第一轮：Phase 0（基础设施）
  0.1 项目结构
  0.3 配置系统       ← 与 0.1 并行之后的工作
  0.7 Git 封装       ← 与 0.3 并行
  0.4 SQLite 数据库  ← 与 0.3 并行
  0.6 模型层抽象     ← 依赖 0.1, 0.3
  0.2 Workspace 初始化 ← 依赖 0.1
  0.5 Schema 文件     ← 依赖 0.2

第二轮：Phase 1（Ingest）
  1.1 Source Manager  ← 依赖 0.4
  1.2 Parser          ← 可与 1.1 并行
  1.3 Compiler        ← 依赖 1.1, 1.2, 0.6
  1.4 Writer          ← 依赖 1.3, 0.5
  1.5 Patch Applier   ← 依赖 1.4, 0.4, 0.7
  1.6 Ingest 串联     ← 依赖 1.1-1.5

第三轮：Phase 2 + Phase 3（可并行）
  2.1-2.4 Query MVP   ← 依赖 Phase 1
  3.1-3.3 Lint MVP     ← 依赖 Phase 1（可与 Phase 2 并行）

第四轮：Phase 4（按需）
```

---

## 附录：关键文件清单

| 文件 | 所属 Phase | 用途 |
|------|-----------|------|
| `pyproject.toml` | 0.1 | 项目配置与依赖 |
| `src/kb/cli.py` | 0.1 | CLI 入口，所有命令定义 |
| `src/kb/config.py` | 0.3 | 配置加载与校验 |
| `src/kb/db.py` | 0.4 | SQLite 封装 |
| `src/kb/git_ops.py` | 0.7 | Git 操作封装 |
| `src/kb/models.py` | 0.1 | 数据模型定义 |
| `src/kb/llm/base.py` | 0.6 | 模型抽象接口 |
| `src/kb/llm/openai_compat.py` | 0.6 | OpenAI 适配器 |
| `src/kb/source_manager.py` | 1.1 | Source 登记与去重 |
| `src/kb/parser/markdown.py` | 1.2 | Markdown 解析 |
| `src/kb/parser/web.py` | 1.2 | 网页解析 |
| `src/kb/parser/pdf.py` | 1.2 | PDF 解析 |
| `src/kb/compiler.py` | 1.3-1.4 | Patch Plan 生成 + 页面渲染 |
| `src/kb/patch.py` | 1.5 | Patch 审核与应用 |
| `src/kb/query.py` | 2.1-2.3 | Query Engine |
| `src/kb/lint.py` | 3.1-3.2 | Lint Engine |
