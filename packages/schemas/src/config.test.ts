import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  forgeConfigSchema,
  validateForgeConfig,
  type ForgeConfig,
} from "./index.js";

const fixturesDirectory = fileURLToPath(
  new URL("../fixtures/", import.meta.url),
);

function readFixtures(group: "valid" | "invalid") {
  const directory = `${fixturesDirectory}${group}`;

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => ({
      fileName,
      value: JSON.parse(
        readFileSync(`${directory}/${fileName}`, "utf8"),
      ) as unknown,
    }));
}

const minimalConfig = readFixtures("valid").find(
  ({ fileName }) => fileName === "minimal-stdio.json",
)?.value;

if (minimalConfig === undefined) {
  throw new Error("The minimal-stdio.json fixture is required by schema tests");
}

describe("forgeConfigSchema fixtures", () => {
  for (const fixture of readFixtures("valid")) {
    it(`accepts ${fixture.fileName}`, () => {
      const result = forgeConfigSchema.safeParse(fixture.value);

      expect(
        result.success,
        result.success ? undefined : result.error.message,
      ).toBe(true);
    });
  }

  for (const fixture of readFixtures("invalid")) {
    it(`rejects ${fixture.fileName}`, () => {
      expect(forgeConfigSchema.safeParse(fixture.value).success).toBe(false);
    });
  }
});

describe("forgeConfigSchema cross-field validation", () => {
  it("requires confirmation for destructive tools", () => {
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      tools: [
        {
          name: "delete_record",
          title: "Delete record",
          description: "Deletes a fictional record.",
          inputSchema: {},
          useWhen: "Deletion is explicitly requested.",
          avoidWhen: "The user has not confirmed deletion.",
          riskLevel: "high",
          readOnly: false,
          destructive: true,
          requiresConfirmation: false,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "tools.0.requiresConfirmation",
          message: "Destructive tools must require confirmation",
        }),
      );
    }
  });

  it("rejects inline defaults for secret variables", () => {
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      environment: [
        {
          name: "API_TOKEN",
          description: "A runtime secret.",
          required: true,
          secret: true,
          default: "must-not-be-stored-here",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatchObject({
        path: "environment.0.default",
        message: "Secret variables must not define an inline default value",
      });
    }
  });

  it.each([
    ["tools", { name: "duplicate_tool" }],
    ["prompts", { name: "duplicate_prompt" }],
    ["resources", { name: "duplicate_resource" }],
  ] as const)("rejects duplicate %s names", (collection, namedItem) => {
    const completeItems = {
      tools: {
        ...namedItem,
        title: "Duplicate",
        description: "Duplicate definition.",
        inputSchema: {},
        useWhen: "Needed.",
        avoidWhen: "Not needed.",
        riskLevel: "low",
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
      },
      prompts: {
        ...namedItem,
        title: "Duplicate",
        description: "Duplicate definition.",
      },
      resources: {
        ...namedItem,
        title: "Duplicate",
        description: "Duplicate definition.",
        uri: "demo://duplicate",
      },
    };
    const item = completeItems[collection];
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      [collection]: [item, item],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: `${collection}.1.name`,
          message: expect.stringContaining("Duplicate"),
        }),
      );
    }
  });

  it("reports a resource-template collision at the template path", () => {
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      resources: [
        {
          name: "record_detail",
          title: "Record",
          description: "A static record.",
          uri: "demo://records/one",
        },
      ],
      resourceTemplates: [
        {
          name: "record_detail",
          title: "Record template",
          description: "A record selected by ID.",
          uriTemplate: "demo://records/{id}",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "resourceTemplates.0.name",
          message: expect.stringContaining("Duplicate resources name"),
        }),
      );
    }
  });

  it("rejects parent-directory traversal in project-relative paths", () => {
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      knowledge: {
        enabled: true,
        sources: [
          {
            id: "outside_file",
            type: "markdown",
            path: "../outside.md",
            title: "Outside file",
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "knowledge.sources.0.path",
          message: expect.stringContaining(
            "without parent-directory traversal",
          ),
        }),
      );
    }
  });

  it("applies safe defaults", () => {
    const parsed = forgeConfigSchema.parse(minimalConfig);

    expect(parsed.clients).toEqual({});
    expect(parsed.capabilities).toEqual([]);
    expect(parsed.knowledge.enabled).toBe(false);
    expect(parsed.security).toMatchObject({
      allowedRootDirectories: [],
      allowedReadPaths: [],
      networkAccess: "none",
      shellAccess: false,
      fileWrite: false,
      fileDelete: false,
      requireConfirmation: true,
    });
  });

  it("accepts capability ids and confined read paths", () => {
    const result = forgeConfigSchema.safeParse({
      ...(minimalConfig as object),
      capabilities: ["local-json-data", "contacts-read"],
      security: { allowedReadPaths: ["data/contacts.json"] },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsafe read paths", () => {
    for (const path of [
      "../contacts.json",
      "/tmp/contacts.json",
      "C:\\contacts.json",
    ]) {
      expect(
        forgeConfigSchema.safeParse({
          ...(minimalConfig as object),
          security: { allowedReadPaths: [path] },
        }).success,
      ).toBe(false);
    }
  });
});

describe("validateForgeConfig", () => {
  it("returns typed parsed data for a valid configuration", () => {
    const result = validateForgeConfig(minimalConfig);

    expect(result.success).toBe(true);
    if (result.success) {
      expectTypeOf(result.data).toMatchTypeOf<ForgeConfig>();
      expect(result.data.schemaVersion).toBe("1");
    }
  });

  it("returns readable paths and messages", () => {
    const result = validateForgeConfig({
      ...(minimalConfig as object),
      schemaVersion: "2",
    });

    expect(result).toEqual({
      success: false,
      errors: [
        expect.objectContaining({
          path: "schemaVersion",
          message: expect.stringContaining("1"),
        }),
      ],
    });
  });
});
