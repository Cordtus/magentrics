# Model and Monthly Visualizations Design

## Context

The Models and Monthly usage sections currently present only raw tables. The exact values are useful, but the tables make comparative patterns slow to read. The redesign adds visual summaries while keeping the tables available for detail and accessibility.

## Chosen approach

Use the approved full-width trend-and-ranking design:

- Monthly usage becomes a combination chart with total-token bars and an estimated-cost line.
- Models becomes a horizontal bar chart ranked by total tokens.
- Each existing table moves into a collapsed `View data` disclosure below its chart.

Position and length provide more accurate comparison than treemaps, donut charts, or heatmap intensity. Cards were rejected because they make individual values readable but weaken trend and proportion comparisons.

## Layout

Both sections use the dashboard's full content width. Models no longer shares a two-column row with Token usage because ten horizontal categories need enough width for model names, bars, and scale labels.

The page order remains:

1. summary metrics;
2. usage over time;
3. token usage;
4. models;
5. monthly usage; and
6. cumulative usage.

## Monthly chart

The monthly chart uses:

- a time axis at monthly resolution;
- total tokens as teal bars on the left token axis;
- estimated cost as an amber line on the right currency axis;
- tooltips with the month, exact token total, estimated cost, and active days; and
- a full-width responsive chart frame.

Calendar months missing from the export appear as null presentation rows. This creates a visible gap without treating the month as zero usage. The exact monthly table continues to include only source-backed months.

## Model chart

The model chart uses:

- horizontal bars sorted by total tokens, matching the existing model summary order;
- a linear token scale so bar lengths honestly represent each model's share;
- full model names on the category axis;
- tooltips with total tokens, output tokens, reasoning tokens, active days, and fallback days; and
- a small amber fallback marker in the tooltip when applicable.

Small models may have very short bars because the top two models dominate the dataset. This is intentional and more truthful than a logarithmic bar length. The exact table remains available for close comparison.

## Data model

`dashboard-core.js` adds `monthlyTimeline`, derived from the validated monthly summaries. It spans the first through last source-backed month and inserts null-valued placeholder rows only for missing calendar months. Existing `monthly` data and all totals remain unchanged.

This derived series is pure, deterministic, and covered by a unit test that proves a missing month becomes a null gap rather than a zero-value record.

## Failure and accessibility behavior

Each new chart has a specific fallback message. If Chart.js is unavailable, the corresponding `View data` table remains usable and the shared chart status appears.

Canvases retain direct accessible labels and descriptions. The data tables retain captions, column headings, and keyboard-scrollable regions. The disclosures are labelled by their surrounding section context.

## Responsive behavior

Charts use responsive Chart.js canvases and fixed minimum frame heights. Model height scales to accommodate all model rows. At narrow widths, full-width sections avoid crushed labels; chart and table content remain inside the existing page gutter.

## Testing and verification

- Add a core unit test for missing-month gap insertion before implementing `monthlyTimeline`.
- Run the full Node test suite and syntax checks.
- Verify all five charts render with the bundled dataset.
- Verify model and monthly tooltips, table disclosures, chart fallbacks, and file replacement data.
- Inspect desktop and mobile layouts for clipping and horizontal overflow.

## Acceptance criteria

- Monthly usage clearly shows token and cost trends across calendar months.
- Missing months render as gaps, not zero usage.
- Models clearly shows relative token use in descending order.
- Exact model and monthly tables remain available under `View data`.
- Chart failure never hides the exact values.
- The completed visualizations work in the offline share package.
