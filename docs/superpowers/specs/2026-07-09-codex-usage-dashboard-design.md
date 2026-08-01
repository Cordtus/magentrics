# Codex Usage Dashboard Design

## Context

The current `index.html` is a self-contained April 2026 report that embeds Claude Code usage and GitHub contribution data. It does not read `codex-usage.json`.

The current JSON was generated with:

```bash
npx ccusage codex daily -j > codex-usage.json
```

It contains 103 recorded daily Codex usage entries from 2025-11-17 through 2026-07-09, aggregate totals, and per-model token details. It does not contain GitHub contribution data or per-model costs. The dashboard will therefore become a Codex-only usage dashboard rather than preserving the old GitHub comparison.

## Goals

- Display the current ccusage Codex JSON accurately.
- Keep `index.html` directly openable through `file://`.
- Load a generated default snapshot without prompting.
- Allow a user to select or drag in a fresh or alternate ccusage JSON file without regenerating the snapshot.
- Keep data transformation independent from DOM and chart rendering.
- Make refresh and verification commands explicit and repeatable.

## Non-goals

- Reconstruct or refresh GitHub contribution metrics.
- Invent per-model costs that are absent from the source JSON.
- Add a framework, bundler, server, database, or live file watcher.
- Treat missing calendar dates as confirmed zero-usage days.
- Vendor Chart.js or make chart rendering work without network access.

## Architecture

The dashboard will remain a small static application built from classic browser scripts so it works when opened directly from disk.

### `index.html`

Owns the document structure, dashboard styling, loading and error regions, file input, drop affordance, chart canvases, tables, and classic script tags. It retains the existing Chart.js and date adapter CDN dependencies.

### `usage-data.js`

A generated browser-loadable snapshot derived from `codex-usage.json`. It assigns the raw ccusage object to a stable browser global consumed by the dashboard. It contains data only and is never hand-edited.

### `dashboard-core.js`

Owns pure behavior:

- validating the required ccusage shape;
- normalizing and sorting recorded daily rows;
- detecting duplicate dates and invalid metric values;
- reconciling daily and top-level totals;
- aggregating recorded rows by week and month;
- aggregating model usage and fallback occurrences;
- producing cumulative series; and
- deriving summary values and chart-ready structures.

It exposes the same API to a classic browser script and Node tests. It has no DOM or Chart.js dependency.

### `dashboard.js`

Owns browser behavior:

- loading the generated snapshot on startup;
- rendering summary metrics and tables;
- creating, replacing, and destroying Chart.js instances;
- handling daily/weekly and log/linear toggles;
- handling JSON file selection and drag-and-drop;
- reporting the active source and date range; and
- showing recoverable errors without discarding the currently rendered data.

### `scripts/generate-data.mjs`

Reads `codex-usage.json`, validates it with the same core contract, and writes `usage-data.js` atomically. A failed read or validation exits nonzero and leaves the previous generated snapshot intact.

### Tests and documentation

`tests/dashboard-core.test.js` uses Node's built-in test runner for behavior-level checks. `README.md` documents direct opening, data loading, refresh commands, tests, and the Chart.js network requirement.

## Data flow

On page load:

1. The generated snapshot assigns the default raw data to a browser global.
2. `dashboard.js` passes that object through `dashboard-core.js` validation and normalization.
3. The core returns one normalized dashboard model containing summaries, recorded daily rows, weekly and monthly aggregates, model aggregates, and cumulative series.
4. The browser layer renders that model and labels the source as the generated snapshot.

On file selection or drop:

1. The browser reads the selected file as text and parses it as JSON.
2. The parsed object follows the same validation and normalization path as the generated snapshot.
3. A valid file replaces the rendered dataset in memory and updates the source label to the selected filename.
4. An invalid file shows an actionable error and leaves the prior dataset and charts intact.

Selected files are not persisted. Reloading the page returns to the generated snapshot.

## Data semantics

- `costUSD` is labelled as estimated cost because ccusage derives it from model pricing.
- `totalTokens` is used as supplied and reconciled against input, output, cache creation, and cache read tokens.
- `reasoningOutputTokens` is a subset of output tokens. It is displayed separately but never added to `totalTokens` or stacked as an additional token category.
- Missing calendar dates remain missing. Lines may span the time axis, but aggregations count only recorded rows and the UI calls them recorded or active days.
- `cacheCreationTokens` remains supported but its chart series is hidden when every value in the active dataset is zero.
- Cache-read share is `cacheReadTokens / totalTokens` for the relevant summary or period.
- `isFallback` is treated as a model-day occurrence flag, not as a request count.
- Per-model views show tokens and recorded days only because the JSON does not provide per-model costs.
- Floating-point costs are rounded only for display. Calculations preserve the source values.

