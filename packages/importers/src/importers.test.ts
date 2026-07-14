import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  convertImportedServerToForgeDraft,
  detectMcpConfigurationFormat,
  importGenericMcpConfiguration,
  importLmStudioConfiguration,
  importMcpConfiguration,
  sanitizeImportedConfiguration,
} from "./index.js";

function fixture(
  group: "valid" | "warnings" | "invalid",
  fileName: string,
): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/${group}/${fileName}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function codes(result: ReturnType<typeof importMcpConfiguration>) {
  return result.diagnostics.map(({ code }) => code);
}

describe("format detection", () => {
  it("detects the documented LM Studio root", () => {
    expect(
      detectMcpConfigurationFormat(fixture("valid", "lm-studio-single.json")),
    ).toEqual({
      status: "detected",
      format: "lm-studio",
      confidence: "high",
      reason: "The root object contains the documented mcpServers key.",
    });
  });

  it("detects generic wrapped and root-map formats", () => {
    expect(
      detectMcpConfigurationFormat(fixture("valid", "generic-servers.json")),
    ).toMatchObject({
      status: "detected",
      format: "generic-mcp-json",
      confidence: "high",
    });
    expect(
      detectMcpConfigurationFormat(fixture("valid", "generic-root-map.json")),
    ).toMatchObject({
      status: "detected",
      format: "generic-mcp-json",
      confidence: "medium",
    });
  });

  it("prefers an explicit source kind", () => {
    expect(
      detectMcpConfigurationFormat(fixture("valid", "lm-studio-single.json"), {
        sourceKind: "generic-mcp-json",
      }),
    ).toMatchObject({
      status: "detected",
      format: "generic-mcp-json",
      confidence: "high",
    });
  });

  it("refuses an ambiguous root", () => {
    const result = importMcpConfiguration(
      fixture("invalid", "ambiguous-root.json"),
    );

    expect(result).toMatchObject({ success: false, servers: [] });
    expect(codes(result)).toEqual(["IMP_AMBIGUOUS_FORMAT"]);
  });

  it("reports placeholder source kinds as unsupported", () => {
    const result = importMcpConfiguration({}, { sourceKind: "package-json" });

    expect(result.detectedFormat).toBe("package-json");
    expect(codes(result)).toEqual(["IMP_UNSUPPORTED_FORMAT"]);
  });
});

