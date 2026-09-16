# Repository Guidelines

## Project Structure & Module Organization

Dependency-free static dashboard for the JSON emitted by `ccusage codex daily --json`. Keep the browser shell in `index.html`, UI/chart behavior in `dashboard.js`, and validation/aggregation in `dashboard-core.js`. `dashboard-core.js` must stay compatible with both the browser and CommonJS; use ESM only in `.mjs` scripts. Tests live in `tests/`; `dist/` and `vendor/` are generated/pinned artifacts.

The dashboard loads `data/latest.js`, a loader that points at the newest snapshot in `data/snapshots/`. Bundled data lives only under `data/`: the committed `data/usage-sources.json` manifest, immutable timestamped exports in `data/raw/`, immutable browser snapshots in `data/snapshots/`, and generated `data/latest.json`/`data/latest.js` pointers. Every refresh also writes `data/latest-data.json`, the raw multi-user bundle that the dashboard's opt-in `?live=1` mode polls. Root-level `usage-data.js` and `codex-usage*.json` are gitignored leftovers of the old single-file flow — do not regenerate or depend on them (only `build-share` synthesizes `usage-data.js` inside the package).

## Build, Test, and Development Commands

- `bun install` installs the project-pinned `ccusage` devDependency (via `bun.lock`). Node runs everything else; `bun run` just wraps the Node scripts in `package.json`.
- `bun run refresh [codex|claude|opencode]` (→ `node scripts/refresh.mjs`) is the single refresh entry point; the first positional argument is the required provider (`codex`, `claude`, or `opencode`); omitting it fails with the choices and an example. `scripts/refresh.mjs` dispatches to `refresh-data.mjs` for `codex`/`claude` (runs `ccusage <provider> daily --json`, validates it, archives the raw export, publishes a snapshot, and advances the `data/latest.*` pointers atomically) and to `refresh-opencode.mjs` for `opencode`. Modes are flags: `--watch` re-runs the refresh every `--interval <seconds>` (default 60, overlapping runs are skipped) and `--serve` starts the loopback dashboard (`--port <n>`, default 8765) after the first refresh; combine them, or omit both to update data once and exit. Ctrl-C/SIGTERM clears the timer and closes the server, letting any in-flight refresh finish before the process exits. The ccusage paths must run via `bun run` so `node_modules/.bin/ccusage` is on PATH; running with plain `node` fails on a missing `ccusage`.
- `bun run fetch:opencode` (→ `node scripts/fetch-opencode.mjs`) fetches assistant-message usage from the opencode server API (`opencode serve`, default port 4096, `--base-url`/`OPENCODE_BASE_URL` to override) and emits the ccusage `{ daily, totals }` shape on stdout. A bare run aggregates every registered project plus the server's current project (a bare run scoped only to the current project looks empty — that's the #1 gotcha); `--directory` scopes to one project; `--cache <path>` reuses per-session results whose `time.updated` is unchanged; `--output` writes atomically. OpenCode folds `reasoning` into `outputTokens` and keeps `tokens.total` as input + output + cache read/write — the mapping in `aggregateMessages` preserves both, which keeps the export dashboardCore-valid.
- `bun run refresh opencode` (→ `refresh-opencode.mjs` via `refresh.mjs`) is the persistent path for a multi-agent project: it fetches incrementally (cache defaults to `data/opencode-cache.json`), splits usage by `info.agent`, publishes one dashboard user per agent via `publishSnapshot`, and writes `data/latest.json`/`latest.js` plus `data/latest-data.json` (the browser bundle `?live=1` polls). It owns the server lifecycle: `withOpenCodeServer` probes the target, reuses an already-running server, or spawns a temporary `opencode serve` (loopback only) and stops it when done. Schedule it with a systemd user service + timer (see README); `fetchOpenCodeUsage` only re-reads sessions whose `time.updated` moved, so idle cost stays near zero.
- `bun run fetch:opencode` is the one-shot export printer (no snapshot/publish). `bun run start` serves the dashboard; `bun run start:opencode` runs the headless server.
- `bun run share:build` (→ `node scripts/build-share.mjs`) builds `dist/codex-usage-dashboard/` + ZIP from the snapshot `data/latest.json` points to. Requires the system `zip` binary and rewrites `data/latest.js` to `usage-data.js` in the package.
- `node --test tests/*.test.js` (or `bun run test`) runs the full suite — 7 files, no framework.
- `node serve.mjs [port]` serves loopback-only (127.0.0.1, default 8765) when `file://` loading is restricted.
- `node scripts/generate-data.mjs [input-json] [output-script]` is the legacy standalone snapshot path; its default args are the gitignored root files. `refresh-data.mjs` imports `serializeSnapshot` and `writeAtomically` from it.

## Refresh & Manifest Gotchas

- `data/usage-sources.json` requires a `personalUserId` that matches a user in `users`; each user needs `id`, `name`, and `file`. Refresh only fetches the personal user and rewrites that user's `file` to the new `data/raw/` path; add other users manually and drop their validated exports under `data/raw/`.
- Raw exports and snapshots are never overwritten — filenames get `-2`, `-3`, … suffixes when colliding.
- Never break the atomicity contract: a failed export or validation must leave the last successful dashboard selected. `writeAtomically` (temp file + rename) is the mechanism.

## Coding Style & Naming Conventions

Follow the surrounding file rather than a global formatter: `dashboard-core.js` and its tests use tabs; `.mjs` scripts use two spaces. `camelCase` for functions/variables, PascalCase only for constructors, lowercase filenames without kebab (`build-share.mjs`). Validate before rendering or writing data; never mutate parsed exports.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Add behavior-based tests beside the affected area — aggregation edge cases in `tests/dashboard-core.test.js`, filesystem/package failures in the generator, refresh, share, and serve tests. Test malformed input, reconciliation rules, and failure preservation whenever touching data or archive handling. Run the complete suite before handing off changes.

## Commits and Data Safety

Commit style is conventional commits (`feat:`, `chore:`, `docs:`) with lowercase, concise subjects — e.g. `feat: load and package the latest usage snapshot`. Keep commits scoped; PRs should describe visible dashboard or packaging changes, list test commands run, and include screenshots for UI changes.

Treat everything under `data/raw/`, `data/snapshots/`, `data/latest.*`, `codex-usage*.json`, `usage-data.js`, `usage-sources.json`, and `marius.json` as sensitive (usage dates, totals, costs, model names) — all gitignored, and never publish or attach them without the owner's approval.
