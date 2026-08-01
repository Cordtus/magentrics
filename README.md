# Codex Usage Dashboard

A local, offline-capable dashboard for the JSON emitted by `ccusage codex daily --json`. It validates the export before displaying it, then presents usage, estimated cost, token composition, models, and trends without sending data anywhere.

The repository ships with a generated snapshot, so opening the UI needs neither a build step nor package installation. For refreshing personal data, install Bun and run:

```bash
bun install
```

Bun installs the project-pinned `ccusage` command. Node.js is still used to regenerate the snapshot, run tests, build a shareable package, or serve the files when `file://` is restricted; browser-only use needs neither Bun nor Node.

## Quick start

1. Open `index.html` in a browser. It loads the newest published snapshot immediately.
2. To inspect a different export, select **Load JSON** or drag the JSON file onto the page.
3. Reload the page to discard the selected file and return to the bundled snapshot.

If the browser prevents scripts or local assets from loading from `file://`, start the included loopback-only server instead:

```bash
node serve.mjs
```

Open the `http://127.0.0.1:8765/` URL printed by the command. Pass a port number as the first argument to use a different port. The server has no dependencies and is not exposed to the network.

An invalid selected file shows a diagnostic and leaves the last valid dashboard in place. A file loaded through the UI exists only for that browser session.

## Refresh the bundled data

The normal refresh workflow is one command:

```bash
bun run refresh
```

It runs the local `ccusage codex daily --json` command, validates the result, preserves the raw export under `data/raw/`, creates a transformed browser snapshot under `data/snapshots/`, and advances `data/latest.js` only after the complete bundle is valid. Previous raw exports and snapshots are never overwritten. The generated manifest and pointer files are updated atomically, so a failed export or validation leaves the last successful dashboard selected.

`data/usage-sources.json` controls the bundle. `personalUserId` identifies the entry refreshed automatically. To add another user, add a `users` entry manually and place that user’s validated ccusage JSON under `data/raw/`; refresh will include it but will not fetch it automatically.

The raw exports, transformed snapshots, manifest, and latest pointer can reveal usage dates, totals, costs, and model names. Treat all of them as sensitive.

## Use the dashboard

With a multi-user bundle, the dashboard starts on **Account total**. The detail selector changes the summary and detailed charts to an individual user; **Usage by user** remains a comparison of every bundled user and the combined account. Loading a single JSON file through the UI replaces the page with that export only, until reload.

Use the Daily/Weekly control for the usage timeline and user comparison. The Token usage chart has log and linear scales. Each chart’s **View data** disclosure provides its exact tabular values.

The interface includes:

- Summary cards for estimated cost, total/input/output/reasoning/cache-read tokens, and active days.
- Daily or weekly cost and total-token trend.
- Token composition over time.
- A model ranking with token totals, active days, and fallback counts.
- Monthly totals and cumulative cost/token charts.

## Interpreting the data

- **Estimated cost** is ccusage’s `costUSD` estimate, based on its model pricing; it is not a billing record.
- **Total tokens** equals input + output + cache creation + cache read. **Reasoning tokens** are already included in output tokens, so they must not be added again.
- **Cache-read share** is cache-read tokens divided by total tokens.
- **Active/recorded days** are dates that exist in the export. Missing dates are not assumed to be zero; missing months appear as gaps in the monthly chart. Weekly periods start on Monday.
- **Models** are ranked by total tokens. The export has no per-model cost, so the model table does not attribute cost. **Fallbacks** count model-days marked as fallback, not requests.
- **Account total** adds every user’s token and cost metrics. On a shared calendar date, both users’ usage is added; the account’s active-day count still counts that date once.

## Share an offline copy

Build a self-contained folder and ZIP after refreshing the snapshot:

```bash
bun run share:build
```

This creates `dist/codex-usage-dashboard/` and `dist/codex-usage-dashboard.zip` from the newest published snapshot. Recipients can extract the ZIP and open its `index.html` (or run its `node serve.mjs` fallback); no install or internet connection is required. The package omits the raw JSON files but embeds the same sensitive usage data in `usage-data.js`.

## Development

Run the complete test suite with:

```bash
bun run test
```

### Stack

- Static HTML, CSS, and vanilla JavaScript; no build framework or package manager.
- `dashboard-core.js` is browser/CommonJS validation and aggregation logic.
- Bun manages the project’s `ccusage` development dependency and refresh/package scripts; Node.js built-ins power refresh, tests, packaging, and the optional static server.
- Pinned local Chart.js 4.4.7 plus `chartjs-adapter-date-fns` 3.0.0 provide offline charts; licenses are in `vendor/THIRD_PARTY_LICENSES.md`.

### Key files

- `index.html`, `dashboard.js`: browser shell, controls, and rendering.
- `dashboard-core.js`: source validation and single-/multi-user aggregation.
- `data/usage-sources.json`: editable bundled-user manifest; `data/raw/`: immutable source exports; `data/snapshots/`: immutable browser snapshots; `data/latest.js`: generated latest-snapshot loader.
- `scripts/generate-data.mjs`: validated, atomic snapshot generation.
- `scripts/refresh-data.mjs`: one-command ccusage refresh and archive publication.
- `scripts/build-share.mjs`: offline folder and ZIP creation.
- `serve.mjs`: optional loopback-only static server.
- `tests/`: Node built-in test suite; `vendor/`: pinned chart dependencies and notices.
