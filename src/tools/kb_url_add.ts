import type { ToolResult, WorkspaceConfig } from "../types";
import {
  registerUrlSource,
  type RegisterUrlSourceInput,
  type RegisterUrlSourceResult,
} from "../core/url-source";

export async function kbUrlAdd(
  input: RegisterUrlSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<RegisterUrlSourceResult>> {
  try {
    return {
      success: true,
      data: await registerUrlSource(input, config),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
