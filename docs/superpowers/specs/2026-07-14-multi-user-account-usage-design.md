# Multi-User Account Usage Design

## Goal

Show the two supplied ccusage exports as `Myself` and `Marius`, while retaining an account-total view that exactly sums their tokens and estimated costs.

## Data model

`usage-sources.json` will be the editable source manifest. It declares ordered user IDs, display names, and export filenames. The snapshot generator will validate every export independently and emit a browser-safe bundle containing the named raw exports.

`dashboard-core.js` will add a multi-user builder. It will reuse the existing single-export validation and aggregation for each person, then produce an `account` dashboard model. Account daily rows are grouped by date and add every token field and cost. Thus overlapping dates are added, not discarded. `recordedDays` counts distinct account calendar days; user-level active days remain unchanged. Account model totals merge the already-aggregated person models so fallback occurrences remain user-day counts rather than being collapsed into one boolean per shared date.

## Interface

The summary and existing detailed charts default to **Account total**. A user-detail selector switches those sections between Account total, Myself, and Marius. Above them, a full-width comparison chart always shows the separate token series for both users, with an account-total line. Its data disclosure lists each person’s cost, tokens, and active days. The shared daily/weekly control changes the comparison cadence too.

Loading a JSON file remains a single-export, session-only replacement. It renders as one named detail and does not alter the bundled multi-user account view after a reload.

## Safety and verification

The generator must leave the previous snapshot untouched if the manifest, a source, or an export is invalid. The share builder must use the manifest so the ZIP embeds the same multi-user bundle. Tests will cover date-overlap addition, model/fallback reconciliation, manifest validation and atomic failure preservation, plus packaged snapshot fidelity. Documentation will explain refreshing both exports and the fact that the archive exposes both users’ usage data.
