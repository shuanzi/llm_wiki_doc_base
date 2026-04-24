# llm_doc_base 迭代改动交接文档

生成日期：2026-04-23  
适用对象：本地 Codex / 后续开发者  
基准：`llm_doc_base-main.zip` 原始项目 + 两份 patch

- Phase 1 + Phase 2 patch：`llm_doc_base_phase1_phase2_git.patch`
- Phase 3 搜索增强 patch：`llm_doc_base_phase3_search_git.patch`

> 本文档用于帮助本地 Codex 继续修改代码。它不是 patch 本身；实际修改仍以两份 patch 为准。

---

## 1. 应用顺序

```bash
cd llm_doc_base-main

# 第一轮：多格式导入 + YAML frontmatter parser
git apply llm_doc_base_phase1_phase2_git.patch

# 第二轮：kb_search_wiki 多后端搜索增强
git apply llm_doc_base_phase3_search_git.patch
```

建议应用后立即检查：

```bash
git diff --check
npm install
npm run typecheck
npm run build
```

可单独跑新增测试：

```bash
node --test -r ts-node/register tests/frontmatter.test.ts
node --test -r ts-node/register tests/source-registry.test.ts
node --test -r ts-node/register tests/wiki-search.test.ts
```

如本地使用全局 TypeScript / ts-node，可按本机环境调整 `node --test -r ...` 命令。

---

## 2. 整体改动摘要

两轮 patch 合并后，项目主要变更为：

1. `kb_source_add` 从 `.md/.txt only` 升级为“本地文件 → canonical Markdown → 现有 ingest 流程”。
2. 非 Markdown 文件通过 Microsoft MarkItDown 转换为 Markdown；明确排除 ZIP、OCR / 图片、音频转录、Outlook、YouTube URL、plugins。
3. Manifest 扩展，记录原始文件、转换文件、converter metadata，同时保持旧 manifest 兼容。
4. `kb_read_source` 支持 byte pagination，避免长 PDF / DOCX / PPTX 转换后被 200KB 默认窗口截断。
5. Frontmatter parser 从自研 `parseSimpleYaml` 替换为 `yaml` 包，增加完整 YAML 解析、稳定序列化和更强 validation。
6. `kb_run_lint` 对 YAML parse error 以 lint issue 形式报告，而不是直接崩溃。
7. `kb_search_wiki` 支持 `auto | index | rg | bm25 | qmd` 多模式搜索。
8. 新增内置 BM25 cache，可在无外部工具时提供全文排序检索。
9. 新增 ripgrep 精确搜索后端和 QMD optional adapter。
10. 新增 MCP tools：`kb_search_index_status`、`kb_search_rebuild_index`。
11. 写入 wiki 页面、更新 section、ensure entry、rebuild page-index 后会标记搜索索引 stale。
12. `kb_ensure_entry` 修改 `index.md` / `log.md` 后会刷新 `page-index.json` 对应 entry。
13. `tsconfig.json` 最终改为 `module: "Node16"`、`moduleResolution: "node16"`。

---

## 3. 外部依赖与环境变量

### 3.1 npm dependency

