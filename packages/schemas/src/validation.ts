import type { z } from "zod";

import { forgeConfigSchema, type ForgeConfig } from "./config.js";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { success: true; data: ForgeConfig }
  | { success: false; errors: ValidationIssue[] };

export function formatValidationIssues(
  issues: ReadonlyArray<z.ZodIssue>,
): ValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
    message: issue.message,
  }));
}

export function validateForgeConfig(input: unknown): ValidationResult {
  const result = forgeConfigSchema.safeParse(input);

  if (result.success) {
    return result;
  }

  return {
    success: false,
    errors: formatValidationIssues(result.error.issues),
  };
}
