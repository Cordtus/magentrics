# Codex Usage Dashboard Implementation Plan

## Task statement

Replace the stale embedded Claude/GitHub dashboard with a directly openable Codex usage dashboard driven by the current ccusage JSON, a generated browser snapshot, and optional file selection or drag-and-drop.

## Product direction

- Visual thesis: a dark, precise instrument panel with quiet ruled sections, high-contrast numerals, and one cool cyan accent.
- Content plan: source/status header, KPI strip, primary usage timeline, token and model detail, monthly summary, cumulative trend, then concise operating guidance in the repository README.
- Interaction thesis: a fast staged page entrance, responsive chart transitions on aggregation changes, and a clear full-page drop state with subtle row/control feedback. Reduced-motion preferences disable nonessential motion.

## Testing basis and risk

- Basis and oracle: the approved design and the observed `npx ccusage codex daily -j` contract in `codex-usage.json`.
- Core risks: double-counting reasoning output, treating sparse dates as zero, losing model/fallback data, accepting inconsistent totals, overwriting a valid generated snapshot after a failed refresh, and blanking the current UI after a bad selected file.
- Test layers: Node unit tests for pure validation and aggregation; Node integration tests for generator filesystem behavior; browser smoke checks for the assembled `file://` workflow.

## Steps

1. Build `dashboard-core.js` as a classic-browser/CommonJS-compatible pure module.
   - Validate required top-level, daily, and per-model fields.
   - Reject invalid dates, duplicates, negative/non-finite values, reasoning greater than output, token identity failures, model/day reconciliation failures, and top-level reconciliation failures.
   - Ignore unknown extra fields.
   - Normalize rows without mutating the input.
   - Produce summary, daily, Monday-based weekly, monthly, model, cumulative, and series-visibility data.

2. Add `tests/dashboard-core.test.js` using `node:test`.
   - Cover canonical aggregation, sparse dates, reasoning semantics, model ordering, fallback occurrences, zero-only series, extra fields, and representative invalid contracts.
   - Keep expected values explicit and independent of the production algorithm.

3. Build `scripts/generate-data.mjs` and `tests/generate-data.test.js`.
   - Accept optional input/output paths for isolated integration testing and default to the repository JSON/snapshot paths.
   - Validate before writing.
   - Write a safe classic-script assignment atomically.
   - Prove valid generation and failure preservation with temporary directories.

4. Generate `usage-data.js` from the current `codex-usage.json`.

5. Rebuild `index.html` as the static dashboard shell.
   - Use semantic controls and status/error regions.
   - Associate every canvas with a description and collapsible exact-value table.
   - Use a cardless KPI strip and restrained ruled sections.
   - Preserve Chart.js and its date adapter as CDN dependencies.
   - Load generated data and local classic scripts in deterministic order.

6. Build `dashboard.js` as the browser controller.
   - Validate and stage data before replacing current state.
   - Render summaries and tables independently of Chart.js.
   - Render/destroy timeline, composition, and cumulative charts safely.
   - Implement daily/weekly and log/linear controls.
   - Implement file selection, drag-and-drop, source status, and recoverable errors.
   - Preserve the last valid display after bad selected data.

7. Add `README.md`.
   - Document direct opening, CDN/network behavior, snapshot regeneration, ad hoc JSON loading, and test commands.

8. Verify and review.
   - Run the focused core test, generator test, full Node suite, and generator against the real JSON.
   - Audit for skipped/focused tests, debug output, placeholders, and accidental secrets.
   - Open the dashboard through `file://`, exercise the critical interactions and invalid-data path, and inspect desktop/mobile layouts.
   - Request an independent code/design review, address findings, and rerun relevant checks.
