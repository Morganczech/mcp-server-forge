import type { ForgeConfig } from "@mcp-server-forge/schemas";
import type {
  FileOwnership,
  FileUpdateStrategy,
  ForgeFilePlanAction,
  ForgeGeneratedFileState,
  ForgeGenerationState,
  ForgeTemplateManifest,
  ForgeTemplateFile,
} from "@mcp-server-forge/templates";
import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export interface ForgeRenderEnvironmentMetadata {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
}

export interface ForgeRenderContext {
  project: {
    name: string;
    title: string;
    description: string;
    language: string;
    license?: string;
  };
  server: {
    name: string;
    version: string;
    description: string;
    runtime: string;
    transport: string;
  };
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
  composition: {
    enabled: boolean;
  };
  knowledge: {
    enabled: boolean;
  };
  documentation: {
    language: string;
  };
  distribution: {
    type: string;
  };
  security: {
    networkAccess: string;
    shellAccess: boolean;
    fileWrite: boolean;
    fileDelete: boolean;
    requireConfirmation: boolean;
  };
  environment: ForgeRenderEnvironmentMetadata[];
  registry: {
    categories: string[];
  };
}

export interface ForgeRenderOptions {
  includeConditionSkipDiagnostics?: boolean;
}

export interface ForgeRenderRequest {
  config: ForgeConfig;
  manifest: ForgeTemplateManifest;
  templateSources: Record<string, string>;
  composition?: {
    capabilityIds: string[];
    runtimeDependencies: Record<string, string>;
    developmentDependencies: Record<string, string>;
    declaredTools: ForgeConfig["tools"];
    declaredAllowedReadPaths: string[];
  };
  options?: ForgeRenderOptions;
}

export interface ForgeRenderedFile {
  path: string;
  content: string;
  contentHash: string;
  contentType?: string;
  executable: boolean;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
  source: string;
}

export interface ForgeSkippedRenderFile {
  path: string;
  source: string;
  reason:
    | "condition-not-met"
    | "condition-invalid"
    | "source-missing"
    | "source-invalid";
}

export interface ForgeRenderMetadata {
  templateId: string;
  templateVersion: string;
  manifestVersion: string;
  renderedFileCount: number;
  skippedFileCount: number;
  skippedFiles: ForgeSkippedRenderFile[];
  renderEngine: "mcp-forge-restricted";
  renderEngineVersion: "1";
  hashAlgorithm: "sha256";
  lineEndings: "lf";
  trailingNewline: "exactly-one";
}

export interface ForgeRenderResult {
  success: boolean;
  files: ForgeRenderedFile[];
  diagnostics: ForgeDiagnostic[];
  metadata: ForgeRenderMetadata;
}

export interface ForgeRenderedPreview {
  files: ForgeRenderedFile[];
  diagnostics: ForgeDiagnostic[];
  safeToPlan: boolean;
}

export type ForgeRenderRequestValidationResult =
  | { success: true; data: ForgeRenderRequest; diagnostics: ForgeDiagnostic[] }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export type ForgeTemplateSourceRenderResult =
  | { success: true; content: string; diagnostics: ForgeDiagnostic[] }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export interface RenderTemplateSourceOptions {
  diagnosticPath?: Array<string | number>;
}

export type ForgeRenderScalar = string | boolean;

export interface ForgeTargetFileState {
  path: string;
  exists: boolean;
  contentHash?: string;
  executable?: boolean;
}

export interface ForgeTargetState {
  files: ForgeTargetFileState[];
}

export interface ForgeGenerationPreviewOptions {
  allowExplicitReplace?: boolean;
}

export interface ForgeGenerationPreviewRequest {
  renderResult: ForgeRenderResult;
  manifest: ForgeTemplateManifest;
  targetState: ForgeTargetState;
  previousState?: ForgeGenerationState;
  options?: ForgeGenerationPreviewOptions;
}

export type ForgeGenerationReasonCode =
  | "TARGET_MISSING"
  | "TARGET_ALREADY_MATCHES"
  | "CREATE_ONCE_TARGET_EXISTS"
  | "USER_OWNED_TARGET_EXISTS"
  | "TARGET_MATCHES_PREVIOUS_GENERATION"
  | "TARGET_MODIFIED_SINCE_GENERATION"
  | "PREVIOUS_GENERATION_HASH_MISSING"
  | "EXPLICIT_REPLACE_NOT_ALLOWED"
  | "EXPLICIT_REPLACE_ALLOWED"
  | "SHARED_FILE_REQUIRES_MERGE"
  | "MANUAL_STRATEGY"
  | "TARGET_HASH_UNKNOWN"
  | "EXECUTABLE_FLAG_CHANGED"
  | "MAPPING_INCONSISTENT";

export interface ForgePlannedFile {
  path: string;
  action: ForgeFilePlanAction;
  reasonCode: ForgeGenerationReasonCode;
  ownership: FileOwnership;
  updateStrategy: FileUpdateStrategy;
  renderedHash: string;
  targetHash?: string;
  previousGeneratedHash?: string;
  changedFromPreviousGeneration?: boolean;
  targetModifiedByUser?: boolean;
  executableChange?: boolean;
}

export interface ForgePlannedFileInput {
  renderedFile: ForgeRenderedFile;
  manifestFile: ForgeTemplateFile;
  targetFile?: ForgeTargetFileState;
  previousFile?: ForgeGeneratedFileState;
  allowExplicitReplace?: boolean;
}

export interface ForgePlannedFileResult {
  file: ForgePlannedFile;
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeOrphanedGeneratedFile {
  path: string;
  ownership?: FileOwnership;
  updateStrategy?: FileUpdateStrategy;
  previousGeneratedHash: string;
  targetExists: boolean;
  targetHash?: string;
  modifiedSinceGeneration?: boolean;
}

export interface ForgeGenerationPreviewSummary {
  create: number;
  replace: number;
  skip: number;
  conflict: number;
  manualReview: number;
}

export interface ForgeGenerationPreviewMetadata {
  templateId: string;
  templateVersion: string;
  renderedFileCount: number;
  plannedFileCount: number;
}

export interface ForgeGenerationPreview {
  success: boolean;
  safeToApply: boolean;
  files: ForgePlannedFile[];
  orphanedFiles: ForgeOrphanedGeneratedFile[];
  summary: ForgeGenerationPreviewSummary;
  diagnostics: ForgeDiagnostic[];
  metadata: ForgeGenerationPreviewMetadata;
}

export type ForgeGenerationPreviewValidationResult =
  | {
      success: true;
      data: ForgeGenerationPreviewRequest;
      diagnostics: ForgeDiagnostic[];
    }
  | { success: false; diagnostics: ForgeDiagnostic[] };
