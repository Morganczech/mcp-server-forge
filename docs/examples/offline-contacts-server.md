# Offline contacts server example

This example is a small functional MCP server for local fictional contacts. It
demonstrates composition and permission reporting; it is not a production CRM,
address-book synchronizer, or write-capable data service.

## What is generated

The composed plan contains 18 managed project files plus generation state.
Capability-specific outputs include:

- user-owned `data/contacts.json`;
- forge-owned bounded loader `src/lib/load-contacts.ts`;
- three forge-owned contact tool modules;
- a deterministic capability registration module;
- contact runtime tests.

The generated `mcp-forge.json` records the selected capability IDs. Derived tool
and read-permission facts are recomputed from the reviewed manifests whenever a
template and capability root are available.

## Run it

Follow
[the capability generation commands](../capabilities.md#generate-the-example),
then configure an MCP client to run the local absolute path to
`contacts-target/dist/index.js` with `node`. Do not use `npx`; the generated
project is private and not published.

Use the tools as follows:

- `list_contacts` returns a bounded stable list;
- `search_contacts` searches name, email, phone, and tags;
- `get_contact` accepts an exact contact ID;
- `hello` remains the base connectivity check.

A missing contact is a structured `CONTACT_NOT_FOUND` tool error. Invalid,
oversized, missing, or symlinked data fails closed and does not expose arbitrary
filesystem content.

## Regeneration and removal

Running preview or generate again without changes produces 18 skip decisions and
no state rewrite. A manual edit to a forge-owned contact module produces a
conflict and blocks every write. Editing `data/contacts.json` is expected and is
preserved.

If both capability IDs are removed from configuration, preview reports their
previous outputs as orphaned and is unsafe to apply. The contacts data remains
on disk. Phase 6 deliberately provides no delete or purge command.
