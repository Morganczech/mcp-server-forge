import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createProjectInspection,
  isForgeProjectChangePlan,
  isForgeProjectInspection,
} from "@mcp-server-forge/core";
import { hashGeneratedContent } from "@mcp-server-forge/templates";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectCatalog } from "./catalog.js";
import {
  FORGE_MCP_TOOL_NAMES,
  MAX_CATALOG_BYTES,
  MAX_DIAGNOSTICS,
  MAX_PROJECTS_PER_PAGE,
  MAX_TOOL_RESPONSE_BYTES,
  MAX_USER_TEXT_LENGTH,
} from "./constants.js";
import {
  enforceResponseLimit,
  safeUserText,
  sanitizeInspection,
} from "./output.js";
import { createForgeMcpServer } from "./server.js";
import { ForgeReadOnlyService } from "./service.js";
import type { ForgeProjectCatalog, ForgeToolEnvelope } from "./types.js";

const configFixture = new URL(
  "../../../packages/generators/fixtures/valid/basic-config.json",
  import.meta.url,
);
const templateFixture = fileURLToPath(
  new URL(
    "../../../packages/templates/templates/basic-typescript-server",
    import.meta.url,
  ),
);
const forbiddenToolNames = [
  "forge_apply_project",
  "forge_approve_project",
  "forge_confirm_project",
  "forge_delete_project",
  "forge_edit_project",
  "forge_execute_command",
  "forge_generate_project",
  "forge_install_server",
  "forge_migrate_project",
  "forge_remove_project",
  "forge_rollback_project",
  "forge_run_shell",
  "forge_update_project",
  "forge_write_file",
] as const;

let testRoot: string;
let projectsRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "mcp-forge-mcp-"));
  projectsRoot = join(testRoot, "projects");
  await mkdir(projectsRoot);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function createProject(
  projectId: string,
  includeTemplate = true,
  includeConfig = true,
): Promise<string> {
  const root = join(projectsRoot, projectId);
  await mkdir(root);
  if (includeConfig) {
    await writeFile(
      join(root, "mcp-forge.json"),
      await readFile(configFixture),
    );
  }
  if (includeTemplate)
    await cp(templateFixture, join(root, "template"), { recursive: true });
  return root;
}

interface CatalogProjectInput {
  projectId: string;
  label?: string;
  root?: string;
  configPath?: string;
  statePath?: string;
  templatePath?: string;
}

async function writeCatalog(
  projects: CatalogProjectInput[],
  allowedRoots: string[] = ["projects"],
): Promise<string> {
  const path = join(testRoot, "forge-projects.json");
  await writeFile(
    path,
    JSON.stringify({
      catalogVersion: "1",
      allowedRoots,
      projects: projects.map((project) => ({
        projectId: project.projectId,
        label: project.label ?? project.projectId,
        root: project.root ?? `projects/${project.projectId}`,
        configPath: project.configPath ?? "mcp-forge.json",
        statePath: project.statePath ?? ".mcp-forge/generated-state.json",
        ...(project.templatePath === undefined
          ? {}
          : { templatePath: project.templatePath }),
      })),
    }),
  );
  return path;
}

async function readyService(
  projects: CatalogProjectInput[],
): Promise<{ catalog: ForgeProjectCatalog; service: ForgeReadOnlyService }> {
  const catalog = await loadProjectCatalog(
    await writeCatalog(projects),
    testRoot,
  );
  return {
    catalog,
    service: new ForgeReadOnlyService({
      catalog,
      version: "0.1.0-alpha.2",
      now: () => "2026-07-15T12:00:00.000Z",
    }),
  };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const key = absolute.slice(root.length + 1).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        output[`${key}/`] = "directory";
        await visit(absolute);
      } else if (entry.isFile()) output[key] = await readFile(absolute, "utf8");
      else output[key] = `type:${(await lstat(absolute)).mode}`;
    }
  }
  await visit(root);
  return output;
}

