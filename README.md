# AI Usage

A local, offline dashboard for CLI coding-assistant usage: Claude, Codex, and
OpenCode in one view. Point it at a usage export and it shows estimated cost,
tokens, models, trends, and agent turn latency. Everything is validated in the
browser and nothing is uploaded.

## Features

- Cost, token, and active-day summaries; daily/weekly trends; token composition;
  model ranking; monthly and cumulative charts.
- A floating, viewport-pinned panel with a date-range picker, per-source toggles
  (Codex / Claude / OpenCode or each user), and a detail selector — every view and
  the combined total respond live.
- Smooth reloads: charts, cards, and numbers animate into the new data instead of
  snapping, with a fading snapshot of the previous chart behind them.
- Live mode (`?live=1`) that swaps in newly published snapshots without a reload.
- An optional agent-performance section built from local OpenCode turn timing.
- A self-contained offline copy you can hand to someone else.

## How it works

The dashboard is plain HTML/CSS/JS with no build step. It reads usage JSON
client-side and uploads nothing. Because it uses ES modules, browsers block it on
`file://`, so serve the folder with the included dependency-free server.

Data stays local under `data/`:

- `refresh` collects usage, validates it, and atomically publishes an immutable
  snapshot plus the `data/latest.json` pointer. Raw exports and snapshots are never
  overwritten.
