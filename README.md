# AI Usage

A local, offline dashboard for CLI coding-assistant usage (Claude, Codex, OpenCode). Give it a usage export and it shows estimated cost, tokens, models, and trends. It validates everything in the browser and sends no data anywhere.

## Features

- Cost, token, and active-day summaries; daily/weekly trends; token composition; model ranking; monthly and cumulative charts.
- A floating, viewport-pinned panel with a date-range picker and per-source toggles (Codex / Claude / OpenCode or each user), plus a detail selector — every view and the combined total respond live.
- Smooth reloads: charts, cards, and numbers animate into the new data instead of snapping, with a fading snapshot of the previous chart behind them.
- Live mode that reloads the page as new usage is published.
- A self-contained offline copy you can hand to someone else.

## How it works

The dashboard is plain HTML/CSS/JS with no build step. It reads a usage JSON export client-side and uploads nothing. Because it uses ES modules, the browser blocks it on `file://`, so serve the folder with the included dependency-free server and open the printed URL.

Data stays local under `data/`:

- `refresh` fetches usage, validates it, and atomically publishes an immutable snapshot plus the `data/latest.*` pointers. Raw exports and snapshots are never overwritten.
- `codex` and `claude` come from the pinned [`ccusage`](https://www.npmjs.com/package/ccusage) tool; `opencode` reads the local OpenCode server.
- `serve` serves the folder on loopback; `?live=1` polls for new snapshots every 30 seconds.

## Setup

Install [Bun](https://bun.sh), then:

```bash
bun install
```

## Generate and view

Pick a provider as the first argument (`codex`, `claude`, `opencode`, or `combined`; it is required):

```bash
bun run refresh codex
bun run refresh claude
bun run refresh opencode
bun run refresh combined   # all providers in one snapshot, one source each
```

`combined` runs every provider and publishes a single snapshot with a source per provider (skipping any that returns no usage), so the dashboard shows Codex, Claude, and OpenCode side by side with a combined total.

To look at the result, serve the folder and open the URL it prints:

```bash
bun run refresh opencode --serve           # http://127.0.0.1:8765/
bun run refresh opencode --watch --serve   # live: http://127.0.0.1:8765/?live=1
```

`--watch` refreshes every `--interval <seconds>` (default 60); a cycle that finds no new usage prints `no changes` and does not publish. `--serve` uses `--port <n>` (default 8765). To view already-refreshed data without refreshing, run `node serve.js`.

The `opencode` provider starts a temporary server when none is running and stops it afterwards; an already-running server is left alone. Pass `--base-url <url>`, `--directory <path>`, or `--cache <path>` to override its defaults.

## Load an export by hand

Any canonical ccusage export works:

```bash
npx ccusage codex daily --json > aiusage.json
```

Then open the dashboard, choose **Add Your Usage**, and select the file. The browser validates it and keeps it only for the current page session.

## Configuration

`data/usage-sources.json` points refresh at your export. It needs a `personalUserId` matching the single entry in `users`, which needs an `id`, `name`, and `file`; refresh rewrites that `file` after each run.

Run refresh through `bun run` (not plain `node`) so the pinned `ccusage` binary is on `PATH`. The generated files under `data/` expose usage dates, totals, costs, and model names — treat them as private and never commit or publish them.

## Schedule it (systemd)

`refresh opencode` starts its own server, so one service plus a timer is enough. Create `~/.config/systemd/user/opencode-usage.service`:

```ini
[Unit]
Description=Refresh the local opencode usage snapshot

[Service]
Type=oneshot
WorkingDirectory=/absolute/path/to/this/checkout
ExecStart=/absolute/path/to/node scripts/refresh.js opencode
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

Then enable and inspect it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-usage.timer
systemctl --user list-timers opencode-usage.timer
journalctl --user -u opencode-usage.service -f
```

Fill in the absolute `node` path (`command -v node`) and the checkout root. If `opencode` is not on the service `PATH`, add `Environment=OPENCODE_BIN=/absolute/path/to/opencode`. Disable with `systemctl --user disable --now opencode-usage.timer`.

## Share an offline copy

```bash
bun run share:build
```

This writes `dist/codex-usage-dashboard/` and a ZIP from the newest local snapshot. Recipients extract it and run the included `node serve.js` (ES modules cannot load from `file://`); no install or internet needed. The package omits raw JSON but embeds the same sensitive usage data, so share it deliberately.

## Development

```bash
bun run test
```

- `index.html`, `dashboard.js`: browser shell, controls, and rendering.
- `dashboard-core.js`: validation and aggregation, imported by the browser and tests.
- `scripts/refresh.js`: the `bun run refresh [provider]` entry point.
- `scripts/refresh-ccusage.js`: `codex`/`claude` refresh and archive publication.
- `scripts/refresh-combined.js`: runs every provider and publishes one source-per-provider snapshot.
- `scripts/refresh-opencode.js`, `scripts/export-opencode.js`: opencode collection and one-shot export.
- `scripts/snapshot.js`: atomic write + snapshot serialization helpers (and a legacy generator CLI).
- `scripts/build-share.js`: offline folder and ZIP creation; `serve.js`: loopback static server.
- `tests/`: Node's built-in test runner; `vendor/`: pinned Chart.js and notices.

Everything is ESM (`"type": "module"`); the browser loads `dashboard.js` as a module.