describe("read-only project catalog", () => {
  it("supports an empty catalog without scanning the filesystem", async () => {
    await expect(loadProjectCatalog(undefined, testRoot)).resolves.toEqual({
      status: "empty",
      projects: [],
      diagnostics: [],
    });
    const path = await writeCatalog([]);
    expect((await loadProjectCatalog(path, testRoot)).status).toBe("empty");
  });

  it("fails closed for missing, malformed, oversized, and schema-invalid catalogs", async () => {
    const missing = await loadProjectCatalog(
      join(testRoot, "missing-catalog.json"),
      testRoot,
    );
    const malformedPath = join(testRoot, "malformed-catalog.json");
    await writeFile(malformedPath, "{");
    const malformed = await loadProjectCatalog(malformedPath, testRoot);
    const oversizedPath = join(testRoot, "oversized-catalog.json");
    await writeFile(oversizedPath, "x".repeat(MAX_CATALOG_BYTES + 1));
    const oversized = await loadProjectCatalog(oversizedPath, testRoot);
    const invalidPath = join(testRoot, "schema-invalid-catalog.json");
    await writeFile(
      invalidPath,
      JSON.stringify({
        catalogVersion: "1",
        allowedRoots: [],
        projects: [{ projectId: "INVALID", label: "Invalid", root: "." }],
      }),
    );
    const invalid = await loadProjectCatalog(invalidPath, testRoot);

    for (const result of [missing, malformed, oversized]) {
      expect(result).toMatchObject({
        status: "invalid",
        diagnostics: [{ code: "MCP_CATALOG_READ_FAILED" }],
      });
      expect(JSON.stringify(result)).not.toContain(testRoot);
    }
    expect(invalid).toMatchObject({
      status: "invalid",
      diagnostics: [{ code: "MCP_CATALOG_INVALID" }],
    });
  });

  it("loads one or multiple registered projects in deterministic order", async () => {
    await createProject("bravo");
    await createProject("alpha");
    const catalog = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "bravo", templatePath: "template" },
        { projectId: "alpha", templatePath: "template" },
      ]),
      testRoot,
    );

    expect(catalog.status).toBe("ready");
    expect(catalog.projects.map(({ projectId }) => projectId)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  it("rejects duplicate IDs and nonexistent projects", async () => {
    await createProject("duplicate");
    const duplicate = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "duplicate" },
        { projectId: "duplicate" },
      ]),
      testRoot,
    );
    const missing = await loadProjectCatalog(
      await writeCatalog([{ projectId: "missing" }]),
      testRoot,
    );

    expect(duplicate.status).toBe("invalid");
    expect(duplicate.diagnostics[0]?.code).toBe("MCP_CATALOG_INVALID");
    expect(missing.status).toBe("invalid");
    expect(missing.diagnostics[0]?.code).toBe("MCP_PROJECT_ACCESS_DENIED");
  });

  it("rejects traversal and symlink escape outside allowed roots", async () => {
    const outside = join(testRoot, "outside");
    await mkdir(outside);
    const traversal = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "escape", root: "projects/../outside" },
      ]),
      testRoot,
    );
    const link = join(projectsRoot, "linked-outside");
    await symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const linked = await loadProjectCatalog(
      await writeCatalog([{ projectId: "linked-outside" }]),
      testRoot,
    );
    await createProject("bad-config");
    const configTraversal = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "bad-config", configPath: "../outside.json" },
      ]),
      testRoot,
    );

    expect(traversal.status).toBe("invalid");
    expect(linked.status).toBe("invalid");
    expect(configTraversal.status).toBe("invalid");
  });

  it("rejects unknown catalog fields that could hide sensitive payloads", async () => {
    const path = join(testRoot, "invalid-catalog.json");
    await writeFile(
      path,
      JSON.stringify({
        catalogVersion: "1",
        allowedRoots: [],
        projects: [],
        token: "fictional-sensitive-value",
      }),
    );

    expect(await loadProjectCatalog(path, testRoot)).toMatchObject({
      status: "invalid",
      diagnostics: [{ code: "MCP_CATALOG_INVALID" }],
    });
  });

  it("requires every project path to remain project-relative", async () => {
    await createProject("relative-only");
    const invalidState = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "relative-only", statePath: join(testRoot, "state.json") },
      ]),
      testRoot,
    );
    const invalidTemplate = await loadProjectCatalog(
      await writeCatalog([
        { projectId: "relative-only", templatePath: "../template" },
      ]),
      testRoot,
    );

    expect(invalidState.diagnostics[0]?.code).toBe("MCP_CATALOG_INVALID");
    expect(invalidTemplate.diagnostics[0]?.code).toBe("MCP_CATALOG_INVALID");
  });

  it("fails closed when an allowed project root disappears or becomes a symlink after startup", async () => {
    const root = await createProject("runtime-boundary");
    const { service } = await readyService([{ projectId: "runtime-boundary" }]);
    await rm(root, { recursive: true });
    expect(await service.inspectProject("runtime-boundary")).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_PROJECT_ACCESS_DENIED" }],
    });

    const outside = join(testRoot, "replacement");
    await mkdir(outside);
    await writeFile(
      join(outside, "mcp-forge.json"),
      await readFile(configFixture),
    );
    await symlink(
      outside,
      root,
      process.platform === "win32" ? "junction" : "dir",
    );
    const replaced = await service.inspectProject("runtime-boundary");
    expect(replaced).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_PROJECT_ACCESS_DENIED" }],
    });
    expect(JSON.stringify(replaced)).not.toContain(testRoot);
  });
});

