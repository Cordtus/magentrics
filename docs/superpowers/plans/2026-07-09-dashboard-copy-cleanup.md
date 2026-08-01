# Dashboard Copy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace verbose and implementation-focused dashboard language with concise, useful interface copy.

**Architecture:** Keep the current static HTML and browser controller unchanged structurally. Update static interface text in `index.html` and dynamic states in `dashboard.js`; preserve detailed data semantics in `README.md`.

**Tech Stack:** HTML, CSS, browser JavaScript, Node.js built-in test runner

---

## File map

- Modify `index.html`: headings, descriptions, empty/drop/fallback states, accessibility descriptions, and minor spacing rules left unused after copy removal.
- Modify `dashboard.js`: dynamic metadata, KPI notes, table empty states, chart status, and file-loading errors.
- Modify `docs/superpowers/specs/2026-07-09-offline-zip-packaging-design.md`: record that the package carries the cleaned interface.
- Verify `README.md`: retain detailed semantics there; no interface-copy duplication is needed.

Automated text-existence tests are intentionally excluded. The copy itself is the changing product output, so exact-string tests would duplicate the implementation and add no regression value. Existing behavior tests, syntax checks, a targeted forbidden-phrase audit, and assembled-page inspection provide the appropriate evidence.

### Task 1: Clean static interface copy

**Files:**

- Modify: `index.html`

- [x] **Step 1: Update header and empty states**

Remove the redundant eyebrow, simplify initial metadata, retain `Load JSON`, and replace the empty state with `No usage data` plus one actionable sentence.

- [x] **Step 2: Update dashboard sections**

Use the approved headings, remove duplicate kickers and unnecessary descriptions, retain only the reasoning and fallback semantics, and shorten chart fallback/disclosure text.

- [x] **Step 3: Update supporting and accessibility copy**

Simplify the drag overlay and no-script state. Keep hidden descriptions and captions specific while removing boilerplate.

- [x] **Step 4: Remove CSS made obsolete by deleted copy**

Search for eyebrow, kicker, and description selectors. Remove only rules no longer used by any remaining element.

### Task 2: Clean dynamic interface copy

**Files:**

- Modify: `dashboard.js`

- [x] **Step 1: Simplify summary and metadata labels**

Use `Active days`, shorter KPI notes, `Bundled data`, the selected filename, and `Updated <date>`.

- [x] **Step 2: Simplify chart and table states**

Replace technical Chart.js failure language and recorded-row empty messages with concise user-facing states.

- [x] **Step 3: Simplify errors without losing diagnostics**

Use plain-language retention and recovery instructions while retaining filenames and missing-script names needed to diagnose an incomplete folder.

### Task 3: Synchronize packaging intent

**Files:**

- Modify: `docs/superpowers/specs/2026-07-09-offline-zip-packaging-design.md`

- [x] **Step 1: Add the copy cleanup to the package contract**

State that the repository and shared archive use the same concise interface and that detailed data semantics remain in documentation.

### Task 4: Verify the assembled change

**Files:**

- Verify: `index.html`
- Verify: `dashboard.js`
- Verify: `tests/dashboard-core.test.js`
- Verify: `tests/generate-data.test.js`

- [x] **Step 1: Run syntax checks**

Run:

```bash
node --check dashboard.js
node --check dashboard-core.js
node --check scripts/generate-data.mjs
```

Expected: all commands exit 0 with no output.

- [x] **Step 2: Run the full behavior suite**

Run:

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [x] **Step 3: Audit removed language and remaining visible text**

Search runtime files for the removed implementation terms and list all remaining headings, helper text, dynamic labels, and errors. Confirm each remaining phrase is either a direct label, necessary semantic note, action, or actionable diagnostic.

- [x] **Step 4: Inspect the assembled page structure**

Confirm heading order, accessible names/descriptions, disclosure/table associations, and spacing after the removed elements. If a browser executable is unavailable, report that visual rendering was not rerun and rely on the existing responsive structure plus markup inspection.

- [x] **Step 5: Continue the approved offline package plan**

Use the cleaned runtime as the input to `docs/superpowers/specs/2026-07-09-offline-zip-packaging-design.md`.
