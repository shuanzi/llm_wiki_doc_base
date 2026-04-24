import {
  INSTALLER_COMMANDS,
  type CheckCommandArgs,
  type InstallCommandArgs,
  type InstallerCommandName,
  type ParsedInstallerArgs,
  type RepairCommandArgs,
  type UninstallCommandArgs,
} from "./types";

const DEFAULT_MCP_NAME = "llm-kb";
const DEFAULT_AGENT_ID = "llmwiki";

type ParsedOption = {
  flags: Set<string>;
  values: Map<string, string>;
};

export class InstallerCliUsageError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "InstallerCliUsageError";
    this.exitCode = exitCode;
  }
}

export function parseInstallerArgs(argv: readonly string[]): ParsedInstallerArgs {
  const [commandToken, ...rest] = argv;

  if (!commandToken) {
    throw new InstallerCliUsageError(formatInstallerUsage());
  }

  if (isHelpToken(commandToken)) {
    throw new InstallerCliUsageError(formatInstallerUsage(), 0);
  }

  if (!isInstallerCommandName(commandToken)) {
    throw new InstallerCliUsageError(
      `Unknown command "${commandToken}".\n\n${formatInstallerUsage()}`
    );
  }

  const options = parseOptions(rest);

  if (options.flags.has("help")) {
    throw new InstallerCliUsageError(formatInstallerUsage(commandToken), 0);
  }

  switch (commandToken) {
    case "install":
      return parseInstallArgs(options);
    case "check":
      return parseCheckArgs(options);
    case "repair":
      return parseRepairArgs(options);
    case "uninstall":
      return parseUninstallArgs(options);
  }
}

export function isParsedCheckJsonInvocation(argv: readonly string[]): boolean {
  const [commandToken, ...rest] = argv;

  if (commandToken !== "check") {
    return false;
  }

  return rest.some((token) => token === "--json" || token.startsWith("--json="));
}

export function formatInstallerUsage(command?: InstallerCommandName): string {
  const sections = [
    "Usage:",
    "  kb-openclaw-installer install --workspace <path> --kb-root <path> [--agent-id <id>] [--mcp-name <name>] [--force]",
    "  kb-openclaw-installer check --workspace <path> [--agent-id <id>] [--mcp-name <name>] [--json]",
    "  kb-openclaw-installer repair --workspace <path> [--kb-root <path>] [--agent-id <id>] [--mcp-name <name>] [--force]",
    "  kb-openclaw-installer uninstall --workspace <path> [--agent-id <id>] [--mcp-name <name>] [--force]",
    "",
    "Global flags:",
    "  --help                Show this help message",
    "  --mcp-name <name>     MCP registration name (default: llm-kb)",
    "  --agent-id <id>       OpenClaw agent id bound to --workspace (default: llmwiki)",
  ];

  if (!command) {
    return sections.join("\n");
  }

  const details: Record<InstallerCommandName, string[]> = {
    install: [
      "install flags:",
      "  --workspace <path>   Required explicit workspace target path",
      "  --kb-root <path>     Required KB root path",
      "  --agent-id <id>      OpenClaw agent id bound to --workspace",
      "  --force              Allow overwriting installer-owned state",
    ],
    check: [
      "check flags:",
      "  --workspace <path>   Required explicit workspace target path",
      "  --agent-id <id>      OpenClaw agent id bound to --workspace",
      "  --json               Emit machine-readable JSON output",
    ],
    repair: [
      "repair flags:",
      "  --workspace <path>   Required explicit workspace target path",
      "  --kb-root <path>     Optional KB root override",
      "  --agent-id <id>      OpenClaw agent id bound to --workspace",
      "  --force              Allow overwriting installer-owned state",
    ],
    uninstall: [
      "uninstall flags:",
      "  --workspace <path>   Required explicit workspace target path",
      "  --agent-id <id>      OpenClaw agent id bound to --workspace",
      "  --force              Allow removing installer-owned state without prompts",
    ],
  };

  return [...sections, "", ...details[command]].join("\n");
}

function parseInstallArgs(options: ParsedOption): InstallCommandArgs {
  assertNoUnknownFlags(options, ["workspace", "kb-root", "mcp-name", "agent-id", "force", "help"]);

  return {
    command: "install",
    workspace: requireValue(options, "workspace", "install"),
    kbRoot: requireValue(options, "kb-root", "install"),
    mcpName: readMcpName(options),
    agentId: readAgentId(options),
    force: options.flags.has("force"),
  };
}

function parseCheckArgs(options: ParsedOption): CheckCommandArgs {
  assertNoUnknownFlags(options, ["workspace", "mcp-name", "agent-id", "json", "help"]);

  return {
    command: "check",
    workspace: requireValue(options, "workspace", "check"),
    mcpName: readMcpName(options),
    agentId: readAgentId(options),
    json: options.flags.has("json"),
  };
}