describe("Forge read-only application service", () => {
  it("returns status and paginates projects without absolute paths", async () => {
    for (const id of ["alpha", "bravo", "charlie"]) await createProject(id);
    const { service } = await readyService([
      { projectId: "alpha", label: "token=fictional-secret-value" },
      { projectId: "bravo" },
      { projectId: "charlie" },
    ]);

    expect(service.getStatus()).toMatchObject({
      success: true,
      data: {
        registeredProjects: 3,
        applyAvailable: false,
        catalogStatus: "ready",
      },
    });
    expect(service.getStatus()).toEqual(service.getStatus());
    const first = await service.listProjects({ limit: 2 });
    const second = await service.listProjects({
      limit: 2,
      cursor: first.page?.nextCursor ?? undefined,
    });
    expect(first.page).toMatchObject({ returned: 2, nextCursor: "projects:2" });
    expect(second.page).toMatchObject({ returned: 1, nextCursor: null });
    expect((await service.listProjects({ limit: 999 })).page?.limit).toBe(
      MAX_PROJECTS_PER_PAGE,
    );
    expect(JSON.stringify(first)).not.toContain(testRoot);
    expect(JSON.stringify(first)).not.toContain("fictional-secret-value");
  });

  it("returns structured inspection and deterministic summaries", async () => {
    await createProject("inspectable");
    const { service } = await readyService([{ projectId: "inspectable" }]);
    const first = await service.inspectProject("inspectable");
    const second = await service.inspectProject("inspectable");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      success: true,
      projectId: "inspectable",
      summary: { status: "healthy", message: "The project is healthy." },
      data: { inspection: { inspectionVersion: "1" } },
    });
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("FORGE_TEST_SECRET_VALUE");
    expect(serialized).not.toContain("EXAMPLE_TOKEN");
    expect(serialized).not.toContain("\u001b[");
    expect(
      isForgeProjectInspection(
        (first.data as { inspection: unknown }).inspection,
      ),
    ).toBe(true);
  });

  it("distinguishes uninitialized, warning, and conflicting projects", async () => {
    await createProject("uninitialized", false, false);
    const warningRoot = await createProject("warning", false);
    const warningConfig = JSON.parse(
      await readFile(join(warningRoot, "mcp-forge.json"), "utf8"),
    ) as {
      server: { capabilities: { tools: boolean } };
    };
    warningConfig.server.capabilities.tools = true;
    await writeFile(
      join(warningRoot, "mcp-forge.json"),
      JSON.stringify(warningConfig),
    );
    const conflictRoot = await createProject("conflict", false);
    const managedContent = "changed by user\n";
    await writeFile(join(conflictRoot, "managed.txt"), managedContent);
    await mkdir(join(conflictRoot, ".mcp-forge"));
    await writeFile(
      join(conflictRoot, ".mcp-forge/generated-state.json"),
      JSON.stringify({
        stateVersion: "1",
        templateId: "fictional-template",
        templateVersion: "1.0.0",
        hashAlgorithm: "sha256",
        generatedAt: "2026-07-15T12:00:00.000Z",
        files: [
          {
            path: "managed.txt",
            ownership: "forge-owned",
            updateStrategy: "replace-if-unmodified",
            generatedHash: hashGeneratedContent("original\n"),
          },
        ],
      }),
    );
    const { service } = await readyService([
      { projectId: "uninitialized" },
      { projectId: "warning" },
      { projectId: "conflict" },
    ]);

    expect(await service.inspectProject("uninitialized")).toMatchObject({
      success: true,
      data: { inspection: { status: "uninitialized" } },
      summary: { status: "warning" },
    });
    expect(await service.inspectProject("warning")).toMatchObject({
      success: true,
      data: { inspection: { status: "warning" } },
      summary: { status: "warning" },
    });
    expect(await service.inspectProject("conflict")).toMatchObject({
      success: false,
      data: {
        inspection: {
          status: "error",
          generation: { files: [{ status: "conflict" }] },
        },
      },
      summary: { status: "error" },
    });
  });

  it("returns not-declared permissions with plain-language labels", async () => {
    await createProject("permissions");
    const { service } = await readyService([{ projectId: "permissions" }]);
    const result = await service.getPermissions("permissions");
    const permissions = (
      result.data as {
        permissions: Array<{ id: string; status: string; label: string }>;
      }
    ).permissions;

    expect(permissions).toContainEqual(
      expect.objectContaining({
        id: "environment",
        status: "not-declared",
        label: "Read environment variables",
      }),
    );
  });

  it("lists tracked file metadata without file contents and paginates", async () => {
    const root = await createProject("tracked", false);
    const content = "fictional managed content\n";
    await writeFile(join(root, "tracked.txt"), content);
    await mkdir(join(root, ".mcp-forge"));
    await writeFile(
      join(root, ".mcp-forge/generated-state.json"),
      JSON.stringify({
        stateVersion: "1",
        templateId: "fictional-template",
        templateVersion: "1.0.0",
        hashAlgorithm: "sha256",
        generatedAt: "2026-07-15T12:00:00.000Z",
        files: [
          {
            path: "tracked.txt",
            ownership: "forge-owned",
            updateStrategy: "replace-if-unmodified",
            generatedHash: hashGeneratedContent(content),
          },
        ],
      }),
    );
    const { service } = await readyService([{ projectId: "tracked" }]);
    const result = await service.listGeneratedFiles("tracked", { limit: 1 });

    expect(result).toMatchObject({
      success: true,
      data: {
        files: [
          {
            path: "tracked.txt",
            ownership: "forge-owned",
            status: "current",
            changed: false,
          },
        ],
      },
      page: { returned: 1, limit: 1, nextCursor: null },
    });
    expect(JSON.stringify(result)).not.toContain(content.trim());
  });

  it("adapts the existing planner for preview and reports a missing template", async () => {
    await createProject("preview-ready");
    await createProject("preview-missing", false);
    const { service } = await readyService([
      { projectId: "preview-ready", templatePath: "template" },
      { projectId: "preview-missing" },
    ]);

    const preview = await service.previewProject("preview-ready");
    const missing = await service.previewProject("preview-missing");
    expect(preview).toMatchObject({
      success: true,
      data: {
        changePlan: {
          planVersion: "1",
          safeToApply: true,
          dataEffects: { projectWideTransaction: false },
        },
      },
    });
    expect(
      isForgeProjectChangePlan(
        (preview.data as { changePlan: unknown }).changePlan,
      ),
    ).toBe(true);
    expect(missing).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_TEMPLATE_NOT_CONFIGURED" }],
    });
  });

  it("recomputes preview evidence on every call", async () => {
    const root = await createProject("fresh-preview");
    const { service } = await readyService([
      { projectId: "fresh-preview", templatePath: "template" },
    ]);
    const first = await service.previewProject("fresh-preview");
    const config = JSON.parse(
      await readFile(join(root, "mcp-forge.json"), "utf8"),
    ) as { project: { title: string } };
    config.project.title = "Updated fictional title";
    await writeFile(join(root, "mcp-forge.json"), JSON.stringify(config));
    const second = await service.previewProject("fresh-preview");
    const firstPlan = (first.data as { changePlan: { planId: string } })
      .changePlan;
    const secondPlan = (second.data as { changePlan: { planId: string } })
      .changePlan;

    expect(secondPlan.planId).not.toBe(firstPlan.planId);
    expect(isForgeProjectChangePlan(secondPlan)).toBe(true);
  });

  it("explains only registered diagnostics and never claims automatic repair", async () => {
    const service = new ForgeReadOnlyService({
      catalog: { status: "empty", projects: [], diagnostics: [] },
      version: "0.1.0-alpha.2",
    });
    expect(service.explainDiagnostic("PLAN_FILE_CONFLICT")).toMatchObject({
      success: true,
      data: { code: "PLAN_FILE_CONFLICT", canResolveAutomatically: false },
    });
    expect(service.explainDiagnostic("MCP_PROJECT_NOT_FOUND")).toMatchObject({
      success: true,
      data: {
        code: "MCP_PROJECT_NOT_FOUND",
        canResolveAutomatically: false,
      },
    });
    expect(service.explainDiagnostic("NOT_REAL")).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_DIAGNOSTIC_NOT_FOUND" }],
    });
  });

  it("returns stable errors for unknown projects and invalid cursors", async () => {
    const { service } = await readyService([]);
    expect(await service.inspectProject("missing")).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_PROJECT_NOT_FOUND" }],
    });
    expect(await service.listProjects({ cursor: "wrong:1" })).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_CURSOR_INVALID" }],
    });
  });

  it("does not present an invalid catalog as a healthy project list", async () => {
    const service = new ForgeReadOnlyService({
      catalog: {
        status: "invalid",
        projects: [],
        diagnostics: [
          {
            code: "MCP_CATALOG_INVALID",
            severity: "error",
            message: "The test catalog is invalid.",
          },
        ],
      },
      version: "0.1.0-alpha.2",
    });

    expect(await service.listProjects({})).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_CATALOG_INVALID" }],
    });
  });

  it("enforces total response limits", () => {
    const oversized: ForgeToolEnvelope<Record<string, unknown>> = {
      success: true,
      data: { text: "x".repeat(MAX_TOOL_RESPONSE_BYTES + 1) },
      summary: { status: "healthy", message: "Oversized fixture." },
      diagnostics: [],
    };
    expect(enforceResponseLimit(oversized)).toMatchObject({
      success: false,
      diagnostics: [{ code: "MCP_OUTPUT_LIMIT_EXCEEDED" }],
    });
  });

  it("redacts common secret shapes from bounded user text", () => {
    const samples = [
      "SERVICE_KEY=fictional-value",
      "Bearer fictional.bearer.value",
      "Basic ZmljdGlvbmFsOnZhbHVl",
      "Authorization: Basic ZmljdGlvbmFsOnZhbHVl",
      "postgres://fictional-user:fictional-password@localhost/database",
      '{"password":"fictional-json-password","token":"fictional-json-token","apiKey":"fictional-json-key","secret":"fictional-json-secret"}',
      "Cookie: session=fictional-cookie; secure=true",
      "-----BEGIN PRIVATE KEY----- fictional-private-material -----END PRIVATE KEY-----",
      `token=fictional-token-value ${"ghp_"}${"1234567890abcdef"}`,
    ];
    const sanitized = samples.map(safeUserText).join("\n");

    for (const value of [
      "fictional-value",
      "fictional.bearer.value",
      "ZmljdGlvbmFsOnZhbHVl",
      "fictional-password",
      "fictional-json-password",
      "fictional-json-token",
      "fictional-json-key",
      "fictional-json-secret",
      "fictional-cookie",
      "fictional-private-material",
      "fictional-token-value",
      "1234567890abcdef",
    ]) {
      expect(sanitized).not.toContain(value);
    }
    expect(safeUserText("The project is healthy and ready for review.")).toBe(
      "The project is healthy and ready for review.",
    );
    expect(safeUserText("x".repeat(MAX_USER_TEXT_LENGTH + 20))).toHaveLength(
      MAX_USER_TEXT_LENGTH,
    );
  });

  it("bounds serialized inspection diagnostics", () => {
    const inspection = createProjectInspection({
      project: { initialized: true },
      stateAvailable: false,
      diagnostics: Array.from({ length: MAX_DIAGNOSTICS + 10 }, (_, index) => ({
        code: `TEST_WARNING_${String(index).padStart(2, "0")}`,
        severity: "warning" as const,
        message: "A safe fictional warning.",
        source: "test",
        path: [index],
      })),
    });

    expect(sanitizeInspection(inspection).diagnostics).toHaveLength(
      MAX_DIAGNOSTICS,
    );
  });

  it("uses a snapshot that detects directory, rename, content, deletion, and state changes", async () => {
    const root = await createProject("snapshot", false);
    await mkdir(join(root, ".mcp-forge"));
    const statePath = join(root, ".mcp-forge/generated-state.json");
    await writeFile(statePath, "initial-state\n");
    const initial = await snapshot(testRoot);

    const emptyDirectory = join(root, "empty-directory");
    await mkdir(emptyDirectory);
    expect(await snapshot(testRoot)).not.toEqual(initial);
    await rm(emptyDirectory, { recursive: true });
    expect(await snapshot(testRoot)).toEqual(initial);

    const configPath = join(root, "mcp-forge.json");
    const renamedConfig = join(root, "renamed-config.json");
    await rename(configPath, renamedConfig);
    expect(await snapshot(testRoot)).not.toEqual(initial);
    await rename(renamedConfig, configPath);

    await writeFile(statePath, "changed-state\n");
    expect(await snapshot(testRoot)).not.toEqual(initial);
    await writeFile(statePath, "initial-state\n");

    await rm(configPath);
    expect(await snapshot(testRoot)).not.toEqual(initial);
  });

  it("keeps every service operation read-only", async () => {
    await createProject("read-only");
    const { service } = await readyService([
      { projectId: "read-only", templatePath: "template" },
    ]);
    const before = await snapshot(testRoot);

    service.getStatus();
    await service.listProjects({});
    await service.inspectProject("read-only");
    await service.getPermissions("read-only");
    await service.listGeneratedFiles("read-only", {});
    await service.previewProject("read-only");
    service.explainDiagnostic("PLAN_FILE_CONFLICT");

    expect(await snapshot(testRoot)).toEqual(before);
  });
});

