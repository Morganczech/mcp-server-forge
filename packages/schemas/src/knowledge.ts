import { z } from "zod";

import {
  namedDefinitionSchema,
  nonEmptyStringSchema,
  relativePathSchema,
} from "./common.js";

export const knowledgeReviewStatusSchema = z.enum([
  "generated",
  "needs-review",
  "approved",
  "outdated",
]);

const knowledgeSourceMetadataShape = {
  id: namedDefinitionSchema,
  title: nonEmptyStringSchema,
  language: nonEmptyStringSchema.optional(),
  reviewStatus: knowledgeReviewStatusSchema.optional(),
  private: z.boolean().default(false),
  updatedAt: z.string().datetime({ offset: true }).optional(),
};

export const localKnowledgeSourceSchema = z
  .object({
    ...knowledgeSourceMetadataShape,
    type: z.enum(["markdown", "text", "json", "yaml", "pdf", "directory"]),
    path: relativePathSchema,
  })
  .strict();

export const webKnowledgeSourceSchema = z
  .object({
    ...knowledgeSourceMetadataShape,
    type: z.literal("web"),
    url: z.string().url(),
  })
  .strict();

export const knowledgeSourceSchema = z.discriminatedUnion("type", [
  localKnowledgeSourceSchema,
  webKnowledgeSourceSchema,
]);

export const knowledgeSchema = z
  .object({
    enabled: z.boolean().default(false),
    dataDirectory: relativePathSchema.default("knowledge"),
    manifest: relativePathSchema.default("knowledge/manifest.json"),
    publicDirectory: relativePathSchema.default("knowledge/public"),
    privateDirectory: relativePathSchema.default("knowledge/private"),
    sourceDocumentsDirectory: relativePathSchema.default("knowledge/sources"),
    generatedDocumentsDirectory: relativePathSchema.default(
      "knowledge/generated",
    ),
    index: relativePathSchema.default("knowledge/index.json"),
    sources: z.array(knowledgeSourceSchema).default([]),
  })
  .strict();

export type Knowledge = z.infer<typeof knowledgeSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type KnowledgeReviewStatus = z.infer<typeof knowledgeReviewStatusSchema>;
