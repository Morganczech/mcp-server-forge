import type { ForgeRenderScalar } from "./types.js";

export const FORGE_RENDER_HELPERS = [
  "json",
  "lowercase",
  "uppercase",
  "kebabCase",
  "snakeCase",
  "escapeMarkdown",
] as const;

export type ForgeRenderHelper = (typeof FORGE_RENDER_HELPERS)[number];

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function applyRenderHelper(
  helper: ForgeRenderHelper,
  value: ForgeRenderScalar,
): string {
  const text = String(value);
  switch (helper) {
    case "json":
      return JSON.stringify(value);
    case "lowercase":
      return text.toLowerCase();
    case "uppercase":
      return text.toUpperCase();
    case "kebabCase":
      return words(text).join("-");
    case "snakeCase":
      return words(text).join("_");
    case "escapeMarkdown":
      return text
        .replace(/\\/g, "\\\\")
        .replace(/([`*_[\]{}()#+\-.!|>])/g, "\\$1");
  }
}

export function isRenderHelper(value: string): value is ForgeRenderHelper {
  return (FORGE_RENDER_HELPERS as readonly string[]).includes(value);
}