describe("official MCP transport integration", () => {
  it("starts, exposes only the allowlist, and serves a read-only tool call", async () => {
    const catalog: ForgeProjectCatalog = {
      status: "empty",
      projects: [],
      diagnostics: [],
    };
    const service = new ForgeReadOnlyService({
      catalog,
      version: "0.1.0-alpha.2",
    });
    const server = createForgeMcpServer({ service, version: "0.1.0-alpha.2" });
    const client = new Client({ name: "forge-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual(FORGE_MCP_TOOL_NAMES);
      expect(
        tools.tools.every(
          ({ annotations }) =>
            annotations?.readOnlyHint === true &&
            annotations.destructiveHint === false,
        ),
      ).toBe(true);
      expect(
        tools.tools.some(({ name }) =>
          forbiddenToolNames.includes(
            name as (typeof forbiddenToolNames)[number],
          ),
        ),
      ).toBe(false);
      const schemas = JSON.stringify(
        tools.tools.map(({ inputSchema }) => inputSchema),
      );
      expect(schemas).not.toContain('"action"');
      expect(schemas).not.toContain('"root"');
      expect(schemas).not.toContain('"path"');

      const result = await client.callTool({
        name: "forge_get_status",
        arguments: {},
      });
      expect(result.structuredContent).toMatchObject({
        success: true,
        data: { applyAvailable: false, catalogStatus: "empty" },
      });
      const missing = await client.callTool({
        name: "forge_inspect_project",
        arguments: { projectId: "missing" },
      });
      expect(missing).toMatchObject({
        isError: true,
        structuredContent: {
          success: false,
          diagnostics: [{ code: "MCP_PROJECT_NOT_FOUND" }],
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
