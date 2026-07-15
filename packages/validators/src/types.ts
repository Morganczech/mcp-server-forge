import type { ForgeConfig } from "@mcp-server-forge/schemas";

import type { ForgeDiagnosticCode } from "./codes.js";

export type ForgeDiagnosticSeverity = "error" | "warning" | "info";
export type ForgeDiagnosticSource =
  | "schema"
  | "semantic"
  | "security"
  | "compatibility"
  | "import"
  | "template"
  | "generation"
  | "plan"
  | "apply"
  | "filesystem";
export type ForgeDiagnosticCategory =
  | "configuration"
  | "semantic"
  | "security"
  | "compatibility"
  | "documentation"
  | "registry"
  | "client"
  | "import"
  | "template"
  | "generation"
  | "plan"
  | "apply"
  | "filesystem";
export type ForgeDiagnosticPathSegment = string | number;

export interface ForgeDiagnostic {
  code: ForgeDiagnosticCode;
  severity: ForgeDiagnosticSeverity;
  message: string;
  path: ForgeDiagnosticPathSegment[];
  pathText: string;
  source: ForgeDiagnosticSource;
  suggestion?: string;
  documentationUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ForgeDiagnosticDefinition {
  code: ForgeDiagnosticCode;
  severity: ForgeDiagnosticSeverity;
  category: ForgeDiagnosticCategory;
  source: ForgeDiagnosticSource;
  summary: string;
  message: string;
  suggestion?: string;
  fixable: boolean;
}

export type ForgeValidationResult =
  | {
      success: true;
      data: ForgeConfig;
      diagnostics: ForgeDiagnostic[];
    }
  | {
      success: false;
      diagnostics: ForgeDiagnostic[];
    };

export interface FormatDiagnosticsOptions {
  style?: "compact" | "detailed";
  includeSuggestions?: boolean;
}
