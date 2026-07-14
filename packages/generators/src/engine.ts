import {
  createDiagnostic,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { isBlockedSecretPath, resolveRenderContextValue } from "./context.js";
import {
  applyRenderHelper,
  isRenderHelper,
  type ForgeRenderHelper,
} from "./helpers.js";
import type {
  ForgeRenderContext,
  ForgeTemplateSourceRenderResult,
  RenderTemplateSourceOptions,
} from "./types.js";

type TemplateNode = TextNode | ValueNode | IfNode;

interface TextNode {
  kind: "text";
  value: string;
}

interface ValueNode {
  kind: "value";
  path: string;
  helper?: string;
}

interface IfNode {
  kind: "if";
  path: string;
  children: TemplateNode[];
}

type TemplateToken =
  { kind: "text"; value: string } | { kind: "expression"; value: string };

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;

function syntaxDiagnostic(path: Array<string | number>): ForgeDiagnostic {
  return createDiagnostic("GEN_TEMPLATE_SYNTAX_INVALID", path);
}

function tokenize(
  source: string,
  diagnosticPath: Array<string | number>,
): { tokens?: TemplateToken[]; diagnostics: ForgeDiagnostic[] } {
  const tokens: TemplateToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("{{", cursor);
    const strayClose = source.indexOf("}}", cursor);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    if (open === -1) {
      tokens.push({ kind: "text", value: source.slice(cursor) });
      break;
    }
    if (source.startsWith("{{{", open)) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    if (open > cursor) {
      tokens.push({ kind: "text", value: source.slice(cursor, open) });
    }
    const close = source.indexOf("}}", open + 2);
    if (close === -1) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    const expression = source.slice(open + 2, close).trim();
    if (expression.length === 0 || expression.includes("{{")) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    tokens.push({ kind: "expression", value: expression });
    cursor = close + 2;
  }

  return { tokens, diagnostics: [] };
}

function parse(
  tokens: TemplateToken[],
  diagnosticPath: Array<string | number>,
): { nodes?: TemplateNode[]; diagnostics: ForgeDiagnostic[] } {
  const root: TemplateNode[] = [];
  const stack: TemplateNode[][] = [root];

  for (const token of tokens) {
    const current = stack.at(-1);
    if (current === undefined) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    if (token.kind === "text") {
      current.push(token);
      continue;
    }

    if (token.value.startsWith("#if")) {
      const parts = token.value.split(/\s+/);
      if (
        parts.length !== 2 ||
        parts[0] !== "#if" ||
        !IDENTIFIER.test(parts[1] ?? "")
      ) {
        return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
      }
      const node: IfNode = {
        kind: "if",
        path: parts[1] as string,
        children: [],
      };
      current.push(node);
      stack.push(node.children);
      continue;
    }

    if (token.value === "/if") {
      if (stack.length === 1) {
        return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
      }
      stack.pop();
      continue;
    }

    if (token.value.startsWith("#") || token.value.startsWith("/")) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }

    const parts = token.value.split(/\s+/);
    if (
      (parts.length !== 1 && parts.length !== 2) ||
      !parts.every((part) => IDENTIFIER.test(part))
    ) {
      return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
    }
    current.push({
      kind: "value",
      path: parts.at(-1) as string,
      ...(parts.length === 1 ? {} : { helper: parts[0] }),
    });
  }

  if (stack.length !== 1) {
    return { diagnostics: [syntaxDiagnostic(diagnosticPath)] };
  }
  return { nodes: root, diagnostics: [] };
}

function unavailableValueDiagnostic(
  path: string,
  diagnosticPath: Array<string | number>,
): ForgeDiagnostic {
  return createDiagnostic(
    isBlockedSecretPath(path)
      ? "GEN_SECRET_ACCESS_BLOCKED"
      : "GEN_TEMPLATE_VARIABLE_UNKNOWN",
    diagnosticPath,
    { variable: path },
  );
}

function evaluate(
  nodes: TemplateNode[],
  context: ForgeRenderContext,
  diagnosticPath: Array<string | number>,
): { content: string; diagnostics: ForgeDiagnostic[] } {
  let content = "";
  const diagnostics: ForgeDiagnostic[] = [];

  for (const node of nodes) {
    if (node.kind === "text") {
      content += node.value;
      continue;
    }

    const value = resolveRenderContextValue(context, node.path);
    if (value === undefined) {
      diagnostics.push(
        node.kind === "if"
          ? createDiagnostic(
              isBlockedSecretPath(node.path)
                ? "GEN_SECRET_ACCESS_BLOCKED"
                : "GEN_TEMPLATE_CONDITION_INVALID",
              diagnosticPath,
              { variable: node.path },
            )
          : unavailableValueDiagnostic(node.path, diagnosticPath),
      );
      continue;
    }

    if (node.kind === "if") {
      if (typeof value !== "boolean") {
        diagnostics.push(
          createDiagnostic("GEN_TEMPLATE_CONDITION_INVALID", diagnosticPath, {
            variable: node.path,
          }),
        );
        continue;
      }
      if (value) {
        const nested = evaluate(node.children, context, diagnosticPath);
        content += nested.content;
        diagnostics.push(...nested.diagnostics);
      }
      continue;
    }

    if (node.helper === undefined) {
      content += String(value);
      continue;
    }
    if (!isRenderHelper(node.helper)) {
      diagnostics.push(
        createDiagnostic("GEN_TEMPLATE_HELPER_UNKNOWN", diagnosticPath, {
          helper: node.helper,
        }),
      );
      continue;
    }
    content += applyRenderHelper(node.helper as ForgeRenderHelper, value);
  }

  return { content, diagnostics };
}

export function renderTemplateSource(
  source: string,
  context: ForgeRenderContext,
  options: RenderTemplateSourceOptions = {},
): ForgeTemplateSourceRenderResult {
  const diagnosticPath = options.diagnosticPath ?? [];
  if (typeof source !== "string") {
    return {
      success: false,
      diagnostics: [
        createDiagnostic("GEN_TEMPLATE_SOURCE_INVALID", diagnosticPath),
      ],
    };
  }

  const tokenized = tokenize(source, diagnosticPath);
  if (tokenized.tokens === undefined) {
    return { success: false, diagnostics: tokenized.diagnostics };
  }
  const parsed = parse(tokenized.tokens, diagnosticPath);
  if (parsed.nodes === undefined) {
    return { success: false, diagnostics: parsed.diagnostics };
  }
  const evaluated = evaluate(parsed.nodes, context, diagnosticPath);
  const diagnostics = sortDiagnostics(evaluated.diagnostics);
  return diagnostics.some(({ severity }) => severity === "error")
    ? { success: false, diagnostics }
    : { success: true, content: evaluated.content, diagnostics };
}
