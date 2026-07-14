import type { TemplateCondition } from "@mcp-server-forge/templates";

import type { ForgeRenderContext } from "./types.js";

export type ForgeConditionEvaluation =
  { valid: true; matches: boolean } | { valid: false };

function equalsFieldValue(
  context: ForgeRenderContext,
  field: string,
): string | boolean | undefined {
  switch (field) {
    case "project.language":
      return context.project.language;
    case "server.runtime":
      return context.server.runtime;
    case "server.transport":
      return context.server.transport;
    case "server.capabilities.tools":
      return context.capabilities.tools;
    case "server.capabilities.resources":
      return context.capabilities.resources;
    case "server.capabilities.prompts":
      return context.capabilities.prompts;
    case "knowledge.enabled":
      return context.knowledge.enabled;
    case "documentation.language":
      return context.documentation.language;
    case "distribution.type":
      return context.distribution.type;
    default:
      return undefined;
  }
}

export function evaluateTemplateCondition(
  condition: TemplateCondition,
  context: ForgeRenderContext,
): ForgeConditionEvaluation {
  if ("equals" in condition) {
    const value = equalsFieldValue(context, condition.field);
    return value === undefined
      ? { valid: false }
      : { valid: true, matches: value === condition.equals };
  }
  if (condition.field !== "registry.categories") return { valid: false };
  return {
    valid: true,
    matches: context.registry.categories.includes(condition.includes),
  };
}
