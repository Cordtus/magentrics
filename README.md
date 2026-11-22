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
- `codex` and `claude` come from the pinned [`ccusage`](https://www.npmjs.com/package/ccusage) tool; `opencode` reads `opencode.db` directly and caches per-session aggregates, so each run only re-reads sessions whose assistant-message signature changed.
- `serve` serves the folder on loopback; `?live=1` polls for new snapshots every 30 seconds.

## Setup

Node.js 18 or newer is required (the scripts use native `fetch` and the built-in test runner).
The OpenCode provider also needs the `sqlite3` command-line tool on `PATH` (it reads `opencode.db` directly). Install the pinned [`ccusage`](https://www.npmjs.com/package/ccusage) dependency with either package manager:

```bash
npm install     # or: bun install
```

## Generate and view

Pick a provider as the first argument (`codex`, `claude`, `opencode`, or `combined`; it is required):

```bash
bun run refresh codex
bun run refresh claude
bun run refresh opencode
bun run refresh combined   # all providers in one snapshot, one source each
```

## Agent performance

Turn latency from the local OpenCode database, shown as an optional section on
the dashboard:

```bash
bun run export:opencode-perf   # writes data/opencode-perf.json
```

Reports average turn time, p95, model vs. between-turn overhead, time to first
token, tokens/second, context size, turns per request, and a latency breakdown
by prompt size.

`combined` runs every provider and publishes a single snapshot with a source per provider (skipping any that returns no usage or is not installed), so the dashboard shows Codex, Claude, and OpenCode side by side with a combined total.

`npm run refresh -- codex` is equivalent to `bun run refresh codex`; running `node scripts/refresh.js codex` directly also works, but only if `ccusage` is on your `PATH` (the package managers add `node_modules/.bin` for you).

To look at the result, serve the folder and open the URL it prints:

```bash
bun run refresh combined --serve           # refresh once, then serve http://127.0.0.1:8765/
bun run refresh combined --watch --serve   # live: http://127.0.0.1:8765/?live=1
```

`--watch` refreshes every `--interval <seconds>` (default 60); a cycle that finds no new usage prints `no changes` and does not publish. `--serve` uses `--port <n>` (default 8765). To view already-refreshed data without refreshing, run `node serve.js`.

The `opencode` provider starts a temporary server when none is running and stops it afterwards; an already-running server is left alone. Pass `--base-url <url>`, `--directory <path>`, or `--cache <path>` to override its defaults.

## Load an export by hand

Any canonical ccusage export works:

```bash
npx ccusage codex daily --json --offline > aiusage.json
```

For OpenCode, use the bundled exporter. It reads `opencode.db` directly, so it
works with the current (V2) schema and never waits on the server:

```bash
bun run export:opencode --output aiusage.json
```

`ccusage opencode` only understands the older local data and may hang while
fetching pricing from LiteLLM; pass `--offline` if you use it.

Then open the dashboard, choose **Add Your Usage**, and select the file. The browser validates it and keeps it only for the current page session.

## Configuration

`data/usage-sources.json` points refresh at your export. It needs a `personalUserId` matching the single entry in `users`, which needs an `id`, `name`, and `file`; refresh rewrites that `file` after each run.

`data/opencode-db-cache.json` stores one aggregate per session keyed by `max(time_updated)` and the assistant-message count. A run re-reads only sessions whose signature moved; delete the file to force a full rebuild. The first run after deletion is the slow one.

Run refresh through a package-manager script (`bun run` / `npm run`) so the pinned `ccusage` binary is on `PATH`. The generated files under `data/` expose usage dates, totals, costs, and model names — treat them as private and never commit or publish them.

## Schedule it (systemd)

Two user units keep it current: a static server and a daily timer. The refresh
reads `opencode.db` directly, so it needs no OpenCode server and no network. The
dashboard also has a **Refresh data** button that runs the same refresh on demand
through `POST /api/refresh`.

`~/.config/systemd/user/ai-usage-dashboard.service`:

```ini
[Unit]
Description=AI usage dashboard (loopback)
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/this/checkout
ExecStart=/absolute/path/to/node serve.js 8765
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/ai-usage-refresh.service` and `.timer`:

```ini
# ai-usage-refresh.service
[Service]
Type=oneshot
WorkingDirectory=/absolute/path/to/this/checkout
ExecStart=/absolute/path/to/node scripts/refresh.js opencode --db /absolute/path/to/opencode.db --skip-unchanged --quiet
ExecStartPost=/usr/bin/find /absolute/path/to/this/checkout/data/snapshots -type f -mtime +90 -delete
Nice=10
IOSchedulingClass=idle

# ai-usage-refresh.timer
[Timer]
OnCalendar=*-*-* 02:00:00 America/Denver
Persistent=true

[Install]
WantedBy=timers.target
```

Enable both:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-usage-dashboard.service
systemctl --user enable --now ai-usage-refresh.timer
systemctl --user start ai-usage-refresh.service   # run once now
systemctl --user list-timers ai-usage-refresh.timer
journalctl --user -u ai-usage-refresh.service -f
```

The dashboard polls `data/latest.json` every 30 seconds, so an open page picks
up the nightly snapshot without a reload; the **Refresh data** button does an
immediate run and reloads the page. Snapshots older than 90 days are deleted by
the service.


Fill in the absolute `node` path (`command -v node`) and the checkout root. If `opencode` is not on the service `PATH`, add `Environment=OPENCODE_BIN=/absolute/path/to/opencode`. Disable with `systemctl --user disable --now opencode-usage.timer`.

## Share an offline copy

```bash
bun run share:build
```

This writes `dist/ai-usage-dashboard/` and a ZIP from the newest local snapshot. Recipients extract it and run the included `node serve.js` (ES modules cannot load from `file://`); no install or internet needed. The package omits raw JSON but embeds the same sensitive usage data, so share it deliberately.

## Development

```bash
bun run test    # or: npm test
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
