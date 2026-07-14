import { z } from "zod";

import { nonEmptyStringSchema, relativePathSchema } from "./common.js";

export const clientUpdateModeSchema = z.enum([
  "preview",
  "merge",
  "replace-managed-section",
]);

export const clientConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    configPath: relativePathSchema.optional(),
    serverName: nonEmptyStringSchema.optional(),
    updateMode: clientUpdateModeSchema.default("preview"),
  })
  .strict();

export const clientsSchema = z
  .object({
    "lm-studio": clientConfigSchema.optional(),
    "claude-desktop": clientConfigSchema.optional(),
    cursor: clientConfigSchema.optional(),
    codex: clientConfigSchema.optional(),
    continue: clientConfigSchema.optional(),
    "generic-json": clientConfigSchema.optional(),
  })
  .strict();

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type Clients = z.infer<typeof clientsSchema>;
export type ClientUpdateMode = z.infer<typeof clientUpdateModeSchema>;
