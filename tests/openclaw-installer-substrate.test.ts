import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { formatInstallerUsage, parseInstallerArgs } from "../src/openclaw-installer/args";
import { buildExpectedMcpConfig, checkOpenClawInstallation } from "../src/openclaw-installer/check";
import * as workspaceBindingModule from "../src/openclaw-installer/llmwiki-binding";
import {
  createInstallerManifest,
  resolveInstallerManifestPath,
  validateInstallerManifest,
  writeInstallerManifest,
} from "../src/openclaw-installer/manifest";
import {
  materializeSessionRuntimeArtifacts,
} from "../src/openclaw-installer/session-runtime-artifact";
import {
  ensureSessionRuntimeAgentToolPolicy,
  hasSessionRuntimeAgentToolPolicy,
  removeSessionRuntimeAgentToolPolicy,
} from "../src/openclaw-installer/session-runtime-agent-policy";
import { EXPECTED_KB_TOOL_NAMES } from "../src/openclaw-installer/mcp-probe";
import { installOpenClawSkills } from "../src/openclaw-installer/skills";
import { uninstallOpenClawIntegration } from "../src/openclaw-installer/uninstall";
import { renderAllOpenClawWorkspaceDocs } from "../src/openclaw-installer/workspace-docs";

const repoRoot = path.resolve(__dirname, "..");

function assertContains(content: string, needle: string, context: string): void {
  assert.equal(content.includes(needle), true, `${context} should include: ${needle}`);
}

function assertNotContains(content: string, needle: string, context: string): void {
  assert.equal(
    content.includes(needle),
    false,
    `${context} should not include: ${needle}`
  );
}

function mustGetDoc(
  docs: Map<string, string>,
  docName: "AGENTS.md" | "SOUL.md" | "TOOLS.md" | "HEARTBEAT.md"
): string {
  const content = docs.get(docName);
  assert.ok(content, `${docName} should be rendered`);
  return content;
}

async function resolveAgentWorkspaceBinding(options: {
  agentId: string;
  workspacePath: string;
  cli: {
    listConfiguredAgents(): Promise<Array<{ id: string; workspace?: string; raw: object }>>;
  };
}) {
  const resolver = (
    workspaceBindingModule as unknown as {
      resolveAgentWorkspaceBinding?: (input: typeof options) => Promise<unknown>;
    }
  ).resolveAgentWorkspaceBinding;

  assert.equal(
    typeof resolver,
    "function",
    "generic resolver resolveAgentWorkspaceBinding should be exported"
  );

  if (!resolver) {
    throw new Error("generic resolver resolveAgentWorkspaceBinding should be exported");
  }

  return resolver(options) as Promise<Record<string, unknown>>;
}

function createManifestFixture(options: {
  agentId?: string;
  expectedAgentId?: string;
}) {
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-substrate-workspace-")
  );
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-substrate-kb-"));
  const installedAt = new Date().toISOString();

  const installedSkills = installOpenClawSkills({
    workspacePath,
    repoRoot,
    installedAt,
  });

  const installedWorkspaceDocs = renderAllOpenClawWorkspaceDocs().map((doc) => {
    const docFile = path.resolve(workspacePath, doc.installRelativeFile);
    fs.writeFileSync(docFile, doc.content, "utf8");
    return {
      docName: doc.docName,
      docFile,
      contentHash: doc.contentHash,
      installedAt,
      preinstallSnapshot: { known: false as const },
    };
  });

  const sessionRuntime = materializeSessionRuntimeArtifacts({
    workspacePath,
    kbRoot,
    sourcePluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
    sourcePluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
    installedAt,
    agentId: options.agentId ?? "research",
  } as Parameters<typeof materializeSessionRuntimeArtifacts>[0] & {
    agentId: string;
  }).metadata;

  const expectedMcpConfig = buildExpectedMcpConfig({
    mcpName: "llm-kb",
    serverEntrypoint: path.resolve(repoRoot, "dist", "mcp_server.js"),
    kbRoot,
    nodeCommand: process.execPath,
  });

  const manifest = createInstallerManifest({
    installerVersion: "0.1.0",
    repoRoot,
    workspacePath,
    kbRoot,
    mcpName: "llm-kb",
    installedAt,
    installedSkills,
    installedWorkspaceDocs,
    sessionRuntime,
    expectedMcpConfig,
  });

  return {
    workspacePath,
    kbRoot,
    expectedMcpConfig,
    sessionRuntime,
    manifest,
    expectedAgentId: options.expectedAgentId ?? options.agentId ?? "research",
  };
}

