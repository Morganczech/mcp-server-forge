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
