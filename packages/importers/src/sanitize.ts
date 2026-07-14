import type { JsonValue } from "@mcp-server-forge/schemas";

const secretNamePattern =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)(?:$|_)/i;

export function isPotentialSecretName(name: string): boolean {
  return secretNamePattern.test(name);
}

export function sanitizeImportedConfiguration(input: unknown): JsonValue {
  const visited = new WeakSet<object>();

  function sanitize(value: unknown, key?: string): JsonValue {
    if (key !== undefined && isPotentialSecretName(key)) {
      return "[REDACTED]";
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== "object") {
      return null;
    }
    if (visited.has(value)) {
      return "[CIRCULAR]";
    }
    visited.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item));
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey),
        ]),
    );
  }

  return sanitize(input);
}