function createMutableOpenClawCliState(
  initialAgentsList: Array<Record<string, unknown>>,
  initialConfig: Record<string, unknown> = {}
) {
  let agentsList: unknown = initialAgentsList;
  const config = new Map<string, unknown>(Object.entries(initialConfig));
  const ok = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  };

  const cli = {
    resolveExecutablePath() {
      return "/tmp/openclaw";
    },
    async getConfigFilePath() {
      return "/tmp/openclaw-config.json";
    },
    async listConfiguredAgents() {
      if (!Array.isArray(agentsList)) {
        return [];
      }
      return agentsList
        .filter((entry): entry is Record<string, unknown> => {
          return typeof entry === "object" && entry !== null;
        })
        .map((entry) => {
          return {
            id: typeof entry.id === "string" ? entry.id : "",
            workspace:
              typeof entry.workspace === "string" ? entry.workspace : undefined,
            raw: entry,
          };
        })
        .filter((entry) => entry.id.length > 0);
    },
    async showMcpServer() {
      return undefined;
    },
    async getConfigValue<T>(configPath: string) {
      if (configPath === "agents.list") {
        return agentsList as T;
      }
      return config.get(configPath) as T;
    },
    async setConfigValueStrictJson(configPath: string, value: unknown) {
      if (configPath === "agents.list") {
        agentsList = value;
      } else {
        config.set(configPath, value);
      }
      return ok;
    },
    async unsetConfigValue(configPath: string) {
      if (configPath === "agents.list") {
        agentsList = undefined;
      } else {
        config.delete(configPath);
      }
      return ok;
    },
  };

  return {
    cli,
    readAgentsList(): unknown {
      return agentsList;
    },
  };
}

function entryHasPluginPolicy(
  entry: Record<string, unknown>,
  pluginId: string = "llmwiki-kb-tools"
): boolean {
  const tools =
    typeof entry.tools === "object" && entry.tools !== null
      ? (entry.tools as Record<string, unknown>)
      : undefined;
  const allow = Array.isArray(tools?.allow) ? tools.allow : [];
  const alsoAllow = Array.isArray(tools?.alsoAllow) ? tools.alsoAllow : [];
  return allow.includes(pluginId) || alsoAllow.includes(pluginId);
}

test("generic binding resolves explicit non-llmwiki agent id with matching workspace", async () => {
  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/research-workspace",
    cli: {
      async listConfiguredAgents() {
        return [
          {
            id: "llmwiki",
            workspace: "/tmp/llmwiki-workspace",
            raw: {},
          },
          {
            id: "research",
            workspace: "/tmp/research-workspace",
            raw: {},
          },
        ];
      },
    },
  });

  assert.equal(result.status, "bound");
  assert.equal(result.agentId, "research");
  assert.equal(result.boundWorkspace, "/tmp/research-workspace");
  assert.equal(result.agentCount, 1);
});

test("generic binding fails closed when configured agent is missing", async () => {
  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/research-workspace",
    cli: {
      async listConfiguredAgents() {
        return [
          {
            id: "llmwiki",
            workspace: "/tmp/research-workspace",
            raw: {},
          },
        ];
      },
    },
  });

  assert.equal(result.status, "missing_binding");
  assert.equal(result.agentId, "research");
  assert.equal(result.agentCount, 0);
  assert.deepEqual(result.candidateWorkspaces, []);
});

test("generic binding fails closed on malformed workspace entries", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "research",
          workspace: "relative/path-not-allowed",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/research-workspace",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.agentId, "research");
  assert.equal(result.malformedWorkspaceEntryCount, 1);
});

test("generic binding fails closed on same agent bound to multiple workspaces", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "research",
          workspace: "/tmp/workspace-a",
          raw: {},
        },
        {
          id: "research",
          workspace: "/tmp/workspace-b",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/workspace-a",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.agentId, "research");
  assert.ok(Array.isArray(result.candidateWorkspaces));
  assert.equal(result.candidateWorkspaces.length, 2);
});

