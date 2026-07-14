import {
  createDiagnostic,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import type {
  ForgeRenderRequest,
  ForgeRenderRequestValidationResult,
} from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRenderRequest(
  input: unknown,
): ForgeRenderRequestValidationResult {
  if (
    !isObject(input) ||
    !isObject(input.config) ||
    !isObject(input.manifest) ||
    !isObject(input.templateSources) ||
    (input.options !== undefined &&
      (!isObject(input.options) ||
        Object.keys(input.options).some(
          (key) => key !== "includeConditionSkipDiagnostics",
        ) ||
        (input.options.includeConditionSkipDiagnostics !== undefined &&
          typeof input.options.includeConditionSkipDiagnostics !== "boolean")))
  ) {
    return {
      success: false,
      diagnostics: [createDiagnostic("GEN_RENDER_REQUEST_INVALID", [])],
    };
  }

  const diagnostics: ForgeDiagnostic[] = [];
  for (const [source, value] of Object.entries(input.templateSources)) {
    if (typeof value !== "string") {
      diagnostics.push(
        createDiagnostic(
          "GEN_TEMPLATE_SOURCE_INVALID",
          ["templateSources", source],
          { source },
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return {
    success: true,
    data: input as unknown as ForgeRenderRequest,
    diagnostics: [],
  };
}
