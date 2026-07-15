/* global clearTimeout, process, setTimeout, URL */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createForgeApplyContract } from "../packages/core/dist/index.js";
import {
  applyGenerationWorkspace,
  loadComposedTemplateBundle,
  loadGenerationState,
  loadTargetState,
} from "../packages/fs-adapter/dist/index.js";
import {
  createGenerationPreview,
  renderForgeTemplate,
} from "../packages/generators/dist/index.js";
import { inspectForgeProject } from "../packages/engine/dist/index.js";
import { validateForgeProject } from "../packages/validators/dist/index.js";
import { loadProjectCatalog } from "../apps/mcp-server/dist/catalog.js";
import { createForgeMcpServer } from "../apps/mcp-server/dist/server.js";
import { ForgeReadOnlyService } from "../apps/mcp-server/dist/service.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const templatePath = join(
  repoRoot,
  "packages",
  "templates",
  "templates",
  "basic-typescript-server",
);
const capabilityRoot = join(
  repoRoot,
  "packages",
  "capabilities",
  "capabilities",
);
const configPath = join(
  repoRoot,
  "packages",
  "generators",
  "fixtures",
  "valid",
  "contacts-config.json",
);
const statePath = ".mcp-forge/generated-state.json";
const commandTimeoutMs = 180_000;
const mcpTimeoutMs = 15_000;
const expectedProjectFiles = [
  ".gitignore",
  ".mcp-forge/generated-state.json",
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
];

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function withTimeout(operation, label) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${label} timed out after ${mcpTimeoutMs} ms.`)),
          mcpTimeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, CI: "true" },
      timeout: commandTimeoutMs,
      killSignal: "SIGTERM",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const timedOut = error?.killed
      ? `\nProcess exceeded ${commandTimeoutMs} ms and was terminated.`
      : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${timedOut}\n${stdout}${stderr}`.trim(),
    );
  }
}

async function runPnpm(args, cwd) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || pnpmCli === "") {
    throw new Error("The smoke test must be started through pnpm.");
  }
  return run(process.execPath, [pnpmCli, ...args], cwd);
}

async function listFiles(root, directory = root, prefix = "") {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareAscii(left.name, right.name));
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      result.push(
        ...(await listFiles(root, join(directory, entry.name), path)),
      );
    else result.push(path);
  }
  return result.sort(compareAscii);
}

