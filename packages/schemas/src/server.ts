import { z } from "zod";

import {
  exactVersionSchema,
  nonEmptyStringSchema,
  projectNameSchema,
  relativePathSchema,
} from "./common.js";

export const runtimeSchema = z.literal("node");
export const transportSchema = z.enum(["stdio", "streamable-http"]);

export const capabilitiesSchema = z
  .object({
    tools: z.boolean().default(false),
    resources: z.boolean().default(false),
    prompts: z.boolean().default(false),
  })
  .strict();

export const serverSchema = z
  .object({
    name: projectNameSchema,
    version: exactVersionSchema,
    description: nonEmptyStringSchema,
    runtime: runtimeSchema,
    transport: transportSchema,
    entrypoint: relativePathSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();

export type Server = z.infer<typeof serverSchema>;
export type ServerCapabilities = z.infer<typeof capabilitiesSchema>;
export type ServerTransport = z.infer<typeof transportSchema>;