describe("LM Studio and generic import", () => {
  it("imports one command server", () => {
    const result = importLmStudioConfiguration(
      fixture("valid", "lm-studio-single.json"),
    );

    expect(result.success).toBe(true);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      source: { kind: "lm-studio", variant: "mcpServers" },
      identity: {
        suggestedId: "fictional-notes",
        displayName: "fictional-notes",
      },
      connection: {
        kind: "command",
        command: "node",
        args: ["server.js"],
        entrypoint: { path: "server.js", pathKind: "relative" },
      },
    });
  });

  it("imports multiple servers in deterministic key order", () => {
    const result = importLmStudioConfiguration(
      fixture("valid", "lm-studio-multiple.json"),
    );

    expect(result.servers.map(({ identity }) => identity.suggestedId)).toEqual([
      "alpha-server",
      "zeta-server",
    ]);
  });

  it("imports generic servers and direct root maps", () => {
    const wrapped = importGenericMcpConfiguration(
      fixture("valid", "generic-servers.json"),
    );
    const rootMap = importGenericMcpConfiguration(
      fixture("valid", "generic-root-map.json"),
    );

    expect(wrapped.servers[0]?.source.variant).toBe("servers");
    expect(rootMap.servers[0]?.source.variant).toBe("root-map");
  });

  it("detects a pinned scoped npx package", () => {
    const result = importMcpConfiguration(
      fixture("valid", "lm-studio-npx-pinned.json"),
    );

    expect(result.servers[0]?.connection).toEqual({
      kind: "npm",
      packageName: "@example/browser-mcp",
      version: "1.2.3",
      versionKind: "pinned",
      packageManager: "npm",
      originalCommand: "npx",
      originalArgs: ["-y", "@example/browser-mcp@1.2.3", "--stdio"],
      packageArgs: ["--stdio"],
    });
    expect(codes(result)).toContain("IMP_NPM_PACKAGE_DETECTED");
  });

  it("warns instead of treating latest as a pinned version", () => {
    const result = importMcpConfiguration(
      fixture("warnings", "npm-latest.json"),
    );

    expect(result.success).toBe(true);
    expect(result.servers[0]?.connection).toMatchObject({
      kind: "npm",
      version: "latest",
      versionKind: "floating",
    });
    expect(codes(result)).toContain("IMP_NPM_VERSION_NOT_PINNED");
  });

  it("warns when a detected npm package has no version", () => {
    const result = importLmStudioConfiguration({
      mcpServers: {
        unpinned: {
          command: "npx",
          args: ["-y", "@example/unpinned-mcp"],
        },
      },
    });

    expect(result.servers[0]?.connection).toMatchObject({
      kind: "npm",
      packageName: "@example/unpinned-mcp",
      versionKind: "missing",
    });
    expect(codes(result)).toContain("IMP_NPM_VERSION_MISSING");
  });

  it("keeps an unrecognized npx invocation as a command", () => {
    const result = importLmStudioConfiguration({
      mcpServers: {
        uncertain: {
          command: "npx",
          args: ["--package", "@example/server@1.0.0"],
        },
      },
    });

    expect(result.servers[0]?.connection.kind).toBe("command");
    expect(codes(result)).not.toContain("IMP_NPM_PACKAGE_DETECTED");
  });

  it("identifies only the first direct Node argument as an entrypoint", () => {
    const local = importMcpConfiguration(
      fixture("valid", "lm-studio-local-node.json"),
    );
    const optionFirst = importLmStudioConfiguration({
      mcpServers: {
        cautious: { command: "node", args: ["--require", "later.js"] },
      },
    });

    expect(local.servers[0]?.connection).toMatchObject({
      kind: "command",
      commandPathKind: "absolute",
      entrypoint: {
        path: "/opt/example/mcp/fictional-server.js",
        pathKind: "absolute",
      },
    });
    expect(codes(local)).toContain("IMP_ABSOLUTE_PATH_REQUIRES_REVIEW");
    expect(optionFirst.servers[0]?.connection).not.toHaveProperty("entrypoint");
  });

  it("normalizes invalid names and detects normalized duplicates", () => {
    const result = importGenericMcpConfiguration({
      servers: {
        "Demo Server": { command: "first" },
        "demo-server": { command: "second" },
      },
    });

    expect(result.success).toBe(false);
    expect(codes(result)).toContain("IMP_SERVER_NAME_INVALID");
    expect(codes(result)).toContain("IMP_DUPLICATE_SERVER_NAME");
  });
});

