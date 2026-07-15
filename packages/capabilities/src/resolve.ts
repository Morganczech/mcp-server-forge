import type { Tool } from "@mcp-server-forge/schemas";
import { compareAscii } from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  sortDiagnostics,
  type ForgeDiagnostic,
  type ForgeDiagnosticCode,
} from "@mcp-server-forge/validators";

import type {
  CapabilityPermissionRequirement,
  ForgeCapabilityBundle,
  ForgeCapabilityCompositionRequest,
  ForgeCapabilityCompositionResult,
} from "./types.js";

const aggregatorPath = "src/capabilities.ts";
const aggregatorSource = "capabilities/__generated__/src/capabilities.ts.hbs";

function diagnostic(
  code: ForgeDiagnosticCode,
  path: Array<string | number>,
  metadata?: Record<string, unknown>,
): ForgeDiagnostic {
  return createDiagnostic(code, path, metadata);
}

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareAscii);
}

function resolveOrder(
  requested: string[],
  bundles: Map<string, ForgeCapabilityBundle>,
  diagnostics: ForgeDiagnostic[],
): string[] {
  const requestedSet = new Set(requested);
  for (const id of requested) {
    const manifest = bundles.get(id)?.manifest;
    if (manifest === undefined) {
      diagnostics.push(diagnostic("CAP_UNKNOWN", ["capabilities", id], { id }));
      continue;
    }
    for (const dependency of manifest.requires) {
      if (!requestedSet.has(dependency)) {
        diagnostics.push(
          diagnostic(
            "CAP_DEPENDENCY_MISSING",
            ["capabilities", id, "requires"],
            {
              capability: id,
              dependency,
            },
          ),
        );
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      diagnostics.push(
        diagnostic("CAP_DEPENDENCY_CYCLE", ["capabilities", id], { id }),
      );
      return;
    }
    if (visited.has(id) || !requestedSet.has(id)) return;
    const manifest = bundles.get(id)?.manifest;
    if (manifest === undefined) return;
    visiting.add(id);
    for (const dependency of [...manifest.requires].sort(compareAscii))
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of [...requestedSet].sort(compareAscii)) visit(id);
  return ordered;
}

function mergeDependencySet(
  target: Record<string, string>,
  incoming: Record<string, string> | undefined,
  capabilityId: string,
  diagnostics: ForgeDiagnostic[],
): void {
  for (const [name, version] of Object.entries(incoming ?? {}).sort(
    ([a], [b]) => compareAscii(a, b),
  )) {
    const existing = target[name];
    if (existing !== undefined && existing !== version) {
      diagnostics.push(
        diagnostic(
          "CAP_DEPENDENCY_VERSION_CONFLICT",
          ["capabilities", capabilityId, "dependencies", name],
          {
            dependency: name,
            existing,
            requested: version,
          },
        ),
      );
    } else {
      target[name] = version;
    }
  }
}

function registrationSource(bundles: ForgeCapabilityBundle[]): string {
  const registrations = bundles
    .flatMap(({ manifest }) =>
      manifest.tools.map((tool) => ({
        capabilityId: manifest.id,
        name: tool.name,
        module: tool.registration.module,
        exported: tool.registration.export,
      })),
    )
    .sort((left, right) => compareAscii(left.name, right.name));
  const imports = registrations.map(({ module, exported }, index) => {
    const relative = module.replace(/^src\//u, "").replace(/\.ts$/u, ".js");
    return `import { ${exported} as registerCapabilityTool${index} } from "./${relative}";`;
  });
  const calls = registrations.map(
    (_, index) => `  registerCapabilityTool${index}(server);`,
  );
  return [
    'import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
    ...imports,
    "",
    "export function registerCapabilityTools(server: McpServer): void {",
    ...calls,
    "}",
    "",
  ].join("\n");
}

function publicTool(
  tool: ForgeCapabilityBundle["manifest"]["tools"][number],
): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: tool.outputSchema }),
    useWhen: tool.useWhen,
    avoidWhen: tool.avoidWhen,
    riskLevel: tool.riskLevel,
    readOnly: tool.readOnly,
    destructive: tool.destructive,
    requiresConfirmation: tool.requiresConfirmation,
  };
}

