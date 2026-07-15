import { z } from "zod";

import { nonEmptyStringSchema, relativePathSchema } from "./common.js";

export const networkAccessSchema = z.enum([
  "none",
  "restricted",
  "unrestricted",
]);

export const securitySchema = z
  .object({
    allowedRootDirectories: z.array(nonEmptyStringSchema).default([]),
    allowedReadPaths: z.array(relativePathSchema).default([]),
    networkAccess: networkAccessSchema.default("none"),
    shellAccess: z.boolean().default(false),
    fileWrite: z.boolean().default(false),
    fileDelete: z.boolean().default(false),
    requireConfirmation: z.boolean().default(true),
    maxResponseBytes: z.number().int().positive().default(1_048_576),
    timeoutMs: z.number().int().positive().default(30_000),
  })
  .strict();

export type Security = z.infer<typeof securitySchema>;
export type NetworkAccess = z.infer<typeof networkAccessSchema>;
