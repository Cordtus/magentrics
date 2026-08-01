# Multi-User Account Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display separate Myself and Marius usage alongside correctly reconciled account totals in the local and shareable dashboard.

**Architecture:** Introduce an explicit source manifest and browser snapshot bundle. Build each user with the existing validator, then derive an account model by summing date-keyed periods and pre-aggregated model summaries. Render a permanent comparison chart plus selector-driven detail views.

**Tech Stack:** Browser JavaScript, Node.js ESM/CommonJS, `node:test`, Chart.js.

---

### Task 1: Define and test the multi-user aggregation boundary

**Files:**
- Create: `usage-sources.json`
- Modify: `dashboard-core.js`
- Test: `tests/dashboard-core.test.js`

- [ ] Add a failing test with two valid exports sharing one date. Assert `account.summary.totalTokens` and `costUSD` are sums, `recordedDays` is the date-union count, and `users` preserve ordered IDs/names.
- [ ] Add a failing test where the same model has different fallback states across users. Assert account model `fallbackOccurrences` is the sum of user model-days.
- [ ] Implement `buildMultiUserDashboardData(sources)` using `buildDashboardData` per source, date-keyed metric addition for account daily rows, and model-summary merging.
- [ ] Run `node --test tests/dashboard-core.test.js`; expect all core tests to pass.

### Task 2: Generate and package the named bundle

**Files:**
- Modify: `scripts/generate-data.mjs`
- Modify: `scripts/build-share.mjs`
- Test: `tests/generate-data.test.js`
- Test: `tests/build-share.test.js`

- [ ] Add a failing generator test for a manifest containing two exports. Evaluate the generated script and assert it contains the ordered named source bundle, not a flattened export.
- [ ] Add a failure-preservation test for a missing manifest source. Assert the prior `usage-data.js` remains byte-for-byte unchanged.
- [ ] Implement manifest parsing, path resolution relative to the manifest, per-source validation, and atomic snapshot serialization. Make the share builder call the manifest generator.
- [ ] Update package tests to create `usage-sources.json`, two exports, and assert the packaged snapshot retains both named users.
- [ ] Run `node --test tests/generate-data.test.js tests/build-share.test.js`; expect all tests to pass.

### Task 3: Render account and per-user visualizations

**Files:**
- Modify: `index.html`
- Modify: `dashboard.js`

- [ ] Add the user-detail selector, user-comparison canvas, fallback, and accessible data table to the dashboard shell.
- [ ] Add client state for the multi-user bundle and selected detail model. Default detail selection to Account total; selected standalone JSON remains one-detail mode.
- [ ] Render comparison lines for Myself, Marius, and Account total at daily or weekly cadence. Render the existing summary, models, tables, and charts from the selected detail model.
- [ ] Run `node --check dashboard.js` and `node --check dashboard-core.js`; expect zero syntax errors.

### Task 4: Document and verify the refreshed dashboard

**Files:**
- Modify: `README.md`
- Modify: `usage-data.js`
- Modify: `dist/codex-usage-dashboard/`
- Modify: `dist/codex-usage-dashboard.zip`

- [ ] Document `usage-sources.json`, both refresh commands, account-date semantics, selector/comparison behavior, and combined-data privacy.
- [ ] Run `node scripts/generate-data.mjs` and `node scripts/build-share.mjs` to refresh the checked-in snapshot and recipient package.
- [ ] Run `node --test tests/*.test.js`, `node --check dashboard.js`, and `node --check dashboard-core.js`; expect all tests and syntax checks to pass.
- [ ] Inspect `dist/codex-usage-dashboard/usage-data.js` in a VM, verify its account total is 59,697,073,118 tokens and 33,299.8919553 USD, and ensure no external script URLs exist in packaged HTML.
