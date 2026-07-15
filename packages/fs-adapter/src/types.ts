import type {
  ForgeTargetState,
  ForgeTargetFileState,
} from "@mcp-server-forge/generators";
import type { ForgeApplyContract } from "@mcp-server-forge/core";
import type {
  ForgeGenerationState,
  ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_GENERATION_STATE_PATH = ".mcp-forge/generated-state.json";

export interface ForgeFilesystemReadOptions {
  maxFileSizeBytes?: number;
}

export interface ForgeGenerationStateReadOptions extends ForgeFilesystemReadOptions {
  statePath?: string;
}

export interface ForgeManagedTargetPath {
  path: string;
  expectedExecutable?: boolean;
}

export interface ForgeTargetStateLoadResult {
  success: boolean;
  targetState: ForgeTargetState;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeGenerationStateLoadResult {
  success: boolean;
  available: boolean;
  state?: ForgeGenerationState;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeTemplateBundle {
  manifest: ForgeTemplateManifest;
  templateSources: Record<string, string>;
}

export interface ForgeTemplateBundleLoadResult {
  success: boolean;
  bundle?: ForgeTemplateBundle;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeGenerationWorkspaceInspectionRequest {
  projectRoot: string;
  templateDirectory: string;
  options?: ForgeFilesystemReadOptions;
  statePath?: string;
}

export interface ForgeGenerationWorkspaceInspection {
  success: boolean;
  safeToRenderAndPreview: boolean;
  targetState: ForgeTargetState;
  previousState?: ForgeGenerationState;
  manifest?: ForgeTemplateManifest;
  templateSources?: Record<string, string>;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeApplyExecutionRequest {
  projectRoot: string;
  contract: ForgeApplyContract;
  statePath?: string;
  options?: ForgeFilesystemReadOptions;
}

export interface ForgeApplyExecutionResult {
  success: boolean;
  appliedFiles: string[];
  stateWritten: boolean;
  diagnostics: ForgeDiagnostic[];
}

export type { ForgeTargetFileState, ForgeTargetState };
