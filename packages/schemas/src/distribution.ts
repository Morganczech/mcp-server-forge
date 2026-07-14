import { z } from "zod";

import {
  exactVersionSchema,
  nonEmptyStringSchema,
  relativePathSchema,
} from "./common.js";

export const localEntrypointDistributionSchema = z
  .object({
    type: z.literal("local-entrypoint"),
    entrypoint: relativePathSchema,
  })
  .strict();

export const npmPackageDistributionSchema = z
  .object({
    type: z.literal("npm-package"),
    packageName: nonEmptyStringSchema,
    version: exactVersionSchema,
    packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]),
    args: z.array(z.string()).default([]),
  })
  .strict();

export const remoteHttpDistributionSchema = z
  .object({
    type: z.literal("remote-http"),
    url: z.string().url(),
  })
  .strict();

export const customCommandDistributionSchema = z
  .object({
    type: z.literal("custom-command"),
    command: nonEmptyStringSchema,
    args: z.array(z.string()).default([]),
  })
  .strict();

export const distributionSchema = z.discriminatedUnion("type", [
  localEntrypointDistributionSchema,
  npmPackageDistributionSchema,
  remoteHttpDistributionSchema,
  customCommandDistributionSchema,
]);

export type Distribution = z.infer<typeof distributionSchema>;
