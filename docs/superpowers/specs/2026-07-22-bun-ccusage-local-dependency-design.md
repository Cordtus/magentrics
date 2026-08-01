# Bun and Local ccusage Design

## Goal

Make `ccusage` an explicit, reproducible project development dependency without changing the dashboard's dependency-free browser runtime.

## Scope

- Add Bun project metadata and its lockfile.
- Install `ccusage` as a development dependency.
- Expose project commands for exporting usage data, generating the browser snapshot, testing, and building the offline share package.
- Update the root README so all setup and refresh instructions use the local dependency through Bun.

## Command contract

`bun run usage:export` runs the locally installed CLI and writes the ccusage JSON document to standard output. Redirect it to the manifest entry being refreshed, for example:

```bash
bun run usage:export > codex-usage2.json
```

`bun run data:generate`, `bun run test`, and `bun run share:build` wrap the existing Node-based scripts and test suite. Their implementation remains unchanged.

## Boundaries

The browser still opens `index.html` directly and uses only its checked-in local assets. Bun, `node_modules`, and the raw source exports are development-only and are not copied to the offline share package.

## Verification

Install with Bun, confirm the local `ccusage` executable is available through the script, regenerate the snapshot, run the full test suite, and review the package manifest and README command paths.
