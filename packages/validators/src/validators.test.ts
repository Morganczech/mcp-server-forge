import { readFileSync } from "node:fs";

import { forgeConfigSchema } from "@mcp-server-forge/schemas";
import { describe, expect, it } from "vitest";

import {
  createDiagnostic,
  formatDiagnostics,
  groupDiagnosticsByCode,
  groupDiagnosticsByPath,
  hasErrors,
  hasWarnings,
  validateForgeProject,
  validateParsedForgeConfig,
} from "./index.js";
import { schemaIssuesToDiagnostics } from "./schema-diagnostics.js";

function readSchemaFixture(
  group: "valid" | "invalid",
  fileName: string,
): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../schemas/fixtures/${group}/${fileName}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

const minimalInput = readSchemaFixture("valid", "minimal-stdio.json");

function minimalObject(): Record<string, unknown> {
  return structuredClone(minimalInput) as Record<string, unknown>;
}

function writableTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "update_record",
    title: "Update record",
    description: "Updates a fictional record.",
    inputSchema: {},
    useWhen: "A user explicitly requests an update.",
    avoidWhen: "The user only wants to inspect data.",
    riskLevel: "high",
    readOnly: false,
    destructive: false,
    requiresConfirmation: false,
    ...overrides,
  };
}

function diagnosticCodes(input: unknown) {
  return validateForgeProject(input).diagnostics.map(({ code }) => code);
}

describe("schema diagnostics", () => {
  it("maps a missing required field", () => {
    const input = minimalObject();
    delete input.distribution;

    const result = validateForgeProject(input);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CFG_REQUIRED_FIELD_MISSING",
        path: ["distribution"],
        pathText: "distribution",
      }),
    );
  });

  it("distinguishes missing and unsupported schema versions", () => {
    const missing = minimalObject();
    delete missing.schemaVersion;
    const unsupported = { ...minimalObject(), schemaVersion: "2" };

    expect(diagnosticCodes(missing)).toContain("CFG_SCHEMA_VERSION_MISSING");
    expect(diagnosticCodes(unsupported)).toContain(
      "CFG_SCHEMA_VERSION_UNSUPPORTED",
    );
  });

  it("maps unknown fields independently and deterministically", () => {
    const input = { ...minimalObject(), zeta: true, alpha: true };
    const result = validateForgeProject(input);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CFG_UNKNOWN_FIELD",
          pathText: "alpha",
        }),
        expect.objectContaining({
          code: "CFG_UNKNOWN_FIELD",
          pathText: "zeta",
        }),
      ]),
    );
    expect(result.diagnostics.map(({ pathText }) => pathText)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("maps invalid tool names", () => {
    const input = minimalObject();
    input.tools = [writableTool({ name: "Invalid Tool", readOnly: true })];

    expect(diagnosticCodes(input)).toContain("CFG_TOOL_NAME_INVALID");
  });

  it("maps duplicate names", () => {
    const input = readSchemaFixture("invalid", "duplicate-tool-name.json");

    expect(diagnosticCodes(input)).toContain("CFG_DUPLICATE_NAME");
  });

  it("maps inline secret defaults", () => {
    const input = readSchemaFixture("invalid", "secret-value-inline.json");

    expect(diagnosticCodes(input)).toContain("CFG_SECRET_DEFAULT_FORBIDDEN");
  });

  it("maps unpinned npm versions", () => {
    const input = minimalObject();
    input.distribution = {
      type: "npm-package",
      packageName: "@example/server",
      version: "latest",
      packageManager: "pnpm",
    };

    expect(diagnosticCodes(input)).toContain("CFG_NPM_VERSION_NOT_PINNED");
  });

  it("maps unsafe project paths", () => {
    const input = minimalObject();
    input.server = {
      ...(input.server as Record<string, unknown>),
      entrypoint: "../outside.js",
    };

    expect(diagnosticCodes(input)).toContain("CFG_INVALID_PATH");
  });

  it("maps invalid client modes", () => {
    const input = readSchemaFixture("invalid", "invalid-client-mode.json");

    expect(diagnosticCodes(input)).toContain("CFG_CLIENT_MODE_INVALID");
  });

  it("maps invalid knowledge source locations", () => {
    const input = readSchemaFixture("invalid", "web-source-with-path.json");

    expect(diagnosticCodes(input)).toContain(
      "CFG_KNOWLEDGE_SOURCE_LOCATION_INVALID",
    );
  });

  it("uses a stable fallback for an unmapped schema issue", () => {
    const diagnostics = schemaIssuesToDiagnostics([
      {
        code: "future_schema_issue",
        path: ["project", "title"],
        message: "Internal schema wording must not become the public message.",
      },
    ]);

    expect(diagnostics[0]).toMatchObject({
      code: "CFG_VALIDATION_FAILED",
      pathText: "project.title",
      message: "The configuration does not satisfy schema version 1.",
    });
    expect(diagnostics[0]?.message).not.toContain("Internal schema wording");
  });
});

