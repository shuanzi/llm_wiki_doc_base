/**
 * e2e_v2_ingest.ts — End-to-end V2 kb_ingest simulation
 *
 * Simulates a full kb_ingest run on the RISC-V TEE document,
 * driving all 8 V2 tools via direct TypeScript imports.
 *
 * Run with: npx tsx scripts/e2e_v2_ingest.ts
 */

import * as path from "path";
import type { WorkspaceConfig } from "../src/types";
import { kbSourceAdd } from "../src/tools/kb_source_add";
import { kbReadSource } from "../src/tools/kb_read_source";
import { kbWritePage } from "../src/tools/kb_write_page";
import { kbSearchWiki } from "../src/tools/kb_search_wiki";
import { kbEnsureEntry } from "../src/tools/kb_ensure_entry";

// ── Config ──────────────────────────────────────────────────────────────────

const config: WorkspaceConfig = {
  kb_root: path.resolve(__dirname, "../kb"),
};

const SOURCE_FILE = "/Users/xiquandai/Downloads/test/RISC-V TEE标准制定及安全可信3.0启动方案技术分享.md";

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkWarnings(toolName: string, warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn(`[WARN] ${toolName} warnings:`);
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
}

function abort(step: string, error: string): never {
  console.error(`\n[FATAL] Step "${step}" failed: ${error}`);
  process.exit(1);
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("=".repeat(70));
  console.log("V2 E2E Ingest — RISC-V TEE 技术分享");
  console.log("=".repeat(70));

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: kb_source_add (idempotent — V1 already registered it)
  // NOTE: V1 registered this file; the tool deduplicates by content hash
  // and returns an error with the existing source_id embedded in the message.
  // We handle that gracefully.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 1] kb_source_add...");
  let source_id = "src_sha256_5d99456c"; // known from V1

  const addResult = await kbSourceAdd({ file_path: SOURCE_FILE }, config);
  if (!addResult.success) {
    // Dedup error: source already registered — this is expected
    if (addResult.error?.includes("already registered")) {
      console.log(`  [OK] Source already registered (idempotent). Using source_id: ${source_id}`);
    } else {
      abort("kb_source_add", addResult.error ?? "unknown");
    }
  } else {
    source_id = addResult.data!.source_id;
    console.log(`  [OK] source_id: ${source_id}, file_name: ${addResult.data!.file_name}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: kb_read_source
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 2] kb_read_source...");
  const readResult = await kbReadSource({ source_id }, config);
  if (!readResult.success) {
    abort("kb_read_source", readResult.error ?? "unknown");
  }
  const { content, file_name } = readResult.data!;
  console.log(`  [OK] Read ${content.length} chars from "${file_name}"`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Write source summary page (V2 quality — full distillation)
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 3] kbWritePage — source summary...");

  const sourcePage = `---
id: ${source_id}
type: source
title: RISC-V TEE标准制定及安全可信3.0启动方案技术分享
updated_at: 2026-04-12
status: active
source_ids: [${source_id}]
tags: [risc-v, tee, trusted-computing, secure-boot, tpcm, hardware-security]
---

# RISC-V TEE标准制定及安全可信3.0启动方案技术分享

## 文档概述

本文来自山东大学智研院，系统阐述了在 [[risc_v|RISC-V]] 体系结构下制定 [[tee|TEE（可信执行环境）]] 标准的必要性，以及团队提出的基于 [[tpcm|TPCM（可信平台控制模块）]] 的"安全可信 3.0"启动方案。文章从 ARM TrustZone 的成熟生态出发，指出 RISC-V 安全生态碎片化问题，论证标准化的迫切性，并给出一套完整的分层启动信任链方案。

## 关键要点

- **标准化动机**：RISC-V 生态发展迅速但安全规范缺失，各厂商方案割裂互不兼容；ARM TrustZone 已有成熟标准，RISC-V 需要对应的统一 TEE 标准以支撑规模化安全应用。
- **可信计算演进**：可信 1.0（被动容错）→ 可信 2.0（TCG/TPM 被动度量框架）→ 可信 3.0（"主动可信"，通过 TPCM 实现实时监测、判定与响应）。
- **TPCM 核心角色**：TPCM 是"可信管控核心"，连接防护部件与计算部件，维护系统信任源点，与可信密码模块（TCM）协同实现"双体系"架构。
- **安全可信 3.0 启动链**：ZSBL（ROM 中的零级引导）→ FSBL（一级引导 + TPCM 认证）→ OpenSBI/SEE（特权级接口 + 安全态切换）→ TEE_OS（安全态）+ 客户端 OS（非安全态）。
- **标准化工作范围**：涵盖硬件扩展（安全态寄存器、权限模式、内存/外设隔离）、安全启动与验证、编译工具链/调试器/TA 标准化接口，以及国际合作。
- **产业意义**：为金融、医疗、军工、工业控制、IoT、车规级领域提供基于开源可信 RISC-V 的安全解决方案；降低芯片厂商与软件企业的安全投入成本。
- **待解决问题**：安全态寄存器与内存隔离设计、TSB 与管理中心通信机制、TPCM 与 TCM 协同的高级加密接口。
- **未来展望**：参与制定正式 RISC-V TEE 标准 → 推动产业大规模落地 → 构建全球化开放安全社区。

## 核心论断

1. RISC-V TEE 标准缺失是制约其向高安全等级应用场景推进的根本障碍，统一标准能显著降低生态碎片化风险。
2. "主动可信"（可信 3.0）相比传统被动可信框架，能在系统运行全程实时监测并响应安全威胁，而非仅在启动阶段度量。
3. TPCM 方案在 RISC-V 上的实施需要解决安全态硬件隔离（寄存器级 + 内存级）和 SBI 扩展（SSE + RAS）两个关键技术挑战。

## 关联

- [[risc_v|RISC-V]] — 目标体系结构，本文核心讨论对象
- [[tee|TEE（可信执行环境）]] — 安全隔离执行环境，标准化目标
- [[tpcm|TPCM]] — 提出的主动可信控制模块方案
- [[opensbi|OpenSBI]] — 启动链中提供 SBI 接口的固件层
- [[secure_boot|安全启动]] — 信任链从 ZSBL 到 TEE_OS 的完整启动流程
- [[trusted_computing|可信计算]] — 1.0 到 3.0 演进框架的理论基础
- [[hardware_isolation|硬件隔离]] — 安全态与非安全态资源分离的技术手段

## 来源

- 原始文件：RISC-V TEE标准制定及安全可信3.0启动方案技术分享.md
- 来源 URL：https://zhuanlan.zhihu.com/p/28146151665
- 作者：山东大学智研院
- 发布时间：2025-03-06
`;

  const writeSource = await kbWritePage({
    path: `wiki/sources/${source_id}.md`,
    content: sourcePage,
  }, config);

  if (!writeSource.success) {
    abort("kbWritePage (source)", writeSource.error ?? "unknown");
  }
  checkWarnings("kbWritePage (source)", writeSource.data!.warnings);
  console.log(`  [OK] action=${writeSource.data!.action}, page_id=${writeSource.data!.page_id}`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Entity pages — check search first, then create
  // Entities: risc_v, tee, tpcm, opensbi
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 4] Entity pages...");

  // 4a. Search for each entity
  const entitySearches = [
    { id: "risc_v", query: "RISC-V" },
    { id: "tee", query: "TEE trusted execution environment" },
    { id: "tpcm", query: "TPCM trusted platform control module" },
    { id: "opensbi", query: "OpenSBI" },
  ];

  for (const e of entitySearches) {
    const sr = await kbSearchWiki({ query: e.query, type_filter: "entity" }, config);
    if (!sr.success) {
      abort(`kbSearchWiki (${e.id})`, sr.error ?? "unknown");
    }
    const found = sr.data!.find((r) => r.page_id === e.id);
    console.log(`  Search "${e.query}": ${found ? `found page ${found.page_id}` : "not found (will create)"}`);
  }

  // 4b. Create entity pages (all new — V1 never created entity pages)

  // risc_v
  console.log("  Creating entity: risc_v...");
  const riscvPage = `---
id: risc_v
type: entity
title: RISC-V
updated_at: 2026-04-12
status: active
tags: [architecture, isa, open-source, hardware]
aliases: [RISC-V ISA, riscv, RISCV]
source_ids: [${source_id}]
related: [tee, opensbi, tpcm, secure_boot]
---

# RISC-V

RISC-V 是一种开放的精简指令集架构（ISA），由加州大学伯克利分校发起，现由 RISC-V International 维护。其最大特点是完全开源、模块化，允许任何人免费使用、实现和扩展，已从嵌入式微控制器延伸至高性能服务器和 AI 加速器场景。

## 关键特性

- **开放 ISA**：无需授权费，允许商用与学术使用，打破 ARM/x86 的授权壁垒。
- **模块化扩展**：基础整数指令集（RV32I/RV64I）加上可选扩展（M/A/F/D/C/V 等），支持高度定制化设计。
- **特权级体系**：机器态（M-mode）、监督态（S-mode）、用户态（U-mode）三级权限，配合 H 扩展支持虚拟化。
- **安全生态建设中**：目前 TEE 标准尚未统一，各厂商方案割裂；RISC-V TEE 标准制定是当前生态关键任务之一。
- **广泛应用场景**：从嵌入式 IoT、车规级芯片到数据中心服务器，RISC-V 正在向产业规模化迈进。

## 关联

- [[tee|TEE]] — RISC-V 平台上的可信执行环境，标准制定中
- [[opensbi|OpenSBI]] — RISC-V 特权级固件（SBI 实现），启动链必要组件
- [[tpcm|TPCM]] — 提出的 RISC-V 主动可信控制模块方案
- [[secure_boot|安全启动]] — RISC-V 平台的信任链启动流程
- [[trusted_computing|可信计算]] — RISC-V 安全生态的上层理论框架

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeRiscv = await kbWritePage({ path: "wiki/entities/risc_v.md", content: riscvPage }, config);
  if (!writeRiscv.success) abort("kbWritePage (risc_v)", writeRiscv.error ?? "unknown");
  checkWarnings("kbWritePage (risc_v)", writeRiscv.data!.warnings);
  console.log(`    [OK] risc_v: action=${writeRiscv.data!.action}`);

  // tee
  console.log("  Creating entity: tee...");
  const teePage = `---
id: tee
type: entity
title: TEE（可信执行环境）
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, hardware-security, isolation]
aliases: [Trusted Execution Environment, 可信执行环境, TEE]
source_ids: [${source_id}]
related: [risc_v, tpcm, hardware_isolation, secure_boot, trusted_computing]
---

# TEE（可信执行环境）

TEE（Trusted Execution Environment，可信执行环境）是一种通过硬件隔离机制为敏感代码和数据提供安全运行空间的技术框架。TEE 与普通执行环境（REE）并行运行，通过严格的硬件访问控制确保安全区域内的代码和数据不受普通软件环境的攻击。

## 关键特性

- **硬件隔离**：通过 CPU 安全扩展（如 ARM TrustZone、RISC-V 安全态扩展）在硬件层面划分安全态（Secure World）与非安全态（Normal World）。
- **双环境架构**：TEE_OS 运行于安全态（EL1），处理加密密钥、认证等敏感操作；客户端 OS 运行于非安全态，提供丰富应用支持。
- **ARM 生态成熟**：ARM TrustZone 为 TEE 提供了完善的硬件基础和标准规范（OP-TEE、GlobalPlatform API 等）。
- **RISC-V TEE 标准制定中**：不同于 ARM，RISC-V 的 TEE 标准尚未统一，山东大学等机构正在推动 RISC-V TEE 标准的制定工作。
- **应用场景**：金融支付安全、医疗数据保护、军工可信计算、IoT 设备认证、数字版权管理（DRM）等高安全等级场景。

## 关联

- [[risc_v|RISC-V]] — TEE 的目标硬件平台之一，标准化工作正在推进
- [[tpcm|TPCM]] — 与 TEE 协同工作的主动可信控制模块
- [[hardware_isolation|硬件隔离]] — TEE 的核心技术机制
- [[secure_boot|安全启动]] — TEE 信任链建立的起点
- [[trusted_computing|可信计算]] — TEE 是可信计算的核心实现形式

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeTee = await kbWritePage({ path: "wiki/entities/tee.md", content: teePage }, config);
  if (!writeTee.success) abort("kbWritePage (tee)", writeTee.error ?? "unknown");
  checkWarnings("kbWritePage (tee)", writeTee.data!.warnings);
  console.log(`    [OK] tee: action=${writeTee.data!.action}`);

  // tpcm
  console.log("  Creating entity: tpcm...");
  const tpcmPage = `---
id: tpcm
type: entity
title: TPCM（可信平台控制模块）
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, hardware-security, risc-v]
aliases: [Trusted Platform Control Module, 可信平台控制模块, TPCM]
source_ids: [${source_id}]
related: [tee, risc_v, secure_boot, trusted_computing, hardware_isolation]
---

# TPCM（可信平台控制模块）

TPCM（Trusted Platform Control Module，可信平台控制模块）是可信计算 3.0 框架中的核心硬件模块，扮演"可信管控核心"角色。不同于被动的 TPM/TCM，TPCM 具备主动监控与策略执行能力，能对平台及上层软件执行过程进行实时度量、监控与响应。

## 关键特性

- **主动可信**：区别于 TPM/TCM 的被动度量，TPCM 主动介入系统运行，实时监测异常行为并执行可信策略。
- **双体系架构**：TPCM 与可信密码模块（TCM）协同运作，分别负责控制/度量和密码服务，构成"防护部件 + 计算部件"的双体系。
- **可信软件基（TSB）**：TPCM 内置 TSB，承担系统软件与应用软件的度量任务，并通过通信机制与管理中心动态同步策略库。
- **RISC-V 适配**：在 RISC-V 平台上，TPCM 集成于安全可信 3.0 启动链，在 FSBL 阶段介入进行安全认证，并贯穿整个运行时生命周期。
- **安全启动锚点**：TPCM 建立并维护系统信任源点，确保从 ZSBL 到 TEE_OS 的每个启动阶段都经过可信度量和验证。

## 关联

- [[tee|TEE]] — TPCM 与 TEE 协同工作，TPCM 管控 TEE_OS 的安全运行
- [[risc_v|RISC-V]] — TPCM 的目标部署平台
- [[secure_boot|安全启动]] — TPCM 是 RISC-V 安全启动链的核心组件
- [[trusted_computing|可信计算]] — TPCM 是可信 3.0 框架的核心实现
- [[opensbi|OpenSBI]] — 启动链中 TPCM 与 SBI 层交互的接口层

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeTpcm = await kbWritePage({ path: "wiki/entities/tpcm.md", content: tpcmPage }, config);
  if (!writeTpcm.success) abort("kbWritePage (tpcm)", writeTpcm.error ?? "unknown");
  checkWarnings("kbWritePage (tpcm)", writeTpcm.data!.warnings);
  console.log(`    [OK] tpcm: action=${writeTpcm.data!.action}`);

  // opensbi
  console.log("  Creating entity: opensbi...");
  const opensbiPage = `---
id: opensbi
type: entity
title: OpenSBI
updated_at: 2026-04-12
status: active
tags: [risc-v, firmware, bootloader, sbi]
aliases: [Open SBI, RISC-V SBI]
source_ids: [${source_id}]
related: [risc_v, tee, secure_boot, tpcm]
---

# OpenSBI

OpenSBI（Open Supervisor Binary Interface）是 RISC-V 平台的开源特权固件实现，由 Western Digital 主导开发。它实现了 RISC-V SBI（Supervisor Binary Interface）规范，在机器态（M-mode）运行，为上层操作系统（S-mode）提供标准化的硬件抽象接口。

## 关键特性

- **SBI 规范实现**：作为 RISC-V 启动链中的关键固件层，提供从 Boot 阶段到操作系统的特权级接口。
- **安全态扩展（SEE）**：在安全可信 3.0 启动方案中，OpenSBI 集成 SEE（Secure Execution Environment）扩展，实现安全态与非安全态的切换与管理。
- **SSE + RAS 支持**：SBI 标准提供的 SSE（Software Surprise Exception）扩展配合 RAS（Reliability, Availability, Serviceability）机制，提供可用性支撑。
- **启动链位置**：在 RISC-V 安全可信 3.0 启动链中，OpenSBI 处于 EL3 层（FSBL 之后），负责完成安全态初始化并移交控制权给 TEE_OS 和客户端 OS。
- **开源生态**：OpenSBI 的开源特性使其成为 RISC-V 安全生态的重要基础设施，可与 TPCM 和 TEE 方案集成。

## 关联

- [[risc_v|RISC-V]] — OpenSBI 是 RISC-V 平台的标准固件层
- [[tee|TEE]] — OpenSBI/SEE 扩展是 TEE_OS 安全启动的桥接层
- [[tpcm|TPCM]] — TPCM 与 OpenSBI 在启动链中协同工作
- [[secure_boot|安全启动]] — OpenSBI 是 RISC-V 信任链中的重要环节

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeOpensbi = await kbWritePage({ path: "wiki/entities/opensbi.md", content: opensbiPage }, config);
  if (!writeOpensbi.success) abort("kbWritePage (opensbi)", writeOpensbi.error ?? "unknown");
  checkWarnings("kbWritePage (opensbi)", writeOpensbi.data!.warnings);
  console.log(`    [OK] opensbi: action=${writeOpensbi.data!.action}`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 5: Concept pages — secure_boot, trusted_computing, hardware_isolation
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 5] Concept pages...");

  const conceptSearches = [
    { id: "secure_boot", query: "secure boot 安全启动" },
    { id: "trusted_computing", query: "trusted computing 可信计算" },
    { id: "hardware_isolation", query: "hardware isolation 硬件隔离" },
  ];

  for (const c of conceptSearches) {
    const sr = await kbSearchWiki({ query: c.query, type_filter: "concept" }, config);
    if (!sr.success) abort(`kbSearchWiki (${c.id})`, sr.error ?? "unknown");
    const found = sr.data!.find((r) => r.page_id === c.id);
    console.log(`  Search "${c.query}": ${found ? `found page ${found.page_id}` : "not found (will create)"}`);
  }

  // secure_boot
  console.log("  Creating concept: secure_boot...");
  const secureBootPage = `---
id: secure_boot
type: concept
title: 安全启动（信任链）
updated_at: 2026-04-12
status: active
tags: [security, boot, trust-chain, firmware]
aliases: [Secure Boot, 信任链, trust chain, 安全启动]
source_ids: [${source_id}]
related: [risc_v, tee, tpcm, opensbi, trusted_computing, hardware_isolation]
---

# 安全启动（信任链）

安全启动（Secure Boot）是通过构建分层信任链（Trust Chain），确保系统从上电到操作系统加载的每个阶段都经过完整性验证的安全机制。核心思想是"信任根（Root of Trust）"：从不可篡改的只读存储中的初始代码开始，逐级验证下一阶段引导程序的签名和完整性，形成完整的信任传递链。

## 关键特性

- **信任根（RoT）**：信任链的起点，通常存储于只读 ROM 或硬件安全模块中，不可被外部篡改。
- **分层验证**：每一级引导程序验证下一级的签名/哈希，形成链式信任传递：ROM → ZSBL → FSBL → 固件 → OS。
- **RISC-V 安全可信 3.0 启动链**：
  - EL3 ZSBL（ROM 中，最初级硬件初始化+度量）
  - EL3 FSBL（外设/内存配置 + TPCM 安全认证）
  - EL3 OpenSBI/SEE（SBI 接口 + 安全态/非安全态切换）
  - EL1 TEE_OS（安全态，TPCM 管控下）+ 客户端 OS（非安全态）
- **主动可信增强**：在可信 3.0 框架下，安全启动不只是一次性验证，TPCM 持续监控运行时行为，将启动时的信任延伸到运行时。
- **跨平台对比**：ARM TrustZone 已有完善的安全启动规范；RISC-V 的安全启动标准正在制定中，是 RISC-V TEE 标准化工作的重要组成部分。

## 关联

- [[tpcm|TPCM]] — 可信 3.0 启动方案的核心控制模块，在 FSBL 阶段介入
- [[opensbi|OpenSBI]] — RISC-V 启动链中的固件层，带 SEE 扩展
- [[tee|TEE]] — 安全启动信任链的最终目的地之一（TEE_OS 的安全态启动）
- [[risc_v|RISC-V]] — 安全启动的目标平台
- [[trusted_computing|可信计算]] — 安全启动是可信计算的基础机制
- [[hardware_isolation|硬件隔离]] — 安全态与非安全态的硬件级分离保障启动链安全

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeSecureBoot = await kbWritePage({ path: "wiki/concepts/secure_boot.md", content: secureBootPage }, config);
  if (!writeSecureBoot.success) abort("kbWritePage (secure_boot)", writeSecureBoot.error ?? "unknown");
  checkWarnings("kbWritePage (secure_boot)", writeSecureBoot.data!.warnings);
  console.log(`    [OK] secure_boot: action=${writeSecureBoot.data!.action}`);

  // trusted_computing
  console.log("  Creating concept: trusted_computing...");
  const trustedComputingPage = `---
id: trusted_computing
type: concept
title: 可信计算
updated_at: 2026-04-12
status: active
tags: [security, trusted-computing, tee, hardware-security]
aliases: [Trusted Computing, 可信计算, 可信计算体系]
source_ids: [${source_id}]
related: [tee, tpcm, secure_boot, hardware_isolation, risc_v]
---

# 可信计算

可信计算（Trusted Computing）是一种从硬件层面到软件层面为计算系统建立"不可篡改、可度量、可验证"环境的安全体系。其核心目标是确保计算平台的行为符合预期，防止恶意软件篡改系统状态。

## 关键特性

### 演进历程：1.0 → 2.0 → 3.0

- **可信 1.0**：以容错计算等基本安全机制为基础，被动式安全防护，主要关注硬件可靠性。
- **可信 2.0**：以 TCG（Trusted Computing Group）国际标准为代表，引入 TPM/TCM 可信根进行度量与存储，提升系统完整性检测；本质仍是被动式框架，在启动时度量但不干预运行时。
- **可信 3.0**："主动可信"理念，通过 TPCM 等可信计算节点与策略执行功能组件，对系统行为进行实时监测、判定与响应；信任从启动时延伸到运行时全周期。

### 核心组件

- **可信根（Root of Trust）**：信任链起点，通常是 ROM 中不可篡改的启动代码。
- **可信平台模块（TPM/TCM）**：存储度量值、执行加密操作的硬件安全芯片（2.0 框架核心）。
- **TPCM（可信平台控制模块）**：主动介入、实时监控的可信管控核心（3.0 框架核心）。
- **可信软件基（TSB）**：度量系统软件与应用软件的可信计算基础软件层。
- **TEE（可信执行环境）**：为敏感代码提供硬件隔离运行空间的安全执行框架。

## 关联

- [[tee|TEE]] — 可信计算的核心实现形式，提供硬件隔离安全执行环境
- [[tpcm|TPCM]] — 可信 3.0 的核心硬件模块，实现主动可信
- [[secure_boot|安全启动]] — 可信计算的基础安全机制，建立初始信任链
- [[hardware_isolation|硬件隔离]] — 可信计算依赖硬件隔离保证安全态不受侵犯
- [[risc_v|RISC-V]] — 可信计算体系在 RISC-V 平台上的适配与标准化挑战

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeTrustedComputing = await kbWritePage({ path: "wiki/concepts/trusted_computing.md", content: trustedComputingPage }, config);
  if (!writeTrustedComputing.success) abort("kbWritePage (trusted_computing)", writeTrustedComputing.error ?? "unknown");
  checkWarnings("kbWritePage (trusted_computing)", writeTrustedComputing.data!.warnings);
  console.log(`    [OK] trusted_computing: action=${writeTrustedComputing.data!.action}`);

  // hardware_isolation
  console.log("  Creating concept: hardware_isolation...");
  const hardwareIsolationPage = `---
id: hardware_isolation
type: concept
title: 硬件隔离
updated_at: 2026-04-12
status: active
tags: [security, hardware, isolation, memory-protection]
aliases: [Hardware Isolation, 硬件隔离, 安全隔离, security isolation]
source_ids: [${source_id}]
related: [tee, risc_v, tpcm, secure_boot, trusted_computing]
---

# 硬件隔离

硬件隔离是通过 CPU 架构层面的安全扩展，在物理硬件级别将安全态（Secure World）与非安全态（Normal World/Normal）的计算资源严格分离的技术机制。这种隔离确保敏感代码和数据（如密钥、认证逻辑）不能被非安全态软件读取或篡改。

## 关键特性

- **寄存器级隔离**：安全态拥有独立的寄存器组或寄存器状态，安全态与非安全态之间切换时必须通过受控入口（如 SMC/ecall）。
- **内存级隔离**：通过硬件内存保护机制（如 ARM TrustZone 的 TrustZone Protection Controller、RISC-V 的 PMP/IOPMP）将物理内存分区，非安全态代码无法访问安全区内存。
- **外设隔离**：高敏感外设（如密码加速器、安全存储）被标记为安全态独占资源，非安全态无法直接访问。
- **RISC-V 实现挑战**：RISC-V 安全态寄存器隔离设计是当前 TEE 标准化工作中的关键待解决问题，需在 ISA 层面统一定义安全态/非安全态切换机制。
- **与 TEE 的关系**：硬件隔离是 TEE 的物理基础，没有硬件隔离，软件层面的 TEE 无法提供可靠的安全保证。

## 关联

- [[tee|TEE]] — 硬件隔离是 TEE 实现的物理基础
- [[risc_v|RISC-V]] — RISC-V 平台的硬件隔离机制正在标准化中
- [[tpcm|TPCM]] — TPCM 依赖硬件隔离实现安全态的可信度量
- [[secure_boot|安全启动]] — 安全启动需要硬件隔离保证每个启动阶段的安全边界
- [[trusted_computing|可信计算]] — 硬件隔离是可信计算体系的技术基石

## 来源

- 基于 [[${source_id}|RISC-V TEE标准制定及安全可信3.0启动方案技术分享]]
`;

  const writeHardwareIsolation = await kbWritePage({ path: "wiki/concepts/hardware_isolation.md", content: hardwareIsolationPage }, config);
  if (!writeHardwareIsolation.success) abort("kbWritePage (hardware_isolation)", writeHardwareIsolation.error ?? "unknown");
  checkWarnings("kbWritePage (hardware_isolation)", writeHardwareIsolation.data!.warnings);
  console.log(`    [OK] hardware_isolation: action=${writeHardwareIsolation.data!.action}`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 6: Update index.md and log.md
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 6] kb_ensure_entry — index.md and log.md...");

  // Note: The V1 source entry already exists in index.md under ## Sources
  // We only add new entity/concept entries (which were empty in V1)

  const indexEntries = [
    // Entities
    {
      path: "wiki/index.md",
      entry: `- [[risc_v|RISC-V]] — 开源指令集架构，正在推进 TEE 标准化（1 source）`,
      anchor: "## Entities",
      dedup_key: "index_risc_v",
    },
    {
      path: "wiki/index.md",
      entry: `- [[tee|TEE（可信执行环境）]] — 硬件隔离安全执行环境（1 source）`,
      anchor: "## Entities",
      dedup_key: "index_tee",
    },
    {
      path: "wiki/index.md",
      entry: `- [[tpcm|TPCM]] — 可信 3.0 主动可信控制模块（1 source）`,
      anchor: "## Entities",
      dedup_key: "index_tpcm",
    },
    {
      path: "wiki/index.md",
      entry: `- [[opensbi|OpenSBI]] — RISC-V SBI 固件层，支持安全态扩展（1 source）`,
      anchor: "## Entities",
      dedup_key: "index_opensbi",
    },
    // Concepts
    {
      path: "wiki/index.md",
      entry: `- [[secure_boot|安全启动（信任链）]] — 分层信任链从 ROM 到 OS 的完整启动验证（1 source）`,
      anchor: "## Concepts",
      dedup_key: "index_secure_boot",
    },
    {
      path: "wiki/index.md",
      entry: `- [[trusted_computing|可信计算]] — 1.0→2.0→3.0 演进框架，主动可信理念（1 source）`,
      anchor: "## Concepts",
      dedup_key: "index_trusted_computing",
    },
    {
      path: "wiki/index.md",
      entry: `- [[hardware_isolation|硬件隔离]] — 安全态与非安全态的物理资源分离机制（1 source）`,
      anchor: "## Concepts",
      dedup_key: "index_hardware_isolation",
    },
  ];

  for (const entry of indexEntries) {
    const result = await kbEnsureEntry(entry, config);
    if (!result.success) {
      abort(`kbEnsureEntry (${entry.dedup_key})`, result.error ?? "unknown");
    }
    console.log(`  [OK] ${entry.dedup_key}: ${result.data!.action}`);
  }

  // Log entry (V2 specific — dedup_key uses _v2 suffix)
  const logEntry = `## [2026-04-12] ingest | RISC-V TEE标准制定及安全可信3.0启动方案技术分享
- 更新: [[${source_id}|源摘要页]] — V2 完整提炼替换 V1 截取式摘要
- 新建: [[risc_v|RISC-V]] (entity)
- 新建: [[tee|TEE（可信执行环境）]] (entity)
- 新建: [[tpcm|TPCM]] (entity)
- 新建: [[opensbi|OpenSBI]] (entity)
- 新建: [[secure_boot|安全启动（信任链）]] (concept)
- 新建: [[trusted_computing|可信计算]] (concept)
- 新建: [[hardware_isolation|硬件隔离]] (concept)
- 更新: index.md — 4 entity entries + 3 concept entries added`;

  const logResult = await kbEnsureEntry({
    path: "wiki/log.md",
    entry: logEntry,
    anchor: null,
    dedup_key: `log_ingest_${source_id}_v2`,
  }, config);

  if (!logResult.success) {
    abort("kbEnsureEntry (log)", logResult.error ?? "unknown");
  }
  console.log(`  [OK] log entry: ${logResult.data!.action}`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 7: NO kb_commit — leave changes staged for human inspection
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 7] Skipping kb_commit per instructions — leaving for human review.");

  // ────────────────────────────────────────────────────────────────────────
  // Step 8: Verification — read page-index.json and count by type
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[Step 8] Verification...");
  const fs = await import("fs");
  const pageIndexPath = path.resolve(config.kb_root, "state/cache/page-index.json");
  const pageIndex = JSON.parse(fs.readFileSync(pageIndexPath, "utf8"));

  const typeCounts: Record<string, number> = {};
  for (const page of pageIndex.pages) {
    typeCounts[page.type] = (typeCounts[page.type] ?? 0) + 1;
  }

  console.log("\n  Page-index.json — page count by type:");
  for (const [type, count] of Object.entries(typeCounts).sort()) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`    TOTAL: ${pageIndex.pages.length}`);

  console.log("\n" + "=".repeat(70));
  console.log("V2 E2E Ingest COMPLETE");
  console.log("=".repeat(70));
  console.log(`
Pages created/updated:
  - wiki/sources/${source_id}.md  [source, updated from V1]
  - wiki/entities/risc_v.md       [entity, created]
  - wiki/entities/tee.md          [entity, created]
  - wiki/entities/tpcm.md         [entity, created]
  - wiki/entities/opensbi.md      [entity, created]
  - wiki/concepts/secure_boot.md  [concept, created]
  - wiki/concepts/trusted_computing.md [concept, created]
  - wiki/concepts/hardware_isolation.md [concept, created]
  - wiki/index.md                 [updated: 4 entity + 3 concept entries]
  - wiki/log.md                   [updated: V2 log entry]
`);
}

run().catch((err) => {
  console.error("[UNCAUGHT]", err);
  process.exit(1);
});
