import { compareAscii } from "./paths.js";
import type {
  ForgeGeneratedFileState,
  ForgeTemplateDirectory,
  ForgeTemplateFile,
} from "./types.js";

export function sortTemplateFiles(
  files: ReadonlyArray<ForgeTemplateFile>,
): ForgeTemplateFile[] {
  return [...files].sort((left, right) => compareAscii(left.path, right.path));
}

export function sortTemplateDirectories(
  directories: ReadonlyArray<ForgeTemplateDirectory>,
): ForgeTemplateDirectory[] {
  return [...directories].sort((left, right) =>
    compareAscii(left.path, right.path),
  );
}

export function sortGeneratedFileStates(
  files: ReadonlyArray<ForgeGeneratedFileState>,
): ForgeGeneratedFileState[] {
  return [...files].sort((left, right) => compareAscii(left.path, right.path));
}
