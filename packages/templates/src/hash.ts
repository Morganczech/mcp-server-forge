import { createHash } from "node:crypto";

export const GENERATED_CONTENT_HASH_ALGORITHM = "sha256" as const;

export function hashGeneratedContent(content: string | Uint8Array): string {
  return createHash(GENERATED_CONTENT_HASH_ALGORITHM)
    .update(content)
    .digest("hex");
}
