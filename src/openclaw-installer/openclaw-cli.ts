import { spawn } from "child_process";

export interface OpenClawCliOptions {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface OpenClawCliInvocation {
  command: string;
  args: readonly string[];
  cwd?: string;
}

export interface OpenClawCliCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export interface OpenClawMcpServerDefinition {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  workingDirectory?: string;
  url?: string;
  headers?: Record<string, string>;
  connectionTimeoutMs?: number;
  [key: string]: unknown;
}

export interface OpenClawEligibleSkill {
  name: string;
  raw: unknown;
}

export class OpenClawCliError extends Error {
  readonly invocation: OpenClawCliInvocation;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly cause?: unknown;

  constructor(
    message: string,
    invocation: OpenClawCliInvocation,
    output: OpenClawCliCommandOutput,
    cause?: unknown
  ) {
    super(message);
    this.name = "OpenClawCliError";
    this.invocation = invocation;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
    this.exitCode = output.exitCode;
    this.signal = output.signal;
    this.cause = cause;
  }
}

export class OpenClawCliParseError extends Error {
  readonly invocation: OpenClawCliInvocation;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    invocation: OpenClawCliInvocation,
    output: Pick<OpenClawCliCommandOutput, "stdout" | "stderr">
  ) {
    super(message);
    this.name = "OpenClawCliParseError";
    this.invocation = invocation;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
  }
}

export class OpenClawCli {
  private readonly command: string;
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(options: OpenClawCliOptions = {}) {
    this.command = options.command ?? "openclaw";
    this.cwd = options.cwd;
    this.env = options.env;
  }

  async getConfigValue<T>(configPath: string, options: { allowMissing?: boolean } = {}): Promise<T | undefined> {
    const args = ["config", "get", configPath, "--json"];

    try {
      const output = await this.run(args);
      return parseRequiredJson<T>(
        output,
        this.buildInvocation(args),
        `openclaw config get ${configPath}`
      );
    } catch (error) {
      if (options.allowMissing && isMissingConfigPathError(error, configPath)) {
        return undefined;
      }
      throw error;
    }
  }

  async getConfigFilePath(): Promise<string> {
    const args = ["config", "file"];
    const output = await this.run(args);
    const value = parseSingleAbsolutePathOutput(output.stdout);

    if (!value) {
      throw new OpenClawCliParseError(
        "OpenClaw config file path was empty.",
        this.buildInvocation(args),
        output
      );
    }

    return value;
  }

  async showMcpServer(name: string): Promise<OpenClawMcpServerDefinition | undefined> {
    const args = ["mcp", "show", name, "--json"];

    try {
      const output = await this.run(args);
      return parseRequiredJson<OpenClawMcpServerDefinition>(
        output,
        this.buildInvocation(args),
        `openclaw mcp show ${name}`
      );
    } catch (error) {
      if (isMissingNamedMcpServerError(error, name)) {
        return undefined;
      }
      throw error;
    }
  }

  async setMcpServer(name: string, definition: OpenClawMcpServerDefinition): Promise<OpenClawCliCommandOutput> {
    return this.run(["mcp", "set", name, JSON.stringify(definition)]);
  }

  async unsetMcpServer(name: string): Promise<OpenClawCliCommandOutput> {
    return this.run(["mcp", "unset", name]);
  }

  async listEligibleSkills(): Promise<OpenClawEligibleSkill[]> {
    const args = ["skills", "list", "--eligible", "--json"];
    const output = await this.run(args);
    const invocation = this.buildInvocation(args);
    return normalizeEligibleSkills(
      parseRequiredJson<unknown>(output, invocation, "openclaw skills list --eligible")
    );
  }

  async run(args: readonly string[]): Promise<OpenClawCliCommandOutput> {
    const invocation = this.buildInvocation(args);

    return new Promise<OpenClawCliCommandOutput>((resolve, reject) => {
      const child = spawn(invocation.command, [...invocation.args], {
        cwd: invocation.cwd,
        env: { ...process.env, ...this.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(
          new OpenClawCliError(
            `Failed to start OpenClaw CLI (${invocation.command}): ${error.message}`,
            invocation,
            {
              stdout,
              stderr,
              exitCode: -1,
              signal: null,
            },
            error
          )
        );
      });

      child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }

        settled = true;
        const output: OpenClawCliCommandOutput = {
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          signal,
        };

        if (output.exitCode !== 0) {
          reject(
            new OpenClawCliError(
              buildCommandFailureMessage(invocation, output),
              invocation,
              output
            )
          );
          return;
        }

        resolve(output);
      });
    });
  }

  private buildInvocation(args: readonly string[]): OpenClawCliInvocation {
    return {
      command: this.command,
      args,
      cwd: this.cwd,
    };
  }
}

