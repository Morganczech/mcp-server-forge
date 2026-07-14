import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export const FORGE_TEMPLATE_KINDS = [
  "server",
  "knowledge-server",
  "registry-package",
  "client-profile",
] as const;

export const SUPPORTED_FORGE_TEMPLATE_KINDS = [
  "server",
  "knowledge-server",
] as const;

export type ForgeTemplateKind = (typeof FORGE_TEMPLATE_KINDS)[number];
export type SupportedForgeTemplateKind =
  (typeof SUPPORTED_FORGE_TEMPLATE_KINDS)[number];

export type FileOwnership = "forge-owned" | "user-owned" | "shared";

export type FileUpdateStrategy =
  | "create-once"
  | "replace"
  | "replace-if-unmodified"
  | "merge-markers"
  | "manual";

export type TemplateEqualsConditionField =
  | "project.language"
  | "server.runtime"
  | "server.transport"
  | "server.capabilities.tools"
  | "server.capabilities.resources"
  | "server.capabilities.prompts"
  | "knowledge.enabled"
  | "documentation.language"
  | "distribution.type";

export type TemplateIncludesConditionField = "registry.categories";

export type TemplateCondition =
  | {
      field: TemplateEqualsConditionField;
      equals: string | boolean;
    }
  | {
      field: TemplateIncludesConditionField;
      includes: string;
    };

export interface ForgeTemplateFile {
  path: string;
  source: string;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
  required: boolean;
  executable?: boolean;
  contentType?: string;
  condition?: TemplateCondition;
}

export interface ForgeTemplateDirectory {
  path: string;
  required: boolean;
  condition?: TemplateCondition;
}

export interface ForgeTemplateManifest {
  manifestVersion: "1";
  template: {
    id: string;
    version: string;
    title: string;
    description: string;
    kind: SupportedForgeTemplateKind;
    runtime: "node";
    language: "typescript";
  };
  compatibility: {
    forgeConfigSchema: string[];
    minimumForgeVersion?: string;
  };
  files: ForgeTemplateFile[];
  directories?: ForgeTemplateDirectory[];
}

export interface ForgeGeneratedFileState {
  path: string;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
  generatedHash: string;
  templateSourceHash?: string;
}

export interface ForgeGenerationState {
  stateVersion: "1";
  templateId: string;
  templateVersion: string;
  hashAlgorithm: "sha256";
  generatedAt: string;
  files: ForgeGeneratedFileState[];
}

export type TemplateValidationResult<T> =
  | { success: true; data: T; diagnostics: ForgeDiagnostic[] }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export type ForgeFilePlanAction =
  "create" | "replace" | "skip" | "conflict" | "manual-review";

export type ForgeFilePlanReasonCode =
  | "target-missing"
  | "target-already-matches"
  | "create-once-preserved"
  | "target-unmodified"
  | "target-modified"
  | "previous-state-missing"
  | "user-owned-preserved"
  | "shared-merge-unavailable"
  | "manual-strategy"
  | "unsafe-replace-blocked"
  | "unsafe-replace-approved"
  | "executable-change-requires-review"
  | "ownership-strategy-conflict";

export interface ForgeFilePlan {
  path: string;
  action: ForgeFilePlanAction;
  reasonCode: ForgeFilePlanReasonCode;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
}

export interface FilePlanningInput {
  manifestFile: ForgeTemplateFile;
  targetExists: boolean;
  targetHash?: string;
  previousGeneratedHash?: string;
  renderedHash?: string;
  targetExecutable?: boolean;
  renderedExecutable?: boolean;
  allowUnsafeReplace?: boolean;
}

export interface ForgeFilePlanningResult {
  plan: ForgeFilePlan;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeGenerationPlanningInput {
  templateId: string;
  templateVersion: string;
  files: FilePlanningInput[];
  previousState?: ForgeGenerationState;
}

export interface ForgeGenerationPlan {
  templateId: string;
  templateVersion: string;
  files: ForgeFilePlan[];
  diagnostics: ForgeDiagnostic[];
  safeToApply: boolean;
}