第一轮 patch 新增：

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "1.29.0",
  "yaml": "^2.8.3"
}
```

用途：

- `yaml`：替换轻量 frontmatter parser。

### 3.2 MarkItDown 运行环境

MarkItDown 未作为 npm 依赖引入；它通过 Node 的 `child_process.spawnSync()` 调 Python API。

建议本地安装：

```bash
python3 -m pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'
```

不要直接安装 / 启用不需要的能力，尤其不要在项目内开放 ZIP、OCR、音频转录、Outlook、YouTube 转录、plugins。

相关环境变量：

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `MARKITDOWN_PYTHON` | 自动尝试 `python3/python` 或 Windows 的 `python/py` | 指定 Python 可执行文件 |
| `MARKITDOWN_TIMEOUT_MS` | `120000` | 单个文件转换超时 |
| `MARKITDOWN_MAX_STDIO_BYTES` | `10485760` | Python 子进程 stdout/stderr buffer 上限 |

### 3.3 ripgrep 环境

ripgrep 是 optional backend，不安装时：

- `mode: "rg"` 会报 backend unavailable。
- `mode: "auto"` 会 fallback 到 BM25。

相关环境变量：

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `RG_BIN` | `rg` | ripgrep 可执行文件 |
| `RG_TIMEOUT_MS` | `10000` | 单次 rg 查询超时 |

### 3.4 QMD 环境

QMD 是 optional backend，不作为项目强依赖。

相关环境变量：

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `QMD_BIN` | `qmd` | QMD CLI 可执行文件 |
| `QMD_INDEX_NAME` | `llm_doc_base_<kb_root_hash_8>` | QMD index 名称 |
| `QMD_COLLECTION_NAME` | `llm_doc_base_wiki` | QMD collection 名称 |
| `QMD_SEARCH_COMMAND` | `query` | 支持 `query | search | vsearch` |
| `QMD_TIMEOUT_MS` | `30000` | QMD CLI 调用超时 |

---

## 4. Phase 1：知识库文档导入支持更多格式

### 4.1 新增核心文件

新增：

```text
src/core/source-conversion.ts
```

职责：

1. 校验输入 source 文件。
2. 判断扩展名是否支持。
3. Markdown 文件 passthrough。
4. `.txt` 文件 plaintext passthrough，写成 canonical Markdown。
5. 其他支持格式调用 MarkItDown Python API 转 Markdown。
6. 统一返回 `SourceConversionResult`。

### 4.2 支持格式

当前实现中的支持集合：

```ts
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const PLAINTEXT_EXTENSIONS = new Set([".txt"]);
const MARKITDOWN_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".csv",
  ".json",
  ".xml",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xls",
  ".epub",
]);
```

明确拒绝：

```ts
.zip, .msg, .eml,
.mp3, .wav, .m4a, .flac, .ogg, .aac, .wma, .aiff,
.jpg, .jpeg, .png, .gif, .bmp, .tif, .tiff, .webp, .heic, .svg
```

拒绝原因分别对应：

- ZIP archives intentionally not supported
- Outlook / Email intentionally not supported
- Audio transcription intentionally not supported
- Image OCR intentionally not supported

### 4.3 输入安全边界

`validateSourceFile(filePath)` 增加以下检查：

- `file_path` 必填且非空。
- 不接受 URL-like 输入，例如 `https://...`。
- 路径 resolve 为本地绝对路径。
- 文件必须存在。
- 不接受 symlink。
- 必须是 regular file，拒绝目录 / 特殊文件。
- 扩展名必须在支持列表内。

### 4.4 MarkItDown 调用方式

Node 侧调用 Python：

```ts
spawnSync(python, ["-c", script, inputPath, outputPath, versionPath], ...)
```

Python 脚本核心逻辑：

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False)
if hasattr(md, "convert_local"):
    result = md.convert_local(input_path)
else:
    result = md.convert(input_path)
```

输出写入临时目录下的 `output.md`，转换完成后 Node 读取该文件。临时目录最后会 `fs.rmSync(..., { recursive: true, force: true })` 清理。

### 4.5 转换失败处理

会抛出明确错误：

- Python 不存在。
- MarkItDown 未安装。
- 对应 optional extra 未安装。
- MarkItDown 进程非零退出。
- MarkItDown 没有生成 output file。
- 转换结果为空。

空结果错误会提示：

```text
The file may contain only scanned images or otherwise unsupported content. OCR is disabled.
```

### 4.6 `source-registry.ts` 改动

改造文件：

```text
src/core/source-registry.ts
```

核心变化：

1. 注册前先 `validateSourceFile()`。
2. 基于原始文件 bytes 计算 `originalContentHashFull`。
3. `source_id` 基于原始文件 hash，而非转换后的 Markdown hash。
4. duplicate detection 同时比较：
   - `manifest.content_hash`
   - `manifest.original_content_hash`
5. canonical Markdown 固定写入：

```text
kb/raw/inbox/{source_id}.md
```

6. 非 Markdown 原始文件写入：

```text
kb/raw/originals/{source_id}{original_extension}
```

7. Manifest 写入：

```text
kb/state/manifests/{source_id}.json
```

### 4.7 Manifest 类型扩展

`src/types/index.ts` 中：

```ts
export type SourceKind = "markdown" | "plaintext" | "converted_markdown";

