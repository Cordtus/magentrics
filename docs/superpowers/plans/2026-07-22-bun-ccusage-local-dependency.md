# Bun and Local ccusage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bun-managed, locally pinned `ccusage` tooling while preserving the static dashboard and offline share package.

**Architecture:** Bun owns development dependency resolution through `package.json` and its lockfile. Package scripts invoke the local `ccusage` binary or the unchanged Node scripts; the browser runtime continues to use checked-in JavaScript and vendored chart files only.

**Tech Stack:** Bun, `ccusage`, Node.js built-in test runner, static HTML/CSS/JavaScript, Chart.js.

---

## File structure

- Create: `package.json` — private project metadata, the local `ccusage` development dependency, and script aliases.
- Create: `bun.lock` — resolved Bun dependency graph.
- Modify: `README.md` — Bun installation, locally pinned export command, and Bun script instructions.
- Modify: `docs/superpowers/specs/2026-07-22-bun-ccusage-local-dependency-design.md` — clarify the test command uses the package script.

### Task 1: Create Bun project metadata and install ccusage

**Files:**
- Create: `package.json`
- Create: `bun.lock`

- [ ] **Step 1: Add the package metadata and scripts**

Create `package.json` with this structure; Bun adds the resolved `ccusage` version under `devDependencies` in the next step.

```json
{
  "name": "codex-usage-dashboard",
  "private": true,
  "scripts": {
    "usage:export": "ccusage codex daily --json",
    "data:generate": "node scripts/generate-data.mjs",
    "share:build": "node scripts/build-share.mjs",
    "test": "node --test tests/*.test.js"
  }
}
```

- [ ] **Step 2: Install the local development dependency**

Run:

```bash
bun add --dev ccusage
```

Expected: `package.json` contains a non-empty `devDependencies.ccusage` version and Bun creates `bun.lock`.

- [ ] **Step 3: Verify the local executable through the script**

Run:

```bash
bun run usage:export --help
```

Expected: ccusage prints its command help from the local installation without downloading a package.

### Task 2: Make the README’s Bun workflow authoritative

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document one-time developer setup**

Add the following after the introductory paragraph:

```markdown
For development, install [Bun](https://bun.sh/) and run:

```bash
bun install
```

This installs the project-pinned `ccusage` command. Browser-only use still needs no install step.
```

- [ ] **Step 2: Replace the global export command with the local script**

Replace the refresh example with:

```bash
bun run usage:export > codex-usage2.json
```

State that each manifest entry needs its own export and that the script writes JSON to standard output so redirection selects the destination file.

- [ ] **Step 3: Use package scripts for existing maintenance commands**

Replace the documented generation, share-build, and test invocations with:

```bash
bun run data:generate
bun run share:build
bun run test
```

Keep `node serve.mjs` as the optional direct server command because it is intentionally usable from an extracted share package without Bun.

### Task 3: Verify the managed workflow and preserve browser behavior

**Files:**
- Verify: `package.json`
- Verify: `bun.lock`
- Verify: `README.md`
- Verify: `usage-data.js`
- Verify: `tests/*.test.js`

- [ ] **Step 1: Regenerate the checked-in browser snapshot through Bun**

Run:

```bash
bun run data:generate
```

Expected: the generator reports that it wrote `usage-data.js` from `usage-sources.json`.

- [ ] **Step 2: Run the complete test suite through the Bun script**

Run:

```bash
bun run test
```

Expected: the Node test runner reports all tests passing with zero failures.

- [ ] **Step 3: Build the offline package through Bun**

Run:

```bash
bun run share:build
```

Expected: the command prints the generated folder, ZIP, size, and SHA-256, and the package contains no Bun runtime dependency.

- [ ] **Step 4: Review the final dependency boundary**

Run:

```bash
rg -n 'ccusage|bun run|node serve' README.md package.json
```

Expected: README commands use the local Bun workflow, `ccusage` is only a development dependency, and `node serve.mjs` remains the standalone UI fallback.
