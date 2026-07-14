import { getDiagnosticDefinition } from "./catalog.js";
import type { ForgeDiagnosticCode } from "./codes.js";
import type {
  ForgeDiagnostic,
  ForgeDiagnosticPathSegment,
  ForgeDiagnosticSeverity,
} from "./types.js";

const severityOrder: Record<ForgeDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function formatDiagnosticPath(
  path: ReadonlyArray<ForgeDiagnosticPathSegment>,
): string {
  return path.length === 0 ? "<root>" : path.join(".");
}

export function createDiagnostic(
  code: ForgeDiagnosticCode,
  path: ReadonlyArray<ForgeDiagnosticPathSegment>,
  metadata?: Record<string, unknown>,
): ForgeDiagnostic {
  const definition = getDiagnosticDefinition(code);
  const diagnostic: ForgeDiagnostic = {
    code,
    severity: definition.severity,
    message: definition.message,
    path: [...path],
    pathText: formatDiagnosticPath(path),
    source: definition.source,
  };

  if (definition.suggestion !== undefined) {
    diagnostic.suggestion = definition.suggestion;
  }
  if (metadata !== undefined) {
    diagnostic.metadata = metadata;
  }

  return diagnostic;
}

export function sortDiagnostics(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): ForgeDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    return (
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.pathText.localeCompare(right.pathText) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
    );
  });
}

export function hasErrors(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): boolean {
  return diagnostics.some(({ severity }) => severity === "error");
}

export function hasWarnings(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): boolean {
  return diagnostics.some(({ severity }) => severity === "warning");
}

export function groupDiagnosticsByPath(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): ReadonlyMap<string, ForgeDiagnostic[]> {
  const groups = new Map<string, ForgeDiagnostic[]>();

  for (const diagnostic of sortDiagnostics(diagnostics)) {
    const group = groups.get(diagnostic.pathText) ?? [];
    group.push(diagnostic);
    groups.set(diagnostic.pathText, group);
  }

  return groups;
}

export function groupDiagnosticsByCode(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): ReadonlyMap<ForgeDiagnosticCode, ForgeDiagnostic[]> {
  const groups = new Map<ForgeDiagnosticCode, ForgeDiagnostic[]>();

  for (const diagnostic of sortDiagnostics(diagnostics)) {
    const group = groups.get(diagnostic.code) ?? [];
    group.push(diagnostic);
    groups.set(diagnostic.code, group);
  }

  return groups;
}
