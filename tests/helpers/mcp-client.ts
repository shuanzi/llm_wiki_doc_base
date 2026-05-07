import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpToolClient {
  listTools(): Promise<unknown>;
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  callToolAtStage<T = unknown>(
    stage: string,
    name: string,
    args?: Record<string, unknown>,
    context?: string
  ): Promise<T>;
  close(): Promise<void>;
}

interface StartKbMcpClientOptions {
  serverCommand: string;
  serverArgs: string[];
  kbRoot: string;
  cwd: string;
}

type McpTextToolResponse = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
};

const MAX_ERROR_SNIPPET_LENGTH = 500;

function isMcpTextToolResponse(value: unknown): value is McpTextToolResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function safeSnippet(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text === undefined) {
    text = "undefined";
  }

  return text.length > MAX_ERROR_SNIPPET_LENGTH
    ? `${text.slice(0, MAX_ERROR_SNIPPET_LENGTH)}...`
    : text;
}

function contentTypeList(response: McpTextToolResponse): string {
  const types = response.content.map((item) => item.type || "<empty>");
  return types.length > 0 ? types.join(", ") : "<none>";
}

function parseMcpToolJson<T>(name: string, response: unknown): T {
  if (!isMcpTextToolResponse(response)) {
    throw new Error(
      `MCP 工具 ${name} 返回了不支持的响应形态；响应摘要：${safeSnippet(response)}`
    );
  }

  if (response.isError) {
    const text = response.content
      .map((item) => (item.type === "text" ? item.text ?? "" : ""))
      .join("\n");
    if (!text.trim()) {
      throw new Error(
        `MCP 工具 ${name} 返回错误但没有文本内容；content types：${contentTypeList(response)}`
      );
    }
    throw new Error(text);
  }

  const firstText = response.content.find((item) => item.type === "text");
  if (!firstText?.text) {
    throw new Error("未返回文本内容");
  }

  try {
    return JSON.parse(firstText.text) as T;
  } catch (error) {
    throw new Error(
      `MCP 工具 ${name} 返回的文本不是合法 JSON；原因：${errorMessage(error)}；文本长度：${firstText.text.length}；文本片段：${safeSnippet(firstText.text)}`
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startKbMcpClient(
  options: StartKbMcpClientOptions
): Promise<McpToolClient> {
  const env = {
    ...getDefaultEnvironment(),
    KB_ROOT: options.kbRoot,
  };
  const transport = new StdioClientTransport({
    command: options.serverCommand,
    args: options.serverArgs,
    cwd: options.cwd,
    env,
  });

  const client = new Client({ name: "real-data-e2e-test", version: "0.1.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }

  return {
    listTools: () => client.listTools(),
    callTool: async <T = unknown>(
      name: string,
      args: Record<string, unknown> = {}
    ): Promise<T> => {
      try {
        return parseMcpToolJson<T>(name, await client.callTool({ name, arguments: args }));
      } catch (error) {
        throw new Error(`MCP 工具 ${name} 调用失败：${errorMessage(error)}`);
      }
    },
    callToolAtStage: async <T = unknown>(
      stage: string,
      name: string,
      args: Record<string, unknown> = {},
      context = ""
    ): Promise<T> => {
      try {
        return parseMcpToolJson<T>(name, await client.callTool({ name, arguments: args }));
      } catch (error) {
        const contextSuffix = context ? `；上下文：${context}` : "";
        throw new Error(
          `阶段 ${stage} 调用 MCP 工具 ${name} 失败${contextSuffix}：${errorMessage(error)}`
        );
      }
    },
    close: () => client.close(),
  };
}
