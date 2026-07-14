import { z } from "zod";

import { jsonValueSchema, nonEmptyStringSchema } from "./common.js";

export const externalSecretSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("environment-variable"),
      name: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/, "Must be an uppercase environment name"),
    })
    .strict(),
  z
    .object({
      type: z.literal("secret-manager"),
      reference: nonEmptyStringSchema,
    })
    .strict(),
]);

export const environmentVariableSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/, "Must be an uppercase environment name"),
    description: nonEmptyStringSchema,
    required: z.boolean(),
    secret: z.boolean(),
    default: jsonValueSchema.optional(),
    externalSource: externalSecretSourceSchema.optional(),
  })
  .strict()
  .superRefine((variable, context) => {
    if (variable.secret && variable.default !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["default"],
        message: "Secret variables must not define an inline default value",
      });
    }
  });

export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
export type ExternalSecretSource = z.infer<typeof externalSecretSourceSchema>;
