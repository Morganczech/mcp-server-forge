import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ForgeApplyContract } from "@mcp-server-forge/core";
import { hashGeneratedContent } from "@mcp-server-forge/templates";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyGenerationWorkspace,
  applyGenerationWorkspaceWithHooks,
} from "./apply.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mcp-forge-apply-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function contract(content = "generated\n"): ForgeApplyContract {
  const contentHash = hashGeneratedContent(content);
  return {
    contractVersion: "1",
    templateId: "test-template",
    templateVersion: "1.0.0",
    operations: [
      {
        path: "src/index.ts",
        action: "create",
        content,
        contentHash,
        executable: false,
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        expectedTarget: { exists: false },
      },
    ],
    previousState: null,
    nextState: {
      stateVersion: "1",
      templateId: "test-template",
      templateVersion: "1.0.0",
      hashAlgorithm: "sha256",
      generatedAt: "2026-07-15T08:00:00.000Z",
      files: [
        {
          path: "src/index.ts",
          ownership: "forge-owned",
          updateStrategy: "replace-if-unmodified",
          generatedHash: contentHash,
        },
      ],
    },
  };
}

function twoFileContract(): ForgeApplyContract {
  const result = contract("first\n");
  const secondContent = "second\n";
  const secondHash = hashGeneratedContent(secondContent);
  result.operations.push({
    ...result.operations[0]!,
    path: "src/second.ts",
    content: secondContent,
    contentHash: secondHash,
  });
  result.nextState.files.push({
    ...result.nextState.files[0]!,
    path: "src/second.ts",
    generatedHash: secondHash,
  });
  return result;
}

describe("applyGenerationWorkspace", () => {
  it("executes a valid contract and writes state last", async () => {
    const projectRoot = await root();
    const result = await applyGenerationWorkspace({
      projectRoot,
      contract: contract(),
    });

    expect(result).toMatchObject({
      success: true,
      appliedFiles: ["src/index.ts"],
      stateWritten: true,
    });
    expect(await readFile(join(projectRoot, "src/index.ts"), "utf8")).toBe(
      "generated\n",
    );
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, ".mcp-forge/generated-state.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ templateId: "test-template" });
  });

  it("performs no writes when a target changed before execution", async () => {
    const projectRoot = await root();
    await writeFile(join(projectRoot, "src-index.ts"), "unrelated\n");
    const stale = contract();
    stale.operations[0] = { ...stale.operations[0]!, path: "src-index.ts" };
    stale.nextState.files[0] = {
      ...stale.nextState.files[0]!,
      path: "src-index.ts",
    };

    const result = await applyGenerationWorkspace({
      projectRoot,
      contract: stale,
    });

    expect(result.success).toBe(false);
    expect(result.appliedFiles).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "APPLY_TARGET_CHANGED",
    );
    expect(await readFile(join(projectRoot, "src-index.ts"), "utf8")).toBe(
      "unrelated\n",
    );
  });

  it("reports completed files and omits state after a partial I/O failure", async () => {
    const projectRoot = await root();
    const result = await applyGenerationWorkspaceWithHooks(
      { projectRoot, contract: twoFileContract() },
      {
        beforeFileWrite: (_operation, index) => {
          if (index === 1) throw new Error("simulated write failure");
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      appliedFiles: ["src/index.ts"],
      stateWritten: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "APPLY_WRITE_FAILED",
    );
    expect(await readFile(join(projectRoot, "src/index.ts"), "utf8")).toBe(
      "first\n",
    );
    await expect(
      readFile(join(projectRoot, "src/second.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(projectRoot, ".mcp-forge/generated-state.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects generated content above the bounded filesystem limit", async () => {
    const projectRoot = await root();
    const result = await applyGenerationWorkspace({
      projectRoot,
      contract: contract("content above limit\n"),
      options: { maxFileSizeBytes: 8 },
    });

    expect(result.success).toBe(false);
    expect(result.appliedFiles).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "APPLY_CONTRACT_INVALID",
    );
  });
});