export interface SourceConversionMetadata {
  required: boolean;
  converter: "none" | "plaintext" | "markitdown";
  converter_version?: string;
  disabled_features: string[];
  warnings?: string[];
}
```

`Manifest` 新增字段：

```ts
original_path?: string;
original_file_name?: string;
original_extension?: string;
original_content_hash?: string;
converted_path?: string;
converted_content_hash?: string;
conversion?: SourceConversionMetadata;
```

保留字段：

```ts
source_id
source_locator
source_kind
content_hash
canonical_path
file_name
ingest_status
created_at
```

注意：`content_hash` 现在语义为“原始文件 bytes hash”，用于 source identity 稳定性。

### 4.8 `kb_source_add` 输出变化

`src/tools/kb_source_add.ts` 的实现主体仍是包装 `registerSourceFile()`，但返回的 `data` 里包含扩展后的 `manifest`。

MCP description 更新为：

```text
Register a supported local source file into the knowledge base. Markdown is preserved; other supported formats are converted to canonical Markdown via MarkItDown. ZIP, OCR/images, audio transcription, Outlook, YouTube URLs, and plugins are disabled.
```

### 4.9 `kb_read_source` 分页增强

改造文件：

```text
src/core/source-registry.ts
src/tools/kb_read_source.ts
src/mcp_server.ts
```

新增输入：

```ts
offset_bytes?: number;
max_bytes?: number;
```

默认：

```ts
MAX_SOURCE_CONTENT_BYTES = 200 * 1024;
offset_bytes = 0;
max_bytes = 204800;
```

新增输出字段：

```ts
offset_bytes: number;
returned_bytes: number;
total_bytes: number;
truncated: boolean;
next_offset_bytes?: number;
warning?: string;
```

兼容行为：不传分页参数时，仍只返回第一个 200KB 窗口。

注意：当前实现按 byte slice 后 `toString("utf8")`。如果 offset 落在多字节 UTF-8 字符中间，理论上可能出现替换字符。后续可考虑按 UTF-8 boundary 对齐。

### 4.10 Phase 1 新增测试

新增：

```text
tests/source-registry.test.ts
```

覆盖重点：

- Markdown 注册仍走 canonical `.md`。
- plaintext 注册走 passthrough。
- 非 Markdown 格式逻辑可通过 stub / mock 覆盖。
- 明确拒绝不支持的扩展或 URL-like 输入。
- Manifest 字段符合扩展后结构。
- `kb_read_source` 分页行为。

---

## 5. Phase 2：Frontmatter YAML parser 替换

### 5.1 改造文件

```text
src/utils/frontmatter.ts
src/core/wiki-maintenance.ts
package.json
package-lock.json
tests/frontmatter.test.ts
```

### 5.2 Parser 行为

旧实现 `parseSimpleYaml` 被替换。

新行为：

1. 支持 BOM 清理。
2. 只识别文件开头的独立 `---` 行作为 frontmatter opening delimiter。
3. closing delimiter 必须是独立 `---` 行。
4. 支持 `\n` / `\r\n`。
5. YAML block 使用 `yaml.parseDocument()` 解析。
6. YAML root 必须是 mapping / object。
7. YAML parse errors 和 warnings 都作为 invalid frontmatter error 抛出。
8. 如果没有合法 frontmatter block，返回：

```ts
{ frontmatter: {}, body: content }
```

### 5.3 Serializer 行为

`serializeFrontmatter()` 会先稳定排序字段。

固定顺序：

```text
id
type
title
updated_at
status
tags
aliases
source_ids
related
```

其他字段按 key 字母序追加。

序列化使用：

```ts
stringifyYaml(ordered, {
  lineWidth: 0,
  sortMapEntries: false,
})
```

### 5.4 Validation 增强

`validateFrontmatter()` 现在检查：

- `id/type/title/updated_at/status` 必须是非空 string。
- `id` 必须匹配 `^[a-z0-9_-]+$`。
- `updated_at` 必须是合法日期，格式为 `YYYY-MM-DD`。
- `status` 只能是 `active | stub | deprecated`。
- `tags/aliases/source_ids/related` 必须是 string array。
- unknown page type 仍是 warning，不是 error。

### 5.5 Lint 行为

`src/core/wiki-maintenance.ts` 中的 `scanWikiPages()` 捕获 `parseFrontmatter()` 错误，并将其转化为：

```text
rule: invalid-frontmatter
severity: error
```

这样 malformed YAML 不会导致 `kb_run_lint` 整体崩溃。

### 5.6 Phase 2 测试

扩展：

```text
tests/frontmatter.test.ts
```

覆盖重点：

- quoted comma，例如 `aliases: ["ACME, Inc."]`
- colon in string
- YAML comments
- multiline array
- block scalar
- malformed YAML error
- 正文中的 `---` 不应截断 frontmatter
- serialize / parse roundtrip
- validation 对日期、数组、status 的检查

---

## 6. Phase 3：`kb_search_wiki` 多后端搜索增强

### 6.1 改造范围

主要文件：

```text
src/core/wiki-search.ts
src/tools/kb_search_index_status.ts
src/tools/kb_search_rebuild_index.ts
src/mcp_server.ts
src/types/index.ts
src/core/wiki-pages.ts
src/core/wiki-log.ts
src/core/wiki-maintenance.ts
README.md
docs/technical.md
src/openclaw-installer/mcp-probe.ts
src/openclaw-installer/workspace-docs.ts
tests/wiki-search.test.ts
```

### 6.2 Search 类型扩展

`src/types/index.ts` 新增：

```ts
export type SearchBackend = "index" | "rg" | "bm25" | "qmd";
export type SearchMode = "auto" | SearchBackend;
```

`SearchResult` 新增可选字段：

```ts
backend?: SearchBackend | "wikilink";
match_kind?: "wikilink" | "page" | "line" | "document";
line_number?: number;
highlights?: string[];
```

`SearchQuery` 新增：

```ts
query?: string;
mode?: SearchMode;
include_body?: boolean;
refresh_index?: boolean;
```

并保留：

```ts
resolve_link?: string;
type_filter?: string;
tags?: string[];
limit?: number;
```

### 6.3 `kb_search_wiki` schema 修正

MCP schema 由“必须传 query”改为二选一：

```json
"anyOf": [
  { "required": ["query"] },
  { "required": ["resolve_link"] }
]
```

因此可以直接调用：

```json
{ "resolve_link": "[[Foo]]" }
```

无需再传空 query。

### 6.4 搜索模式

`kb_search_wiki` 支持：

| mode | 行为 |
|---|---|
| `auto` | 默认模式；精确/path-like 查询优先 rg；QMD 可用且 fresh 时用 QMD；否则 BM25 |
| `index` | 旧版 page-index 搜索；仅 title/alias/tag/headings/body_excerpt |
| `rg` | ripgrep 精确行级搜索 |
| `bm25` | 内置 BM25 全文检索 |
| `qmd` | QMD optional adapter |

`resolve_link` 优先级最高；只要传了 `resolve_link`，忽略 mode/query，走 `resolveWikiLink()`。

### 6.5 `auto` 路由逻辑

`preferRg(query)` 判断以下情况优先走 rg：

- `[[wikilink]]`
- `src_sha256_<hash>`
- `.md` 文件名
- 包含 `/` 的 path-like 查询
- 双引号包裹的精确短语

否则：

1. 如果 QMD 可用且 state 中 `qmd.stale === false`，尝试 QMD。
2. QMD 没结果或失败，fallback 到 BM25。
3. QMD 不可用，直接 BM25。

### 6.6 内置 BM25 cache

新增 cache 文件：

```text
kb/state/cache/search-bm25.json
kb/state/cache/search-index-state.json
```

BM25 index 结构内部定义为：

```ts
type Bm25Index = {
  version: number;
  generated_at: string;
  corpus_hash: string;
  docs: Bm25Doc[];
  df: Record<string, number>;
  avgdl: number;
};
```

`Bm25Doc` 字段：

```ts
page_id
path
title
type
aliases
tags
headings
length
fields: {
  title
  aliases
  tags
  headings
  body
}
```

字段权重：

```ts
title: 4
aliases: 3
tags: 2.5
headings: 2
body: 1
```

参数：

```ts
k1 = 1.2
b = 0.75
```

补充分数：

- title exact match：`+5`
- title includes phrase：`+2`

分词：

- NFKC normalize
- lowercase
- 保留 Unicode letter / number / `_` / `-`
- 清理 Markdown 符号
- CJK token 会额外生成 bigram

BM25 查询时：

- 如果 cache 缺失、corpus hash 不一致、或 state 标记 stale，会自动 rebuild。
- `refresh_index: true` 会强制 rebuild。

### 6.7 corpus hash

`corpusHash(workspace)` 对 `kb/wiki/**/*.md` 的相对路径和文件内容进行 SHA-256 计算。

用途：

- 判断 BM25 cache 是否过期。
- 判断 QMD index state 是否过期。
- `kb_search_index_status` 展示当前 corpus 状态。

### 6.8 ripgrep backend

`searchRg()` 调用：

```bash
rg --json --smart-case --fixed-strings --glob '**/*.md' -e <query> .
```

`cwd` 被限定为：

```text
kb/wiki
```

返回结果按 page 聚合：

- `backend: "rg"`
- `match_kind: "line"`
- `line_number`
- `highlights`
- `excerpt` 为若干匹配行，例如：

```text
L42: matched line content
```

注意：当前使用 `--fixed-strings`，所以 `rg` 后端不是 regex 搜索。后续如要支持 regex，需要新增参数并做安全限制。

### 6.9 QMD backend

`rebuildQmd()` 逻辑：

```bash
qmd --index <indexName> collection add <kb/wiki> --name <collectionName> --mask '**/*.md'
qmd --index <indexName> update
```

`searchQmd()` 逻辑：

```bash
qmd --index <indexName> <QMD_SEARCH_COMMAND> --json -n <limit> <query>
```

默认搜索命令：

```text
query
```

QMD result parser 兼容以下顶层数组字段：

```text
results
matches
documents
items
```

记录字段兼容：

```text
path / filepath / file / filename / document / id
title
score / rerankScore / rerank_score / similarity
snippet / text / excerpt / content / body
```

QMD mode 行为：

- `mode: "qmd"`：QMD 不可用会直接返回错误。
- `mode: "qmd"` 且 state stale：要求运行 `kb_search_rebuild_index({ backend: "qmd" })` 或传 `refresh_index: true`。
- `mode: "auto"`：QMD 不可用 / stale / failed 时 fallback 到 BM25。

注意：QMD CLI 版本和 JSON 输出 shape 可能变化；本地应重点做一次真实 QMD E2E。

### 6.10 新增 MCP tools

新增文件：

```text
src/tools/kb_search_index_status.ts
src/tools/kb_search_rebuild_index.ts
```

#### `kb_search_index_status`

输入：空对象。

输出类型：`SearchIndexStatus`。

返回内容包括：

```ts
generated_at
corpus_hash
page_index: { pages }
ripgrep: { available, bin, error? }
bm25: { exists, stale, path, docs, generated_at?, corpus_hash?, last_error? }
qmd: { available, stale, bin, index_name, collection_name, last_rebuild_at?, corpus_hash?, last_error? }
```

#### `kb_search_rebuild_index`

输入：

```ts
backend?: "bm25" | "qmd" | "all";
```

默认：

```ts
backend = "all"
```

行为：

- `bm25`：构建 / 覆盖 `kb/state/cache/search-bm25.json`。
- `qmd`：调用 QMD collection add + update。
- `all`：先 BM25，再 QMD；QMD 不可用时不会阻断 BM25 rebuild。

### 6.11 stale marking

以下写操作会标记 search index stale：

```text
writeWikiPage()
updateWikiSection()
ensureWikiEntry()
rebuildPageIndex()
```

标记函数：

```ts
markSearchIndexesStale(workspace, reason)
```

state 文件：

```text
kb/state/cache/search-index-state.json
```

会记录：

```ts
last_mutation_at
last_mutation_reason
bm25.stale = true
qmd.stale = true
```

### 6.12 `kb_ensure_entry` 索引一致性修复

`src/core/wiki-pages.ts` 新增：

```ts
refreshPageIndexEntryForPath(targetPath, workspace)
```

`src/core/wiki-log.ts` 中 `ensureWikiEntry()` 写入文件后调用：

```ts
refreshPageIndexEntryForPath(resolvedPath.relativePath, workspace);
markSearchIndexesStale(workspace, `ensure entry ${resolvedPath.relativePath}`);
```

这修复了之前 `kb_ensure_entry` 修改 `index.md` / `log.md` 后 `page-index.json` 不刷新的问题。

### 6.13 文档 / installer 同步

同步更新：

```text
README.md
docs/technical.md
src/openclaw-installer/mcp-probe.ts
src/openclaw-installer/workspace-docs.ts
```

工具数量由 11 更新为 13。

新增工具：

```text
kb_search_index_status
kb_search_rebuild_index
```

---

## 7. 文件级变更清单

### 7.1 Phase 1 + Phase 2 patch

| 文件 | 变更 |
|---|---|
| `package.json` / `package-lock.json` | 新增 `yaml` dependency |
| `src/core/source-conversion.ts` | 新增；负责 source file 校验和 MarkItDown 转换 |
| `src/core/source-registry.ts` | 注册流程改为 canonical Markdown；扩展 manifest；支持分页读取 |
| `src/core/wiki-maintenance.ts` | lint 捕获 frontmatter parse error |
| `src/mcp_server.ts` | 更新 `kb_source_add` / `kb_read_source` schema 和说明 |
| `src/tools/kb_read_source.ts` | 接收分页参数 |
| `src/tools/kb_source_add.ts` | 工具说明配合多格式导入 |
| `src/types/index.ts` | 扩展 `SourceKind` / `Manifest` |
| `src/utils/frontmatter.ts` | 用 `yaml` 重写 parser / serializer / validation |
| `src/utils/hash.ts` | 新增 buffer hash 工具 |
| `src/utils/index.ts` | 导出新增 hash 工具 |
| `tests/frontmatter.test.ts` | 扩展 YAML parser 测试 |
| `tests/source-registry.test.ts` | 新增 source registry 测试 |
| `tsconfig.json` | 第一轮先将 `moduleResolution` 从 `bundler` 调整为 `node` |

Patch 统计：

```text
15 files changed, 939 insertions(+), 179 deletions(-)
```

### 7.2 Phase 3 patch

| 文件 | 变更 |
|---|---|
| `README.md` | 工具数量 11 → 13；搜索说明更新 |
| `docs/technical.md` | 搜索后端和 cache 说明更新 |
| `src/core/wiki-log.ts` | ensure entry 后刷新 page-index，标记 search stale |
| `src/core/wiki-maintenance.ts` | rebuild page-index 后标记 search stale |
| `src/core/wiki-pages.ts` | 新增 `refreshPageIndexEntryForPath()`；写入 / section update 后标记 stale |
| `src/core/wiki-search.ts` | 核心搜索增强：index / rg / bm25 / qmd / auto；status / rebuild |
| `src/mcp_server.ts` | 新增两个 MCP tools；更新 search schema |
| `src/openclaw-installer/mcp-probe.ts` | 工具数量同步 |
| `src/openclaw-installer/workspace-docs.ts` | 工具说明同步 |
| `src/tools/kb_search_index_status.ts` | 新增 search index status 工具 |
| `src/tools/kb_search_rebuild_index.ts` | 新增 search index rebuild 工具 |
| `src/types/index.ts` | 扩展 Search 类型 |
| `tests/wiki-search.test.ts` | 新增搜索测试 |
| `tsconfig.json` | 最终改为 `module: Node16` / `moduleResolution: node16` |

Patch 统计：

```text
14 files changed, 831 insertions(+), 79 deletions(-)
```

---

## 8. MCP tools 最终列表

Workflow tools：

1. `kb_source_add`
2. `kb_read_source`
3. `kb_write_page`
4. `kb_update_section`
5. `kb_ensure_entry`
6. `kb_search_wiki`
7. `kb_read_page`
8. `kb_commit`

Maintenance tools：

9. `kb_rebuild_index`
10. `kb_run_lint`
11. `kb_search_index_status`
12. `kb_search_rebuild_index`
13. `kb_repair`

---

## 9. 建议本地验收流程

### 9.1 基础构建

```bash
npm install
npm run typecheck
npm run build
```

### 9.2 Frontmatter 测试

```bash
node --test -r ts-node/register tests/frontmatter.test.ts
```

重点确认：

- quoted string / comments / multiline array / block scalar 通过。
- malformed YAML 报错。
- serialize / parse roundtrip 稳定。

### 9.3 Source registry 测试

```bash
node --test -r ts-node/register tests/source-registry.test.ts
```

重点确认：

- Markdown passthrough。
- plaintext passthrough。
- unsupported extension 拒绝。
- manifest 扩展字段正确。
- read source pagination 正确。

### 9.4 MarkItDown 手工 smoke test

准备一个简单 HTML：

```bash
cat > /tmp/kb-test.html <<'HTML'
<h1>Hello</h1>
<p>This is a test.</p>
HTML
```

通过 MCP 或直接调用工具注册，确认：

- `kb_source_add` 成功。
- `raw/originals/{source_id}.html` 存在。
- `raw/inbox/{source_id}.md` 存在。
- manifest 中：
  - `source_kind = converted_markdown`
  - `conversion.converter = markitdown`
  - `conversion.disabled_features` 包含 disabled list。

### 9.5 搜索测试

```bash
node --test -r ts-node/register tests/wiki-search.test.ts
```

如本机没有安装 `rg`，ripgrep 相关测试应 skip 或走 unavailable path。

### 9.6 BM25 手工验证

通过 MCP：

```json
{
  "tool": "kb_search_rebuild_index",
  "arguments": { "backend": "bm25" }
}
```

再查：

```json
{
  "tool": "kb_search_wiki",
  "arguments": {
    "query": "knowledge graph",
    "mode": "bm25",
    "limit": 5
  }
}
```

确认返回结果包含：

```text
backend: bm25
match_kind: document
score > 0
```

### 9.7 ripgrep 手工验证

安装 ripgrep 后：

```json
{
  "tool": "kb_search_wiki",
  "arguments": {
    "query": "src_sha256_",
    "mode": "rg",
    "limit": 5
  }
}
```

确认返回：

```text
backend: rg
match_kind: line
line_number
```

### 9.8 QMD 手工验证

如果本地安装了 QMD：

```json
{
  "tool": "kb_search_rebuild_index",
  "arguments": { "backend": "qmd" }
}
```

然后：

```json
{
  "tool": "kb_search_wiki",
  "arguments": {
    "query": "项目原始 idea 中关于持续维护知识库的设计",
    "mode": "qmd",
    "limit": 5
  }
}
```

确认返回：

```text
backend: qmd
match_kind: document
```

如 QMD CLI 真实参数和当前 adapter 有差异，优先修改：

```text
src/core/wiki-search.ts -> rebuildQmd()
src/core/wiki-search.ts -> searchQmd()
src/core/wiki-search.ts -> recordsFromJson() / strField() / numField()
```

---

## 10. 已知限制 / 后续 Codex 修改建议

### 10.1 MarkItDown 集成

建议 Codex 后续检查：

1. Python 环境不存在时的错误是否足够友好。
2. 不同 OS 上 `python3/python/py` 候选顺序是否合理。
3. 对 PDF scanned-only 的错误提示是否符合用户预期。
4. 是否需要为 MarkItDown 增加 integration test gate，例如：

```bash
RUN_MARKITDOWN_INTEGRATION=1 npm test
```

5. 是否需要显式记录 MarkItDown input file size 限制，避免超大文件阻塞 MCP。

### 10.2 `kb_read_source` byte pagination

当前按 bytes 截取 Markdown，再 `toString("utf8")`。

后续可优化：

- offset/end 自动对齐 UTF-8 边界。
- 或改为 character pagination。
- 或返回 base64 / raw bytes metadata，但这对 LLM ingest 不友好。

### 10.3 YAML parser

当前策略：YAML warnings 也被当成 invalid frontmatter error。

可由 Codex 评估是否放宽：

- parse errors：blocking error。
- warnings：lint warning，但不阻断写入。

### 10.4 BM25 分词

当前分词是轻量实现。

可优化：

- CJK token 改为 unigram + bigram 组合权重。
- 加入 stopwords。
- 保留 page_id/source_id/path token 的特殊权重。
- 对 wikilinks `[[target|label]]` 同时索引 target 和 label。
- 对 code block 内 token 降权，而不是直接清除。

### 10.5 QMD adapter

QMD 是最需要本地真实验证的部分。

Codex 后续重点：

1. 校验 `qmd collection add` 是否幂等；如果重复 add 会失败，应改为先 list / remove / update。
2. 校验 `--mask '**/*.md'` 参数是否符合当前 QMD 版本。
3. 校验 `qmd query --json -n <limit> <query>` 输出 shape。
4. 如果 QMD 输出 chunk-level path + offsets，应把多个 chunk 聚合为同一 page。
5. 如 QMD 支持 collection scope，搜索命令应限定 collection，避免 index 中其他 collection 干扰。
6. 如 QMD `query` 需要模型或本地 LLM，`auto` 是否应优先 `search` / `vsearch` 可再评估。

### 10.6 `auto` 检索融合

当前 `auto` 是 backend 选择，不做多后端融合。

可升级为：

1. `rg`、BM25、QMD 并行或顺序查询。
2. 使用 Reciprocal Rank Fusion 合并。
3. 精确 title / alias / page_id 命中置顶。
4. 返回 `backend_trace`，方便 debug。

### 10.7 Search index stale 与 lint

当前写操作会标记 stale，但 `kb_run_lint` 尚未新增 search index stale 检查。

建议新增 lint rules：

```text
search-bm25-stale
search-qmd-stale
search-index-missing
```

### 10.8 `kb_commit` 安全债

仍建议后续单独修复：

- 检测 commit 前是否已有 kb_root 外的 staged files。
- 如果有，直接报错或暂存/恢复 staged state。
- 避免 `kb_commit` 把用户之前 staged 的无关文件一起提交。

### 10.9 OpenClaw installer / skills 文案

本轮只同步了部分 README / technical / installer tool count。建议再检查：

```text
skills/kb_ingest/SKILL.md
src/openclaw-installer/skills.ts
docs/product.md
docs/progress.md
```

确认里面没有残留 `.md/.txt only` 或 11 tools 的旧描述。

---

## 11. 给本地 Codex 的建议任务清单

可直接把以下任务交给本地 Codex：

```text
请在已应用 llm_doc_base_phase1_phase2_git.patch 和 llm_doc_base_phase3_search_git.patch 的代码库中，执行以下检查和修复：

1. 运行 npm install、npm run typecheck、npm run build。
2. 运行 tests/frontmatter.test.ts、tests/source-registry.test.ts、tests/wiki-search.test.ts。
3. 检查 QMD CLI adapter 是否符合本机 qmd 版本；如不符合，修改 rebuildQmd/searchQmd，并补充一个 gated integration test。
4. 检查 MarkItDown 集成是否能转换 html/pdf/docx/pptx/xlsx；如需要，补充 RUN_MARKITDOWN_INTEGRATION=1 的 gated test。
5. 检查 src/openclaw-installer/skills.ts、skills/kb_ingest/SKILL.md、docs/product.md、docs/progress.md 是否需要同步更新。
6. 为 kb_run_lint 增加 search index stale 检查。
7. 评估 kb_read_source byte pagination 是否需要 UTF-8 boundary 对齐。
8. 不要改变当前排除范围：不支持 ZIP、OCR/图片、音频转录、Outlook、YouTube 转录、plugins。
```

---

## 12. 参考资料

- MarkItDown GitHub：<https://github.com/microsoft/markitdown>
- QMD GitHub：<https://github.com/tobi/qmd>
- ripgrep GitHub：<https://github.com/BurntSushi/ripgrep>