describe("semantic and security diagnostics", () => {
  it("rejects definitions for a disabled capability", () => {
    const input = minimalObject();
    input.tools = [writableTool({ readOnly: true })];

    const result = validateForgeProject(input);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SEM_CAPABILITY_DISABLED_WITH_DEFINITIONS",
        severity: "error",
        pathText: "server.capabilities.tools",
      }),
    );
  });

  it("warns when a capability is enabled without definitions", () => {
    const input = minimalObject();
    const server = input.server as Record<string, unknown>;
    server.capabilities = {
      ...(server.capabilities as Record<string, unknown>),
      tools: true,
    };

    const result = validateForgeProject(input);

    expect(result.success).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
        severity: "warning",
      }),
    );
  });

  it("warns about sources in a disabled knowledge layer", () => {
    const input = minimalObject();
    input.knowledge = {
      enabled: false,
      sources: [
        {
          id: "handbook",
          type: "markdown",
          path: "knowledge/handbook.md",
          title: "Fictional handbook",
        },
      ],
    };

    const result = validateForgeProject(input);

    expect(result.success).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SEM_KNOWLEDGE_DISABLED_WITH_SOURCES",
        severity: "warning",
      }),
    );
  });

  it("reports write and delete policy conflicts for a destructive tool", () => {
    const input = minimalObject();
    const server = input.server as Record<string, unknown>;
    server.capabilities = {
      ...(server.capabilities as Record<string, unknown>),
      tools: true,
    };
    input.tools = [
      writableTool({
        name: "delete_record",
        destructive: true,
        requiresConfirmation: true,
      }),
    ];

    const parsed = forgeConfigSchema.parse(input);
    const diagnostics = validateParsedForgeConfig(parsed);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "SEC_TOOL_DELETE_DISABLED",
      "SEC_TOOL_WRITE_DISABLED",
    ]);
    expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(
      true,
    );
  });

  it("returns diagnostics in the same order on every run", () => {
    const parsed = forgeConfigSchema.parse(
      readSchemaFixture("valid", "full-project.json"),
    );

    expect(validateParsedForgeConfig(parsed)).toEqual(
      validateParsedForgeConfig(parsed),
    );
  });
});

describe("diagnostic utilities and formatting", () => {
  const warning = createDiagnostic(
    "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
    ["server", "capabilities", "tools"],
  );
  const error = createDiagnostic("CFG_REQUIRED_FIELD_MISSING", ["server"]);

  it("detects severities and groups diagnostics", () => {
    expect(hasErrors([warning, error])).toBe(true);
    expect(hasWarnings([warning, error])).toBe(true);
    expect(groupDiagnosticsByPath([warning, error]).get("server")).toEqual([
      error,
    ]);
    expect(
      groupDiagnosticsByCode([warning, error]).get(
        "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
      ),
    ).toEqual([warning]);
  });

  it("formats compact one-line diagnostics without suggestions", () => {
    expect(
      formatDiagnostics([warning], {
        style: "compact",
        includeSuggestions: false,
      }),
    ).toBe(
      "WARNING SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS server.capabilities.tools: This capability is enabled but has no corresponding definitions.",
    );
  });

  it("formats detailed multi-line diagnostics with suggestions", () => {
    const output = formatDiagnostics([error], { style: "detailed" });

    expect(output).toContain("ERROR CFG_REQUIRED_FIELD_MISSING\nserver\n\n");
    expect(output).toContain("Suggestion: Add the required field");
  });

  it("serializes diagnostics to plain JSON", () => {
    const serialized = JSON.stringify([warning, error]);
    const parsed = JSON.parse(serialized) as unknown;

    expect(parsed).toEqual([warning, error]);
    expect(serialized).not.toContain("ZodError");
  });
});
