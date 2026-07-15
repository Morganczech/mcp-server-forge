import type { ForgeConfig } from "@mcp-server-forge/schemas";

import type { ForgeRenderContext, ForgeRenderScalar } from "./types.js";

export function createRenderContext(config: ForgeConfig): ForgeRenderContext {
  return {
    project: {
      name: config.project.name,
      title: config.project.title,
      description: config.project.description,
      language: config.project.language,
      ...(config.project.license === undefined
        ? {}
        : { license: config.project.license }),
    },
    server: {
      name: config.server.name,
      version: config.server.version,
      description: config.server.description,
      runtime: config.server.runtime,
      transport: config.server.transport,
    },
    capabilities: { ...config.server.capabilities },
    composition: { enabled: config.capabilities.length > 0 },
    knowledge: { enabled: config.knowledge.enabled },
    documentation: { language: config.documentation.language },
    distribution: { type: config.distribution.type },
    security: {
      networkAccess: config.security.networkAccess,
      shellAccess: config.security.shellAccess,
      fileWrite: config.security.fileWrite,
      fileDelete: config.security.fileDelete,
      requireConfirmation: config.security.requireConfirmation,
    },
    environment: config.environment.map(
      ({ name, description, required, secret }) => ({
        name,
        description,
        required,
        secret,
      }),
    ),
    registry: {
      categories: [...(config.registry?.categories ?? [])].sort(),
    },
  };
}

const scalarGetters: Record<
  string,
  (context: ForgeRenderContext) => ForgeRenderScalar | undefined
> = {
  "project.name": (context) => context.project.name,
  "project.title": (context) => context.project.title,
  "project.description": (context) => context.project.description,
  "project.language": (context) => context.project.language,
  "project.license": (context) => context.project.license,
  "server.name": (context) => context.server.name,
  "server.version": (context) => context.server.version,
  "server.description": (context) => context.server.description,
  "server.runtime": (context) => context.server.runtime,
  "server.transport": (context) => context.server.transport,
  "capabilities.tools": (context) => context.capabilities.tools,
  "capabilities.resources": (context) => context.capabilities.resources,
  "capabilities.prompts": (context) => context.capabilities.prompts,
  "composition.enabled": (context) => context.composition.enabled,
  "knowledge.enabled": (context) => context.knowledge.enabled,
  "documentation.language": (context) => context.documentation.language,
  "distribution.type": (context) => context.distribution.type,
  "security.networkAccess": (context) => context.security.networkAccess,
  "security.shellAccess": (context) => context.security.shellAccess,
  "security.fileWrite": (context) => context.security.fileWrite,
  "security.fileDelete": (context) => context.security.fileDelete,
  "security.requireConfirmation": (context) =>
    context.security.requireConfirmation,
};

export const FORGE_RENDER_CONTEXT_PATHS = Object.freeze(
  Object.keys(scalarGetters).sort(),
);

export function resolveRenderContextValue(
  context: ForgeRenderContext,
  path: string,
): ForgeRenderScalar | undefined {
  return scalarGetters[path]?.(context);
}

export function isBlockedSecretPath(path: string): boolean {
  const processEnvironmentPath = ["process", "env"].join(".");
  return (
    path === "secrets" ||
    path.startsWith("secrets.") ||
    path === processEnvironmentPath ||
    path.startsWith(`${processEnvironmentPath}.`) ||
    path === "environment" ||
    path.startsWith("environment.")
  );
}