test("generic binding fails closed on duplicate agent entries with the same workspace", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "research",
          workspace: "/tmp/workspace-a",
          raw: {},
        },
        {
          id: "research",
          workspace: "/tmp/workspace-a",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/workspace-a",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.agentId, "research");
  assert.equal(result.agentCount, 2);
  assert.deepEqual(result.candidateWorkspaces, ["/tmp/workspace-a"]);
});

test("generic binding fails closed when a duplicate agent entry lacks workspace", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "research",
          workspace: "/tmp/workspace-a",
          raw: {},
        },
        {
          id: "research",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/workspace-a",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.agentId, "research");
  assert.equal(result.agentCount, 2);
  assert.deepEqual(result.candidateWorkspaces, ["/tmp/workspace-a"]);
});

test("generic binding fails closed when workspace belongs to another agent", async () => {
  const result = await resolveAgentWorkspaceBinding({
    agentId: "research",
    workspacePath: "/tmp/shared-workspace",
    cli: {
      async listConfiguredAgents() {
        return [
          {
            id: "llmwiki",
            workspace: "/tmp/shared-workspace",
            raw: {},
          },
          {
            id: "research",
            workspace: "/tmp/research-workspace",
            raw: {},
          },
        ];
      },
    },
  });

  assert.equal(result.status, "missing_binding");
  assert.equal(result.agentId, "research");
  assert.deepEqual(result.candidateWorkspaces, ["/tmp/research-workspace"]);
  assert.match(String(result.message), /research/u);
});

test("installer CLI parses --agent-id and defaults to llmwiki", () => {
  const explicit = parseInstallerArgs([
    "install",
    "--workspace",
    "/tmp/workspace",
    "--kb-root",
    "/tmp/kb",
    "--agent-id",
    "research",
  ]) as ReturnType<typeof parseInstallerArgs> & { agentId?: string };

  assert.equal(explicit.command, "install");
  assert.equal(explicit.agentId, "research");

  const defaulted = parseInstallerArgs([
    "check",
    "--workspace",
    "/tmp/workspace",
  ]) as ReturnType<typeof parseInstallerArgs> & { agentId?: string };

  assert.equal(defaulted.command, "check");
  assert.equal(defaulted.agentId, "llmwiki");

  const repair = parseInstallerArgs([
    "repair",
    "--workspace",
    "/tmp/workspace",
    "--agent-id",
    "analysis",
  ]) as ReturnType<typeof parseInstallerArgs> & { agentId?: string };
  assert.equal(repair.command, "repair");
  assert.equal(repair.agentId, "analysis");

  const uninstall = parseInstallerArgs([
    "uninstall",
    "--workspace",
    "/tmp/workspace",
    "--agent-id",
    "archive",
  ]) as ReturnType<typeof parseInstallerArgs> & { agentId?: string };
  assert.equal(uninstall.command, "uninstall");
  assert.equal(uninstall.agentId, "archive");

  assertContains(
    formatInstallerUsage(),
    "install --workspace <path> --kb-root <path> [--agent-id <id>]",
    "installer usage"
  );
});

test("manifest validation reports session runtime metadata drift", () => {
  const fixture = createManifestFixture({ agentId: "research" });
  const outsidePluginRoot = path.resolve(os.tmpdir(), "outside-openclaw-plugin-root");
  const manifest = {
    ...fixture.manifest,
    sessionRuntime: fixture.manifest.sessionRuntime
      ? {
          ...fixture.manifest.sessionRuntime,
          pluginRoot: outsidePluginRoot,
          canonicalToolNames: ["kb_read_page"],
        }
      : undefined,
  };

  const validation = validateInstallerManifest(manifest, {
    repoRoot,
    workspacePath: fixture.workspacePath,
    kbRoot: fixture.kbRoot,
    mcpName: "llm-kb",
    expectedMcpConfig: fixture.expectedMcpConfig,
    agentId: "research",
  });

  assert.equal(
    validation.driftItems.some((item) => {
      return (
        item.kind === "unknown_ownership" &&
        item.message.includes("pluginRoot points outside workspace ownership scope")
      );
    }),
    true
  );
  assert.equal(
    validation.driftItems.some((item) => {
      return (
        item.kind === "session_runtime_hash_drift" &&
        item.message.includes("canonical tool names drifted")
      );
    }),
    true
  );
});

test("manifest records non-llmwiki session runtime agent id", () => {
  const fixture = createManifestFixture({ agentId: "research" });

  assert.equal(fixture.sessionRuntime.agentId, "research");
  assert.equal(fixture.manifest.sessionRuntime?.agentId, "research");
});