async function snapshot(root) {
  const result = {};
  for (const path of await listFiles(root)) {
    result[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  return result;
}

async function prepare(projectRoot, configValue) {
  const validation = validateForgeProject(configValue);
  if (!validation.success)
    throw new Error("Contacts smoke configuration is invalid.");
  const loaded = await loadComposedTemplateBundle(
    templatePath,
    capabilityRoot,
    validation.data,
  );
  if (!loaded.success || loaded.bundle === undefined) {
    throw new Error(
      `Capability composition failed: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }
  const renderResult = renderForgeTemplate({
    config: loaded.bundle.effectiveConfig,
    manifest: loaded.bundle.manifest,
    templateSources: loaded.bundle.templateSources,
    ...(loaded.bundle.composition === undefined
      ? {}
      : { composition: loaded.bundle.composition }),
  });
  const state = await loadGenerationState(projectRoot, { statePath });
  const targets = await loadTargetState(
    projectRoot,
    [
      ...new Set([
        ...renderResult.files.map(({ path }) => path),
        ...(state.state?.files.map(({ path }) => path) ?? []),
      ]),
    ].map((path) => ({ path })),
  );
  if (!renderResult.success || !state.success || !targets.success) {
    throw new Error("Composed generation evidence is unsafe.");
  }
  const preview = createGenerationPreview({
    renderResult,
    manifest: loaded.bundle.manifest,
    targetState: targets.targetState,
    ...(state.state === undefined ? {} : { previousState: state.state }),
  });
  return { loaded, renderResult, preview, previousState: state.state };
}

async function apply(projectRoot, configValue) {
  const prepared = await prepare(projectRoot, configValue);
  const contract = createForgeApplyContract({
    renderResult: prepared.renderResult,
    preview: prepared.preview,
    manifest: prepared.loaded.bundle.manifest,
    ...(prepared.previousState === undefined
      ? {}
      : { previousState: prepared.previousState }),
    generatedAt: "2026-07-15T16:00:00.000Z",
  });
  if (!contract.success) throw new Error("Composed Apply Contract is invalid.");
  const result = await applyGenerationWorkspace({
    projectRoot,
    statePath,
    contract: contract.data,
  });
  if (
    !result.success ||
    !result.stateWritten ||
    result.appliedFiles.length !== 18
  ) {
    throw new Error("Composed workspace generation failed.");
  }
}

async function smokeRuntime(projectRoot) {
  const requireFromProject = createRequire(join(projectRoot, "package.json"));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(
      pathToFileURL(
        requireFromProject.resolve("@modelcontextprotocol/sdk/client/index.js"),
      ).href
    ),
    import(
      pathToFileURL(
        requireFromProject.resolve("@modelcontextprotocol/sdk/client/stdio.js"),
      ).href
    ),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(projectRoot, "dist", "index.js")],
    cwd: projectRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const client = new Client({ name: "forge-contacts-smoke", version: "1.0.0" });
  let connected = false;
  let result;
  try {
    await withTimeout(client.connect(transport), "contacts MCP connect");
    connected = true;
    const tools = await withTimeout(
      client.listTools(),
      "contacts MCP tools/list",
    );
    const names = tools.tools.map(({ name }) => name);
    const expected = [
      "get_contact",
      "hello",
      "list_contacts",
      "search_contacts",
    ];
    if (
      JSON.stringify([...names].sort(compareAscii)) !== JSON.stringify(expected)
    ) {
      throw new Error(
        `Unexpected contacts tool allowlist: ${names.join(", ")}`,
      );
    }
    const listed = await withTimeout(
      client.callTool({
        name: "list_contacts",
        arguments: { limit: 1, offset: 0 },
      }),
      "list_contacts",
    );
    const searched = await withTimeout(
      client.callTool({ name: "search_contacts", arguments: { query: "Ada" } }),
      "search_contacts",
    );
    const found = await withTimeout(
      client.callTool({
        name: "get_contact",
        arguments: { id: "contact-002" },
      }),
      "get_contact",
    );
    const missing = await withTimeout(
      client.callTool({
        name: "get_contact",
        arguments: { id: "contact-999" },
      }),
      "get_contact missing",
    );
    if (
      listed.structuredContent?.contacts?.[0]?.id !== "contact-001" ||
      searched.structuredContent?.contacts?.[0]?.name !== "Ada Příkladová" ||
      found.structuredContent?.contact?.email !==
        "boris.ukazkovy@example.test" ||
      missing.isError !== true ||
      missing.structuredContent?.error?.code !== "CONTACT_NOT_FOUND"
    ) {
      throw new Error("A contacts MCP tool returned unexpected bounded data.");
    }
    result = { toolNames: expected, callsVerified: true };
  } finally {
    if (connected) await withTimeout(client.close(), "contacts MCP close");
    else await transport.close().catch(() => undefined);
  }
  if (stderr !== "")
    throw new Error(`Contacts server wrote to stderr: ${stderr}`);
  return result;
}

async function callForgeMcp(
  temporaryRoot,
  projectRoot,
  configFile = "mcp-forge.json",
  installOperatorAssets = false,
) {
  if (installOperatorAssets) {
    await cp(templatePath, join(projectRoot, ".forge-template"), {
      recursive: true,
    });
    await cp(capabilityRoot, join(projectRoot, ".forge-capabilities"), {
      recursive: true,
    });
  }
  const catalogPath = join(temporaryRoot, "forge-projects.json");
  await writeFile(
    catalogPath,
    JSON.stringify({
      catalogVersion: "1",
      allowedRoots: ["./project"],
      projects: [
        {
          projectId: "contacts",
          label: "Offline contacts smoke project",
          root: "./project",
          configPath: configFile,
          statePath,
          templatePath: ".forge-template",
          capabilityRootPath: ".forge-capabilities",
        },
      ],
    }),
  );
  const catalog = await loadProjectCatalog(catalogPath, temporaryRoot);
  if (catalog.status !== "ready")
    throw new Error("Forge MCP catalog is not ready.");
  const service = new ForgeReadOnlyService({
    catalog,
    version: "0.1.0-alpha.2",
    now: () => "2026-07-15T16:00:00.000Z",
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
    name: "forge-composition-smoke",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await withTimeout(
    server.connect(serverTransport),
    "Forge MCP server connect",
  );
  await withTimeout(
    client.connect(clientTransport),
    "Forge MCP client connect",
  );
  try {
    const calls = {};
    for (const [label, request] of [
      [
        "forge_inspect_project",
        { name: "forge_inspect_project", arguments: { projectId: "contacts" } },
      ],
      [
        "forge_get_permissions",
        { name: "forge_get_permissions", arguments: { projectId: "contacts" } },
      ],
      [
        "forge_list_generated_files",
        {
          name: "forge_list_generated_files",
          arguments: { projectId: "contacts", limit: 100 },
        },
      ],
      [
        "forge_preview_project",
        { name: "forge_preview_project", arguments: { projectId: "contacts" } },
      ],
    ]) {
      calls[label] = await withTimeout(client.callTool(request), label);
    }
    return calls;
  } finally {
    await withTimeout(client.close(), "Forge MCP client close");
    await withTimeout(server.close(), "Forge MCP server close");
  }
}

function assertCleanForgeMcp(calls) {
  const inspection =
    calls.forge_inspect_project.structuredContent?.data?.inspection;
  const readPermission =
    calls.forge_get_permissions.structuredContent?.data?.permissions?.find(
      ({ id }) => id === "filesystem.read",
    );
  const files = calls.forge_list_generated_files.structuredContent?.data?.files;
  const changePlan =
    calls.forge_preview_project.structuredContent?.data?.changePlan;
  if (
    Object.values(calls).some(
      ({ structuredContent }) => structuredContent?.success !== true,
    ) ||
    inspection?.status !== "healthy" ||
    inspection.project.capabilities?.join(",") !==
      "local-json-data,contacts-read" ||
    inspection.project.tools?.join(",") !==
      "get_contact,hello,list_contacts,search_contacts" ||
    readPermission?.status !== "allowed" ||
    readPermission.scope?.join(",") !== "data/contacts.json" ||
    files?.length !== 18 ||
    files.find(({ path }) => path === "data/contacts.json")?.ownership !==
      "user-owned" ||
    changePlan?.safeToApply !== true ||
    changePlan.changes.some(({ action }) => action !== "skip")
  ) {
    throw new Error(
      `Forge MCP composition evidence is incomplete: ${JSON.stringify(calls)}`,
    );
  }
}

async function assertStandaloneProject(projectRoot) {
  const packageText = await readFile(join(projectRoot, "package.json"), "utf8");
  const lockfile = await readFile(join(projectRoot, "pnpm-lock.yaml"), "utf8");
  const generatedConfig = JSON.parse(
    await readFile(join(projectRoot, "mcp-forge.json"), "utf8"),
  );
  const packageValue = JSON.parse(packageText);
  if (
    packageValue.packageManager !== "pnpm@11.7.0" ||
    packageValue.engines?.node !== ">=22" ||
    packageValue.dependencies?.["@modelcontextprotocol/sdk"] !== "1.29.0" ||
    packageValue.dependencies?.zod !== "3.25.76" ||
    Object.keys(packageValue.dependencies ?? {}).length !== 2 ||
    packageText.includes("workspace:") ||
    lockfile.includes("workspace:") ||
    lockfile.includes("link:") ||
    generatedConfig.capabilities?.join(",") !==
      "local-json-data,contacts-read" ||
    generatedConfig.tools?.map(({ name }) => name).join(",") !== "hello"
  ) {
    throw new Error("The composed project is not standalone and reproducible.");
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "mcp-forge-contacts-"));
const projectRoot = join(temporaryRoot, "project");
try {
  await mkdir(projectRoot);
  const configValue = JSON.parse(await readFile(configPath, "utf8"));
  await apply(projectRoot, configValue);
  const files = await listFiles(projectRoot);
  if (JSON.stringify(files) !== JSON.stringify(expectedProjectFiles)) {
    throw new Error(`Unexpected composed files: ${files.join(", ")}`);
  }
  await assertStandaloneProject(projectRoot);
  const repeated = await prepare(projectRoot, configValue);
  if (
    !repeated.preview.safeToApply ||
    repeated.preview.summary.skip !== 18 ||
    repeated.preview.files.some(({ action }) => action !== "skip")
  ) {
    throw new Error("Composed second generation is not idempotent.");
  }
  await runPnpm(["install", "--frozen-lockfile"], projectRoot);
  await runPnpm(["typecheck"], projectRoot);
  await runPnpm(["test"], projectRoot);
  await runPnpm(["build"], projectRoot);
  const beforeRuntime = await snapshot(projectRoot);
  const runtime = await smokeRuntime(projectRoot);
  if (
    JSON.stringify(await snapshot(projectRoot)) !==
    JSON.stringify(beforeRuntime)
  ) {
    throw new Error("Contacts runtime changed the project filesystem.");
  }
  const inspection = await inspectForgeProject({
    projectRoot,
    configValue,
    templatePath,
    capabilityRootPath: capabilityRoot,
    statePath,
    observedAt: "2026-07-15T16:00:00.000Z",
  });
  const readPermission = inspection.inspection.permissions.find(
    ({ permission }) => permission === "filesystem.read",
  );
  if (
    inspection.inspection.status !== "healthy" ||
    inspection.inspection.project.capabilities?.join(",") !==
      "local-json-data,contacts-read" ||
    inspection.inspection.project.tools?.join(",") !==
      "get_contact,hello,list_contacts,search_contacts" ||
    readPermission?.status !== "allowed" ||
    readPermission.scope.join(",") !== "data/contacts.json" ||
    inspection.inspection.generation.files.length !== 18
  ) {
    throw new Error("Forge inspection did not expose composed project facts.");
  }
  const cleanMcp = await callForgeMcp(
    temporaryRoot,
    projectRoot,
    "mcp-forge.json",
    true,
  );
  assertCleanForgeMcp(cleanMcp);
  const forgeMcpTools = Object.keys(cleanMcp);
  const stateBefore = await readFile(join(projectRoot, statePath), "utf8");
  const toolPath = join(projectRoot, "src", "tools", "list-contacts.ts");
  const toolContent = await readFile(toolPath, "utf8");
  await writeFile(toolPath, `${toolContent}\n// protected manual change\n`);
  const conflict = await prepare(projectRoot, configValue);
  if (
    conflict.preview.safeToApply ||
    !conflict.preview.files.some(
      ({ path, action }) =>
        path === "src/tools/list-contacts.ts" && action === "conflict",
    ) ||
    (await readFile(join(projectRoot, statePath), "utf8")) !== stateBefore
  ) {
    throw new Error("Composed forge-owned conflict was not protected.");
  }
  const conflictMcp = await callForgeMcp(temporaryRoot, projectRoot);
  const conflictFiles =
    conflictMcp.forge_list_generated_files.structuredContent?.data?.files;
  if (
    conflictMcp.forge_inspect_project.structuredContent?.data?.inspection
      ?.status !== "error" ||
    conflictMcp.forge_preview_project.structuredContent?.success !== false ||
    conflictFiles?.find(({ path }) => path === "src/tools/list-contacts.ts")
      ?.status !== "conflict"
  ) {
    throw new Error("Forge MCP did not expose the composed file conflict.");
  }
  await writeFile(toolPath, toolContent);
  const dataPath = join(projectRoot, "data", "contacts.json");
  const customData = `${(await readFile(dataPath, "utf8")).trim()}\n`;
  await writeFile(
    dataPath,
    customData.replace("Ada Příkladová", "Ada Uživatelská"),
  );
  const userData = await prepare(projectRoot, configValue);
  if (
    !userData.preview.safeToApply ||
    !userData.preview.files.some(
      ({ path, action }) => path === "data/contacts.json" && action === "skip",
    ) ||
    !(await readFile(dataPath, "utf8")).includes("Ada Uživatelská")
  ) {
    throw new Error("User-owned contacts data was not preserved.");
  }
  const localOnlyConfig = {
    ...configValue,
    capabilities: ["local-json-data"],
  };
  const localOnlyConfigFile = "local-data-only.json";
  await writeFile(
    join(projectRoot, localOnlyConfigFile),
    `${JSON.stringify(localOnlyConfig, null, 2)}\n`,
  );
  const localOnly = await prepare(projectRoot, localOnlyConfig);
  if (
    localOnly.preview.safeToApply ||
    !localOnly.preview.files.some(
      ({ path, action }) => path === "data/contacts.json" && action === "skip",
    ) ||
    localOnly.preview.orphanedFiles.some(
      ({ path }) => path === "data/contacts.json",
    ) ||
    !localOnly.preview.orphanedFiles.some(
      ({ path }) => path === "src/tools/list-contacts.ts",
    ) ||
    (await readFile(join(projectRoot, statePath), "utf8")) !== stateBefore
  ) {
    throw new Error(
      "Removing contacts-read did not preserve local data safely.",
    );
  }
  const localOnlyMcp = await callForgeMcp(
    temporaryRoot,
    projectRoot,
    localOnlyConfigFile,
  );
  const localOnlyFiles =
    localOnlyMcp.forge_list_generated_files.structuredContent?.data?.files;
  if (
    localOnlyMcp.forge_preview_project.structuredContent?.success !== false ||
    localOnlyFiles?.find(({ path }) => path === "data/contacts.json")
      ?.status !== "current" ||
    localOnlyFiles?.find(({ path }) => path === "src/tools/list-contacts.ts")
      ?.status !== "orphaned"
  ) {
    throw new Error("Forge MCP did not expose contacts-read removal safely.");
  }
  const removedConfig = { ...configValue, capabilities: [] };
  const removedConfigFile = "no-capabilities.json";
  await writeFile(
    join(projectRoot, removedConfigFile),
    `${JSON.stringify(removedConfig, null, 2)}\n`,
  );
  const removed = await prepare(projectRoot, removedConfig);
  if (
    removed.preview.safeToApply ||
    !removed.preview.orphanedFiles.some(
      ({ path }) => path === "data/contacts.json",
    ) ||
    !(await readFile(dataPath, "utf8")).includes("Ada Uživatelská") ||
    (await readFile(join(projectRoot, statePath), "utf8")) !== stateBefore
  ) {
    throw new Error("Capability removal did not preserve orphaned user data.");
  }
  const removedMcp = await callForgeMcp(
    temporaryRoot,
    projectRoot,
    removedConfigFile,
  );
  const removedFiles =
    removedMcp.forge_list_generated_files.structuredContent?.data?.files;
  if (
    removedMcp.forge_preview_project.structuredContent?.success !== false ||
    removedFiles?.find(({ path }) => path === "data/contacts.json")?.status !==
      "orphaned" ||
    removedFiles?.find(({ path }) => path === "data/contacts.json")
      ?.ownership !== "user-owned"
  ) {
    throw new Error(
      `Forge MCP did not expose preserved orphaned contact data: ${JSON.stringify(removedMcp)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      generatedFileCount: 18,
      idempotentSkipCount: 18,
      conflictProtected: true,
      userDataPreserved: true,
      contactsRemovalPreservedData: true,
      removalPreservedData: true,
      orphanOwnershipExposed: true,
      standaloneProjectVerified: true,
      inspectionStatus: inspection.inspection.status,
      toolNames: runtime.toolNames,
      callsVerified: runtime.callsVerified,
      forgeMcpTools,
      runtimeFilesystemUnchanged: true,
    })}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
