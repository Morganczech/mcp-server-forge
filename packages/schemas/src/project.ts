import { z } from "zod";

import { nonEmptyStringSchema, projectNameSchema } from "./common.js";

export const projectSchema = z
  .object({
    name: projectNameSchema,
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    language: nonEmptyStringSchema,
    license: nonEmptyStringSchema.optional(),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
