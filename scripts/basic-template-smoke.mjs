/* global clearTimeout, process, setTimeout, URL */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createForgeApplyContract } from "../packages/core/dist/index.js";
import {
  applyGenerationWorkspace,
  loadGenerationState,
  loadTargetState,
  loadTemplateBundle,
} from "../packages/fs-adapter/dist/index.js";
import {
  createGenerationPreview,
  renderForgeTemplate,
} from "../packages/generators/dist/index.js";
import { validateForgeProject } from "../packages/validators/dist/index.js";
import { loadProjectCatalog } from "../apps/mcp-server/dist/catalog.js";
import { createForgeMcpServer } from "../apps/mcp-server/dist/server.js";
import { ForgeReadOnlyService } from "../apps/mcp-server/dist/service.js";

const runFile = promisify(execFile);
const commandTimeoutMs = 180_000;
const mcpTimeoutMs = 15_000;
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const templatePath = join(
  repoRoot,
  "packages",
  "templates",
  "templates",
  "basic-typescript-server",
);
const configPath = join(
  repoRoot,
  "packages",
  "generators",
  "fixtures",
  "valid",
  "basic-config.json",
);
const statePath = ".mcp-forge/generated-state.json";
const expectedFiles = [
  ".gitignore",
  ".mcp-forge/generated-state.json",
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
];

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function withTimeout(operation, label, timeoutMs = mcpTimeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function listProjectFiles(root, directory = root, prefix = "") {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareAscii(left.name, right.name));
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(root, absolute, relative)));
    } else {
      files.push(relative);
    }
  }
  return files.sort(compareAscii);
}

async function snapshotProject(root) {
  const snapshot = {};
  for (const path of await listProjectFiles(root)) {
    const content = await readFile(join(root, path));
    snapshot[path] = createHash("sha256").update(content).digest("hex");
  }
  return snapshot;
}

