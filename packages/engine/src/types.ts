import type {
  ForgeProjectChangePlan,
  ForgeProjectInspection,
} from "@mcp-server-forge/core";

export interface ForgeReadOnlyProjectRequest {
  projectRoot: string;
  configValue: Record<string, unknown>;
  templatePath?: string;
  statePath?: string;
  observedAt?: string;
}

export interface ForgeReadOnlyProjectResult {
  inspection: ForgeProjectInspection;
  changePlan?: ForgeProjectChangePlan;
  filesystemFailure: boolean;
  validationFailure: boolean;
}
