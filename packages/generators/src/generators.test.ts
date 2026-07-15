import { readFileSync } from "node:fs";

import { forgeConfigSchema, type ForgeConfig } from "@mcp-server-forge/schemas";
import {
  validateTemplateManifest,
  type ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import { describe, expect, it } from "vitest";

import {
  createRenderContext,
  createRenderedPreview,
  normalizeRenderedContent,
  renderForgeTemplate,
  renderTemplateSource,
  validateRenderRequest,
  type ForgeRenderRequest,
} from "./index.js";

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

function config(name: "basic-config" | "knowledge-config"): ForgeConfig {
  return forgeConfigSchema.parse(
    readJson(new URL(`../fixtures/valid/${name}.json`, import.meta.url)),
  );
}

function manifest(
  templateId: "basic-typescript-server" | "knowledge-typescript-server",
): ForgeTemplateManifest {
  const result = validateTemplateManifest(
    readJson(
      new URL(
        `../../templates/templates/${templateId}/template.json`,
        import.meta.url,
      ),
    ),
  );
  if (!result.success) throw new Error(`Invalid test manifest: ${templateId}`);
  return result.data;
}

function request(
  templateId: "basic-typescript-server" | "knowledge-typescript-server",
): ForgeRenderRequest {
  const selectedManifest = manifest(templateId);
  const templateSources = Object.fromEntries(
    selectedManifest.files.map(({ source }) => [
      source,
      readFileSync(
        new URL(
          `../../templates/templates/${templateId}/${source}`,
          import.meta.url,
        ),
        "utf8",
      ),
    ]),
  );
  return {
    config:
      templateId === "basic-typescript-server"
        ? config("basic-config")
        : config("knowledge-config"),
    manifest: selectedManifest,
    templateSources,
  };
}

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map(({ code }) => code);
}

describe("safe render context", () => {
  it("exposes only explicit rendering metadata", () => {
    const context = createRenderContext(config("basic-config"));

    expect(context.project.name).toBe("example-server");
    expect(context.server.transport).toBe("stdio");
    expect(context.capabilities.tools).toBe(true);
    expect(context.environment).toEqual([]);
  });

  it("never includes secret defaults or external-source references", () => {
    const serialized = JSON.stringify(
      createRenderContext(config("basic-config")),
    );

    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("externalSource");
    expect(serialized).not.toContain("default");
  });
});

describe("restricted template language", () => {
  const context = createRenderContext(config("basic-config"));

  it("renders an allowed value", () => {
    expect(renderTemplateSource("{{project.name}}", context)).toMatchObject({
      success: true,
      content: "example-server",
    });
  });

  it("escapes JSON strings", () => {
    expect(
      renderTemplateSource("{{json project.title}}", context),
    ).toMatchObject({
      success: true,
      content: '"Example *Server*"',
    });
  });

  it("escapes Markdown punctuation", () => {
    expect(
      renderTemplateSource("{{escapeMarkdown project.title}}", context),
    ).toMatchObject({ success: true, content: "Example \\*Server\\*" });
  });

  it.each([
    ["lowercase", "example *server*"],
    ["uppercase", "EXAMPLE *SERVER*"],
    ["kebabCase", "example-server"],
    ["snakeCase", "example_server"],
  ])("applies the %s helper", (helper, expected) => {
    expect(
      renderTemplateSource(`{{${helper} project.title}}`, context),
    ).toMatchObject({ success: true, content: expected });
  });

  it("renders a satisfied boolean condition", () => {
    const knowledgeContext = createRenderContext(config("knowledge-config"));
    expect(
      renderTemplateSource(
        "{{#if knowledge.enabled}}enabled{{/if}}",
        knowledgeContext,
      ),
    ).toMatchObject({ success: true, content: "enabled" });
  });

  it("omits an unsatisfied boolean condition", () => {
    expect(
      renderTemplateSource(
        "before{{#if knowledge.enabled}}hidden{{/if}}after",
        context,
      ),
    ).toMatchObject({ success: true, content: "beforeafter" });
  });

  it("rejects unknown variables", () => {
    expect(
      codes(renderTemplateSource("{{project.unknown}}", context)),
    ).toContain("GEN_TEMPLATE_VARIABLE_UNKNOWN");
  });

  it("blocks paths that could expose secrets", () => {
    expect(
      codes(renderTemplateSource("{{environment.default}}", context)),
    ).toContain("GEN_SECRET_ACCESS_BLOCKED");
  });

  it("rejects unknown helpers", () => {
    expect(
      codes(renderTemplateSource("{{reverse project.name}}", context)),
    ).toContain("GEN_TEMPLATE_HELPER_UNKNOWN");
  });

  it.each([
    "{{project.name",
    "{{#if knowledge.enabled}}missing close",
    "{{#each project}}x{{/each}}",
    "{{{project.name}}}",
  ])("rejects invalid syntax: %s", (source) => {
    expect(codes(renderTemplateSource(source, context))).toContain(
      "GEN_TEMPLATE_SYNTAX_INVALID",
    );
  });
});

