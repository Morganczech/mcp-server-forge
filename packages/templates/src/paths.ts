const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SHELL_SYNTAX = /(?:\$\{|\$\(|`|[|;&<>])/;

export function isPortableRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function isSafeTemplateSourcePath(value: string): boolean {
  return (
    isPortableRelativePath(value) &&
    !URL_SCHEME.test(value) &&
    !SHELL_SYNTAX.test(value)
  );
}

export function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
