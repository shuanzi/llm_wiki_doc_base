import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildExpectedMcpConfig } from "../src/openclaw-installer/check";
import { resolveLlmwikiWorkspaceBinding } from "../src/openclaw-installer/llmwiki-binding";
import {
  createInstallerManifest,
  validateInstallerManifest,
} from "../src/openclaw-installer/manifest";
import {
  materializeSessionRuntimeArtifacts,
} from "../src/openclaw-installer/session-runtime-artifact";
import { installOpenClawSkills } from "../src/openclaw-installer/skills";
import { renderAllOpenClawWorkspaceDocs } from "../src/openclaw-installer/workspace-docs";

test("llmwiki binding fails closed on malformed workspace entries", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "llmwiki",
          workspace: "relative/path-not-allowed",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveLlmwikiWorkspaceBinding({
    workspacePath: "/tmp/llmwiki-workspace",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.malformedWorkspaceEntryCount, 1);
});

test("llmwiki binding fails closed on ambiguous workspace entries", async () => {
  const fakeCli = {
    async listConfiguredAgents() {
      return [
        {
          id: "llmwiki",
          workspace: "/tmp/workspace-a",
          raw: {},
        },
        {
          id: "llmwiki",
          workspace: "/tmp/workspace-b",
          raw: {},
        },
      ];
    },
  };

  const result = await resolveLlmwikiWorkspaceBinding({
    workspacePath: "/tmp/workspace-a",
    cli: fakeCli as never,
  });

  assert.equal(result.status, "ambiguous_binding");
  assert.equal(result.candidateWorkspaces.length, 2);
});

test("manifest validation reports session runtime hash drift", () => {
  const repoRoot = path.resolve(__dirname, "..");
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

test("session runtime materialization rejects symlinked plugin root", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-substrate-symlink-workspace-")
  );
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
        sourcePluginEntrypoint: path.resolve(repoRoot, "dist", "openclaw_plugin.js"),
        sourcePluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
      }),
    /symlink/u
  );
});