- Codex and Claude come from the pinned [`ccusage`](https://www.npmjs.com/package/ccusage)
  tool. `refresh opencode` reads a local opencode server when one is reachable and
  falls back to `opencode.db` when it is not (or when `--db` is given); per-session
  caches keep repeat runs incremental.
- `serve` serves the folder on loopback. `?live=1` polls the pointer every 30
  seconds and swaps in a new snapshot when one is published.

## Setup

Node.js 18 or newer is required (the scripts use native `fetch` and the built-in
test runner).

```bash
npm install     # or: bun install
```

The OpenCode database paths (`refresh opencode --db`, the performance export) also
need the `sqlite3` command-line tool on `PATH`.

## Refresh

The provider is a required first argument: `codex`, `claude`, `opencode`, or
`combined`.

```bash
bun run refresh codex
bun run refresh claude
bun run refresh opencode
bun run refresh combined   # every provider, one source each
```

`combined` runs all three and publishes a single snapshot with a source per
provider, skipping any provider that returns no usage or is not installed, so the
dashboard shows Codex, Claude, and OpenCode side by side with a combined total.
Without `--db` it needs a reachable opencode server (or a local `opencode` binary
to start one); pass the OpenCode `--db <path>` option to read the database instead.

Flags (they combine freely; the default updates the data once and exits):

| Flag | Effect |
| --- | --- |
| `--watch` | Keep refreshing on an interval |
| `--serve` | Update, then serve the dashboard on loopback |
| `--interval <s>` | Refresh interval for `--watch` (default 60) |
| `--port <n>` | Dashboard port for `--serve` (default 8765) |
| `--skip-unchanged` | Do not republish an identical snapshot |
| `--quiet` | Only print refresh results, not progress |

The OpenCode provider adds `--db <path>` (read `opencode.db` directly instead of
using the server), `--base-url <url>`, `--directory <path>`, and `--cache <path>`.

```bash
bun run refresh combined --serve            # refresh once, then serve
bun run refresh opencode --watch --serve    # live: http://127.0.0.1:8765/?live=1
```

A `--watch` cycle that finds no new usage prints `no changes` and publishes
nothing. Without `--db`, the OpenCode provider reuses a running
`opencode serve`, or starts a temporary one and stops it afterwards; an
unreachable API falls back to reading `opencode.db`.

`npm run refresh -- codex` is equivalent to `bun run refresh codex`. Running
`node scripts/refresh.js codex` directly also works, but only if `ccusage` is
already on your `PATH` (the package managers add `node_modules/.bin` for you).

To view already-refreshed data without refreshing, run `node serve.js` (or
`bun run start`).

## Agent performance

Every `refresh opencode` also writes `data/opencode-perf.json`, which drives the
dashboard's performance section: average turn time, p95, model time vs.
between-turn overhead, time to first token, tokens/second, context size, turns per
request, and latency by prompt size. The default window is 30 days.

To regenerate it on its own:

```bash
bun run export:opencode-perf                      # writes data/opencode-perf.json
bun run export:opencode-perf --days 7 --db ~/.local/share/opencode/opencode.db
```

## Load an export by hand

Any canonical ccusage export works:

```bash
npx ccusage codex daily --json --offline > aiusage.json
```

For OpenCode, use the bundled exporter. It reads the local opencode server and
falls back to `opencode.db` when the server is unreachable:

```bash
bun run export:opencode --output aiusage.json
```

It accepts `--base-url <url>`, `--directory <path>` (limit to one project), and
`--cache <path>` (reuse sessions that have not changed).

Then open the dashboard, choose **Add Your Usage** (or drop the file on the page),
and select the file. The browser validates it and keeps it only for the current
page session.

## Configuration

`data/usage-sources.json` points `refresh codex` and `refresh claude` at your
export. It needs a `personalUserId` matching the single entry in `users`, which
needs an `id`, `name`, and `file`; refresh rewrites that `file` after each run.

Two caches keep OpenCode refresh cheap: `data/opencode-cache.json` for the server
path and `data/opencode-db-cache.json` for `--db`. The server cache re-reads a
session whose `time.updated` moved; the database cache keys on a
message-count/latest-timestamp/sum signature. Delete a cache file to force a full
rebuild (the first run after deletion is the slow one).

The generated files under `data/` expose usage dates, totals, costs, and model
names — treat them as private and never commit or publish them.

## Schedule it (systemd)

Two user units keep it current: a static server and a daily refresh. Both run
from the checkout, and the refresh reads `opencode.db` directly, so it needs no
OpenCode server and no network. The dashboard also has a **Refresh data** button
that runs the same refresh on demand through `POST /api/refresh`.

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

Fill in the absolute `node` path (`command -v node`) and the checkout root. The
served dashboard's **Refresh data** button uses `serve.js`'s default database path
(`~/.local/share/opencode/opencode.db`); set `Environment=OPENCODE_DB=/path/to/opencode.db`
on the dashboard service to point it elsewhere. Disable with
`systemctl --user disable --now ai-usage-refresh.timer`.

The dashboard polls `data/latest.json` every 30 seconds, so an open page picks up
the nightly snapshot without a reload; the **Refresh data** button does an
immediate run and reloads the page. Snapshots older than 90 days are deleted by
the refresh service.

## Share an offline copy

```bash
bun run share:build     # requires the system "zip" binary
```

This writes `dist/ai-usage-dashboard/` and a ZIP from the snapshot `data/latest.json`
points to.
Recipients extract it and run the included `node serve.js` (ES modules cannot load
from `file://`); no install or internet needed. The package omits raw JSON but
embeds the same sensitive usage data, so share it deliberately.

## Development

```bash
bun run test    # or: npm test
```

- `index.html`, `dashboard.js` — browser shell, controls, and rendering.
- `dashboard-core.js` — validation and aggregation, imported by the browser, the
  scripts, and the tests.
- `scripts/refresh.js` — the `bun run refresh [provider]` entry point.
- `scripts/refresh-ccusage.js` — `codex`/`claude` refresh and snapshot publication.
- `scripts/refresh-opencode.js`, `scripts/export-opencode.js` — OpenCode collection
  (server with database fallback) and one-shot export.
- `scripts/refresh-combined.js` — runs every provider and publishes one
  source-per-provider snapshot.
- `scripts/export-opencode-perf.js` — the standalone turn-latency report.
- `scripts/snapshot.js` — atomic write and snapshot serialization helpers.
- `scripts/build-share.js` — offline folder and ZIP creation; `serve.js` — loopback
  static server and the refresh endpoint.
- `tests/` — Node's built-in test runner; `vendor/` — pinned Chart.js and notices.

Everything is ESM (`"type": "module"`); the browser loads `dashboard.js` as a
module.
