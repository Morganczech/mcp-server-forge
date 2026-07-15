import type {
  ForgeGenerationPreview,
  ForgeRenderedFile,
  ForgeRenderResult,
} from "@mcp-server-forge/generators";
import type {
  FileOwnership,
  FileUpdateStrategy,
  ForgeGenerationState,
  ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export type ForgeApplyFileAction = "create" | "replace";

export interface ForgeApplyExpectedTarget {
  exists: boolean;
  contentHash?: string;
  executable?: boolean;
}

export interface ForgeApplyFileOperation {
  path: string;
  action: ForgeApplyFileAction;
  content: string;
  contentHash: string;
  executable: boolean;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
  expectedTarget: ForgeApplyExpectedTarget;
}

export interface ForgeApplyContract {
  contractVersion: "1";
  templateId: string;
  templateVersion: string;
  operations: ForgeApplyFileOperation[];
  previousState: ForgeGenerationState | null;
  nextState: ForgeGenerationState;
}

export interface ForgeApplyContractRequest {
  renderResult: ForgeRenderResult;
  preview: ForgeGenerationPreview;
  manifest: ForgeTemplateManifest;
  previousState?: ForgeGenerationState;
  generatedAt: string;
}

export type ForgeApplyContractResult =
  | {
      success: true;
      data: ForgeApplyContract;
      diagnostics: ForgeDiagnostic[];
    }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export type ForgeApplyContractValidationResult =
  | { success: true; data: ForgeApplyContract; diagnostics: ForgeDiagnostic[] }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export interface ForgeApplyRenderedLookup {
  byPath: ReadonlyMap<string, ForgeRenderedFile>;
  duplicatePaths: string[];
}

export type ForgePermissionKind =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.delete"
  | "network"
  | "shell"
  | "environment";
export type ForgePermissionStatus = "allowed" | "denied" | "not-declared";

export interface ForgePermissionDeclaration {
  permission: ForgePermissionKind;
  status: ForgePermissionStatus;
  scope: string[];
  source: string;
  description: string;
}

export interface ForgePermissionDeclarationInput {
  permission: ForgePermissionKind;
  declared?: boolean;
  allowed?: boolean;
  scope?: ReadonlyArray<string>;
  source?: string;
  description: string;
}

export type ForgeProjectStatus =
  "uninitialized" | "healthy" | "warning" | "error";
export type ForgeInspectedFileStatus =
  | "current"
  | "planned-create"
  | "planned-replace"
  | "missing"
  | "conflict"
  | "manual-review"
  | "orphaned";

export interface ForgeInspectedFile {
  path: string;
  status: ForgeInspectedFileStatus;
  ownership?: FileOwnership;
  reasonCode?: string;
}

export interface ForgeInspectionDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
  path: Array<string | number>;
}

export interface ForgeProjectInspection {
  inspectionVersion: "1";
  project: {
    initialized: boolean;
    name?: string;
    title?: string;
    serverName?: string;
    serverVersion?: string;
    capabilities?: string[];
    tools?: string[];
  };
  status: ForgeProjectStatus;
  generation: {
    stateAvailable: boolean;
    templateId?: string;
    templateVersion?: string;
    safeToApply?: boolean;
    files: ForgeInspectedFile[];
  };
  permissions: ForgePermissionDeclaration[];
  diagnostics: ForgeInspectionDiagnostic[];
  summary: {
    files: number;
    conflicts: number;
    warnings: number;
    errors: number;
  };
}

export interface ForgeProjectInspectionInput {
  project?: ForgeProjectInspection["project"];
  stateAvailable: boolean;
  stateTemplate?: { id: string; version: string };
  preview?: ForgeGenerationPreview;
  trackedFiles?: ReadonlyArray<{
    path: string;
    exists: boolean;
    currentHash?: string;
    generatedHash: string;
  }>;
  permissions?: ReadonlyArray<ForgePermissionDeclarationInput>;
  diagnostics?: ReadonlyArray<ForgeInspectionDiagnostic | ForgeDiagnostic>;
}

export interface ForgeProjectChangePlan {
  planVersion: "1";
  planId: string;
  planHash: string;
  createdAt: string;
  safeToApply: boolean;
  risk: "none" | "low" | "medium" | "high";
  changes: Array<{
    path: string;
    action: "create" | "replace" | "skip" | "conflict" | "manual-review";
    reasonCode: string;
    ownership: FileOwnership;
    expectedTargetHash?: string;
    desiredHash: string;
  }>;
  permissionChanges: [];
  dataEffects: {
    writesFiles: boolean;
    deletesFiles: false;
    writesGenerationState: boolean;
    projectWideTransaction: false;
  };
  diagnostics: ForgeInspectionDiagnostic[];
}

export interface ForgePlanConfirmationBinding {
  planId: string;
  planHash: string;
}
