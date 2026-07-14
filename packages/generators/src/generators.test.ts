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
    expect(context.capabilities.tools).toBe(false);
    expect(context.environment).toEqual([
      {
        name: "EXAMPLE_TOKEN",
        description: "A secret supplied only at runtime.",
        required: true,
        secret: true,
      },
    ]);
  });

  it("never includes secret defaults or external-source references", () => {
    const serialized = JSON.stringify(
      createRenderContext(config("basic-config")),
    );

    expect(serialized).not.toContain("FORGE_TEST_SECRET_VALUE");
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
    expect(result.files).toHaveLength(3);
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
    expect(result.files).toHaveLength(3);
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
    expect(result.files).toHaveLength(3);
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
      "README.md",
      "SYSTEM_PROMPT.md",
      "package.json",
      "src/index.ts",
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

    expect(packageFile).toBeDefined();
    expect(JSON.parse(packageFile?.content ?? "")).toMatchObject({
      name: "example-server",
      version: "0.1.0",
      private: true,
    });
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