async function run(command, args, cwd) {
  try {
    return await runFile(command, args, {
      cwd,
      env: { ...process.env, CI: "true" },
      maxBuffer: 8 * 1024 * 1024,
      timeout: commandTimeoutMs,
      killSignal: "SIGTERM",
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const timeout = error?.killed
      ? `\nProcess exceeded ${commandTimeoutMs} ms and was terminated.`
      : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${timeout}\n${stdout}${stderr}`.trim(),
    );
  }
}

async function prepareGeneration(projectRoot, configValue) {
  const validation = validateForgeProject(configValue);
  if (!validation.success) throw new Error("Smoke configuration is invalid.");
  const template = await loadTemplateBundle(templatePath);
  if (!template.success || template.bundle === undefined) {
    throw new Error("Functional template bundle could not be loaded.");
  }
  const renderResult = renderForgeTemplate({
    config: validation.data,
    manifest: template.bundle.manifest,
    templateSources: template.bundle.templateSources,
  });
  if (!renderResult.success)
    throw new Error("Functional template did not render.");
  const targets = await loadTargetState(
    projectRoot,
    renderResult.files.map(({ path }) => ({ path })),
  );
  const state = await loadGenerationState(projectRoot, { statePath });
  if (!targets.success || !state.success) {
    throw new Error("Generation evidence could not be loaded.");
  }
  const preview = createGenerationPreview({
    renderResult,
    manifest: template.bundle.manifest,
    targetState: targets.targetState,
    ...(state.state === undefined ? {} : { previousState: state.state }),
  });
  return {
    manifest: template.bundle.manifest,
    renderResult,
    preview,
    previousState: state.state,
  };
}

async function applyInitialGeneration(projectRoot, configValue) {
  const prepared = await prepareGeneration(projectRoot, configValue);
  const contract = createForgeApplyContract({
    ...prepared,
    generatedAt: "2026-07-15T12:00:00.000Z",
  });
  if (!contract.success)
    throw new Error("Safe Apply Contract was not created.");
  const applied = await applyGenerationWorkspace({
    projectRoot,
    statePath,
    contract: contract.data,
  });
  if (
    !applied.success ||
    !applied.stateWritten ||
    applied.appliedFiles.length !== 11
  ) {
    throw new Error("Initial functional template generation failed.");
  }
  return prepared;
}

async function inspectGeneratedProject(projectRoot) {
  const cli = join(repoRoot, "apps", "cli", "dist", "index.js");
  const baseArgs = [
    cli,
    "inspect",
    "--config",
    join(projectRoot, "mcp-forge.json"),
    "--root",
    projectRoot,
    "--template",
    templatePath,
  ];
  const textInspection = await run(process.execPath, baseArgs, repoRoot);
  if (!textInspection.stdout.includes("Status: healthy")) {
    throw new Error("Generated project text inspection is not healthy.");
  }
  const json = await run(process.execPath, [...baseArgs, "--json"], repoRoot);
  const inspection = JSON.parse(json.stdout);
  if (
    inspection.status !== "healthy" ||
    inspection.generation?.files?.length !== 11 ||
    !inspection.generation.files.every(({ status }) => status === "current")
  ) {
    throw new Error("Generated project inspection is not healthy and current.");
  }
  if (
    !inspection.permissions.every(({ permission, status }) =>
      permission === "environment"
        ? status === "not-declared"
        : status === "denied",
    )
  ) {
    throw new Error(
      "Generated project inspection reported unsafe permissions.",
    );
  }
  return inspection;
}

async function smokeMcpServer(projectRoot) {
  const requireFromProject = createRequire(join(projectRoot, "package.json"));
  const clientModule = await import(
    pathToFileURL(
      requireFromProject.resolve("@modelcontextprotocol/sdk/client/index.js"),
    ).href
  );
  const transportModule = await import(
    pathToFileURL(
      requireFromProject.resolve("@modelcontextprotocol/sdk/client/stdio.js"),
    ).href
  );
  const { Client } = clientModule;
  const { StdioClientTransport } = transportModule;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(projectRoot, "dist", "index.js")],
    cwd: projectRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: "forge-template-smoke", version: "1.0.0" });
  let connected = false;
  let result;
  try {
    await withTimeout(client.connect(transport), "Generated MCP connect");
    connected = true;
    const tools = await withTimeout(
      client.listTools(),
      "Generated MCP tools/list",
    );
    if (JSON.stringify(tools.tools.map(({ name }) => name)) !== '["hello"]') {
      throw new Error("Generated server exposed an unexpected tool allowlist.");
    }
    const defaultGreeting = await withTimeout(
      client.callTool({ name: "hello", arguments: {} }),
      "Generated MCP hello default call",
    );
    const namedGreeting = await withTimeout(
      client.callTool({ name: "hello", arguments: { name: "Mirďas" } }),
      "Generated MCP hello named call",
    );
    if (
      defaultGreeting.structuredContent?.message !==
        "Hello from your local MCP server!" ||
      namedGreeting.structuredContent?.message !== "Hello, Mirďas!"
    ) {
      throw new Error("Generated hello tool returned an unexpected response.");
    }
    const invalidType = await withTimeout(
      client.callTool({ name: "hello", arguments: { name: 42 } }),
      "Generated MCP invalid-type call",
    );
    const tooLong = await withTimeout(
      client.callTool({ name: "hello", arguments: { name: "x".repeat(81) } }),
      "Generated MCP over-limit call",
    );
    if (invalidType.isError !== true || tooLong.isError !== true) {
      throw new Error("Generated hello tool accepted an invalid input.");
    }
    result = {
      toolNames: ["hello"],
      defaultGreeting,
      namedGreeting,
      invalidInputsRejected: true,
    };
  } finally {
    if (connected) {
      await withTimeout(client.close(), "Generated MCP close");
    } else {
      await transport.close().catch(() => undefined);
    }
  }
  if (stderr !== "")
    throw new Error(`Generated server wrote to stderr: ${stderr}`);
  return result;
}

async function verifyForgeMcpTools(temporaryRoot, projectRoot) {
  const localTemplatePath = join(projectRoot, ".forge-template");
  await cp(templatePath, localTemplatePath, { recursive: true });
  const catalogPath = join(temporaryRoot, "forge-projects.json");
  await writeFile(
    catalogPath,
    JSON.stringify({
      catalogVersion: "1",
      allowedRoots: ["./project"],
      projects: [
        {
          projectId: "generated",
          label: "Generated smoke project",
          root: "./project",
          configPath: "mcp-forge.json",
          statePath,
          templatePath: ".forge-template",
        },
      ],
    }),
  );
  const catalog = await withTimeout(
    loadProjectCatalog(catalogPath, temporaryRoot),
    "Forge MCP catalog load",
  );
  if (catalog.status !== "ready") {
    throw new Error("Forge MCP smoke catalog is not ready.");
  }
  const service = new ForgeReadOnlyService({
    catalog,
    version: "0.1.0-alpha.2",
    now: () => "2026-07-15T12:00:00.000Z",
  });
  const requireFromProject = createRequire(join(projectRoot, "package.json"));
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import(
      pathToFileURL(
        requireFromProject.resolve("@modelcontextprotocol/sdk/client/index.js"),
      ).href
    ),
    import(
      pathToFileURL(
        requireFromProject.resolve("@modelcontextprotocol/sdk/inMemory.js"),
      ).href
    ),
  ]);
  const server = createForgeMcpServer({ service, version: "0.1.0-alpha.2" });
  const client = new Client({
    name: "forge-read-only-smoke",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  let serverConnected = false;
  let clientConnected = false;
  try {
    await withTimeout(
      server.connect(serverTransport),
      "Forge MCP server connect",
    );
    serverConnected = true;
    await withTimeout(
      client.connect(clientTransport),
      "Forge MCP client connect",
    );
    clientConnected = true;
    const tools = await withTimeout(client.listTools(), "Forge MCP tools/list");
    if (
      tools.tools.length !== 7 ||
      !tools.tools.every(
        ({ annotations }) =>
          annotations?.readOnlyHint === true &&
          annotations.destructiveHint === false,
      )
    ) {
      throw new Error(
        "Forge MCP did not expose its exact read-only allowlist.",
      );
    }
    const call = (name, argumentsValue) =>
      withTimeout(client.callTool({ name, arguments: argumentsValue }), name);
    const inspection = await call("forge_inspect_project", {
      projectId: "generated",
    });
    const permissions = await call("forge_get_permissions", {
      projectId: "generated",
    });
    const generatedFiles = await call("forge_list_generated_files", {
      projectId: "generated",
      limit: 100,
    });
    const preview = await call("forge_preview_project", {
      projectId: "generated",
    });
    const inspectionData = inspection.structuredContent;
    const permissionData = permissions.structuredContent?.data?.permissions;
    const fileData = generatedFiles.structuredContent?.data?.files;
    const previewData = preview.structuredContent?.data?.changePlan;
    if (
      inspectionData?.success !== true ||
      inspectionData.summary?.status !== "healthy" ||
      permissions.structuredContent?.success !== true ||
      !Array.isArray(permissionData) ||
      permissionData.length !== 6 ||
      !permissionData.every(({ id, status }) =>
        id === "environment" ? status === "not-declared" : status === "denied",
      ) ||
      generatedFiles.structuredContent?.success !== true ||
      !Array.isArray(fileData) ||
      fileData.length !== 11 ||
      !fileData.every(({ status }) => status === "current") ||
      preview.structuredContent?.success !== true ||
      previewData?.safeToApply !== true ||
      previewData.changes.length !== 11
    ) {
      throw new Error(
        "A read-only Forge MCP tool returned unsafe project evidence.",
      );
    }
  } finally {
    if (clientConnected)
      await withTimeout(client.close(), "Forge MCP client close");
    if (serverConnected)
      await withTimeout(server.close(), "Forge MCP server close");
  }
  return [
    "forge_inspect_project",
    "forge_get_permissions",
    "forge_list_generated_files",
    "forge_preview_project",
  ];
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "mcp-forge-basic-template-"),
);
const projectRoot = join(temporaryRoot, "project");
try {
  await mkdir(projectRoot);
  const configValue = JSON.parse(await readFile(configPath, "utf8"));
  await applyInitialGeneration(projectRoot, configValue);
  const generatedFiles = await listProjectFiles(projectRoot);
  if (JSON.stringify(generatedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected generated files: ${generatedFiles.join(", ")}`);
  }

  const repeated = await prepareGeneration(projectRoot, configValue);
  if (
    !repeated.preview.safeToApply ||
    repeated.preview.summary.skip !== 11 ||
    repeated.preview.files.some(({ action }) => action !== "skip")
  ) {
    throw new Error("Second generation preview is not fully idempotent.");
  }

  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await run(pnpm, ["install", "--frozen-lockfile"], projectRoot);
  await run(pnpm, ["typecheck"], projectRoot);
  await run(pnpm, ["test"], projectRoot);
  await run(pnpm, ["build"], projectRoot);
  const inspection = await inspectGeneratedProject(projectRoot);
  const beforeRuntime = await snapshotProject(projectRoot);
  const mcp = await smokeMcpServer(projectRoot);
  const afterRuntime = await snapshotProject(projectRoot);
  if (JSON.stringify(afterRuntime) !== JSON.stringify(beforeRuntime)) {
    throw new Error(
      "Generated server changed the project filesystem at runtime.",
    );
  }
  const forgeMcpTools = await verifyForgeMcpTools(temporaryRoot, projectRoot);

  const stateBeforeConflict = await readFile(
    join(projectRoot, statePath),
    "utf8",
  );
  const helloPath = join(projectRoot, "src", "tools", "hello.ts");
  await writeFile(
    helloPath,
    `${await readFile(helloPath, "utf8")}\n// manual change\n`,
  );
  const conflict = await prepareGeneration(projectRoot, configValue);
  if (
    conflict.preview.safeToApply ||
    conflict.preview.summary.conflict !== 1 ||
    !conflict.preview.files.some(
      ({ path, action }) =>
        path === "src/tools/hello.ts" && action === "conflict",
    ) ||
    (await readFile(join(projectRoot, statePath), "utf8")) !==
      stateBeforeConflict
  ) {
    throw new Error("Manual forge-owned modification was not protected.");
  }

  process.stdout.write(
    `${JSON.stringify({
      generatedFileCount: 11,
      idempotentSkipCount: repeated.preview.summary.skip,
      conflictCount: conflict.preview.summary.conflict,
      inspectionStatus: inspection.status,
      toolNames: mcp.toolNames,
      invalidInputsRejected: mcp.invalidInputsRejected,
      forgeMcpTools,
      runtimeFilesystemUnchanged: true,
    })}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
