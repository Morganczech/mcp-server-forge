import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { isPortableRelativePath } from "@mcp-server-forge/templates";
import { z } from "zod";

import { MAX_CATALOG_BYTES, MAX_USER_TEXT_LENGTH } from "./constants.js";
import { mcpDiagnostic } from "./diagnostics.js";
import type { ForgeProjectCatalog, RegisteredForgeProject } from "./types.js";

const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const catalogSchema = z
  .object({
    catalogVersion: z.literal("1"),
    allowedRoots: z.array(z.string().min(1)).max(32),
    projects: z
      .array(
        z
          .object({
            projectId: projectIdSchema,
            label: z.string().min(1).max(MAX_USER_TEXT_LENGTH),
            root: z.string().min(1),
            configPath: z.string().min(1).default("mcp-forge.json"),
            statePath: z
              .string()
              .min(1)
              .default(".mcp-forge/generated-state.json"),
            templatePath: z.string().min(1).optional(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function canonicalDirectory(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

async function readCatalogJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("catalog path must be a regular non-symlink file");
  }
  if (metadata.size > MAX_CATALOG_BYTES)
    throw new Error("catalog is too large");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function resolveFrom(base: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

export async function loadProjectCatalog(
  catalogPath: string | undefined,
  cwd = process.cwd(),
): Promise<ForgeProjectCatalog> {
  if (catalogPath === undefined || catalogPath.length === 0) {
    return { status: "empty", projects: [], diagnostics: [] };
  }
  const absoluteCatalog = resolveFrom(cwd, catalogPath);
  let rawCatalog: unknown;
  try {
    rawCatalog = await readCatalogJson(absoluteCatalog);
  } catch {
    return {
      status: "invalid",
      projects: [],
      diagnostics: [
        mcpDiagnostic(
          "MCP_CATALOG_READ_FAILED",
          "The project catalog could not be read as a bounded valid JSON file.",
        ),
      ],
    };
  }
  const validatedCatalog = catalogSchema.safeParse(rawCatalog);
  if (!validatedCatalog.success) {
    return {
      status: "invalid",
      projects: [],
      diagnostics: [
        mcpDiagnostic(
          "MCP_CATALOG_INVALID",
          "The project catalog does not satisfy the strict catalog schema.",
        ),
      ],
    };
  }
  const parsed: z.infer<typeof catalogSchema> = validatedCatalog.data;

  const base = dirname(absoluteCatalog);
  const allowedRoots = (
    await Promise.all(
      parsed.allowedRoots.map((path) =>
        canonicalDirectory(resolveFrom(base, path)),
      ),
    )
  ).filter((path): path is string => path !== undefined);
  if (allowedRoots.length !== parsed.allowedRoots.length) {
    return {
      status: "invalid",
      projects: [],
      diagnostics: [
        mcpDiagnostic(
          "MCP_CATALOG_INVALID",
          "Every allowed root must exist and be a directory.",
        ),
      ],
    };
  }

  const seen = new Set<string>();
  const projects: RegisteredForgeProject[] = [];
  for (const project of parsed.projects) {
    if (seen.has(project.projectId)) {
      return {
        status: "invalid",
        projects: [],
        diagnostics: [
          mcpDiagnostic(
            "MCP_CATALOG_INVALID",
            "Project IDs in the catalog must be unique.",
          ),
        ],
      };
    }
    seen.add(project.projectId);
    if (
      !isPortableRelativePath(project.configPath) ||
      !isPortableRelativePath(project.statePath) ||
      (project.templatePath !== undefined &&
        !isPortableRelativePath(project.templatePath))
    ) {
      return {
        status: "invalid",
        projects: [],
        diagnostics: [
          mcpDiagnostic(
            "MCP_CATALOG_INVALID",
            "Config, state, and template paths must be portable project-relative paths.",
          ),
        ],
      };
    }
    const root = await canonicalDirectory(resolveFrom(base, project.root));
    if (
      root === undefined ||
      !allowedRoots.some((allowedRoot) => inside(allowedRoot, root))
    ) {
      return {
        status: "invalid",
        projects: [],
        diagnostics: [
          mcpDiagnostic(
            "MCP_PROJECT_ACCESS_DENIED",
            "A catalogued project is missing or outside the configured allowed roots.",
          ),
        ],
      };
    }
    let templatePath: string | undefined;
    if (project.templatePath !== undefined) {
      templatePath = await canonicalDirectory(
        resolve(root, project.templatePath),
      );
      if (templatePath === undefined || !inside(root, templatePath)) {
        return {
          status: "invalid",
          projects: [],
          diagnostics: [
            mcpDiagnostic(
              "MCP_PROJECT_ACCESS_DENIED",
              "A project template is missing or escapes its registered project root.",
            ),
          ],
        };
      }
    }
    projects.push({
      projectId: project.projectId,
      label: project.label,
      root,
      configPath: project.configPath,
      statePath: project.statePath,
      ...(templatePath === undefined ? {} : { templatePath }),
    });
  }

  projects.sort((left, right) => left.projectId.localeCompare(right.projectId));
  return {
    status: projects.length === 0 ? "empty" : "ready",
    projects,
    diagnostics: [],
  };
}