describe("content normalization", () => {
  it("normalizes CRLF and CR to LF", () => {
    expect(normalizeRenderedContent("a\r\nb\rc")).toBe("a\nb\nc\n");
  });

  it("enforces exactly one trailing newline", () => {
    expect(normalizeRenderedContent("value\n\n\n")).toBe("value\n");
    expect(normalizeRenderedContent("")).toBe("\n");
  });
});

describe("full manifest rendering", () => {
  it("validates a complete render request", () => {
    expect(
      validateRenderRequest(request("basic-typescript-server")),
    ).toMatchObject({ success: true, diagnostics: [] });
  });

  it("diagnoses a missing source and skips only its file", () => {
    const input = request("basic-typescript-server");
    delete input.templateSources["files/src/index.ts.hbs"];
    const result = renderForgeTemplate(input);

    expect(result.success).toBe(false);
    expect(codes(result)).toContain("GEN_TEMPLATE_SOURCE_MISSING");
    expect(result.files).toHaveLength(10);
    expect(result.metadata.skippedFiles).toContainEqual(
      expect.objectContaining({
        path: "src/index.ts",
        reason: "source-missing",
      }),
    );
  });

  it("diagnoses a non-text source and skips only its file", () => {
    const input = request("basic-typescript-server");
    (input.templateSources as Record<string, unknown>)[
      "files/src/index.ts.hbs"
    ] = 42;
    const result = renderForgeTemplate(input);

    expect(result.success).toBe(false);
    expect(codes(result)).toContain("GEN_TEMPLATE_SOURCE_INVALID");
    expect(result.files).toHaveLength(10);
    expect(result.metadata.skippedFiles).toContainEqual(
      expect.objectContaining({ reason: "source-invalid" }),
    );
  });

  it("diagnoses and skips a file with an unknown manifest condition", () => {
    const input = request("basic-typescript-server");
    const firstFile = input.manifest.files[0];
    if (firstFile === undefined) throw new Error("Expected a manifest file");
    input.manifest.files[0] = {
      ...firstFile,
      condition: { field: "unknown.field", equals: true },
    } as unknown as typeof firstFile;
    const result = renderForgeTemplate(input);

    expect(codes(result)).toContain("GEN_TEMPLATE_CONDITION_INVALID");
    expect(result.files).toHaveLength(10);
    expect(result.metadata.skippedFiles).toContainEqual(
      expect.objectContaining({ reason: "condition-invalid" }),
    );
  });

  it("warns about an unused source without failing rendering", () => {
    const input = request("basic-typescript-server");
    input.templateSources["files/unused.hbs"] = "unused";
    const result = renderForgeTemplate(input);

    expect(result.success).toBe(true);
    expect(codes(result)).toContain("GEN_TEMPLATE_SOURCE_UNUSED");
  });

  it("renders all basic server files in memory", () => {
    const result = renderForgeTemplate(request("basic-typescript-server"));

    expect(result.success).toBe(true);
    expect(result.files.map(({ path }) => path)).toEqual([
      ".gitignore",
      "README.md",
      "mcp-forge.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/index.ts",
      "src/tools/hello.ts",
      "tests/hello.test.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
    expect(result.files.map(({ content }) => content).join("\n")).not.toContain(
      "FORGE_TEST_SECRET_VALUE",
    );
  });

  it("renders knowledge files selected by manifest conditions", () => {
    const result = renderForgeTemplate(request("knowledge-typescript-server"));

    expect(result.success).toBe(true);
    expect(result.files.map(({ path }) => path)).toEqual([
      "README.md",
      "SYSTEM_PROMPT.md",
      "data/manifest.json",
      "data/public/.gitkeep",
      "package.json",
      "src/index.ts",
    ]);
    expect(result.metadata.skippedFileCount).toBe(0);
  });

  it("produces valid package JSON", () => {
    const result = renderForgeTemplate(request("basic-typescript-server"));
    const packageFile = result.files.find(
      ({ path }) => path === "package.json",
    );
    const packageJson = JSON.parse(packageFile?.content ?? "") as Record<
      string,
      unknown
    >;

    expect(packageFile).toBeDefined();
    expect(packageJson).toMatchObject({
      name: "example-server",
      version: "0.1.0",
      private: true,
      type: "module",
      packageManager: "pnpm@11.7.0",
      scripts: {
        build: "tsc -p tsconfig.json",
        start: "node dist/index.js",
        test: "vitest run",
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "1.29.0",
        zod: "3.25.76",
      },
    });
    expect(packageJson).not.toHaveProperty("bin");
    expect(JSON.stringify(packageJson)).not.toContain("workspace:");
  });

  it("renders a valid standalone project contract and TypeScript configuration", () => {
    const result = renderForgeTemplate(request("basic-typescript-server"));
    const contents = new Map(
      result.files.map(({ path, content }) => [path, content]),
    );
    const generatedConfig = forgeConfigSchema.parse(
      JSON.parse(contents.get("mcp-forge.json") ?? ""),
    );
    const tsconfig = JSON.parse(contents.get("tsconfig.json") ?? "") as {
      compilerOptions?: { module?: string; rootDir?: string; outDir?: string };
    };

    expect(generatedConfig).toMatchObject({
      server: {
        transport: "stdio",
        capabilities: { tools: true, resources: false, prompts: false },
      },
      tools: [{ name: "hello", readOnly: true, destructive: false }],
      security: {
        networkAccess: "none",
        shellAccess: false,
        fileWrite: false,
        fileDelete: false,
      },
    });
    expect(tsconfig.compilerOptions).toMatchObject({
      module: "NodeNext",
      rootDir: "src",
      outDir: "dist",
    });
    expect(contents.get("src/index.ts")).toContain("StdioServerTransport");
    expect(contents.get("src/index.ts")).toContain('registerTool(\n  "hello"');
    expect(contents.get("src/tools/hello.ts")).toContain(
      "MAX_HELLO_NAME_LENGTH = 80",
    );
    expect(contents.get("tests/hello.test.ts")).toContain(
      'createHelloResult("Mirďas")',
    );
    expect(contents.get("README.md")).toContain("## Connect an MCP client");
    expect(JSON.stringify(generatedConfig.tools[0]?.inputSchema)).not.toMatch(
      /"(?:path|url|command|code)"/u,
    );
    expect(
      `${contents.get("src/index.ts")}\n${contents.get("src/tools/hello.ts")}`,
    ).not.toMatch(
      /node:(?:fs|child_process|http|https|net)|\bfetch\s*\(|process\.env/u,
    );
  });

  it("uses the documented ownership allowlist without unsafe local data", () => {
    const result = renderForgeTemplate(request("basic-typescript-server"));
    const ownership = Object.fromEntries(
      result.files.map(({ path, ownership: value }) => [path, value]),
    );
    const serialized = JSON.stringify(result);

    expect(ownership).toEqual({
      ".gitignore": "user-owned",
      "README.md": "shared",
      "mcp-forge.json": "forge-owned",
      "package.json": "forge-owned",
      "pnpm-lock.yaml": "forge-owned",
      "pnpm-workspace.yaml": "forge-owned",
      "src/index.ts": "forge-owned",
      "src/tools/hello.ts": "forge-owned",
      "tests/hello.test.ts": "forge-owned",
      "tsconfig.json": "forge-owned",
      "vitest.config.ts": "forge-owned",
    });
    expect(serialized).not.toMatch(/\/Users\/(?!example)|\/home\/(?!example)/u);
    expect(serialized).not.toMatch(
      /(?:api[_-]?key|password|private[_-]?key)/iu,
    );
  });

  it("produces deterministic sorting and hashes", () => {
    const input = request("basic-typescript-server");
    const reversed: ForgeRenderRequest = {
      ...input,
      manifest: {
        ...input.manifest,
        files: [...input.manifest.files].reverse(),
      },
      templateSources: Object.fromEntries(
        Object.entries(input.templateSources).reverse(),
      ),
    };

    expect(renderForgeTemplate(reversed)).toEqual(renderForgeTemplate(input));
    expect(renderForgeTemplate(input)).toEqual(renderForgeTemplate(input));
  });

  it("records condition skips without noisy diagnostics by default", () => {
    const input = request("knowledge-typescript-server");
    input.config = config("basic-config");
    const result = renderForgeTemplate(input);

    expect(result.metadata.skippedFiles.map(({ path }) => path)).toEqual([
      "data/manifest.json",
      "data/public/.gitkeep",
    ]);
    expect(codes(result)).not.toContain("GEN_RENDER_SKIPPED_BY_CONDITION");
  });

  it("serializes the result and creates a planning preview", () => {
    const result = renderForgeTemplate(request("basic-typescript-server"));
    const preview = createRenderedPreview(result);

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(preview.safeToPlan).toBe(true);
    expect(preview.files).toEqual(result.files);
  });
});

describe("generator domain boundaries", () => {
  it("has no filesystem, network, environment, time, randomness, or child process access", () => {
    const sourceFiles = [
      "conditions.ts",
      "context.ts",
      "engine.ts",
      "helpers.ts",
      "index.ts",
      "normalize.ts",
      "preview.ts",
      "render.ts",
      "types.ts",
      "validate.ts",
    ];

    for (const fileName of sourceFiles) {
      const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
      expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net)/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain("process.env");
      expect(source).not.toMatch(/Date\.now|new Date|Math\.random/);
    }
  });
});
