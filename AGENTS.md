# Repository Guidelines

## Project Structure & Module Organization

This is a dependency-free static dashboard for the JSON emitted by `ccusage codex daily --json`. Keep the browser shell in `index.html`, UI/chart behavior in `dashboard.js`, and data validation and aggregation in `dashboard-core.js`. `usage-data.js` is the generated browser snapshot; its source is `codex-usage.json`.

Use `scripts/generate-data.mjs` to validate and atomically regenerate the snapshot, and `scripts/build-share.mjs` to create the offline payload under `dist/`. Keep pinned browser dependencies and their notices in `vendor/`. Tests live in `tests/`; `dist/codex-usage-dashboard/` and its ZIP are generated artifacts, not a second source tree.

## Build, Test, and Development Commands

- `node serve.mjs` serves the dashboard on a loopback URL when direct `file://` loading is restricted.
- `node scripts/generate-data.mjs` validates `codex-usage.json` and refreshes `usage-data.js`.
- `node scripts/build-share.mjs` regenerates the snapshot and builds the self-contained folder and ZIP in `dist/`.
- `node --test tests/*.test.js` runs the complete Node built-in test suite. No package installation or build framework is required.

## Coding Style & Naming Conventions

Follow the surrounding file rather than applying a global formatter: `dashboard-core.js` and its tests use tabs, while `.mjs` scripts use two spaces. Use `camelCase` for functions and variables, PascalCase only for constructors, and lower-case kebab-free filenames such as `build-share.mjs`. Keep `dashboard-core.js` compatible with both the browser and CommonJS; use ESM only in `.mjs` scripts. Preserve validation before rendering or writing data, and avoid mutating parsed exports.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Add focused, behavior-based tests beside the affected area—for example, aggregation edge cases in `tests/dashboard-core.test.js` and filesystem/package failures in the generator or share-package tests. Test malformed input, reconciliation rules, and failure preservation whenever changing data or archive handling. Run the complete suite before handing off changes.

## Commit, Pull Request, and Data Safety

This checkout has no usable Git history, so no existing commit convention can be inferred. In the canonical repository, use concise imperative subjects (for example, `Validate share-package manifest`) and keep each commit scoped. Pull requests should describe visible dashboard or packaging changes, list test commands run, and include screenshots for UI changes.

Treat `codex-usage.json`, `usage-data.js`, and generated archives as potentially sensitive: they expose usage dates, totals, costs, and model names. Do not publish or attach them without the owner's approval.
