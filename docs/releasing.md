# Release process

This document is the operational checklist for source releases of MCP Server
Forge. The normative release and authorization requirements remain in
[`AGENTS.md`](../AGENTS.md). A release is always an explicit manual action.

## Current release model

The current alpha release is a Git tag and GitHub prerelease built from `main`.
There is no release workflow and no package publication step. The root,
applications, shared packages, and example are all private. The basic generated
TypeScript project is functional but intentionally limited to one local `hello`
tool and is not published to npm.

Publishing to npm is **not applicable** for the current alpha series. Do not run
`npm publish` or `pnpm publish` while packages are private and their publish
contents and dependency metadata have not been prepared and reviewed.

## Version scope

Source releases currently use one Forge version for the root package, both
applications, and all packages under `packages/`:

- `package.json`;
- `apps/cli/package.json`;
- `apps/mcp-server/package.json`;
- `packages/core/package.json`;
- `packages/fs-adapter/package.json`;
- `packages/generators/package.json`;
- `packages/importers/package.json`;
- `packages/schemas/package.json`;
- `packages/templates/package.json`;
- `packages/validators/package.json`.

`examples/company-info` is a private fixture/example at version `0.0.0` and is
not part of the synchronized release version. Configuration `schemaVersion`,
template `manifestVersion`, template versions, and generation `stateVersion` are
independent contracts and must not change merely because the Forge version
changes.

## Prepare the release

- [ ] Confirm the proposed version follows Semantic Versioning and does not
      imply stability beyond the implemented contracts.
- [ ] Confirm `git status --short --branch` shows a clean `main` synchronized
      with `origin/main`.
- [ ] Confirm the target tag does not exist locally or remotely.
- [ ] Confirm the latest `main` CI run is green on Ubuntu, macOS, and Windows.
- [ ] Run `pnpm install --frozen-lockfile` from a clean checkout.
- [ ] Run `pnpm format:check`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check`.
- [ ] Run `node apps/cli/dist/index.js --help`.
- [ ] Run `node apps/cli/dist/index.js --version` and confirm it matches the
      proposed tag without the leading `v`.
- [ ] Run `node apps/cli/dist/index.js generate --help`.
- [ ] Complete the cross-platform [smoke-test procedure](testing/smoke-tests.md)
      or verify the automated smoke coverage and current platform reports.
- [ ] Confirm README and CLI documentation describe implemented behavior and
      identify the generated basic project as a one-tool local example rather
      than a production business server.
- [ ] Move the relevant `Unreleased` changelog entries into a dated section for
      the proposed version, leaving a new empty `Unreleased` section.
- [ ] Set the synchronized package versions listed above to the proposed version
      without changing independent contract versions.
- [ ] Confirm internal workspace dependency declarations remain valid for the
      source release.
- [ ] Inspect each prospective package with `npm pack --dry-run --json` and
      confirm no personal paths, secrets, tests, build metadata, or unintended
      source files would be published.
- [ ] Confirm no package publication is planned while package manifests remain
      private.
- [ ] Commit only the reviewed version and release-documentation changes.
- [ ] Re-run the complete verification suite on the release commit and require
      green CI before tagging.

## Publish the source release

Perform these steps only after explicit release approval:

1. Confirm the release commit is on `main`, the working tree is clean, and local
   `main` matches `origin/main`.
2. Create an annotated tag whose name exactly matches the package version:

   ```bash
   git tag -a v0.1.0-alpha.2 -m "v0.1.0-alpha.2"
   ```

3. Push the tag without force:

   ```bash
   git push origin v0.1.0-alpha.2
   ```

4. Create a GitHub prerelease from the existing tag. Use only the dated
   `v0.1.0-alpha.2` changelog section as the release notes:

   ```bash
   gh release create v0.1.0-alpha.2 --verify-tag --prerelease --title "v0.1.0-alpha.2" --notes-file <release-notes-file>
   ```

The branch must already be pushed and green before tagging. Do not create a
second release commit after the tag, and do not use force push.

## Verify the release

- [ ] Confirm the GitHub release is marked as a prerelease and points to the
      expected tag and release commit.
- [ ] Confirm the release notes match the dated changelog section.
- [ ] Confirm GitHub source archives are available and contain no uncommitted
      files.
- [ ] Confirm the repository still has no unintended tag, deployment, or package
      publication.
- [ ] Confirm `main` remains green and synchronized after release creation.
- [ ] Record the release URL and final commit SHA.

## Future npm publication

This section is intentionally inactive. Before any package becomes publishable,
its manifest needs an explicit public/private decision, repository and license
metadata, a reviewed `files` allowlist, correct `main`/`types`/`exports` and
`bin` entries, package documentation, exact publish-time internal dependency
versions, and a dry-run tarball review. npm publication requires its own
explicit approval and must not be inferred from approval to create a source
release.
