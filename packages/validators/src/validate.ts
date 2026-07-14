import { forgeConfigSchema, type ForgeConfig } from "@mcp-server-forge/schemas";

import { hasErrors, sortDiagnostics } from "./diagnostics.js";
import { schemaIssuesToDiagnostics } from "./schema-diagnostics.js";
import { validateParsedForgeConfig } from "./semantic.js";
import type { ForgeValidationResult } from "./types.js";

export function validateForgeProject(input: unknown): ForgeValidationResult {
  const schemaResult = forgeConfigSchema.safeParse(input);

  if (!schemaResult.success) {
    return {
      success: false,
      diagnostics: schemaIssuesToDiagnostics(schemaResult.error.issues),
    };
  }

  const diagnostics = validateParsedForgeConfig(schemaResult.data);

  if (hasErrors(diagnostics)) {
    return { success: false, diagnostics };
  }

  return {
    success: true,
    data: schemaResult.data,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function validateKnownForgeConfig(
  config: ForgeConfig,
): ForgeValidationResult {
  const diagnostics = validateParsedForgeConfig(config);

  return hasErrors(diagnostics)
    ? { success: false, diagnostics }
    : { success: true, data: config, diagnostics };
}
