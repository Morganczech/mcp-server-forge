import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forgeConfigSchema } from "@mcp-server-forge/schemas";
import {
  validateTemplateManifest,
  type ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import { describe, expect, it } from "vitest";

import { resolveCapabilityComposition } from "./resolve.js";
import type {
  ForgeCapabilityBundle,
  ForgeCapabilityManifestV1,
} from "./types.js";
import { validateCapabilityManifest } from "./validation.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const capabilityRoot = join(
  repoRoot,
  "packages",
  "capabilities",
  "capabilities",
);

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sources(
  root: string,
  directory = join(root, "files"),
  prefix = "files",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      Object.assign(result, sources(root, join(directory, entry.name), path));
    else result[path] = readFileSync(join(directory, entry.name), "utf8");
  }
  return result;
}

function bundle(
  id: "local-json-data" | "contacts-read",
): ForgeCapabilityBundle {
  const root = join(capabilityRoot, id);
  const validated = validateCapabilityManifest(
    json(join(root, "capability.json")),
  );
  if (!validated.success)
    throw new Error(
      `Invalid test capability ${id}: ${JSON.stringify(validated.diagnostics)}`,
    );
  return { manifest: validated.data, templateSources: sources(root) };
}

function base() {
  const templateRoot = join(
    repoRoot,
    "packages",
    "templates",
    "templates",
    "basic-typescript-server",
  );
  const manifest = validateTemplateManifest(
    json(join(templateRoot, "template.json")),
  );
  if (!manifest.success) throw new Error("Invalid base template");
  const config = forgeConfigSchema.parse(
    json(
      join(
        repoRoot,
        "packages",
        "generators",
        "fixtures",
        "valid",
        "basic-config.json",
      ),
    ),
  );
  return {
    manifest: manifest.data,
    templateSources: sources(templateRoot),
    config,
  };
}

function request(
  ids: string[],
  bundles: ForgeCapabilityBundle[],
  templateManifest?: ForgeTemplateManifest,
) {
  const value = base();
  return {
    config: { ...value.config, capabilities: ids },
    templateManifest: templateManifest ?? value.manifest,
    templateSources: value.templateSources,
    requestedCapabilities: ids,
    capabilityBundles: bundles,
  };
}

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map(({ code }) => code);
}

function changed(
  source: ForgeCapabilityBundle,
  update: (manifest: ForgeCapabilityManifestV1) => void,
): ForgeCapabilityBundle {
  const result = structuredClone(source);
  update(result.manifest);
  return result;
}

describe("capability manifest v1", () => {
  it.each(["local-json-data", "contacts-read"] as const)(
    "validates the official %s bundle",
    (id) =>
      expect(validateCapabilityManifest(bundle(id).manifest).success).toBe(
        true,
      ),
  );

  it("rejects unknown fields and unsupported versions", () => {
    const input = structuredClone(
      bundle("local-json-data").manifest,
    ) as unknown as Record<string, unknown>;
    input.unknown = true;
    expect(codes(validateCapabilityManifest(input))).toContain(
      "CAP_MANIFEST_INVALID",
    );
    input.manifestVersion = "2";
    expect(codes(validateCapabilityManifest(input))).toContain(
      "CAP_MANIFEST_VERSION_UNSUPPORTED",
    );
  });

  it.each(["", "01.0.0", "1.0.0-01", "1.0.0-", "latest"])(
    "rejects invalid capability version %j",
    (version) => {
      const input = structuredClone(bundle("local-json-data").manifest);
      input.version = version;
      expect(codes(validateCapabilityManifest(input))).toContain(
        "CAP_MANIFEST_INVALID",
      );
    },
  );

  it.each(["", "Contacts", "../contacts", "contacts_read"])(
    "rejects invalid capability id %j",
    (id) => {
      const input = structuredClone(bundle("local-json-data").manifest);
      input.id = id;
      expect(codes(validateCapabilityManifest(input))).toContain(
        "CAP_MANIFEST_INVALID",
      );
    },
  );

  it.each(["/tmp/data.json", "../data.json", "C:\\data.json"])(
    "rejects unsafe capability path %s",
    (path) => {
      const input = structuredClone(bundle("local-json-data").manifest);
      input.files[0]!.path = path;
      expect(codes(validateCapabilityManifest(input))).toContain(
        "CAP_MANIFEST_INVALID",
      );
    },
  );

  it("rejects tool and user-data declarations without matching files", () => {
    const tool = structuredClone(bundle("contacts-read").manifest);
    tool.tools[0]!.registration.module = "src/tools/missing.ts";
    expect(codes(validateCapabilityManifest(tool))).toContain(
      "CAP_MANIFEST_INVALID",
    );

    const data = structuredClone(bundle("local-json-data").manifest);
    data.data![0]!.path = "data/missing.json";
    expect(codes(validateCapabilityManifest(data))).toContain(
      "CAP_MANIFEST_INVALID",
    );
  });
});