function parseRepairArgs(options: ParsedOption): RepairCommandArgs {
  assertNoUnknownFlags(options, ["workspace", "kb-root", "mcp-name", "agent-id", "force", "help"]);

  return {
    command: "repair",
    workspace: requireValue(options, "workspace", "repair"),
    kbRoot: readOptionalValue(options, "kb-root"),
    mcpName: readMcpName(options),
    agentId: readAgentId(options),
    force: options.flags.has("force"),
  };
}

function parseUninstallArgs(options: ParsedOption): UninstallCommandArgs {
  assertNoUnknownFlags(options, ["workspace", "mcp-name", "agent-id", "force", "help"]);

  return {
    command: "uninstall",
    workspace: requireValue(options, "workspace", "uninstall"),
    mcpName: readMcpName(options),
    agentId: readAgentId(options),
    force: options.flags.has("force"),
  };
}

function parseOptions(argv: readonly string[]): ParsedOption {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "-h") {
      assertNoDuplicateFlagOption(flags, "help");
      flags.add("help");
      continue;
    }

    if (!token.startsWith("--")) {
      throw new InstallerCliUsageError(`Unexpected positional argument "${token}".`);
    }

    const normalized = token.slice(2);

    if (!normalized) {
      throw new InstallerCliUsageError("Encountered an empty option token.");
    }

    const [name, inlineValue] = normalized.split("=", 2);

    if (inlineValue !== undefined) {
      if (!expectsValue(name)) {
        throw new InstallerCliUsageError(`Option --${name} does not take a value.`);
      }
      if (isHelpValueToken(inlineValue)) {
        throw new InstallerCliUsageError(`Option --${name} requires a value.`);
      }

      assertNoDuplicateValueOption(values, name);
      values.set(name, inlineValue);
      continue;
    }

    const value = argv[index + 1];

    if (expectsValue(name)) {
      if (
        value === undefined ||
        isHelpValueToken(value) ||
        isLikelyOptionToken(value)
      ) {
        throw new InstallerCliUsageError(`Option --${name} requires a value.`);
      }

      assertNoDuplicateValueOption(values, name);
      values.set(name, value);
      index += 1;
      continue;
    }

    assertNoDuplicateFlagOption(flags, name);
    flags.add(name);
  }

  return { flags, values };
}

function requireValue(
  options: ParsedOption,
  name: string,
  command: InstallerCommandName
): string {
  const value = readOptionalValue(options, name);

  if (!value) {
    const requirementMessage =
      name === "workspace"
        ? `Command "${command}" requires --workspace to explicitly target a workspace path.`
        : `Command "${command}" requires --${name}.`;
    throw new InstallerCliUsageError(
      `${requirementMessage}\n\n${formatInstallerUsage(command)}`
    );
  }

  return value;
}

function readOptionalValue(options: ParsedOption, name: string): string | undefined {
  return options.values.get(name);
}

function readMcpName(options: ParsedOption): string {
  const value = readOptionalValue(options, "mcp-name");

  if (value === undefined) {
    return DEFAULT_MCP_NAME;
  }

  if (value.length === 0) {
    throw new InstallerCliUsageError("Option --mcp-name must not be empty.");
  }

  return value;
}

function readAgentId(options: ParsedOption): string {
  const value = readOptionalValue(options, "agent-id");

  if (value === undefined) {
    return DEFAULT_AGENT_ID;
  }

  if (value.length === 0) {
    throw new InstallerCliUsageError("Option --agent-id must not be empty.");
  }

  return value;
}

function assertNoUnknownFlags(options: ParsedOption, allowedNames: string[]): void {
  const allowed = new Set(allowedNames);
  const unknownFlags = [...options.flags].filter((flag) => !allowed.has(flag));
  const unknownValues = [...options.values.keys()].filter((name) => !allowed.has(name));
  const unknown = [...unknownFlags, ...unknownValues];

  if (unknown.length > 0) {
    throw new InstallerCliUsageError(
      `Unknown option(s): ${unknown.map((name) => `--${name}`).join(", ")}.`
    );
  }
}

function expectsValue(name: string): boolean {
  return (
    name === "workspace" ||
    name === "kb-root" ||
    name === "mcp-name" ||
    name === "agent-id"
  );
}

function assertNoDuplicateValueOption(values: Map<string, string>, name: string): void {
  if (values.has(name)) {
    throw new InstallerCliUsageError(`Option --${name} must not be provided more than once.`);
  }
}

function assertNoDuplicateFlagOption(flags: Set<string>, name: string): void {
  if (flags.has(name)) {
    throw new InstallerCliUsageError(`Option --${name} must not be provided more than once.`);
  }
}

function isHelpToken(token: string): boolean {
  return token === "--help" || token === "-h" || token === "help";
}

function isHelpValueToken(token: string): boolean {
  return token === "--help" || token === "-h";
}

function isLikelyOptionToken(token: string): boolean {
  return token.startsWith("--");
}

function isInstallerCommandName(value: string): value is InstallerCommandName {
  return INSTALLER_COMMANDS.includes(value as InstallerCommandName);
}