test("manifest validation reports CLI and session runtime agent id mismatch", () => {
  const fixture = createManifestFixture({
    agentId: "research",
    expectedAgentId: "analysis",
  });

  const validation = validateInstallerManifest(fixture.manifest, {
    repoRoot,
    workspacePath: fixture.workspacePath,
    kbRoot: fixture.kbRoot,
    mcpName: "llm-kb",
    expectedMcpConfig: fixture.expectedMcpConfig,
    agentId: fixture.expectedAgentId,
  } as Parameters<typeof validateInstallerManifest>[1] & { agentId: string });

  assert.equal(
    validation.driftItems.some((item) => {
      return (
        item.kind === "session_runtime_hash_drift" &&
        item.expected === "analysis" &&
        item.actual === "research"
      );
    }),
    true
  );
});

test("manifest validation reports session runtime hash drift", () => {
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-substrate-workspace-")
  );
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-substrate-kb-"));
  const installedAt = new Date().toISOString();

  const installedSkills = installOpenClawSkills({
    workspacePath,
    repoRoot,
    installedAt,
  });

  const installedWorkspaceDocs = renderAllOpenClawWorkspaceDocs().map((doc) => {
    const docFile = path.resolve(workspacePath, doc.installRelativeFile);
    fs.writeFileSync(docFile, doc.content, "utf8");
    return {
      docName: doc.docName,
      docFile,
      contentHash: doc.contentHash,
      installedAt,
      preinstallSnapshot: { known: false as const },
    };
  });

  const sessionRuntime = materializeSessionRuntimeArtifacts({
    workspacePath,
    kbRoot,
    sourcePluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
    sourcePluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
    installedAt,
  }).metadata;

  const expectedMcpConfig = buildExpectedMcpConfig({
    mcpName: "llm-kb",
    serverEntrypoint: path.resolve(repoRoot, "dist", "mcp_server.js"),
    kbRoot,
    nodeCommand: process.execPath,
  });

  const manifest = createInstallerManifest({
    installerVersion: "0.1.0",
    repoRoot,
    workspacePath,
    kbRoot,
    mcpName: "llm-kb",
    installedAt,
    installedSkills,
    installedWorkspaceDocs,
    sessionRuntime,
    expectedMcpConfig,
  });

  fs.appendFileSync(sessionRuntime.pluginIndexFile, "\n// drift\n", "utf8");

  const validation = validateInstallerManifest(manifest, {
    repoRoot,
    workspacePath,
    kbRoot,
    mcpName: "llm-kb",
    expectedMcpConfig,
  });

  assert.equal(
    validation.driftItems.some((item) => item.kind === "session_runtime_hash_drift"),
    true
  );
});

test("session runtime tool policy targets configured agent id", async () => {
  const workspacePath = "/tmp/research-workspace";
  let agentsList: unknown = [
    {
      id: "llmwiki",
      workspace: "/tmp/llmwiki-workspace",
      tools: {
        alsoAllow: [],
      },
    },
    {
      id: "research",
      workspace: workspacePath,
      tools: {
        alsoAllow: [],
      },
    },
  ];
  const fakeCli = {
    async getConfigValue() {
      return agentsList;
    },
    async setConfigValueStrictJson(_configPath: string, value: unknown) {
      agentsList = value;
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    },
  };

  await ensureSessionRuntimeAgentToolPolicy({
    cli: fakeCli as never,
    agentId: "research",
    workspacePath,
  });

  assert.equal(
    await hasSessionRuntimeAgentToolPolicy({
      cli: fakeCli as never,
      agentId: "research",
      workspacePath,
    }),
    true
  );
  assert.equal(
    await hasSessionRuntimeAgentToolPolicy({
      cli: fakeCli as never,
      agentId: "llmwiki",
      workspacePath: "/tmp/llmwiki-workspace",
    }),
    false
  );

  await removeSessionRuntimeAgentToolPolicy({
    cli: fakeCli as never,
    agentId: "research",
    workspacePath,
  });

  assert.equal(
    await hasSessionRuntimeAgentToolPolicy({
      cli: fakeCli as never,
      agentId: "research",
      workspacePath,
    }),
    false
  );
});

