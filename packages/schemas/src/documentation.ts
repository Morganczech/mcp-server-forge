import { z } from "zod";

import { nonEmptyStringSchema } from "./common.js";

export const documentationOutputsSchema = z
  .object({
    readme: z.boolean().default(false),
    shortSystemPrompt: z.boolean().default(false),
    fullSystemPrompt: z.boolean().default(false),
    agents: z.boolean().default(false),
    queryExamples: z.boolean().default(false),
    clientConfigurations: z.boolean().default(false),
  })
  .strict();

export const documentationSchema = z
  .object({
    language: nonEmptyStringSchema.default("en"),
    outputs: documentationOutputsSchema.default({}),
  })
  .strict();

export type Documentation = z.infer<typeof documentationSchema>;
export type DocumentationOutputs = z.infer<typeof documentationOutputsSchema>;
