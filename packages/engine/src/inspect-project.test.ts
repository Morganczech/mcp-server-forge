import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isForgeProjectChangePlan,
  isForgeProjectInspection,
} from "@mcp-server-forge/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectForgeProject } from "./inspect-project.js";

const configFixture = new URL(
  "../../generators/fixtures/valid/basic-config.json",
  import.meta.url,
);
const templateFixture = fileURLToPath(
  new URL("../../templates/templates/basic-typescript-server", import.meta.url),
);

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "mcp-forge-engine-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("inspectForgeProject", () => {
  it("creates validated inspection and plan contracts without filesystem writes", async () => {
    const configValue = JSON.parse(
      await readFile(configFixture, "utf8"),
    ) as Record<string, unknown>;
    const before = await readdir(projectRoot, { recursive: true });

    const result = await inspectForgeProject({
      projectRoot,
      configValue,
      templatePath: templateFixture,
      observedAt: "2026-07-15T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      filesystemFailure: false,
      validationFailure: false,
      inspection: { status: "healthy" },
      changePlan: { safeToApply: true },
    });
    expect(
      isForgeProjectInspection(JSON.parse(JSON.stringify(result.inspection))),
    ).toBe(true);
    expect(
      isForgeProjectChangePlan(JSON.parse(JSON.stringify(result.changePlan))),
    ).toBe(true);
    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });

  it("reports invalid configuration without reading or writing project state", async () => {
    const before = await readdir(projectRoot, { recursive: true });
    const result = await inspectForgeProject({
      projectRoot,
      configValue: {},
    });

    expect(result).toMatchObject({
      filesystemFailure: false,
      validationFailure: true,
      inspection: { status: "error" },
    });
    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });
});
