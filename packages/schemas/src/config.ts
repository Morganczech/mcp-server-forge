import { z } from "zod";

import { clientsSchema } from "./clients.js";
import { schemaVersionSchema } from "./common.js";
import { distributionSchema } from "./distribution.js";
import { documentationSchema } from "./documentation.js";
import { environmentVariableSchema } from "./environment.js";
import { knowledgeSchema } from "./knowledge.js";
import { projectSchema } from "./project.js";
import { promptSchema } from "./prompts.js";
import { registrySchema } from "./registry.js";
import { resourceSchema, resourceTemplateSchema } from "./resources.js";
import { securitySchema } from "./security.js";
import { serverSchema } from "./server.js";
import { toolSchema } from "./tools.js";

const capabilityIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(64);

function addDuplicateNameIssues(
  items: ReadonlyArray<{ name: string }>,
  path: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  items.forEach((item, index) => {
    if (seen.has(item.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path, index, "name"],
        message: `Duplicate ${path} name: ${item.name}`,
      });
    }
    seen.add(item.name);
  });
}

function addDuplicateResourceNameIssues(
  resources: ReadonlyArray<{ name: string }>,
  resourceTemplates: ReadonlyArray<{ name: string }>,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  resources.forEach((resource, index) => {
    if (seen.has(resource.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resources", index, "name"],
        message: `Duplicate resources name: ${resource.name}`,
      });
    }
    seen.add(resource.name);
  });

  resourceTemplates.forEach((resourceTemplate, index) => {
    if (seen.has(resourceTemplate.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resourceTemplates", index, "name"],
        message: `Duplicate resources name: ${resourceTemplate.name}`,
      });
    }
    seen.add(resourceTemplate.name);
  });
}

export const forgeConfigSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    project: projectSchema,
    server: serverSchema,
    capabilities: z.array(capabilityIdSchema).default([]),
    tools: z.array(toolSchema).default([]),
    resources: z.array(resourceSchema).default([]),
    resourceTemplates: z.array(resourceTemplateSchema).default([]),
    prompts: z.array(promptSchema).default([]),
    knowledge: knowledgeSchema.default({}),
    documentation: documentationSchema.default({}),
    clients: clientsSchema.default({}),
    distribution: distributionSchema,
    environment: z.array(environmentVariableSchema).default([]),
    security: securitySchema.default({}),
    registry: registrySchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    addDuplicateNameIssues(config.tools, "tools", context);
    addDuplicateNameIssues(config.prompts, "prompts", context);
    addDuplicateResourceNameIssues(
      config.resources,
      config.resourceTemplates,
      context,
    );
  });

export type ForgeConfig = z.infer<typeof forgeConfigSchema>;

// Backward-compatible alias for the package's original bootstrap export.
export const serverConfigSchema = forgeConfigSchema;
export type ServerConfig = ForgeConfig;
