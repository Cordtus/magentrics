# AI Usage

A local, offline-capable dashboard for compatible usage exports from Claude, Codex, OpenCode, and other providers. It validates each export before displaying it, then presents usage, estimated cost, token composition, models, and trends without sending data anywhere.

Opening the UI needs neither a build step nor package installation. For generating exports with the included scripts, install Bun and run:

```bash
bun install
```

Bun installs the project-pinned `ccusage` command. Node.js is still used to regenerate the snapshot, run tests, build a shareable package, or serve the files when `file://` is restricted; browser-only use needs neither Bun nor Node.

## Quick start

1. Open `index.html` in a browser. It starts empty and keeps all selected data in the current session.
2. Select **Add Your Usage** to load an export or see generation guidance.
3. Reload the page to discard the selected file and clear the dashboard.

If the browser prevents scripts or local assets from loading from `file://`, start the included loopback-only server instead:

```bash
node serve.mjs
```

Open the `http://127.0.0.1:8765/` URL printed by the command. Pass a port number as the first argument to use a different port. The server has no dependencies and is not exposed to the network.

An invalid selected file shows a diagnostic and leaves the last valid dashboard in place. A file loaded through the UI exists only for that browser session.

## Use the data launcher

The **Add Your Usage** button in the dashboard is the single entry point for adding data:

- **JSON** loads a compatible `ccusage` daily export for the current browser session.
- **Generating the JSON file** shows the local command to generate an export.

The local JSON file is never uploaded or modified. Reload the page to clear the current session.

## Generate usage data

Generate an OpenCode export with one command:

```bash
npx ccusage opencode daily --json > aiusage.json && pwd
```

Then open the public dashboard, choose **Add Your Usage > Add File**, and select `aiusage.json`.
The browser validates and visualizes the file locally.

The command prints the directory containing `aiusage.json` after it finishes.

For Claude or Codex data, use the corresponding provider:

```bash
npx ccusage claude daily --json > aiusage.json
npx ccusage codex daily --json > aiusage.json
```

The command writes the file locally. The dashboard is entirely client-side: it reads the selected
JSON in the browser and sends no usage data to a server. Review the generated file before sharing
it.

## Supported export formats

The browser accepts these formats without uploading them:

- A canonical `ccusage codex daily --json` export.
- A canonical export produced by `npx ccusage <provider> daily --json`.

