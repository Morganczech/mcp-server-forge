import type { JsonValue } from "@mcp-server-forge/schemas";
import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

export type ImportSourceKind =
  | "lm-studio"
  | "generic-mcp-json"
  | "package-json"
  | "server-metadata"
  | "custom";

export type SupportedImportSourceKind = "lm-studio" | "generic-mcp-json";
export type ImportConfidence = "high" | "medium" | "low";
export type ImportValueOrigin = "observed" | "inferred";
export type ImportSourceVariant = "mcpServers" | "servers" | "root-map";

export interface ImportSource {
  kind: SupportedImportSourceKind;
  variant: ImportSourceVariant;
}

export interface ImportProvenance {
  sourceKind: SupportedImportSourceKind;
  sourceVariant: ImportSourceVariant;
  sourcePath: Array<string | number>;
  serverKey: string;
  observedFields: string[];
  inferredFields: string[];
}

export interface ImportConfidenceReport {
  overall: ImportConfidence;
  fields: Record<string, ImportConfidence>;
}

export interface ImportedIdentity {
  suggestedId: string;
  displayName: string;
  description?: string;
  version?: string;
}

export interface ImportedEntrypoint {
  path: string;
  pathKind: "absolute" | "relative";
  argumentIndex: number;
}

export interface ImportedCommandConnection {
  kind: "command";
  command: string;
  commandPathKind: "absolute" | "path-command";
  args: string[];
  workingDirectory?: string;
  entrypoint?: ImportedEntrypoint;
}

export interface ImportedNpmConnection {
  kind: "npm";
  packageName: string;
  version?: string;
  versionKind: "pinned" | "floating" | "missing";
  packageManager: "npm";
  originalCommand: string;
  originalArgs: string[];
  packageArgs: string[];
}

export interface ImportedRemoteConnection {
  kind: "remote";
  url: string;
  transport: "streamable-http";
}

export type ImportedConnection =
  ImportedCommandConnection | ImportedNpmConnection | ImportedRemoteConnection;

export interface ImportedEnvironmentVariable {
  name: string;
  required: true;
  secret: boolean;
  valuePresent: boolean;
  redacted: boolean;
  valueRetained: boolean;
  value?: string;
}

export interface ImportedCapabilityHint {
  capability: "tools" | "resources" | "prompts";
  confidence: ImportConfidence;
  origin: ImportValueOrigin;
}

export interface SanitizedImportedRaw {
  unknownFields: Record<string, JsonValue>;
}

export interface ImportedMcpServerDraft {
  source: ImportSource;
  identity: ImportedIdentity;
  connection: ImportedConnection;
  environment: ImportedEnvironmentVariable[];
  capabilities: ImportedCapabilityHint[];
  provenance: ImportProvenance;
  diagnostics: ForgeDiagnostic[];
  confidence: ImportConfidenceReport;
  raw?: SanitizedImportedRaw;
}

export interface DetectedImportFormat {
  status: "detected";
  format: ImportSourceKind;
  confidence: ImportConfidence;
  reason: string;
}

export interface AmbiguousImportFormat {
  status: "ambiguous";
  candidates: SupportedImportSourceKind[];
  confidence: "low";
  reason: string;
}

export interface UnsupportedImportFormat {
  status: "unsupported";
  confidence: "low";
  reason: string;
}

export type ImportFormatDetection =
  DetectedImportFormat | AmbiguousImportFormat | UnsupportedImportFormat;

export interface ImportOptions {
  sourceKind?: ImportSourceKind;
  publicEnvironmentValues?: "preserve" | "omit";
  includeSanitizedRaw?: boolean;
}

export interface ImportResult {
  success: boolean;
  detectedFormat?: ImportSourceKind;
  detection: ImportFormatDetection;
  servers: ImportedMcpServerDraft[];
  diagnostics: ForgeDiagnostic[];
}

export interface ForgeConfigurationDraft {
  status: "draft";
  requiresReview: true;
  project: {
    name: string;
    title: string;
    description?: string;
    language?: string;
  };
  server: {
    name: string;
    version?: string;
    description?: string;
    runtime?: "node";
    transport?: "stdio" | "streamable-http";
    entrypoint?: string;
  };
  distribution:
    | {
        type: "npm-package";
        packageName: string;
        version?: string;
        packageManager: "npm";
        args: string[];
      }
    | {
        type: "custom-command";
        command: string;
        args: string[];
      }
    | {
        type: "remote-http";
        url: string;
      };
  environment: Array<{
    name: string;
    description?: string;
    required: true;
    secret: boolean;
    default?: string;
  }>;
  security: {
    allowedRootDirectories: string[];
    networkAccess: "none";
    shellAccess: false;
    fileWrite: false;
    fileDelete: false;
    requireConfirmation: true;
  };
  missingRequiredFields: string[];
  diagnostics: ForgeDiagnostic[];
}
