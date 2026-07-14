import type { FileOwnership, FileUpdateStrategy } from "./types.js";

const allowedStrategies: Record<
  FileOwnership,
  ReadonlySet<FileUpdateStrategy>
> = {
  "forge-owned": new Set([
    "create-once",
    "replace",
    "replace-if-unmodified",
    "manual",
  ]),
  "user-owned": new Set(["create-once", "manual"]),
  shared: new Set(["merge-markers", "manual"]),
};

export function isOwnershipStrategyValid(
  ownership: FileOwnership,
  updateStrategy: FileUpdateStrategy,
): boolean {
  return allowedStrategies[ownership].has(updateStrategy);
}
