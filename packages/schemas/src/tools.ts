import { z } from "zod";

import {
  jsonObjectSchema,
  namedDefinitionSchema,
  nonEmptyStringSchema,
} from "./common.js";

export const toolRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const toolSchema = z
  .object({
    name: namedDefinitionSchema,
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    inputSchema: jsonObjectSchema,
    outputSchema: jsonObjectSchema.optional(),
    useWhen: nonEmptyStringSchema,
    avoidWhen: nonEmptyStringSchema,
    riskLevel: toolRiskLevelSchema,
    readOnly: z.boolean(),
    destructive: z.boolean(),
    requiresConfirmation: z.boolean(),
  })
  .strict()
  .superRefine((tool, context) => {
    if (tool.destructive && !tool.requiresConfirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiresConfirmation"],
        message: "Destructive tools must require confirmation",
      });
    }
  });

export type Tool = z.infer<typeof toolSchema>;
export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>;
