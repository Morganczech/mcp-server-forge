import type {
  ForgeProjectChangePlan,
  ForgeProjectInspection,
} from "@mcp-server-forge/core";

import type { ForgeMcpDiagnosticCode } from "./diagnostics.js";

export interface ForgeMcpDiagnostic {
  code: ForgeMcpDiagnosticCode;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface RegisteredForgeProject {
  projectId: string;
  label: string;
  root: string;
  configPath: string;
  statePath: string;
  templatePath?: string;
}

export interface ForgeProjectCatalog {
  status: "empty" | "ready" | "invalid";
  projects: RegisteredForgeProject[];
  diagnostics: ForgeMcpDiagnostic[];
}

export interface ForgeToolEnvelope<T> {
  success: boolean;
  projectId?: string;
  data: T | null;
  summary: { status: "healthy" | "warning" | "error"; message: string };
  diagnostics: Array<
    ForgeMcpDiagnostic | ForgeProjectInspection["diagnostics"][number]
  >;
  page?: { nextCursor: string | null; returned: number; limit: number };
}

export interface ForgeProjectEvidence {
  project: RegisteredForgeProject;
  inspection: ForgeProjectInspection;
  changePlan?: ForgeProjectChangePlan;
}