describe("deterministic capability composition", () => {
  const local = bundle("local-json-data");
  const contacts = bundle("contacts-read");

  it("leaves the basic template unchanged without capabilities", () => {
    const result = resolveCapabilityComposition(request([], []));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifest.files).toHaveLength(11);
      expect(result.data.renderComposition.capabilityIds).toEqual([]);
    }
  });

  it("composes local data alone with protected ownership", () => {
    const result = resolveCapabilityComposition(
      request(["local-json-data"], [local]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.manifest.files.find(
          ({ path }) => path === "data/contacts.json",
        ),
      ).toMatchObject({
        ownership: "user-owned",
        updateStrategy: "create-once",
      });
      expect(result.data.permissions).toEqual([
        expect.objectContaining({
          permission: "filesystem.read",
          scope: ["data/contacts.json"],
        }),
      ]);
    }
  });

  it("resolves dependencies and creates an exact deterministic contacts composition", () => {
    const first = resolveCapabilityComposition(
      request(["contacts-read", "local-json-data"], [contacts, local]),
    );
    const second = resolveCapabilityComposition(
      request(["local-json-data", "contacts-read"], [local, contacts]),
    );
    expect(first).toEqual(second);
    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.data.renderComposition.capabilityIds).toEqual([
        "local-json-data",
        "contacts-read",
      ]);
      expect(first.data.manifest.files.map(({ path }) => path)).toEqual([
        ".gitignore",
        "README.md",
        "data/contacts.json",
        "mcp-forge.json",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "src/capabilities.ts",
        "src/index.ts",
        "src/lib/load-contacts.ts",
        "src/tools/get-contact.ts",
        "src/tools/hello.ts",
        "src/tools/list-contacts.ts",
        "src/tools/search-contacts.ts",
        "tests/contacts.test.ts",
        "tests/hello.test.ts",
        "tsconfig.json",
        "vitest.config.ts",
      ]);
      expect(
        first.data.renderComposition.effectiveConfig.tools.map(
          ({ name }) => name,
        ),
      ).toEqual(["get_contact", "hello", "list_contacts", "search_contacts"]);
      expect(first.data.renderComposition.runtimeDependencies).toEqual({
        "@modelcontextprotocol/sdk": "1.29.0",
        zod: "3.25.76",
      });
    }
  });

  it("rejects unknown, duplicate, and missing required capabilities", () => {
    expect(
      codes(resolveCapabilityComposition(request(["missing"], []))),
    ).toContain("CAP_UNKNOWN");
    expect(
      codes(
        resolveCapabilityComposition(
          request(["local-json-data", "local-json-data"], [local]),
        ),
      ),
    ).toContain("CAP_DUPLICATE");
    expect(
      codes(
        resolveCapabilityComposition(request(["contacts-read"], [contacts])),
      ),
    ).toContain("CAP_DEPENDENCY_MISSING");
  });

  it("rejects dependency cycles and declared conflicts", () => {
    const cyclicLocal = changed(
      local,
      (manifest) => (manifest.requires = ["contacts-read"]),
    );
    expect(
      codes(
        resolveCapabilityComposition(
          request(
            ["local-json-data", "contacts-read"],
            [cyclicLocal, contacts],
          ),
        ),
      ),
    ).toContain("CAP_DEPENDENCY_CYCLE");
    const conflicting = changed(
      local,
      (manifest) => (manifest.conflictsWith = ["contacts-read"]),
    );
    expect(
      codes(
        resolveCapabilityComposition(
          request(
            ["local-json-data", "contacts-read"],
            [conflicting, contacts],
          ),
        ),
      ),
    ).toContain("CAP_CONFLICT");
  });

  it("rejects file, tool, dependency-version, permission, and template conflicts", () => {
    const fileCollision = changed(contacts, (manifest) => {
      manifest.files[0]!.path = "src/lib/load-contacts.ts";
    });
    expect(
      codes(
        resolveCapabilityComposition(
          request(["local-json-data", "contacts-read"], [local, fileCollision]),
        ),
      ),
    ).toContain("CAP_FILE_COLLISION");
    const toolCollision = changed(contacts, (manifest) => {
      manifest.tools[0]!.name = "hello";
    });
    expect(
      codes(
        resolveCapabilityComposition(
          request(["local-json-data", "contacts-read"], [local, toolCollision]),
        ),
      ),
    ).toContain("CAP_TOOL_COLLISION");
    const versionConflict = changed(contacts, (manifest) => {
      manifest.dependencies.runtime = { zod: "3.25.75" };
    });
    expect(
      codes(
        resolveCapabilityComposition(
          request(
            ["local-json-data", "contacts-read"],
            [local, versionConflict],
          ),
        ),
      ),
    ).toContain("CAP_DEPENDENCY_VERSION_CONFLICT");
    const permissionConflict = changed(contacts, (manifest) => {
      manifest.permissions[0]!.status = "denied";
    });
    expect(
      codes(
        resolveCapabilityComposition(
          request(
            ["local-json-data", "contacts-read"],
            [local, permissionConflict],
          ),
        ),
      ),
    ).toContain("CAP_PERMISSION_CONFLICT");
    const incompatible = changed(local, (manifest) => {
      manifest.compatibleTemplates = ["knowledge-typescript-server"];
    });
    expect(
      codes(
        resolveCapabilityComposition(
          request(["local-json-data"], [incompatible]),
        ),
      ),
    ).toContain("CAP_TEMPLATE_INCOMPATIBLE");
  });
});
