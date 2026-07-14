import { z } from "zod";

import { namedDefinitionSchema, nonEmptyStringSchema } from "./common.js";

const resourceBaseShape = {
  name: namedDefinitionSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  mimeType: nonEmptyStringSchema.optional(),
  source: nonEmptyStringSchema.optional(),
};

export const resourceSchema = z
  .object({
    ...resourceBaseShape,
    uri: nonEmptyStringSchema,
  })
  .strict();

export const resourceTemplateSchema = z
  .object({
    ...resourceBaseShape,
    uriTemplate: nonEmptyStringSchema,
  })
  .strict();

export type Resource = z.infer<typeof resourceSchema>;
export type ResourceTemplate = z.infer<typeof resourceTemplateSchema>;