The dashboard does not guess how to convert arbitrary session logs or provider-specific JSON.
Convert those exports to the canonical daily shape first, or add a tested adapter in the
repository. See [`ccusage`](https://www.npmjs.com/package/ccusage) for the Codex/Claude export
tool and [`OpenCode`](https://opencode.ai/docs/) for its server and CLI documentation.

## Generate a local snapshot

The local refresh workflow is one command. The provider is required as the
first argument (`codex`, `claude`, or `opencode`); running it without one exits
with an error listing the choices:

```bash
bun run refresh codex      # ccusage codex daily --json
bun run refresh claude     # ccusage claude daily --json
bun run refresh opencode   # per-agent usage from a local opencode server
```

For `codex` and `claude` it runs the matching `ccusage <provider> daily --json`,
validates the result, preserves the raw export under `data/raw/`, creates a
transformed browser snapshot under `data/snapshots/`, and advances
`data/latest.js` only after the complete bundle is valid. Previous raw exports
and snapshots are never overwritten. The generated manifest and pointer files
are updated atomically, so a failed export or validation leaves the last
successful dashboard selected. See [Track opencode agents](#track-opencode-agents-persistently)
for the `opencode` provider.

Add modes with flags:

```bash
bun run refresh opencode --watch           # keep updating on an interval
bun run refresh opencode --serve           # update, then serve the dashboard
bun run refresh opencode --watch --serve   # dashboard that keeps itself current
```

`--watch` re-runs the refresh every `--interval <seconds>` (default 60) until you
press Ctrl-C; if a run takes longer than the interval, the next one waits rather
than overlapping. `--serve` starts the loopback dashboard and prints its URL
(`--port <n>`, default 8765).

For a dashboard that updates itself in the browser, combine both and open the
`?live=1` URL:

```bash
bun run refresh opencode --watch --serve
# then open http://127.0.0.1:8765/?live=1
```

Live mode polls `data/latest.json` every 30 seconds and reloads
`data/latest-data.json` when a new snapshot is published. `--watch` alone does
**not** serve anything; it only rewrites the files on disk, so reload the page by
hand if you are serving it separately.

`data/usage-sources.json` controls the local snapshot. `personalUserId` identifies the entry
refreshed automatically. These generated files are private local artifacts and should not be
deployed publicly.

The raw exports, transformed snapshots, manifest, and latest pointer can reveal usage dates, totals, costs, and model names. Treat all of them as sensitive.

## Track opencode agents persistently

For a project that runs several opencode agents, `bun run refresh opencode`
collects usage from the local server and publishes the dashboard snapshot
atomically. If no server is reachable at the target address it starts a
temporary one and stops it when finished; an already-running server is left
untouched.

```bash
bun run refresh opencode
bun run refresh opencode --base-url http://127.0.0.1:4096 --directory /path/to/project
```

- It reuses unchanged sessions from `data/opencode-cache.json`, so each run only reads sessions that changed since the previous one.
- It publishes one dashboard "user" per agent, so the account total and the per-agent breakdown work out of the box.
- It writes `data/latest.js` (loader), `data/latest.json` (pointer), and `data/latest-data.json` (browser bundle).

Serve the dashboard and open it with `?live=1` to poll for new snapshots every 30 seconds:

```bash
node serve.mjs
# then open http://127.0.0.1:8765/?live=1
```

### Refresh on a schedule

Because `refresh opencode` starts a temporary server when none is reachable, one
systemd user service plus a timer is enough to keep the snapshot current. Create
`~/.config/systemd/user/opencode-usage.service`:

```ini
[Unit]
Description=Refresh the local opencode usage snapshot

[Service]
Type=oneshot
WorkingDirectory=/absolute/path/to/claude-usage
ExecStart=/absolute/path/to/node scripts/refresh.mjs opencode
```

and `~/.config/systemd/user/opencode-usage.timer`:

```ini
[Unit]
Description=Refresh opencode usage every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
```

Then start it and inspect it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-usage.timer
systemctl --user list-timers opencode-usage.timer   # next run
journalctl --user -u opencode-usage.service -f      # last run
```

Fill in the two absolute paths (`command -v node`; the checkout root). If
`opencode` is not on the service `PATH`, add
`Environment=OPENCODE_BIN=/absolute/path/to/opencode`. Stop it with
`systemctl --user disable --now opencode-usage.timer`.

Keeping a long-lived server instead (`bun run start:opencode`) lets each refresh
reuse it and skip startup. Other startup scripts: `bun run start` serves the
dashboard on loopback.

## Use the dashboard

Loading a JSON file through the UI replaces the page with that export only, until reload.

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

This creates `dist/codex-usage-dashboard/` and `dist/codex-usage-dashboard.zip` from the newest local snapshot. Recipients can extract the ZIP and open its `index.html` (or run its `node serve.mjs` fallback); no install or internet connection is required. The package omits the raw JSON files but embeds the same sensitive usage data in `usage-data.js`.

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
- `data/usage-sources.json`: editable multi-user manifest; `data/raw/`: immutable source exports and temporary OpenCode exports; `data/snapshots/`: immutable browser snapshots; `data/latest.js`: local snapshot loader.
- `scripts/generate-data.mjs`: validated, atomic snapshot generation.
- `scripts/refresh.mjs`: the `bun run refresh [provider]` entry point; dispatches to the ccusage or opencode path.
- `scripts/refresh-data.mjs`: ccusage (`codex`/`claude`) refresh and archive publication.
- `scripts/refresh-opencode.mjs`: incremental multi-agent opencode collection, server lifecycle, and snapshot publication.
- `scripts/fetch-opencode.mjs`: one-shot opencode export printer (`{ daily, totals }` to stdout).
- `scripts/build-share.mjs`: offline folder and ZIP creation.
- `serve.mjs`: optional loopback-only static server.
- `tests/`: Node built-in test suite; `vendor/`: pinned chart dependencies and notices.
