import type { ForgeMcpDiagnostic } from "./types.js";

export const FORGE_MCP_DIAGNOSTIC_CODES = [
  "MCP_CATALOG_INVALID",
  "MCP_CATALOG_READ_FAILED",
  "MCP_CONFIG_READ_FAILED",
  "MCP_CONTRACT_INVALID",
  "MCP_CURSOR_INVALID",
  "MCP_DIAGNOSTIC_NOT_FOUND",
  "MCP_OUTPUT_LIMIT_EXCEEDED",
  "MCP_PROJECT_ACCESS_DENIED",
  "MCP_PROJECT_NOT_FOUND",
  "MCP_TEMPLATE_NOT_CONFIGURED",
] as const;

export type ForgeMcpDiagnosticCode =
  (typeof FORGE_MCP_DIAGNOSTIC_CODES)[number];

export const MCP_DIAGNOSTIC_CATALOG: Record<
  ForgeMcpDiagnosticCode,
  { title: string; importance: string; safeNextStep: string }
> = {
  MCP_CATALOG_INVALID: {
    title: "Invalid project catalog",
    importance: "The configured catalog violates a Forge safety constraint.",
    safeNextStep: "Correct the catalog and restart the local MCP server.",
  },
  MCP_CATALOG_READ_FAILED: {
    title: "Project catalog could not be read",
    importance: "Forge cannot establish a trusted project allowlist.",
    safeNextStep: "Check the bounded JSON catalog path and file format.",
  },
  MCP_CONFIG_READ_FAILED: {
    title: "Project configuration could not be read",
    importance:
      "Forge cannot inspect the project without trusted configuration evidence.",
    safeNextStep: "Check the registered relative config path and file object.",
  },
  MCP_CONTRACT_INVALID: {
    title: "Forge contract validation failed",
    importance:
      "The serialized inspection or change plan did not match its versioned Forge contract.",
    safeNextStep:
      "Stop using the result and review the local Forge implementation.",
  },
  MCP_CURSOR_INVALID: {
    title: "Invalid pagination cursor",
    importance:
      "The cursor does not belong to the requested bounded list operation.",
    safeNextStep: "Restart pagination without a cursor.",
  },
  MCP_DIAGNOSTIC_NOT_FOUND: {
    title: "Unknown diagnostic code",
    importance: "Forge has no registered explanation for the requested code.",
    safeNextStep: "Use the exact code returned by a Forge diagnostic.",
  },
  MCP_OUTPUT_LIMIT_EXCEEDED: {
    title: "Safe output limit exceeded",
    importance:
      "Returning the complete result would exceed the MCP response boundary.",
    safeNextStep: "Request a smaller page or narrower result.",
  },
  MCP_PROJECT_ACCESS_DENIED: {
    title: "Project access denied",
    importance:
      "The project or template is missing or escapes a registered allowed root.",
    safeNextStep: "Correct the local catalog registration outside MCP.",
  },
  MCP_PROJECT_NOT_FOUND: {
    title: "Project is not registered",
    importance: "MCP tools may inspect only explicitly catalogued project IDs.",
    safeNextStep: "Choose an ID returned by forge_list_projects.",
  },
  MCP_TEMPLATE_NOT_CONFIGURED: {
    title: "Template is not configured",
    importance: "A fresh preview requires an explicitly registered template.",
    safeNextStep:
      "Register a safe project-relative template in the local catalog.",
  },
};

export function mcpDiagnostic(
  code: ForgeMcpDiagnosticCode,
  message: string,
  severity: ForgeMcpDiagnostic["severity"] = "error",
): ForgeMcpDiagnostic {
  return { code, severity, message };
}
