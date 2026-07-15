import { toolSchema } from "@mcp-server-forge/schemas";
import {
  isOwnershipStrategyValid,
  isPortableRelativePath,
  isSafeTemplateSourcePath,
} from "@mcp-server-forge/templates";
import { createDiagnostic } from "@mcp-server-forge/validators";
import { z } from "zod";

import type { ForgeCapabilityValidationResult } from "./types.js";

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(64);
const exactSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const version = z.string().regex(exactSemverPattern);
const exactDependencyVersion = z.string().regex(exactSemverPattern);
const packageName = z
  .string()
  .regex(
    /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u,
  );
const file = z
  .object({
    path: z.string().refine(isPortableRelativePath),
    source: z.string().refine(isSafeTemplateSourcePath),
    ownership: z.enum(["forge-owned", "user-owned", "shared"]),
    updateStrategy: z.enum([
      "create-once",
      "replace",
      "replace-if-unmodified",
      "merge-markers",
      "manual",
    ]),
    required: z.boolean(),
    executable: z.boolean().optional(),
    contentType: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isOwnershipStrategyValid(value.ownership, value.updateStrategy)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid ownership strategy",
      });
    }
  });
const permission = z
  .object({
    permission: z.enum([
      "filesystem.read",
      "filesystem.write",
      "filesystem.delete",
      "network",
      "shell",
      "environment",
    ]),
    status: z.enum(["allowed", "denied"]),
    scope: z.array(z.string().refine(isPortableRelativePath)).max(32),
    description: z.string().min(1).max(512),
  })
  .strict();
const capabilityTool = toolSchema
  .innerType()
  .extend({
    registration: z
      .object({
        module: z
          .string()
          .refine(
            (value) =>
              isPortableRelativePath(value) &&
              value.startsWith("src/") &&
              value.endsWith(".ts"),
          ),
        export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/u),
      })
      .strict(),
  })
  .strict()
  .superRefine((tool, context) => {
    if (tool.destructive && !tool.requiresConfirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiresConfirmation"],
        message: "Destructive tools must require confirmation",
      });
    }
  });
const manifestSchema = z
  .object({
    manifestVersion: z.literal("1"),
    id,
    version,
    displayName: z.string().min(1).max(128),
    description: z.string().min(1).max(1024),
    compatibleTemplates: z.array(id).min(1),
    requires: z.array(id),
    conflictsWith: z.array(id),
    permissions: z.array(permission),
    files: z.array(file),
    dependencies: z
      .object({
        runtime: z.record(packageName, exactDependencyVersion).optional(),
        development: z.record(packageName, exactDependencyVersion).optional(),
      })
      .strict(),
    tools: z.array(capabilityTool),
    data: z
      .array(
        z
          .object({
            path: z.string().refine(isPortableRelativePath),
            ownership: z.literal("user-owned"),
            removal: z.literal("preserve"),
            description: z.string().min(1).max(512),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function validateCapabilityManifest(
  input: unknown,
): ForgeCapabilityValidationResult {
  if (
    typeof input === "object" &&
    input !== null &&
    "manifestVersion" in input &&
    (input as { manifestVersion?: unknown }).manifestVersion !== "1"
  ) {
    return {
      success: false,
      diagnostics: [
        createDiagnostic("CAP_MANIFEST_VERSION_UNSUPPORTED", [
          "manifestVersion",
        ]),
      ],
    };
  }
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      diagnostics: parsed.error.issues.map((issue) =>
        createDiagnostic("CAP_MANIFEST_INVALID", issue.path, {
          reason: issue.message,
        }),
      ),
    };
  }
  const manifest = parsed.data;
  const filePaths = new Set<string>();
  const toolNames = new Set<string>();
  const dataPaths = new Set<string>();
  const duplicates =
    manifest.files.some(({ path }) =>
      filePaths.has(path) ? true : !filePaths.add(path),
    ) ||
    manifest.tools.some(({ name }) =>
      toolNames.has(name) ? true : !toolNames.add(name),
    ) ||
    (manifest.data ?? []).some(({ path }) =>
      dataPaths.has(path) ? true : !dataPaths.add(path),
    );
  const filesByPath = new Map(
    manifest.files.map((declaration) => [declaration.path, declaration]),
  );
  const invalidReference =
    manifest.tools.some(
      ({ registration }) => !filesByPath.has(registration.module),
    ) ||
    (manifest.data ?? []).some(({ path }) => {
      const declaration = filesByPath.get(path);
      return (
        declaration?.ownership !== "user-owned" ||
        declaration.updateStrategy !== "create-once"
      );
    }) ||
    manifest.requires.includes(manifest.id) ||
    manifest.conflictsWith.includes(manifest.id) ||
    manifest.requires.some((required) =>
      manifest.conflictsWith.includes(required),
    ) ||
    Object.keys(manifest.dependencies.runtime ?? {}).some((name) =>
      Object.prototype.hasOwnProperty.call(
        manifest.dependencies.development ?? {},
        name,
      ),
    );
  if (duplicates || invalidReference) {
    return {
      success: false,
      diagnostics: [
        createDiagnostic("CAP_MANIFEST_INVALID", [], {
          reason: duplicates
            ? "duplicate declaration"
            : "inconsistent manifest reference",
        }),
      ],
    };
  }
  return { success: true, data: manifest, diagnostics: [] };
}