function buildCommandFailureMessage(
  invocation: OpenClawCliInvocation,
  output: OpenClawCliCommandOutput
): string {
  const renderedCommand = [invocation.command, ...invocation.args].join(" ");
  const details: string[] = [`OpenClaw CLI command failed: ${renderedCommand}`];

  if (output.exitCode >= 0) {
    details.push(`exit code: ${output.exitCode}`);
  }

  if (output.signal) {
    details.push(`signal: ${output.signal}`);
  }

  const stderr = output.stderr.trim();
  if (stderr) {
    details.push(`stderr: ${stderr}`);
  }

  return details.join(" | ");
}

function parseRequiredJson<T>(
  output: Pick<OpenClawCliCommandOutput, "stdout" | "stderr">,
  invocation: OpenClawCliInvocation,
  description: string
): T {
  const trimmed = output.stdout.trim();

  if (!trimmed) {
    throw new OpenClawCliParseError(
      `${description} returned empty stdout.`,
      invocation,
      output
    );
  }

  if (trimmed === "undefined") {
    throw new OpenClawCliParseError(
      `${description} returned undefined.`,
      invocation,
      output
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new OpenClawCliParseError(
      `${description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      invocation,
      output
    );
  }

  if (parsed === null) {
    throw new OpenClawCliParseError(
      `${description} returned null.`,
      invocation,
      output
    );
  }

  return parsed as T;
}

function isMissingConfigPathError(error: unknown, configPath: string): boolean {
  if (!(error instanceof OpenClawCliError)) {
    return false;
  }

  const renderedPath = JSON.stringify(configPath);
  const combined = `${error.stderr}\n${error.stdout}`;

  return [
    `Config path ${renderedPath} not found`,
    `Configuration path ${renderedPath} not found`,
    `Config key ${renderedPath} not found`,
    `Configuration key ${renderedPath} not found`,
    `Config value ${renderedPath} does not exist`,
    `Configuration value ${renderedPath} does not exist`,
  ].some((pattern) => combined.includes(pattern));
}

function isMissingNamedMcpServerError(error: unknown, serverName: string): boolean {
  if (!(error instanceof OpenClawCliError)) {
    return false;
  }

  const renderedName = JSON.stringify(serverName);
  const combined = `${error.stderr}\n${error.stdout}`;

  return [
    `MCP server ${renderedName} not found`,
    `MCP server ${renderedName} does not exist`,
    `MCP entry ${renderedName} not found`,
  ].some((pattern) => combined.includes(pattern));
}

function normalizeEligibleSkills(payload: unknown): OpenClawEligibleSkill[] {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    throw new OpenClawCliParseError(
      "OpenClaw eligible skills payload did not match the expected { skills: [...] } shape.",
      { command: "openclaw", args: ["skills", "list", "--eligible", "--json"] },
      { stdout: JSON.stringify(payload), stderr: "" }
    );
  }

  return payload.skills.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      !entry.name ||
      entry.name !== entry.name.trim() ||
      !isCanonicalSkillName(entry.name)
    ) {
      throw new OpenClawCliParseError(
        `OpenClaw eligible skills payload contained a malformed skill entry at index ${index}.`,
        { command: "openclaw", args: ["skills", "list", "--eligible", "--json"] },
        { stdout: JSON.stringify(entry), stderr: "" }
      );
    }

    return { name: entry.name, raw: entry };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSingleAbsolutePathOutput(stdout: string): string {
  const candidate = stripSingleTrailingNewline(stdout);

  if (candidate.includes("\n") || candidate.includes("\r")) {
    throw new OpenClawCliParseError(
      "OpenClaw config file output must contain exactly one non-empty line.",
      { command: "openclaw", args: ["config", "file"] },
      { stdout, stderr: "" }
    );
  }

  if (!candidate || candidate !== candidate.trim() || !isExplicitAbsolutePath(candidate)) {
    throw new OpenClawCliParseError(
      "OpenClaw config file output must be a single absolute path.",
      { command: "openclaw", args: ["config", "file"] },
      { stdout, stderr: "" }
    );
  }

  return candidate;
}

function isCanonicalSkillName(value: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(value) || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function stripSingleTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }

  return value;
}

function isExplicitAbsolutePath(value: string): boolean {
  return isPosixAbsolutePath(value) || isWindowsDriveAbsolutePath(value) || isWindowsUncPath(value);
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

function isWindowsDriveAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value);
}

function isWindowsUncPath(value: string): boolean {
  return /^\\\\[^\\\/]+[\\\/][^\\\/]+(?:[\\\/].*)?$/u.test(value);
}