test("session runtime tool policy cleanup can remove previous owner only", async () => {
  const workspacePath = "/tmp/shared-workspace";
  let agentsList: unknown = [
    {
      id: "llmwiki",
      workspace: workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "research",
      workspace: workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ];
  const fakeCli = {
    async getConfigValue() {
      return agentsList;
    },
    async setConfigValueStrictJson(_configPath: string, value: unknown) {
      agentsList = value;
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    },
  };

  await removeSessionRuntimeAgentToolPolicy({
    cli: fakeCli as never,
    agentId: "llmwiki",
    workspacePath,
    allowMissingTarget: true,
  });

  assert.equal(
    await hasSessionRuntimeAgentToolPolicy({
      cli: fakeCli as never,
      agentId: "llmwiki",
      workspacePath,
    }),
    false
  );
  assert.equal(
    await hasSessionRuntimeAgentToolPolicy({
      cli: fakeCli as never,
      agentId: "research",
      workspacePath,
    }),
    true
  );
});

test("session runtime tool policy retarget cleanup removes specified old agent even when workspace drifted", async () => {
  const workspacePath = "/tmp/current-workspace";
  const state = createMutableOpenClawCliState([
    {
      id: "legacy",
      workspace: "/tmp/legacy-old-workspace",
      tools: {
        allow: ["llmwiki-kb-tools"],
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "research",
      workspace: workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "analytics",
      workspace: "/tmp/analytics",
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ]);

  await removeSessionRuntimeAgentToolPolicy({
    cli: state.cli as never,
    agentId: "legacy",
    workspacePath,
    allowMissingTarget: true,
    matchAgentIdOnly: true,
  });

  const nextAgents = state.readAgentsList() as Array<Record<string, unknown>>;
  const legacy = nextAgents.find((entry) => entry.id === "legacy");
  const research = nextAgents.find((entry) => entry.id === "research");
  const analytics = nextAgents.find((entry) => entry.id === "analytics");

  assert.ok(legacy);
  assert.ok(research);
  assert.ok(analytics);
  assert.equal(entryHasPluginPolicy(legacy), false);
  assert.equal(entryHasPluginPolicy(research), true);
  assert.equal(entryHasPluginPolicy(analytics), true);
});

test("session runtime tool policy agent-id-only cleanup fails closed on duplicate agent ids", async () => {
  const workspacePath = "/tmp/current-workspace";
  const initialAgentsList = [
    {
      id: "legacy",
      workspace: "/tmp/legacy-old-workspace",
      tools: {
        allow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "legacy",
      workspace: "/tmp/legacy-other-workspace",
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "research",
      workspace: workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ];
  const state = createMutableOpenClawCliState(initialAgentsList);

  await assert.rejects(
    removeSessionRuntimeAgentToolPolicy({
      cli: state.cli as never,
      agentId: "legacy",
      workspacePath,
      allowMissingTarget: true,
      matchAgentIdOnly: true,
    }),
    /ambiguous.*agent "legacy"/u
  );

  assert.deepEqual(state.readAgentsList(), initialAgentsList);
});

test("uninstall force cleanup removes manifest previous agent tool policy despite workspace drift", async () => {
  const fixture = createManifestFixture({ agentId: "legacy" });
  writeInstallerManifest(fixture.workspacePath, fixture.manifest);

  const state = createMutableOpenClawCliState([
    {
      id: "research",
      workspace: fixture.workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "legacy",
      workspace: "/tmp/legacy-not-current-workspace",
      tools: {
        allow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "analytics",
      workspace: "/tmp/analytics",
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ]);

  await uninstallOpenClawIntegration(
    {
      command: "uninstall",
      workspace: fixture.workspacePath,
      mcpName: "llm-kb",
      agentId: "research",
      force: true,
    },
    {
      repoRoot,
      installerEntrypoint: path.resolve(repoRoot, "dist", "openclaw-installer.js"),
      mcpServerEntrypoint: path.resolve(repoRoot, "dist", "mcp_server.js"),
      openclawPluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
      openclawPluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
      command: "uninstall",
      workspace: fixture.workspacePath,
      kbRoot: fixture.kbRoot,
      mcpName: "llm-kb",
      agentId: "research",
    },
    {
      cli: state.cli as never,
    }
  );

  const nextAgents = state.readAgentsList() as Array<Record<string, unknown>>;
  const research = nextAgents.find((entry) => entry.id === "research");
  const legacy = nextAgents.find((entry) => entry.id === "legacy");
  const analytics = nextAgents.find((entry) => entry.id === "analytics");
  assert.ok(research);
  assert.ok(legacy);
  assert.ok(analytics);
  assert.equal(entryHasPluginPolicy(research), false);
  assert.equal(entryHasPluginPolicy(legacy), false);
  assert.equal(entryHasPluginPolicy(analytics), true);
});

test("uninstall fails closed before mutation when previous agent cleanup is ambiguous", async () => {
  const fixture = createManifestFixture({ agentId: "legacy" });
  writeInstallerManifest(fixture.workspacePath, fixture.manifest);
  const initialAgentsList = [
    {
      id: "research",
      workspace: fixture.workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "legacy",
      workspace: "/tmp/legacy-one",
      tools: {
        allow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "legacy",
      workspace: "/tmp/legacy-two",
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ];
  const state = createMutableOpenClawCliState(initialAgentsList);

  await assert.rejects(
    uninstallOpenClawIntegration(
      {
        command: "uninstall",
        workspace: fixture.workspacePath,
        mcpName: "llm-kb",
        agentId: "research",
        force: true,
      },
      {
        repoRoot,
        installerEntrypoint: path.resolve(repoRoot, "dist", "openclaw-installer.js"),
        mcpServerEntrypoint: path.resolve(repoRoot, "dist", "mcp_server.js"),
        openclawPluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
        openclawPluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
        command: "uninstall",
        workspace: fixture.workspacePath,
        kbRoot: fixture.kbRoot,
        mcpName: "llm-kb",
        agentId: "research",
      },
      {
        cli: state.cli as never,
      }
    ),
    /ambiguous.*agent "legacy"/u
  );

  assert.equal(fs.existsSync(fixture.sessionRuntime.pluginRoot), true);
  assert.equal(fs.existsSync(resolveInstallerManifestPath(fixture.workspacePath)), true);
  assert.deepEqual(state.readAgentsList(), initialAgentsList);
});

test("check fail-closed: manifest runtime agent mismatch does not probe old runtime metadata", async () => {
  const fixture = createManifestFixture({ agentId: "legacy" });
  writeInstallerManifest(fixture.workspacePath, fixture.manifest);

  const state = createMutableOpenClawCliState([
    {
      id: "research",
      workspace: fixture.workspacePath,
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
    {
      id: "legacy",
      workspace: "/tmp/legacy-not-current-workspace",
      tools: {
        alsoAllow: ["llmwiki-kb-tools"],
      },
    },
  ]);

  const result = await checkOpenClawInstallation({
    environment: {
      repoRoot,
      installerEntrypoint: path.resolve(repoRoot, "dist", "openclaw-installer.js"),
      mcpServerEntrypoint: path.resolve(repoRoot, "dist", "mcp_server.js"),
      openclawPluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
      openclawPluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
      command: "check",
      workspace: fixture.workspacePath,
      kbRoot: fixture.kbRoot,
      mcpName: "llm-kb",
      agentId: "research",
    },
    requestedWorkspace: fixture.workspacePath,
    mcpName: "llm-kb",
    cli: state.cli as never,
  });

  assert.equal(
    result.driftItems.some((item) => {
      return (
        item.kind === "session_runtime_hash_drift" &&
        item.expected === "research" &&
        item.actual === "legacy"
      );
    }),
    true
  );
  assert.equal(result.lastSessionProbe, undefined);
});

test("session runtime materialization rejects symlinked plugin root", () => {
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-substrate-symlink-workspace-")
  );
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-substrate-symlink-kb-"));
  const symlinkTarget = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-substrate-symlink-target-")
  );
  const pluginRoot = path.resolve(
    workspacePath,
    ".openclaw/extensions/llmwiki-kb-tools"
  );
  fs.mkdirSync(path.dirname(pluginRoot), { recursive: true });
  fs.symlinkSync(symlinkTarget, pluginRoot);

  assert.throws(
    () =>
      materializeSessionRuntimeArtifacts({
        workspacePath,
        kbRoot,
        sourcePluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
        sourcePluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
      }),
    /symlink/u
  );
});

test("workspace doc rendering is deterministic and follows installed-agent semantics", () => {
  const first = renderAllOpenClawWorkspaceDocs();
  const second = renderAllOpenClawWorkspaceDocs();
  assert.deepEqual(first, second);

  const docs = new Map(first.map((doc) => [doc.docName, doc.content]));
  assert.equal(docs.size, 4);

  const agents = mustGetDoc(docs, "AGENTS.md");
  const soul = mustGetDoc(docs, "SOUL.md");
  const tools = mustGetDoc(docs, "TOOLS.md");
  const heartbeat = mustGetDoc(docs, "HEARTBEAT.md");

  assertContains(
    agents,
    "installer-configured OpenClaw agent",
    "AGENTS.md"
  );
  assertNotContains(agents, "绑定 `llmwiki`", "AGENTS.md");
  assertNotContains(agents, "`llmwiki` 会话可见", "AGENTS.md");
  assertContains(
    agents,
    "`KB_ROOT` 是已安装的 `kb` 目录本体，而不是 `<KB_ROOT>/kb/...` 或 workspace-local `kb/`。",
    "AGENTS.md"
  );
  assertContains(agents, "<KB_ROOT>/raw", "AGENTS.md");
  assertContains(agents, "<KB_ROOT>/wiki", "AGENTS.md");
  assertContains(agents, "<KB_ROOT>/schema", "AGENTS.md");
  assertContains(agents, "<KB_ROOT>/state", "AGENTS.md");
  assertContains(agents, "`wiki/index.md`、`wiki/log.md` 均相对 `KB_ROOT` 解析。", "AGENTS.md");
  assertContains(
    agents,
    "`schema/guidance layer`，用于约束 Agent 维护 `wiki` 的运行规则。",
    "AGENTS.md"
  );
  assertContains(agents, "<KB_ROOT>/wiki/analyses/", "AGENTS.md");
  assertContains(agents, "plan -> draft -> apply", "AGENTS.md");
  assertContains(agents, "冲突与开放问题必须显式写出", "AGENTS.md");
  assertContains(agents, "仅保存 MCP 配置不足以代表可用", "AGENTS.md");

  assertContains(soul, "installer-configured OpenClaw agent", "SOUL.md");
  assertNotContains(soul, "`llmwiki` 会话可见", "SOUL.md");
  assertContains(soul, "使命是长期维护可演化 wiki", "SOUL.md");
  assertContains(soul, "人类负责目标与裁决，Agent 负责检索、编译、交叉链接与一致性维护。", "SOUL.md");
  assertContains(soul, "高价值 query 输出", "SOUL.md");
  assertContains(soul, "仅保存 MCP 配置不能证明可用性；standalone MCP 连通性只是兼容/调试路径。", "SOUL.md");
  assertContains(soul, "ownership 未知、状态歧义、运行时冲突时失败即停并升级人工处理。", "SOUL.md");

  assertContains(tools, "installer-configured OpenClaw agent", "TOOLS.md");
  assertNotContains(tools, "`llmwiki` 会话可见", "TOOLS.md");
  assertContains(tools, "## KB MCP Tools (11)", "TOOLS.md");
  assertContains(
    tools,
    "所有 canonical `kb_*` tools 都读写当前安装绑定的 external `KB_ROOT`，工具路径相对该目录解析。",
    "TOOLS.md"
  );
  for (const toolName of EXPECTED_KB_TOOL_NAMES) {
    assertContains(tools, `\`${toolName}\``, "TOOLS.md");
  }
  assertContains(
    tools,
    "`kb_commit` 属于高风险动作：仅在用户显式要求提交、且当前 workflow 明确需要时执行。",
    "TOOLS.md"
  );
  assertContains(
    tools,
    "仅保存 MCP 配置不足以证明 OpenClaw 可用；standalone MCP 只用于兼容性/调试排障。",
    "TOOLS.md"
  );

  assertContains(heartbeat, "installer-configured OpenClaw agent", "HEARTBEAT.md");
  assertNotContains(heartbeat, "`llmwiki` 会话可见", "HEARTBEAT.md");
  assertContains(heartbeat, "## 启动", "HEARTBEAT.md");
  assertContains(heartbeat, "## 执行", "HEARTBEAT.md");
  assertContains(heartbeat, "## 收尾", "HEARTBEAT.md");
  assertContains(heartbeat, "严格 wiki-first：先查 `wiki`，再按需读 `raw`。", "HEARTBEAT.md");
  assertContains(heartbeat, "`wiki/index.md`（或父级/index）与 `wiki/log.md`", "HEARTBEAT.md");
  assertContains(
    heartbeat,
    "执行 `kb_run_lint` 做质量检查；必要时再 `kb_rebuild_index` / `kb_repair`，并保留审计记录。",
    "HEARTBEAT.md"
  );
  assertContains(
    heartbeat,
    "standalone MCP 连通性只作为兼容/调试信号，不是 OpenClaw 可用性成功契约。",
    "HEARTBEAT.md"
  );
  assertContains(
    heartbeat,
    "出现 ownership 歧义或运行时状态异常时 fail-closed，禁止猜测性修复。",
    "HEARTBEAT.md"
  );
});

test("operator-facing docs encode the OpenClaw installer success contract", () => {
  const readme = fs.readFileSync(path.resolve(repoRoot, "README.md"), "utf8");
  const agentGuide = fs.readFileSync(
    path.resolve(repoRoot, "docs/openclaw-installer-agent-guide.md"),
    "utf8"
  );
  const technical = fs.readFileSync(path.resolve(repoRoot, "docs/technical.md"), "utf8");

  assertContains(
    readme,
    "`KB_ROOT` is the installed `kb` directory itself (`<KB_ROOT>/raw`, `<KB_ROOT>/wiki`, `<KB_ROOT>/schema`, `<KB_ROOT>/state`)",
    "README.md"
  );
  assertContains(
    readme,
    "Tool-relative paths such as `wiki/index.md` and `wiki/log.md` are resolved under that `KB_ROOT`",
    "README.md"
  );
  assertContains(
    readme,
    "configured OpenClaw agent session-visible `kb_*` availability as the primary health contract; saved MCP config alone is insufficient evidence of OpenClaw usability.",
    "README.md"
  );
  assertContains(readme, "--agent-id", "README.md");
  assertNotContains(readme, "in `llmwiki` as the primary health contract", "README.md");
  assertContains(
    readme,
    "The standalone MCP server remains a secondary compatibility/debugging surface, not the OpenClaw success criterion.",
    "README.md"
  );

  assertContains(
    agentGuide,
    "`KB_ROOT` in this installer contract means the installed `kb` directory itself: `<KB_ROOT>/raw`, `<KB_ROOT>/wiki`, `<KB_ROOT>/schema`, `<KB_ROOT>/state`",
    "docs/openclaw-installer-agent-guide.md"
  );
  assertContains(
    agentGuide,
    "runtime tool paths like `wiki/index.md` and `wiki/log.md` resolve directly under that root",
    "docs/openclaw-installer-agent-guide.md"
  );
  assertContains(
    agentGuide,
    "Saved MCP config alone is never sufficient proof of OpenClaw usability; configured OpenClaw agent session-visible canonical `kb_*` tools are the success criterion.",
    "docs/openclaw-installer-agent-guide.md"
  );
  assertContains(agentGuide, "--agent-id", "docs/openclaw-installer-agent-guide.md");
  assertNotContains(
    agentGuide,
    "`llmwiki` session-visible canonical `kb_*` tools are the success criterion",
    "docs/openclaw-installer-agent-guide.md"
  );
  assertContains(
    agentGuide,
    "secondary compatibility/debugging surface",
    "docs/openclaw-installer-agent-guide.md"
  );

  assertContains(
    technical,
    "`check --workspace <path> [--agent-id <id>] [--mcp-name <name>] [--json]`",
    "docs/technical.md"
  );
  assertContains(
    technical,
    "`install/check/repair/uninstall` 都要求显式 `--workspace`，并使用显式或默认的 `--agent-id` 选择 configured OpenClaw agent。",
    "docs/technical.md"
  );
  assertContains(
    technical,
    "`KB_ROOT` 指向已安装 `kb` 目录本体（`<KB_ROOT>/raw|wiki|schema|state`），工具相对路径如 `wiki/index.md`、`wiki/log.md` 都在该根下解析；不是 `<KB_ROOT>/kb/...`，也不是 workspace-local `kb/`。",
    "docs/technical.md"
  );
  assertContains(
    technical,
    "OpenClaw 可用性成功判据是 configured OpenClaw agent 会话可见 canonical `kb_*`；仅保存 MCP 配置不足以代表可用。standalone MCP 只作为兼容/调试路径。",
    "docs/technical.md"
  );
  assertNotContains(
    technical,
    "成功判据是 `llmwiki` 会话可见 canonical `kb_*`",
    "docs/technical.md"
  );
});
