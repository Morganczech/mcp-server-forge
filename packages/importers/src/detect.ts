import type { ImportFormatDetection, ImportOptions } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function looksLikeServerDefinition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return ["command", "args", "env", "cwd"].some((key) => hasOwn(value, key));
}

export function detectMcpConfigurationFormat(
  input: unknown,
  options: Pick<ImportOptions, "sourceKind"> = {},
): ImportFormatDetection {
  if (options.sourceKind !== undefined) {
    return {
      status: "detected",
      format: options.sourceKind,
      confidence: "high",
      reason: `The sourceKind option explicitly selected ${options.sourceKind}.`,
    };
  }

  if (!isRecord(input)) {
    return {
      status: "unsupported",
      confidence: "low",
      reason: "The input root is not a JSON object.",
    };
  }

  const hasMcpServers = hasOwn(input, "mcpServers");
  const hasServers = hasOwn(input, "servers");

  if (hasMcpServers && hasServers) {
    return {
      status: "ambiguous",
      candidates: ["lm-studio", "generic-mcp-json"],
      confidence: "low",
      reason: "The root object contains both mcpServers and servers.",
    };
  }

  if (hasMcpServers) {
    return {
      status: "detected",
      format: "lm-studio",
      confidence: "high",
      reason: "The root object contains the documented mcpServers key.",
    };
  }

  if (hasServers) {
    return {
      status: "detected",
      format: "generic-mcp-json",
      confidence: "high",
      reason: "The root object contains the documented servers key.",
    };
  }

  const entries = Object.entries(input);
  if (
    entries.length > 0 &&
    entries.every(([, value]) => looksLikeServerDefinition(value))
  ) {
    return {
      status: "detected",
      format: "generic-mcp-json",
      confidence: "medium",
      reason:
        "Every root value has the shape of a generic MCP server definition.",
    };
  }

  return {
    status: "unsupported",
    confidence: "low",
    reason: "No supported MCP server map was found.",
  };
}

export { isRecord };
