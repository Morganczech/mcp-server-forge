import { z } from "zod";

import { nonEmptyStringSchema } from "./common.js";

export const registryTrustStatusSchema = z.enum([
  "unverified",
  "verified",
  "deprecated",
]);

export const registrySchema = z
  .object({
    publicRegistryId: nonEmptyStringSchema.optional(),
    publisher: nonEmptyStringSchema.optional(),
    sourceRepository: z.string().url().optional(),
    trustStatus: registryTrustStatusSchema.default("unverified"),
    categories: z.array(nonEmptyStringSchema).default([]),
    lastSyncedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RegistryMetadata = z.infer<typeof registrySchema>;
export type RegistryTrustStatus = z.infer<typeof registryTrustStatusSchema>;
