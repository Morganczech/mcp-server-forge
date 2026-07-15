import { isAbsolute } from "node:path";

import type { ForgeProjectInspection } from "@mcp-server-forge/core";

import {
  MAX_DIAGNOSTICS,
  MAX_FILES_PER_PAGE,
  MAX_TOOL_RESPONSE_BYTES,
  MAX_USER_TEXT_LENGTH,
} from "./constants.js";
import { mcpDiagnostic } from "./diagnostics.js";
import type { ForgeToolEnvelope } from "./types.js";

export function safeUserText(input: string): string {
  const withoutControls = [...input]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 ? character : " ";
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return withoutControls
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/giu,
      "[private key redacted]",
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu,
      "$1[credentials redacted]@",
    )
    .replace(
      /\bAuthorization\s*:\s*(?:Basic|Bearer)\s+[^\s,;]+/giu,
      "Authorization: [redacted]",
    )
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gu, "Basic [redacted]")
    .replace(
      /(["'])(api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|password|secret|token)\1\s*:\s*(["'])[^"']*\3/giu,
      "$1$2$1:$3[redacted]$3",
    )
    .replace(
      /\b(api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|password|secret|token)\s*[:=]\s*["']?[^\s,"']+/giu,
      "$1=[redacted]",
    )
    .replace(
      /\b([A-Z][A-Z0-9_]{1,63})\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gu,
      "$1=[redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [redacted]")
    .replace(
      /\b(?:Set-Cookie|Cookie)\s*:\s*[^,;]+(?:;[^,]+)*/giu,
      "Cookie: [redacted]",
    )
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{8,}\b/gu, "[redacted]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, "[redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      "[redacted]",
    )
    .slice(0, MAX_USER_TEXT_LENGTH);
}

function safeScope(scope: string): string {
  return isAbsolute(scope) ? "[configured path hidden]" : safeUserText(scope);
}

export function sanitizeInspection(
  inspection: ForgeProjectInspection,
): ForgeProjectInspection {
  const files = inspection.generation.files
    .slice(0, MAX_FILES_PER_PAGE)
    .map((file) => ({
      ...file,
      path: safeUserText(file.path),
      ...(file.reasonCode === undefined
        ? {}
        : { reasonCode: safeUserText(file.reasonCode) }),
    }));
  const diagnostics = inspection.diagnostics
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) => ({
      ...diagnostic,
      message: safeUserText(diagnostic.message),
      source: safeUserText(diagnostic.source),
      path: diagnostic.path.map((segment) =>
        typeof segment === "string" ? safeUserText(segment) : segment,
      ),
    }));
  return {
    ...inspection,
    project: {
      initialized: inspection.project.initialized,
      ...(inspection.project.name === undefined
        ? {}
        : { name: safeUserText(inspection.project.name) }),
      ...(inspection.project.title === undefined
        ? {}
        : { title: safeUserText(inspection.project.title) }),
      ...(inspection.project.serverName === undefined
        ? {}
        : { serverName: safeUserText(inspection.project.serverName) }),
      ...(inspection.project.serverVersion === undefined
        ? {}
        : { serverVersion: safeUserText(inspection.project.serverVersion) }),
    },
    generation: { ...inspection.generation, files },
    permissions: inspection.permissions.map((permission) => ({
      ...permission,
      scope: permission.scope.map(safeScope),
      source: safeUserText(permission.source),
      description: safeUserText(permission.description),
    })),
    diagnostics,
  };
}

export function enforceResponseLimit<T>(
  envelope: ForgeToolEnvelope<T>,
): ForgeToolEnvelope<T> {
  if (
    Buffer.byteLength(JSON.stringify(envelope), "utf8") <=
    MAX_TOOL_RESPONSE_BYTES
  ) {
    return envelope;
  }
  return {
    success: false,
    ...(envelope.projectId === undefined
      ? {}
      : { projectId: envelope.projectId }),
    data: null,
    summary: {
      status: "error",
      message: "The safe response size limit was exceeded.",
    },
    diagnostics: [
      mcpDiagnostic(
        "MCP_OUTPUT_LIMIT_EXCEEDED",
        "The result is too large to return safely. Request a smaller page.",
      ),
    ],
  };
}
