import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  createProjectInspection,
  isForgeProjectChangePlan,
  isForgeProjectInspection,
} from "@mcp-server-forge/core";
import { inspectForgeProject } from "@mcp-server-forge/engine";

import { MAX_CONFIG_BYTES } from "./constants.js";
import { mcpDiagnostic } from "./diagnostics.js";
import { sanitizeInspection } from "./output.js";
import type {
  ForgeMcpDiagnostic,
  ForgeProjectEvidence,
  RegisteredForgeProject,
} from "./types.js";

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

async function verifyProjectRoot(
  project: RegisteredForgeProject,
): Promise<ForgeMcpDiagnostic | undefined> {
  try {
    const metadata = await lstat(project.root);
    const canonical = await realpath(project.root);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      canonical !== project.root
    ) {
      throw new Error();
    }
    return undefined;
  } catch {
    return mcpDiagnostic(
      "MCP_PROJECT_ACCESS_DENIED",
      "The registered project root is missing or no longer matches its canonical catalog entry.",
    );
  }
}

async function loadProjectConfig(
  project: RegisteredForgeProject,
): Promise<
  | { success: true; value: Record<string, unknown> }
  | { success: false; missing: true }
  | { success: false; diagnostic: ForgeMcpDiagnostic }
> {
  const configuredPath = resolve(project.root, project.configPath);
  try {
    const metadata = await lstat(configuredPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error();
    if (metadata.size > MAX_CONFIG_BYTES) throw new Error();
    const canonical = await realpath(configuredPath);
    if (!inside(project.root, canonical)) throw new Error();
    const value = JSON.parse(await readFile(canonical, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error();
    }
    return { success: true, value: value as Record<string, unknown> };
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      return { success: false, missing: true };
    }
    return {
      success: false,
      diagnostic: mcpDiagnostic(
        "MCP_CONFIG_READ_FAILED",
        "The registered project configuration could not be read safely.",
      ),
    };
  }
}

export async function collectProjectEvidence(
  project: RegisteredForgeProject,
  options: { includeTemplate: boolean; observedAt?: string },
): Promise<
  | { success: true; evidence: ForgeProjectEvidence }
  | { success: false; diagnostics: ForgeMcpDiagnostic[] }
> {
  const rootDiagnostic = await verifyProjectRoot(project);
  if (rootDiagnostic !== undefined) {
    return { success: false, diagnostics: [rootDiagnostic] };
  }
  const config = await loadProjectConfig(project);
  if (!config.success && "diagnostic" in config) {
    return { success: false, diagnostics: [config.diagnostic] };
  }
  if (!config.success) {
    if (options.includeTemplate) {
      return {
        success: false,
        diagnostics: [
          mcpDiagnostic(
            "MCP_CONFIG_READ_FAILED",
            "A registered project configuration is required for preview.",
          ),
        ],
      };
    }
    const inspection = JSON.parse(
      JSON.stringify(
        sanitizeInspection(createProjectInspection({ stateAvailable: false })),
      ),
    ) as unknown;
    if (!isForgeProjectInspection(inspection)) {
      return {
        success: false,
        diagnostics: [
          mcpDiagnostic(
            "MCP_CONTRACT_INVALID",
            "The serialized project inspection failed contract validation.",
          ),
        ],
      };
    }
    return { success: true, evidence: { project, inspection } };
  }
  const result = await inspectForgeProject({
    projectRoot: project.root,
    configValue: config.value,
    statePath: project.statePath,
    ...(options.includeTemplate && project.templatePath !== undefined
      ? { templatePath: project.templatePath }
      : {}),
    ...(options.includeTemplate && project.capabilityRootPath !== undefined
      ? { capabilityRootPath: project.capabilityRootPath }
      : {}),
    ...(options.observedAt === undefined
      ? {}
      : { observedAt: options.observedAt }),
  });
  const inspection = JSON.parse(
    JSON.stringify(sanitizeInspection(result.inspection)),
  ) as unknown;
  if (!isForgeProjectInspection(inspection)) {
    return {
      success: false,
      diagnostics: [
        mcpDiagnostic(
          "MCP_CONTRACT_INVALID",
          "The serialized project inspection failed contract validation.",
        ),
      ],
    };
  }
  const changePlan =
    result.changePlan === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(result.changePlan)) as unknown);
  if (changePlan !== undefined && !isForgeProjectChangePlan(changePlan)) {
    return {
      success: false,
      diagnostics: [
        mcpDiagnostic(
          "MCP_CONTRACT_INVALID",
          "The serialized project change plan failed identity validation.",
        ),
      ],
    };
  }
  return {
    success: true,
    evidence: {
      project,
      inspection,
      ...(changePlan === undefined ? {} : { changePlan }),
    },
  };
}
