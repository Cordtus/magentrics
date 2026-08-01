# Model and Monthly Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-only Models and Monthly usage sections with clear, full-width charts while retaining exact data tables.

**Architecture:** Add a pure null-gap monthly presentation series to the core dashboard model. Render a Chart.js mixed monthly chart and horizontal model bar chart through the existing chart lifecycle and fallback system, then move both tables into accessible disclosures.

**Tech Stack:** HTML, CSS, browser JavaScript, Chart.js 4.4.7, chartjs-adapter-date-fns 3.0.0, Node.js test runner

---

### Task 1: Add source-aware monthly chart data

**Files:**

- Modify: `tests/dashboard-core.test.js`
- Modify: `dashboard-core.js`

- [x] Write a failing assertion that `monthlyTimeline` includes a null-valued March row between February and April while `monthly` remains source-only.
- [x] Run `node --test tests/dashboard-core.test.js` and confirm the assertion fails because `monthlyTimeline` is missing.
- [x] Add a pure calendar-month iterator that maps source-backed summaries to chart rows and inserts null metrics for missing months.
- [x] Run the focused test and full core suite; confirm both pass.

### Task 2: Add full-width chart structure

**Files:**

- Modify: `index.html`

- [x] Remove the two-column detail grid and its obsolete responsive CSS.
- [x] Add full-width model and monthly chart frames, canvases, accessible descriptions, and specific fallback messages.
- [x] Wrap the existing model and monthly tables in `View data` disclosures.
- [x] Add model-specific frame sizing that remains usable at mobile widths.
- [x] Run `xmllint --html --noout index.html` and confirm no markup errors.

### Task 3: Render monthly and model charts

**Files:**

- Modify: `dashboard.js`

- [x] Add both canvases and fallbacks to the element registry.
- [x] Implement the monthly mixed chart using null-gap rows, monthly time ticks, token bars, a cost line, dual axes, and month/cost/token/day tooltips.
- [x] Implement the horizontal model chart using the sorted model summaries, a linear token axis, and detailed usage/fallback tooltips.
- [x] Add both renderers to the existing dashboard lifecycle so replacement JSON redraws them and chart failures retain tables.
- [x] Run syntax checks and the full Node test suite.

### Task 4: Verify and package

**Files:**

- Modify: `index.html`
- Create: `vendor/chart.umd.min.js`
- Create: `vendor/chartjs-adapter-date-fns.bundle.min.js`
- Create: `vendor/THIRD_PARTY_LICENSES.md`
- Create: `serve.mjs`
- Create: `scripts/build-share.mjs`
- Create: `tests/build-share.test.js`
- Create: `tests/serve.test.js`
- Modify: `README.md`

- [x] Vendor the pinned browser scripts and switch `index.html` from CDN to local paths.
- [x] Write failing package and server integration tests from the approved packaging contract.
- [x] Implement the loopback static server and atomic package builder.
- [x] Update repository and recipient documentation.
- [x] Build `dist/codex-usage-dashboard/` and `dist/codex-usage-dashboard.zip`.
- [x] Verify exact archive contents, offline script references, server HTTP behavior, JavaScript syntax, HTML parsing, snapshot equality, and the complete test suite.
- [x] Print and report the final ZIP path, size, and SHA-256 digest.
