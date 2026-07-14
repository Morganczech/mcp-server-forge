import { z } from "zod";

import {
  namedDefinitionSchema,
  nonEmptyStringSchema,
  relativePathSchema,
} from "./common.js";

export const promptArgumentSchema = z
  .object({
    name: namedDefinitionSchema,
    description: nonEmptyStringSchema,
    required: z.boolean().default(false),
  })
  .strict();

export const promptSchema = z
  .object({
    name: namedDefinitionSchema,
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    arguments: z.array(promptArgumentSchema).default([]),
    templatePath: relativePathSchema.optional(),
  })
  .strict();

export type Prompt = z.infer<typeof promptSchema>;
export type PromptArgument = z.infer<typeof promptArgumentSchema>;
