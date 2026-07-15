import {
  DIAGNOSTIC_CATALOG,
  type ForgeDiagnosticCode,
} from "@mcp-server-forge/validators";

import {
  FORGE_MCP_TOOL_NAMES,
  MAX_DIAGNOSTICS,
  MAX_FILES_PER_PAGE,
  MAX_PROJECTS_PER_PAGE,
} from "./constants.js";
import { MCP_DIAGNOSTIC_CATALOG, mcpDiagnostic } from "./diagnostics.js";
import { collectProjectEvidence } from "./evidence.js";
import { enforceResponseLimit, safeUserText } from "./output.js";
import type {
  ForgeProjectCatalog,
  ForgeToolEnvelope,
  RegisteredForgeProject,
} from "./types.js";

function errorEnvelope<T>(
  message: string,
  diagnostics: ForgeToolEnvelope<T>["diagnostics"],
  projectId?: string,
): ForgeToolEnvelope<T> {
  const envelope: ForgeToolEnvelope<T> = {
    success: false,
    ...(projectId === undefined ? {} : { projectId }),
    data: null,
    summary: { status: "error", message },
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
  };
  return enforceResponseLimit(envelope);
}

function parseCursor(
  cursor: string | undefined,
  expectedPrefix: string,
): number | undefined {
  if (cursor === undefined) return 0;
  const [prefix, index, extra] = cursor.split(":");
  if (
    prefix !== expectedPrefix ||
    extra !== undefined ||
    !/^\d+$/u.test(index ?? "")
  ) {
    return undefined;
  }
  const parsed = Number(index);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function pageLimit(requested: number | undefined, maximum: number): number {
  return Math.max(1, Math.min(requested ?? Math.min(50, maximum), maximum));
}

const permissionPresentation = {
  "filesystem.read": {
    label: "Read files",
    allowed: "This server may read files within the displayed scope.",
    denied: "This server cannot read files.",
  },
  "filesystem.write": {
    label: "Write files",
    allowed: "This server may create or modify files.",
    denied: "This server cannot create or modify files.",
  },
  "filesystem.delete": {
    label: "Delete files",
    allowed: "This server may delete files.",
    denied: "This server cannot delete files.",
  },
  network: {
    label: "Use the network",
    allowed: "This server may access the network within the displayed scope.",
    denied: "This server cannot access the network.",
  },
  shell: {
    label: "Run commands",
    allowed: "This server may run shell commands.",
    denied: "This server cannot run shell commands.",
  },
  environment: {
    label: "Read environment variables",
    allowed: "This server may read environment variables.",
    denied: "This server cannot read environment variables.",
  },
} as const;

export class ForgeReadOnlyService {
  readonly #catalog: ForgeProjectCatalog;
  readonly #version: string;
  readonly #now: () => string;

  constructor(options: {
    catalog: ForgeProjectCatalog;
    version: string;
    now?: () => string;
  }) {
    this.#catalog = options.catalog;
    this.#version = options.version;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  #project(projectId: string): RegisteredForgeProject | undefined {
    return this.#catalog.projects.find(
      (project) => project.projectId === projectId,
    );
  }

  getStatus(): ForgeToolEnvelope<Record<string, unknown>> {
    const healthy = this.#catalog.status !== "invalid";
    return enforceResponseLimit({
      success: healthy,
      data: {
        serverVersion: this.#version,
        registeredProjects: this.#catalog.projects.length,
        features: [...FORGE_MCP_TOOL_NAMES],
        applyAvailable: false,
        catalogStatus: this.#catalog.status,
      },
      summary: {
        status: healthy ? "healthy" : "error",
        message:
          this.#catalog.status === "ready"
            ? `${this.#catalog.projects.length} registered Forge project(s) are available.`
            : this.#catalog.status === "empty"
              ? "The read-only project catalog is empty."
              : "The read-only project catalog is invalid.",
      },
      diagnostics: this.#catalog.diagnostics,
    });
  }

  async listProjects(options: {
    cursor?: string;
    limit?: number;
  }): Promise<ForgeToolEnvelope<Record<string, unknown>>> {
    if (this.#catalog.status === "invalid") {
      return errorEnvelope(
        "The project catalog is invalid.",
        this.#catalog.diagnostics,
      );
    }
    const start = parseCursor(options.cursor, "projects");
    if (start === undefined) {
      return errorEnvelope("The project page cursor is invalid.", [
        mcpDiagnostic("MCP_CURSOR_INVALID", "The project cursor is invalid."),
      ]);
    }
    const limit = pageLimit(options.limit, MAX_PROJECTS_PER_PAGE);
    const selected = this.#catalog.projects.slice(start, start + limit);
    const projects = [];
    for (const project of selected) {
      const result = await collectProjectEvidence(project, {
        includeTemplate: false,
      });
      projects.push(
        result.success
          ? {
              projectId: project.projectId,
              label: safeUserText(project.label),
              status: result.evidence.inspection.status,
              ...(result.evidence.inspection.generation.templateId === undefined
                ? {}
                : {
                    template: {
                      id: result.evidence.inspection.generation.templateId,
                      version:
                        result.evidence.inspection.generation.templateVersion,
                    },
                  }),
              diagnostics: result.evidence.inspection.diagnostics.length,
            }
          : {
              projectId: project.projectId,
              label: safeUserText(project.label),
              status: "error",
              diagnostics: result.diagnostics.length,
            },
      );
    }
    const next = start + selected.length;
    return enforceResponseLimit({
      success: true,
      data: { projects },
      summary: {
        status: "healthy",
        message: `${projects.length} registered project(s) are shown.`,
      },
      diagnostics: [],
      page: {
        nextCursor:
          next < this.#catalog.projects.length ? `projects:${next}` : null,
        returned: projects.length,
        limit,
      },
    });
  }

  async inspectProject(
    projectId: string,
  ): Promise<ForgeToolEnvelope<Record<string, unknown>>> {
    const project = this.#project(projectId);
    if (project === undefined) {
      return errorEnvelope(
        "The requested project is not registered.",
        [
          mcpDiagnostic(
            "MCP_PROJECT_NOT_FOUND",
            "The project ID is not registered.",
          ),
        ],
        projectId,
      );
    }
    const result = await collectProjectEvidence(project, {
      includeTemplate: false,
    });
    if (!result.success) {
      return errorEnvelope(
        "The registered project could not be inspected safely.",
        result.diagnostics,
        projectId,
      );
    }
    const inspection = result.evidence.inspection;
    const uninitialized = inspection.status === "uninitialized";
    return enforceResponseLimit({
      success: inspection.status !== "error",
      projectId,
      data: { inspection },
      summary: {
        status:
          inspection.status === "healthy"
            ? "healthy"
            : inspection.status === "warning" || uninitialized
              ? "warning"
              : "error",
        message:
          inspection.status === "healthy"
            ? "The project is healthy."
            : uninitialized
              ? "The project is registered but is not initialized with a Forge configuration."
              : inspection.status === "warning"
                ? "The project is usable but has warnings."
                : "The project requires attention before changes are considered.",
      },
      diagnostics: inspection.diagnostics.slice(0, MAX_DIAGNOSTICS),
    });
  }

  async getPermissions(
    projectId: string,
  ): Promise<ForgeToolEnvelope<Record<string, unknown>>> {
    const inspected = await this.inspectProject(projectId);
    const inspection = (
      inspected.data as {
        inspection?: import("@mcp-server-forge/core").ForgeProjectInspection;
      } | null
    )?.inspection;
    if (inspection === undefined) return inspected;
    const permissions = inspection.permissions.map((permission) => {
      const presentation = permissionPresentation[permission.permission];
      return {
        id: permission.permission,
        status: permission.status,
        scope: permission.scope,
        source: permission.source,
        label: presentation.label,
        explanation:
          permission.status === "not-declared"
            ? "This permission is not declared. Forge does not assume it is safe."
            : presentation[permission.status],
      };
    });
    return enforceResponseLimit({
      ...inspected,
      data: { permissions },
      summary: {
        status: inspected.summary.status,
        message: `${permissions.length} permission declaration(s) are shown.`,
      },
    });
  }

  async listGeneratedFiles(
    projectId: string,
    options: { cursor?: string; limit?: number },
  ): Promise<ForgeToolEnvelope<Record<string, unknown>>> {
    const prefix = `files-${projectId}`;
    const start = parseCursor(options.cursor, prefix);
    if (start === undefined) {
      return errorEnvelope(
        "The generated-file page cursor is invalid.",
        [mcpDiagnostic("MCP_CURSOR_INVALID", "The file cursor is invalid.")],
        projectId,
      );
    }
    const inspected = await this.inspectProject(projectId);
    const inspection = (
      inspected.data as {
        inspection?: import("@mcp-server-forge/core").ForgeProjectInspection;
      } | null
    )?.inspection;
    if (inspection === undefined) return inspected;
    const limit = pageLimit(options.limit, MAX_FILES_PER_PAGE);
    const selected = inspection.generation.files.slice(start, start + limit);
    const files = selected.map((file) => ({
      path: file.path,
      ownership: file.ownership ?? null,
      status: file.status,
      changed: file.status !== "current",
      diagnostic: file.reasonCode ?? null,
    }));
    const next = start + selected.length;
    return enforceResponseLimit({
      success: inspected.success,
      projectId,
      data: { files },
      summary: {
        status: inspected.summary.status,
        message: `${files.length} tracked generated file(s) are shown.`,
      },
      diagnostics: inspected.diagnostics,
      page: {
        nextCursor:
          next < inspection.generation.files.length
            ? `${prefix}:${next}`
            : null,
        returned: files.length,
        limit,
      },
    });
  }

  async previewProject(
    projectId: string,
  ): Promise<ForgeToolEnvelope<Record<string, unknown>>> {
    const project = this.#project(projectId);
    if (project === undefined) {
      return errorEnvelope(
        "The requested project is not registered.",
        [
          mcpDiagnostic(
            "MCP_PROJECT_NOT_FOUND",
            "The project ID is not registered.",
          ),
        ],
        projectId,
      );
    }
    if (project.templatePath === undefined) {
      return errorEnvelope(
        "No registered template is available for preview.",
        [
          mcpDiagnostic(
            "MCP_TEMPLATE_NOT_CONFIGURED",
            "Preview requires a template registered in the project catalog.",
          ),
        ],
        projectId,
      );
    }
    const result = await collectProjectEvidence(project, {
      includeTemplate: true,
      observedAt: this.#now(),
    });
    if (!result.success || result.evidence.changePlan === undefined) {
      return errorEnvelope(
        "A safe read-only preview could not be created.",
        result.success
          ? result.evidence.inspection.diagnostics
          : result.diagnostics,
        projectId,
      );
    }
    const { inspection, changePlan } = result.evidence;
    return enforceResponseLimit({
      success: changePlan.safeToApply,
      projectId,
      data: { inspection, changePlan },
      summary: {
        status: changePlan.safeToApply ? "healthy" : "warning",
        message: changePlan.safeToApply
          ? `The read-only plan has ${changePlan.changes.length} file decision(s) and is safe to review.`
          : "The read-only plan contains conflicts or manual review and cannot be applied safely.",
      },
      diagnostics: inspection.diagnostics.slice(0, MAX_DIAGNOSTICS),
    });
  }

  explainDiagnostic(code: string): ForgeToolEnvelope<Record<string, unknown>> {
    const mcpDefinition =
      code in MCP_DIAGNOSTIC_CATALOG
        ? MCP_DIAGNOSTIC_CATALOG[code as keyof typeof MCP_DIAGNOSTIC_CATALOG]
        : undefined;
    if (mcpDefinition !== undefined) {
      return enforceResponseLimit({
        success: true,
        data: {
          code,
          ...mcpDefinition,
          canResolveAutomatically: false,
        },
        summary: {
          status: "healthy",
          message: `Forge diagnostic ${code} is explained from the registered catalog.`,
        },
        diagnostics: [],
      });
    }
    const definition = DIAGNOSTIC_CATALOG[code as ForgeDiagnosticCode];
    if (definition === undefined) {
      return errorEnvelope("The diagnostic code is not registered.", [
        mcpDiagnostic(
          "MCP_DIAGNOSTIC_NOT_FOUND",
          "The requested Forge diagnostic code is not registered.",
        ),
      ]);
    }
    return enforceResponseLimit({
      success: true,
      data: {
        code: definition.code,
        title: definition.summary,
        importance: definition.message,
        safeNextStep:
          "suggestion" in definition
            ? definition.suggestion
            : "Review the diagnostic before proceeding.",
        canResolveAutomatically: false,
        definitionFixable: definition.fixable,
      },
      summary: {
        status: "healthy",
        message: `Forge diagnostic ${definition.code} is explained from the registered catalog.`,
      },
      diagnostics: [],
    });
  }
}
