import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { detectMcpConfigurationFormat, isRecord } from "./detect.js";
import { normalizeServerDefinition } from "./normalize.js";
import type {
  ImportFormatDetection,
  ImportOptions,
  ImportResult,
  ImportSource,
  ImportSourceKind,
  ImportedMcpServerDraft,
  SupportedImportSourceKind,
} from "./types.js";

interface ServerMapSelection {
  serverMap?: Record<string, unknown>;
  source: ImportSource;
  sourcePath: string[];
  diagnostics: ForgeDiagnostic[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectServerMap(
  input: unknown,
  sourceKind: SupportedImportSourceKind,
): ServerMapSelection {
  const variant = sourceKind === "lm-studio" ? "mcpServers" : "servers";
  const sourcePath = sourceKind === "lm-studio" ? ["mcpServers"] : ["servers"];
  const source: ImportSource = { kind: sourceKind, variant };

  if (!isRecord(input)) {
    return {
      source,
      sourcePath,
      diagnostics: [createDiagnostic("IMP_UNSUPPORTED_FORMAT", [])],
    };
  }

  let mapValue: unknown;
  if (sourceKind === "lm-studio") {
    mapValue = input.mcpServers;
  } else if (Object.prototype.hasOwnProperty.call(input, "servers")) {
    mapValue = input.servers;
  } else {
    mapValue = input;
    source.variant = "root-map";
    sourcePath.length = 0;
  }

  if (!isRecord(mapValue)) {
    return {
      source,
      sourcePath,
      diagnostics: [
        createDiagnostic("IMP_SERVER_DEFINITION_INVALID", sourcePath, {
          reason: "server-map-not-object",
        }),
      ],
    };
  }

  if (Object.keys(mapValue).length === 0) {
    return {
      source,
      sourcePath,
      diagnostics: [
        createDiagnostic("IMP_SERVER_DEFINITION_INVALID", sourcePath, {
          reason: "server-map-empty",
        }),
      ],
    };
  }

  return { serverMap: mapValue, source, sourcePath, diagnostics: [] };
}

function unsupportedResult(
  detection: ImportFormatDetection,
  code: "IMP_UNSUPPORTED_FORMAT" | "IMP_AMBIGUOUS_FORMAT",
): ImportResult {
  return {
    success: false,
    detection,
    servers: [],
    diagnostics: [createDiagnostic(code, [])],
  };
}

function importDetectedConfiguration(
  input: unknown,
  sourceKind: SupportedImportSourceKind,
  detection: ImportFormatDetection,
  options: ImportOptions,
): ImportResult {
  const selection = selectServerMap(input, sourceKind);
  const diagnostics = [...selection.diagnostics];
  const servers: ImportedMcpServerDraft[] = [];

  if (selection.serverMap !== undefined) {
    const seenSuggestedIds = new Map<string, string>();
    const entries = Object.entries(selection.serverMap).sort(
      ([left], [right]) => compareText(left, right),
    );

    entries.forEach(([serverKey, definition], index) => {
      const normalized = normalizeServerDefinition({
        serverKey,
        definition,
        index,
        source: selection.source,
        sourcePath: selection.sourcePath,
        importOptions: options,
      });
      diagnostics.push(...normalized.diagnostics);

      if (normalized.server === undefined) {
        return;
      }

      const existingSourceName = seenSuggestedIds.get(
        normalized.server.identity.suggestedId,
      );
      if (existingSourceName !== undefined) {
        const duplicateDiagnostic = createDiagnostic(
          "IMP_DUPLICATE_SERVER_NAME",
          normalized.server.provenance.sourcePath,
          {
            suggestedId: normalized.server.identity.suggestedId,
            sourceNames: [existingSourceName, serverKey].sort(compareText),
          },
        );
        normalized.server.diagnostics = sortDiagnostics([
          ...normalized.server.diagnostics,
          duplicateDiagnostic,
        ]);
        diagnostics.push(duplicateDiagnostic);
      } else {
        seenSuggestedIds.set(normalized.server.identity.suggestedId, serverKey);
      }

      servers.push(normalized.server);
    });
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    success: !hasErrors(sortedDiagnostics),
    detectedFormat: sourceKind,
    detection,
    servers,
    diagnostics: sortedDiagnostics,
  };
}

export function importMcpConfiguration(
  input: unknown,
  options: ImportOptions = {},
): ImportResult {
  const detection = detectMcpConfigurationFormat(input, options);

  if (detection.status === "ambiguous") {
    return unsupportedResult(detection, "IMP_AMBIGUOUS_FORMAT");
  }
  if (detection.status === "unsupported") {
    return unsupportedResult(detection, "IMP_UNSUPPORTED_FORMAT");
  }
  if (
    !(["lm-studio", "generic-mcp-json"] as ImportSourceKind[]).includes(
      detection.format,
    )
  ) {
    return {
      ...unsupportedResult(detection, "IMP_UNSUPPORTED_FORMAT"),
      detectedFormat: detection.format,
    };
  }

  return importDetectedConfiguration(
    input,
    detection.format as SupportedImportSourceKind,
    detection,
    options,
  );
}

export function importLmStudioConfiguration(
  input: unknown,
  options: Omit<ImportOptions, "sourceKind"> = {},
): ImportResult {
  return importMcpConfiguration(input, {
    ...options,
    sourceKind: "lm-studio",
  });
}

export function importGenericMcpConfiguration(
  input: unknown,
  options: Omit<ImportOptions, "sourceKind"> = {},
): ImportResult {
  return importMcpConfiguration(input, {
    ...options,
    sourceKind: "generic-mcp-json",
  });
}