export function resolveCapabilityComposition(
  request: ForgeCapabilityCompositionRequest,
): ForgeCapabilityCompositionResult {
  const diagnostics: ForgeDiagnostic[] = [];
  for (const id of duplicateIds(request.requestedCapabilities)) {
    diagnostics.push(diagnostic("CAP_DUPLICATE", ["capabilities", id], { id }));
  }
  const bundles = new Map(
    request.capabilityBundles.map((bundle) => [bundle.manifest.id, bundle]),
  );
  const order = resolveOrder(
    request.requestedCapabilities,
    bundles,
    diagnostics,
  );
  const selected = order
    .map((id) => bundles.get(id))
    .filter((bundle): bundle is ForgeCapabilityBundle => bundle !== undefined);
  const selectedIds = new Set(order);
  const paths = new Set(request.templateManifest.files.map(({ path }) => path));
  const tools = new Set(request.config.tools.map(({ name }) => name));
  const runtimeDependencies: Record<string, string> = {};
  const developmentDependencies: Record<string, string> = {};
  const permissionByKind = new Map<string, CapabilityPermissionRequirement>();

  for (const bundle of selected) {
    const { manifest } = bundle;
    if (
      !manifest.compatibleTemplates.includes(
        request.templateManifest.template.id,
      )
    ) {
      diagnostics.push(
        diagnostic("CAP_TEMPLATE_INCOMPATIBLE", ["capabilities", manifest.id], {
          capability: manifest.id,
          template: request.templateManifest.template.id,
        }),
      );
    }
    for (const conflict of manifest.conflictsWith) {
      if (selectedIds.has(conflict)) {
        diagnostics.push(
          diagnostic(
            "CAP_CONFLICT",
            ["capabilities", manifest.id, "conflictsWith"],
            {
              capability: manifest.id,
              conflict,
            },
          ),
        );
      }
    }
    for (const file of manifest.files) {
      if (paths.has(file.path)) {
        diagnostics.push(
          diagnostic(
            "CAP_FILE_COLLISION",
            ["capabilities", manifest.id, "files", file.path],
            {
              path: file.path,
            },
          ),
        );
      }
      paths.add(file.path);
    }
    for (const tool of manifest.tools) {
      if (tools.has(tool.name)) {
        diagnostics.push(
          diagnostic(
            "CAP_TOOL_COLLISION",
            ["capabilities", manifest.id, "tools", tool.name],
            {
              tool: tool.name,
            },
          ),
        );
      }
      tools.add(tool.name);
    }
    mergeDependencySet(
      runtimeDependencies,
      manifest.dependencies.runtime,
      manifest.id,
      diagnostics,
    );
    mergeDependencySet(
      developmentDependencies,
      manifest.dependencies.development,
      manifest.id,
      diagnostics,
    );
    for (const permission of manifest.permissions) {
      const existing = permissionByKind.get(permission.permission);
      if (existing !== undefined && existing.status !== permission.status) {
        diagnostics.push(
          diagnostic(
            "CAP_PERMISSION_CONFLICT",
            ["capabilities", manifest.id, "permissions"],
            {
              permission: permission.permission,
            },
          ),
        );
        continue;
      }
      permissionByKind.set(permission.permission, {
        ...permission,
        scope: [
          ...new Set([...(existing?.scope ?? []), ...permission.scope]),
        ].sort(compareAscii),
      });
    }
  }
  if (selected.length > 0 && paths.has(aggregatorPath)) {
    diagnostics.push(
      diagnostic("CAP_FILE_COLLISION", ["composition", aggregatorPath]),
    );
  }
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (sortedDiagnostics.some(({ severity }) => severity === "error")) {
    return { success: false, diagnostics: sortedDiagnostics };
  }

  const files = [...request.templateManifest.files];
  const templateSources = { ...request.templateSources };
  for (const bundle of selected) {
    for (const file of bundle.manifest.files) {
      const source = `capabilities/${bundle.manifest.id}/${file.source}`;
      files.push({ ...file, source });
      templateSources[source] = bundle.templateSources[file.source] ?? "";
    }
  }
  if (selected.length > 0) {
    files.push({
      path: aggregatorPath,
      source: aggregatorSource,
      ownership: "forge-owned",
      updateStrategy: "replace-if-unmodified",
      required: true,
      contentType: "text/typescript",
    });
    templateSources[aggregatorSource] = registrationSource(selected);
  }
  const permissions = [...permissionByKind.values()].sort((left, right) =>
    compareAscii(left.permission, right.permission),
  );
  const allowedReadPaths = permissions
    .filter(
      ({ permission, status }) =>
        permission === "filesystem.read" && status === "allowed",
    )
    .flatMap(({ scope }) => scope)
    .sort(compareAscii);
  const effectiveConfig = {
    ...request.config,
    capabilities: [...order],
    tools: [
      ...request.config.tools,
      ...selected.flatMap(({ manifest }) => manifest.tools.map(publicTool)),
    ].sort((left, right) => compareAscii(left.name, right.name)),
    security: {
      ...request.config.security,
      allowedReadPaths,
    },
  };
  files.sort((left, right) => compareAscii(left.path, right.path));
  return {
    success: true,
    diagnostics: sortedDiagnostics,
    data: {
      manifest: { ...request.templateManifest, files },
      templateSources,
      renderComposition: {
        capabilityIds: [...order],
        runtimeDependencies,
        developmentDependencies,
        declaredTools: [...request.config.tools],
        declaredAllowedReadPaths: [...request.config.security.allowedReadPaths],
        effectiveConfig,
      },
      permissions,
    },
  };
}
