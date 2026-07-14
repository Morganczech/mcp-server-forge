# Read-only filesystem adapter

## Purpose and boundary

`@mcp-server-forge/fs-adapter` is the integration boundary between explicit
filesystem locations and the pure template/generator domain. It converts bounded
reads into the existing JSON-serializable `ForgeTargetState`, validated optional
`ForgeGenerationState`, and an in-memory template bundle.

The templates, generators, and validators packages do not depend on this
adapter. The adapter may call their public validation, hashing, and sorting
APIs, but filesystem objects never enter their domain contracts.

## Public API

- `loadTargetState(rootPath, managedPaths, options)` inspects only declared
  target paths and returns hashes/metadata without returning target content;
- `loadGenerationState(rootPath, options)` optionally loads the default state or
  an explicit portable `statePath` confined inside root;
- `loadTemplateBundle(templateDirectory, options)` loads `template.json` and
  only its declared text sources;
- `inspectGenerationWorkspace(request)` composes those reads and reports whether
  the result is safe to pass to the renderer and generation preview;
- `DEFAULT_MAX_FILE_SIZE_BYTES` is 5 MiB;
- `DEFAULT_GENERATION_STATE_PATH` is `.mcp-forge/generated-state.json`.

Every root must be supplied explicitly as an absolute path. There is no current
working-directory fallback.

## Authorized read scope

The adapter does not recursively scan project or template trees. It reads only:

1. the explicit project or template root metadata needed for confinement;
2. managed target paths supplied by the caller;
3. `.mcp-forge/generated-state.json` under the project root;
4. `template.json` under the template directory;
5. the unique template source paths declared by the validated manifest.

Extra project files and undeclared template files are not opened or returned.
Forge configuration remains an explicit input to the existing schema/renderer
workflow; this adapter does not discover configuration implicitly.

## Root confinement and path policy

Roots are checked for existence and directory type, then canonicalized with
`realpath`. An explicitly supplied root may itself be a symlink to a directory;
the resolved directory becomes the fixed authorization boundary.

Every managed or manifest source path must use the existing portable relative
`/` path contract. Absolute paths, backslashes, empty segments, `.` and `..` are
rejected. Duplicate normalized managed paths are rejected. Each path component
is inspected without following symlinks, and the final canonical regular-file
path is checked to remain under the canonical root.

Only regular files are readable. A directory at a file target, a regular file in
a required parent-directory position, socket, device, or FIFO produces
`FS_PATH_TYPE_UNSUPPORTED`.

## Symlink policy

Version 1 rejects every symlink encountered in a managed target, generation
state, manifest, or template source path, including symlinks that point inside
the same root. Directory symlinks therefore cannot escape the root. A rejected
managed target is conservatively represented as existing with no hash, alongside
an error diagnostic, so consumers cannot mistake it for a safe create target.

Regular files are opened read-only with `O_NOFOLLOW` where the platform exposes
it. Callers must stop when inspection reports errors; the adapter never repairs
or replaces a link.

## Hashing and content

Existing target files are read only long enough to compute SHA-256 through the
public `hashGeneratedContent` helper. The hash represents the exact bytes on
disk—there is no line-ending or trailing-newline normalization. This matches the
bytes that a future writer and generated state must record and reliably detects
manual byte-level changes.

Target content is never returned. Template sources are different: they are
explicitly declared renderer input, decoded as strict UTF-8, and returned only
in the in-memory source map.

## Size limits

Every file read uses `maxFileSizeBytes`, defaulting to 5 MiB. The adapter checks
file size before loading content and checks the bounded result again after open.
An oversized target remains `exists: true` but has no hash, emits
`FS_FILE_TOO_LARGE`, and therefore leads to conservative planning. Oversized
state, manifests, or template sources cannot produce a usable bundle/state and
also emit their context-specific read diagnostic.

The limit must be a positive safe integer. Raising it is an explicit caller
decision; there is no unlimited mode.

## Generation state

A missing `.mcp-forge/generated-state.json` is a normal `available: false`
result. An existing file must be a bounded, regular, non-link UTF-8 file
containing valid JSON. Its value is validated with `validateGenerationState`;
schema diagnostics are preserved alongside `FS_GENERATION_STATE_INVALID`.

The adapter does not create, update, migrate, or delete generation state.

## Template bundles

`loadTemplateBundle` first validates bounded UTF-8 `template.json` with
`validateTemplateManifest`. Only unique source paths declared by the validated
manifest are then opened, in deterministic ASCII order. It does not recursively
enumerate the template directory and does not load undeclared files. Binary or
invalid UTF-8 template sources are rejected.

## Diagnostics

Filesystem integration uses the shared catalog and stable `FS_` prefix:

- roots and paths: `FS_ROOT_NOT_FOUND`, `FS_ROOT_NOT_DIRECTORY`,
  `FS_PATH_INVALID`, `FS_PATH_OUTSIDE_ROOT`, `FS_SYMLINK_REJECTED`,
  `FS_PATH_TYPE_UNSUPPORTED`, `FS_DUPLICATE_NORMALIZED_PATH`;
- bounded reads and hashes: `FS_FILE_READ_FAILED`, `FS_FILE_TOO_LARGE`,
  `FS_HASH_FAILED`;
- state: `FS_GENERATION_STATE_INVALID`, `FS_GENERATION_STATE_READ_FAILED`;
- templates: `FS_TEMPLATE_MANIFEST_NOT_FOUND`, `FS_TEMPLATE_MANIFEST_INVALID`,
  `FS_TEMPLATE_SOURCE_MISSING`, `FS_TEMPLATE_SOURCE_READ_FAILED`.

Diagnostics are sorted with the shared deterministic sorter. Template and state
contract diagnostics are retained when validation fails.

## Platform behavior

On POSIX systems, `executable` reflects whether any execute bit is set. On
Windows it is `undefined`, because the POSIX mode bit is not a reliable portable
signal. Planning must not invent an executable value when it is unavailable.

## What the adapter never does

The package contains no write, create-directory, delete, rename, installation,
network, shell, or child-process operation. It does not render templates, apply
plans, create generation state, merge shared files, discover roots implicitly,
or scan complete trees.
