import { z } from "zod";

export const schemaVersionSchema = z.literal("1");

export const namedDefinitionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Must use snake_case, start with a letter, and contain at most 64 characters",
  );

export const projectNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must use lowercase kebab-case and contain at most 64 characters",
  );

export const nonEmptyStringSchema = z.string().trim().min(1);

export const relativePathSchema = nonEmptyStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split(/[\\/]/).includes(".."),
  "Must be a relative path without parent-directory traversal",
);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(jsonValueSchema);

export const exactVersionSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    "Must be an exact version such as 1.2.3; floating tags such as latest are not allowed",
  );
