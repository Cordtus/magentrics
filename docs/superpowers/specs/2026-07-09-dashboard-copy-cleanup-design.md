# Dashboard Copy Cleanup Design

## Context

The dashboard is visually complete, but several headings and helper sentences read like implementation notes. Phrases about calendar spacing, validated datasets, generated snapshots, and recorded rows expose internal mechanics without helping someone understand their usage.

This cleanup happens before the offline share package is built so the repository dashboard and packaged dashboard use the same finished interface copy.

## Direction

Use concise, utility-first language. Headings should say what the user is looking at. Supporting text should appear only when it prevents a likely misunderstanding or tells the user what to do next.

Keep technical details in the README unless they are needed to interpret a value on the page.

## Visible copy

### Header and data state

- Keep the page title `Codex Usage` and remove the redundant `Local usage report` eyebrow.
- Identify the default source as `Bundled data` and a loaded file by its filename.
- Show the date range followed by `Updated <date>`.
- Use `Loading data`, `No usage data`, and `Load or drop a ccusage Codex JSON file.` for startup and empty states.
- Keep the primary action `Load JSON`; use `Reading JSON` while a file is being processed.

### Summary metrics

- Use `Estimated cost`, `Total tokens`, `Output tokens`, `Reasoning tokens`, `Cache-read tokens`, and `Active days`.
- Shorten notes to `Estimated by ccusage`, `<value> input`, `Reasoning included`, `<percentage> of output`, `<percentage> of total`, and the date range.

### Sections

- `Usage over time`: cost and tokens with the existing daily/weekly control. No visible description.
- `Token usage`: token categories with the existing log/linear control. Retain only `Reasoning is included in output.`
- `Models`: token use by model. Retain only `Fallbacks count days, not requests.`
- `Monthly usage`: the existing monthly table. No visible description.
- `Cumulative usage`: running cost and token totals. No visible description.

Remove the section kickers because they duplicate the headings.

### Supporting states

- Use `Chart unavailable. Data tables are still available.` for the shared chart status.
- Use section-specific fallbacks: `Usage chart unavailable.`, `Token chart unavailable.`, and `Cumulative chart unavailable.`
- Use `View data` for each chart's disclosure because its section heading supplies the context.
- Use `Drop JSON to load` in the drag overlay with no secondary sentence.
- Use `JavaScript is required to view this dashboard.` for the no-script state.
- Use `No model data.` and `No monthly data.` for empty table rows.

## Errors

Errors should name the problem and the next action without validation jargon.

- Preserve the last working view after a failed replacement file and say `Your current data is unchanged.`
- When no data is active, say `Load or drop a ccusage Codex JSON file.`
- Use filenames where useful, such as `Could not load <filename>`.
- Keep missing-script errors specific enough to diagnose a broken shared folder, but describe the user impact in plain language.

## Accessibility copy

Visually hidden chart descriptions, captions, control labels, and region labels remain. They should identify the content directly and avoid boilerplate such as `The complete values are available in the following...`.

The three `View data` disclosures remain associated with their surrounding labelled sections, and each table retains a specific accessible caption and region label.

## Scope

Only user-facing text in `index.html` and `dashboard.js` changes. Data validation, calculations, chart behavior, file loading, and layout remain unchanged. The repository README keeps the detailed data semantics that are intentionally removed from the interface.

## Verification

- Add behavior-focused assertions for the stable visible copy and dynamic source/error text.
- Confirm removed implementation-language phrases no longer appear in the runtime files.
- Run the complete Node test suite and JavaScript syntax checks.
- Open the dashboard at desktop and mobile widths to confirm that removing kickers and descriptions does not leave awkward spacing.

## Acceptance criteria

- Every visible heading and helper message is concise and natural.
- No interface text refers to recorded rows, calendar spacing, generated snapshots, validated datasets, or internal validation mechanics.
- Necessary semantics for reasoning tokens and fallback counts remain visible.
- Loading, empty, drop, chart-failure, and file-error states state the outcome or next action clearly.
- Existing dashboard behavior and accessibility relationships are preserved.
