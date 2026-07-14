import type { ForgeConfig } from "@mcp-server-forge/schemas";

import { createDiagnostic, sortDiagnostics } from "./diagnostics.js";
import type { ForgeDiagnostic } from "./types.js";

type CapabilityName = "tools" | "resources" | "prompts";

function validateCapability(
  capability: CapabilityName,
  enabled: boolean,
  definitionCount: number,
): ForgeDiagnostic[] {
  const path = ["server", "capabilities", capability];
  const metadata = { capability, definitionCount };

  if (!enabled && definitionCount > 0) {
    return [
      createDiagnostic(
        "SEM_CAPABILITY_DISABLED_WITH_DEFINITIONS",
        path,
        metadata,
      ),
    ];
  }

  if (enabled && definitionCount === 0) {
    return [
      createDiagnostic(
        "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
        path,
        metadata,
      ),
    ];
  }

  return [];
}

export function validateParsedForgeConfig(
  config: ForgeConfig,
): ForgeDiagnostic[] {
  const diagnostics: ForgeDiagnostic[] = [
    ...validateCapability(
      "tools",
      config.server.capabilities.tools,
      config.tools.length,
    ),
    ...validateCapability(
      "resources",
      config.server.capabilities.resources,
      config.resources.length + config.resourceTemplates.length,
    ),
    ...validateCapability(
      "prompts",
      config.server.capabilities.prompts,
      config.prompts.length,
    ),
  ];

  if (!config.knowledge.enabled && config.knowledge.sources.length > 0) {
    diagnostics.push(
      createDiagnostic(
        "SEM_KNOWLEDGE_DISABLED_WITH_SOURCES",
        ["knowledge", "enabled"],
        { sourceCount: config.knowledge.sources.length },
      ),
    );
  }

  config.tools.forEach((tool, index) => {
    if (!tool.readOnly && !config.security.fileWrite) {
      diagnostics.push(
        createDiagnostic("SEC_TOOL_WRITE_DISABLED", ["tools", index], {
          toolName: tool.name,
        }),
      );
    }

    if (tool.destructive && !config.security.fileDelete) {
      diagnostics.push(
        createDiagnostic("SEC_TOOL_DELETE_DISABLED", ["tools", index], {
          toolName: tool.name,
        }),
      );
    }
  });

  return sortDiagnostics(diagnostics);
}
