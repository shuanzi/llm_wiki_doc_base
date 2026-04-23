import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export class OpenClawWorkspaceResolutionError extends Error {
  readonly kind: "invalid_workspace_path";
  readonly requestedWorkspace?: string;
  readonly resolvedWorkspace?: string;

  constructor(
    kind: "invalid_workspace_path",
    message: string,
    details: { requestedWorkspace?: string; resolvedWorkspace?: string } = {}
  ) {
    super(message);
    this.name = "OpenClawWorkspaceResolutionError";
    this.kind = kind;
    this.requestedWorkspace = details.requestedWorkspace;
    this.resolvedWorkspace = details.resolvedWorkspace;
  }
}

export function resolveExplicitWorkspacePath(
  requestedWorkspace: string,
  options: { cwd?: string; homeDir?: string } = {}
): string {
  const normalizedWorkspace = normalizeExplicitWorkspacePath(requestedWorkspace, options);

  if (!fs.existsSync(normalizedWorkspace)) {
    throw new OpenClawWorkspaceResolutionError(
      "invalid_workspace_path",
      `Workspace path does not exist: ${normalizedWorkspace}`,
      {
        requestedWorkspace: normalizedWorkspace,
        resolvedWorkspace: normalizedWorkspace,
      }
    );
  }

  if (!fs.statSync(normalizedWorkspace).isDirectory()) {
    throw new OpenClawWorkspaceResolutionError(
      "invalid_workspace_path",
      `Workspace path is not a directory: ${normalizedWorkspace}`,
      {
        requestedWorkspace: normalizedWorkspace,
        resolvedWorkspace: normalizedWorkspace,
      }
    );
  }

  return normalizedWorkspace;
}

function normalizeExplicitWorkspacePath(
  value: string,
  options: { cwd?: string; homeDir?: string } = {}
): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.resolve(homeDir, value.slice(2));
  }

  return path.resolve(cwd, value);
}
