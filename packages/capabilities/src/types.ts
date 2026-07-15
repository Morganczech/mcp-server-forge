import type { ForgeConfig, Tool } from "@mcp-server-forge/schemas";
import type {
  ForgeTemplateFile,
  ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export type CapabilityPermissionKind =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.delete"
  | "network"
  | "shell"
  | "environment";

export interface CapabilityPermissionRequirement {
  permission: CapabilityPermissionKind;
  status: "allowed" | "denied";
  scope: string[];
  description: string;
}

export interface CapabilityToolDeclaration extends Tool {
  registration: {
    module: string;
    export: string;
  };
}

export interface CapabilityDataDeclaration {
  path: string;
  ownership: "user-owned";
  removal: "preserve";
  description: string;
}

export interface ForgeCapabilityManifestV1 {
  manifestVersion: "1";
  id: string;
  version: string;
  displayName: string;
  description: string;
  compatibleTemplates: string[];
  requires: string[];
  conflictsWith: string[];
  permissions: CapabilityPermissionRequirement[];
  files: ForgeTemplateFile[];
  dependencies: {
    runtime?: Record<string, string>;
    development?: Record<string, string>;
  };
  tools: CapabilityToolDeclaration[];
  data?: CapabilityDataDeclaration[];
}

export interface ForgeCapabilityBundle {
  manifest: ForgeCapabilityManifestV1;
  templateSources: Record<string, string>;
}

export interface ForgeCapabilityCompositionRequest {
  config: ForgeConfig;
  templateManifest: ForgeTemplateManifest;
  templateSources: Record<string, string>;
  requestedCapabilities: string[];
  capabilityBundles: ForgeCapabilityBundle[];
}

export interface ForgeRenderComposition {
  capabilityIds: string[];
  runtimeDependencies: Record<string, string>;
  developmentDependencies: Record<string, string>;
  declaredTools: Tool[];
  declaredAllowedReadPaths: string[];
  effectiveConfig: ForgeConfig;
}

export interface ForgeCapabilityComposition {
  manifest: ForgeTemplateManifest;
  templateSources: Record<string, string>;
  renderComposition: ForgeRenderComposition;
  permissions: CapabilityPermissionRequirement[];
}

export type ForgeCapabilityValidationResult =
  | {
      success: true;
      data: ForgeCapabilityManifestV1;
      diagnostics: ForgeDiagnostic[];
    }
  | { success: false; diagnostics: ForgeDiagnostic[] };

export type ForgeCapabilityCompositionResult =
  | {
      success: true;
      data: ForgeCapabilityComposition;
      diagnostics: ForgeDiagnostic[];
    }
  | { success: false; diagnostics: ForgeDiagnostic[] };
