export function normalizeRenderedContent(
  content: string,
  contentType?: string,
): string {
  void contentType;
  const normalized = content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  return `${normalized}\n`;
}