## Dashboard content

The existing dark visual language remains, with less panel chrome and a clearer operational hierarchy.

### Header and source status

- Product title: `Codex Usage`.
- Recorded date range and latest record.
- Active source: generated snapshot or selected filename.
- `Load JSON` action.
- Whole-page drag-and-drop feedback.

### Summary strip

- Estimated cost.
- Total tokens.
- Output tokens.
- Reasoning tokens.
- Cache-read tokens and share.
- Recorded active days.

### Usage timeline

The primary chart combines estimated-cost bars and a total-token line on separate axes. A daily/weekly toggle changes aggregation without changing the source dataset. Missing dates remain visible as unrecorded gaps.

### Token composition

The token chart supports input, output, reasoning, cache read, and cache creation. It provides log and linear scale controls. Labels and tooltips state that reasoning is included within output.

### Model usage

The model view lists total tokens, output tokens, reasoning tokens, recorded active days, and fallback occurrences for each model. Models sort by total tokens descending.

### Monthly and cumulative views

The monthly table reports estimated cost, total tokens, output tokens, reasoning tokens, cache share, and recorded active days. A cumulative chart tracks estimated cost and total tokens across recorded dates.

Each chart is associated with a concise text description and followed by a collapsed, keyboard-accessible exact-value table. The timeline table follows the active daily or weekly aggregation so chart data remains inspectable without relying on canvas pixels.

### Responsive behavior

Desktop uses a dense readable workspace with paired secondary views where space allows. Narrow screens stack all regions, keep tables horizontally scrollable, preserve legible controls, and avoid fixed viewport assumptions.

## Error handling

The validator rejects:

- malformed JSON;
- missing top-level `daily` or `totals` values;
- missing required daily or model metrics;
- invalid or duplicate dates;
- non-finite or negative numeric metrics;
- reasoning output greater than output tokens;
- daily token metrics that do not reconcile with their model entries; and
- top-level totals that do not reconcile with daily rows.

Unknown extra fields are ignored. Validation errors identify the affected row, model, or total where practical.

The dashboard keeps the last successfully rendered dataset when a selected file fails. If the generated snapshot is unavailable or invalid at initial load, the page presents the load/drop controls and an error rather than leaving a blank screen.

If Chart.js or its date adapter is unavailable, summary metrics and tables still render. Chart regions show a concise dependency warning instead of crashing the rest of the page.

## Refresh workflow

Refresh the raw Codex export, then regenerate the default browser snapshot:

```bash
npx ccusage@latest codex daily -j > codex-usage.json
node scripts/generate-data.mjs
```

After those commands, opening or reloading `index.html` shows the regenerated snapshot. A user who only wants to inspect a new export can instead open the dashboard and select or drop the JSON file.

## Testing strategy

The test basis is the observed ccusage JSON contract and the dashboard behavior approved in this design.

### Core unit tests

Using compact deterministic fixtures, verify:

- a valid export normalizes successfully;
- summary totals and cache share are correct;
- weekly and monthly aggregation preserve recorded-day counts;
- sparse dates are not zero-filled;
- reasoning tokens are exposed but not double-counted;
- model totals and ordering are correct;
- fallback flags count model-day occurrences;
- zero-only token series are marked hidden;
- malformed and inconsistent data produces diagnostic errors; and
- extra fields do not break validation.

### Generator integration tests

Using temporary directories and files, verify:

- valid JSON produces a browser-loadable snapshot containing the same data;
- malformed or inconsistent JSON exits unsuccessfully; and
- failure does not replace an existing generated snapshot.

### Browser verification

Verify the assembled dashboard by:

- opening `index.html` directly through `file://`;
- confirming the generated snapshot renders;
- loading the same JSON through the picker;
- loading it through drag-and-drop;
- confirming an invalid file preserves the prior dashboard;
- exercising daily/weekly and log/linear toggles;
- expanding the timeline, composition, and cumulative data tables;
- checking the no-Chart.js fallback; and
- inspecting representative desktop and mobile viewport layouts.

## Acceptance criteria

- Directly opening `index.html` renders the generated `codex-usage.json` snapshot without a file prompt.
- Selecting or dropping a valid ccusage Codex daily export replaces the displayed dataset for the current page session.
- All displayed cost, token, date, and model metrics derive from the active JSON and respect the documented semantics.
- No GitHub-specific labels, charts, or calculations remain.
- Invalid data cannot replace the last valid dashboard state or corrupt the generated snapshot.
- The documented refresh commands, behavior tests, and browser checks pass.