describe("environment and raw-data safety", () => {
  it("redacts API keys and tokens without retaining their values", () => {
    const result = importMcpConfiguration(
      fixture("warnings", "secret-env.json"),
    );
    const environment = result.servers[0]?.environment ?? [];

    expect(environment).toContainEqual({
      name: "SERVICE_TOKEN",
      required: true,
      secret: true,
      valuePresent: true,
      redacted: true,
      valueRetained: false,
    });
    expect(environment).toContainEqual({
      name: "YOUTUBE_API_KEY",
      required: true,
      secret: true,
      valuePresent: true,
      redacted: true,
      valueRetained: false,
    });
    expect(
      codes(result).filter((code) => code === "IMP_SECRET_REDACTED"),
    ).toHaveLength(2);
  });

  it("preserves public env values by default and can omit them", () => {
    const input = fixture("warnings", "secret-env.json");
    const preserved = importMcpConfiguration(input);
    const omitted = importMcpConfiguration(input, {
      publicEnvironmentValues: "omit",
    });

    expect(
      preserved.servers[0]?.environment.find(
        ({ name }) => name === "PUBLIC_REGION",
      ),
    ).toMatchObject({ valueRetained: true, value: "fictional-region-1" });
    expect(
      omitted.servers[0]?.environment.find(
        ({ name }) => name === "PUBLIC_REGION",
      ),
    ).toEqual({
      name: "PUBLIC_REGION",
      required: true,
      secret: false,
      valuePresent: true,
      redacted: false,
      valueRetained: false,
    });
  });

  it("preserves unknown fields only in sanitized raw metadata", () => {
    const result = importMcpConfiguration(
      fixture("warnings", "unknown-fields.json"),
    );
    const serialized = JSON.stringify(result);

    expect(codes(result)).toContain("IMP_UNKNOWN_FIELD_PRESERVED");
    expect(result.servers[0]?.raw).toEqual({
      unknownFields: {
        credentials: { PRIVATE_KEY: "[REDACTED]" },
        labels: { category: "fictional" },
      },
    });
    expect(serialized).not.toContain("private-value-must-never-survive");
  });

  it("serializes a complete result without any source secret", () => {
    const result = importMcpConfiguration(
      fixture("warnings", "secret-env.json"),
    );
    const serialized = JSON.stringify(result);

    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(serialized).not.toContain("token-value-must-never-survive");
    expect(serialized).not.toContain("api-key-value-must-never-survive");
  });

  it("sanitizes cyclic programmatic input without throwing", () => {
    const input: Record<string, unknown> = { API_KEY: "hidden" };
    input.self = input;

    expect(sanitizeImportedConfiguration(input)).toEqual({
      API_KEY: "[REDACTED]",
      self: "[CIRCULAR]",
    });
  });
});

describe("invalid definitions and Forge draft conversion", () => {
  it.each([
    ["missing-command.json", "IMP_COMMAND_MISSING"],
    ["args-not-array.json", "IMP_ARGS_INVALID"],
    ["env-not-object.json", "IMP_ENV_INVALID"],
    ["empty-server-map.json", "IMP_SERVER_DEFINITION_INVALID"],
  ] as const)("reports %s with %s", (fileName, expectedCode) => {
    const result = importMcpConfiguration(fixture("invalid", fileName));

    expect(result.success).toBe(false);
    expect(codes(result)).toContain(expectedCode);
  });

  it("creates an explicitly incomplete Forge draft", () => {
    const imported = importMcpConfiguration(
      fixture("valid", "lm-studio-npx-pinned.json"),
    );
    const draft = convertImportedServerToForgeDraft(imported.servers[0]!);

    expect(draft).toMatchObject({
      status: "draft",
      requiresReview: true,
      project: { name: "browser-tools", title: "browser-tools" },
      server: {
        name: "browser-tools",
        version: "1.2.3",
        runtime: "node",
        transport: "stdio",
      },
      distribution: {
        type: "npm-package",
        packageName: "@example/browser-mcp",
        version: "1.2.3",
        packageManager: "npm",
        args: ["--stdio"],
      },
      security: {
        networkAccess: "none",
        fileWrite: false,
        fileDelete: false,
      },
    });
    expect(draft.missingRequiredFields).toContain("server.capabilities");
    expect(draft.missingRequiredFields).toContain("server.entrypoint");
    expect(draft.diagnostics.map(({ code }) => code)).toContain(
      "IMP_FIELD_INFERRED",
    );
  });

  it("returns deterministic diagnostics", () => {
    const input = fixture("warnings", "absolute-path.json");

    expect(importMcpConfiguration(input)).toEqual(
      importMcpConfiguration(input),
    );
  });

  it("contains no filesystem, network, or child-process imports in domain code", () => {
    const sourceDirectory = fileURLToPath(new URL("./", import.meta.url));
    const domainSource = readdirSync(sourceDirectory)
      .filter(
        (fileName) =>
          fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"),
      )
      .map((fileName) => readFileSync(`${sourceDirectory}/${fileName}`, "utf8"))
      .join("\n");

    expect(domainSource).not.toMatch(
      /node:(?:fs|http|https|net|child_process)/,
    );
    expect(domainSource).not.toMatch(/\bfetch\s*\(/);
  });
});
