# Automatic Usage Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Replace the multi-command export/generate workflow with one personal-data refresh command that preserves timestamped raw and transformed snapshots and loads the newest successful snapshot automatically.

**Architecture:** Add a refresh orchestrator that invokes the local ccusage executable through execFile, validates the personal export, archives it under data/raw/, builds the existing multi-user dashboard bundle, archives the browser snapshot under data/snapshots/, and atomically advances a stable latest pointer. Keep the manifest editable for extra users, make the browser load the pointer synchronously for file:// compatibility, and make share packaging copy the selected snapshot without regenerating it.

**Tech Stack:** Node.js built-ins, Bun package scripts and local ccusage, vanilla browser JavaScript, node:test, and the existing dashboard-core validation/aggregation module.

---

## File structure

- Create: scripts/refresh-data.mjs — personal ccusage execution, manifest update, immutable archive publication, and latest-pointer publication.
- Create: data/usage-sources.json — tracked editable user manifest; the refresh command updates only the personal user’s raw-file reference.
- Create: data/latest.json — generated stable pointer metadata used by Node tooling.
- Create: data/latest.js — generated synchronous browser loader for the selected snapshot.
- Modify: scripts/generate-data.mjs — expose validated bundle construction/serialization helpers without requiring normal users to provide input/output paths.
- Modify: scripts/build-share.mjs — read the selected latest snapshot and package it as usage-data.js; do not run a generation step.
- Modify: index.html — load data/latest.js instead of the root generated snapshot.
- Modify: package.json — add refresh; retain share:build and test.
- Modify: README.md — document the one-command workflow, archive layout, manual additional-user configuration, and generated-file sensitivity.
- Modify: tests/generate-data.test.js — adapt manifest paths and preserve low-level generator behavior where still useful.
- Create: tests/refresh-data.test.js — test the refresh command’s observable filesystem and bundle behavior with injected exporter/time/filesystem boundaries.
- Modify: tests/build-share.test.js — verify packaging consumes the latest pointer and does not require source generation.

## Task 1: Establish the new manifest and refresh command contract

**Files:**
- Create: data/usage-sources.json
- Modify: package.json
- Test: tests/refresh-data.test.js

- [ ] **Step 1: Define the behavior contract in a failing test**

Add a happy-path test that creates a temporary project with a data/usage-sources.json manifest containing personalUserId: "myself", injects deterministic ccusage output and 2026-08-01T02:00:00.000Z, runs the exported refresh function, and asserts:

    assert.deepEqual(await readJson(path.join(projectRoot, "data/raw/myself-20260801T020000Z.json")), validExport());
    assert.equal((await readFile(path.join(projectRoot, "data/latest.json"), "utf8")).includes("usage-20260801T020000Z.js"), true);
    assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/usage-sources.json"), "utf8")).users[0].file, "raw/myself-20260801T020000Z.json");

Behavior/oracle: a successful refresh must publish a usable new source and select it as the latest dashboard input. Wrong implementations that only create files, skip validation, or fail to update the selected manifest entry must fail this test. Layer: integration-level filesystem test around the public refresh function with a fake exporter.

- [ ] **Step 2: Run the focused test and verify it fails for the missing workflow**

Run: node --test tests/refresh-data.test.js

Expected: FAIL because scripts/refresh-data.mjs and its refresh entry point do not yet exist.

- [ ] **Step 3: Add the tracked default manifest and package script**

Create data/usage-sources.json with:

    {
      "personalUserId": "myself",
      "users": [
        {
          "id": "myself",
          "name": "Myself",
          "file": "raw/myself-initial.json"
        }
      ]
    }

Add "refresh": "node scripts/refresh-data.mjs" to package.json. Do not invoke shell redirection; the Node script owns stdout capture and file writing.

- [ ] **Step 4: Commit the contract scaffolding**

Run: git add data/usage-sources.json package.json tests/refresh-data.test.js && git commit -m "feat: define automatic usage refresh command"

## Task 2: Implement immutable raw export and transformed snapshot publication

**Files:**
- Create: scripts/refresh-data.mjs
- Modify: scripts/generate-data.mjs
- Test: tests/refresh-data.test.js

- [ ] **Step 1: Add failing retention and failure-preservation tests**

Extend the refresh integration suite with:

    test("a second refresh preserves the first raw and transformed artifacts", async (t) => {
      const first = await refreshFixture(t, "2026-08-01T02:00:00.000Z", validExport("2026-07-31"));
      const firstRaw = await readFile(first.rawPath);
      const firstSnapshot = await readFile(first.snapshotPath);
      await refreshFixture(t, "2026-08-01T03:00:00.000Z", validExport("2026-08-01"), first.projectRoot);
      assert.deepEqual(await readFile(first.rawPath), firstRaw);
      assert.deepEqual(await readFile(first.snapshotPath), firstSnapshot);
      assert.equal((await readFile(path.join(first.projectRoot, "data/latest.json"), "utf8")).includes("usage-20260801T030000Z.js"), true);
    });

    test("export or validation failure leaves the prior latest pointer active", async (t) => {
      const first = await refreshFixture(t, "2026-08-01T02:00:00.000Z", validExport());
      await assert.rejects(refresh({ projectRoot: first.projectRoot, runExporter: async () => "{bad", now: fixedNow("2026-08-01T03:00:00.000Z") }));
      assert.equal(await readFile(path.join(first.projectRoot, "data/latest.json"), "utf8"), first.latestJson);
    });

Behavior/oracle: archives are immutable and the prior selected state survives bad input. Wrong implementations that overwrite the first artifact, advance the pointer before validation, or silently drop invalid data must fail. Layer: filesystem integration because the risk is publication ordering and persistence.

- [ ] **Step 2: Run the focused tests and verify the new cases fail**

Run: node --test tests/refresh-data.test.js

Expected: the new tests fail because no archive/pointer orchestration exists.

- [ ] **Step 3: Implement the refresh module with injectable boundaries**

Implement exported refresh(options = {}) with these stable options: projectRoot, runExporter, now, and optional filesystem operations. Use execFile("ccusage", ["codex", "daily", "--json"]) in the default exporter. Use UTC YYYYMMDDTHHmmssZ names, adding -2, -3, and so on if a path already exists.

The implementation must:

1. Read and validate data/usage-sources.json and find personalUserId.
2. Capture and parse exporter stdout; call the existing dashboard-core validation through the generator’s shared bundle-building helper.
3. Write the personal raw JSON atomically to data/raw/<personal-id>-<timestamp>.json.
4. Build the multi-user { users: [{ id, name, data }] } bundle from the new personal file plus every other manifest file, rejecting missing or invalid entries.
5. Write data/snapshots/usage-<timestamp>.js atomically.
6. Write data/latest.json containing the selected snapshot path and timestamp, and data/latest.js containing a synchronous document.write script tag for that snapshot, each via temporary-file rename.
7. Replace the manifest atomically only after the new bundle is valid, preserving the prior manifest if any later pointer publication fails.

Keep newly created artifacts recoverable on a late failure, but never point the browser at an invalid or incomplete snapshot.

- [ ] **Step 4: Run the focused refresh suite**

Run: node --test tests/refresh-data.test.js

Expected: all refresh behavior tests pass, including archive retention and failure preservation.

- [ ] **Step 5: Commit the refresh implementation**

Run: git add scripts/refresh-data.mjs scripts/generate-data.mjs tests/refresh-data.test.js && git commit -m "feat: archive and publish automatic usage refreshes"

## Task 3: Switch the browser and share builder to the latest snapshot

**Files:**
- Modify: index.html
- Modify: scripts/build-share.mjs
- Modify: tests/build-share.test.js

- [ ] **Step 1: Add failing latest-pointer and packaging tests**

Update the share fixture to create two timestamped snapshots and data/latest.json selecting the second. Assert that buildSharePackage copies the selected second snapshot into packaged usage-data.js, even when the source manifest has no root usage-data.js. Keep the existing server test unchanged because nested static paths already use the same safe resolver and MIME map.

Behavior/oracle: packaging must reproduce what the browser would display and must not silently regenerate from a stale source. Layer: packaging integration test because the delivered ZIP is the contract.

- [ ] **Step 2: Run the focused package suite and verify it fails**

Run: node --test tests/build-share.test.js

Expected: FAIL because the builder still calls generateSnapshot and assumes root usage-data.js.

- [ ] **Step 3: Make the browser load the stable pointer**

Replace the index.html script reference to usage-data.js with data/latest.js. Keep the script before dashboard-core.js and dashboard.js. The generated loader must use a synchronous classic-script insertion so window.CODEX_USAGE_DATA is populated before dashboard initialization on file:// and loopback URLs.

- [ ] **Step 4: Make share packaging consume the selected snapshot**

Add a helper in scripts/build-share.mjs that reads data/latest.json, resolves its selected snapshot within data/, and copies that file to the package’s stable usage-data.js. Remove the generation call from buildSharePackage; retain validation that the selected snapshot exists and is a file. The package must continue omitting raw exports and the development data/ directory.

- [ ] **Step 5: Run browser/package tests and commit**

Run: node --test tests/build-share.test.js tests/serve.test.js

Expected: all focused packaging and server tests pass.

Then run: git add index.html scripts/build-share.mjs tests/build-share.test.js tests/serve.test.js && git commit -m "feat: load and package the latest usage snapshot"

## Task 4: Migrate generation tests, documentation, and local artifacts

**Files:**
- Modify: README.md
- Modify: tests/generate-data.test.js
- Modify: package.json only if script descriptions need adjustment
- Modify: usage-sources.json only if retained as a compatibility redirect; otherwise remove it after confirming no code references it
- Create locally: data/raw/ and data/snapshots/ generated artifacts through bun run refresh

- [ ] **Step 1: Update generator tests around the retained public behavior**

Keep tests for safe serialization, multi-user bundle preservation, malformed input, inconsistent totals, and atomic replacement because those are real generated-artifact contracts. Remove or rewrite tests that only assert the old two-path CLI invocation if that invocation is no longer documented. Add an assertion that the generated snapshot serialization can be loaded by the data/latest.js loader contract.

- [ ] **Step 2: Rewrite the README workflow**

Document bun run refresh as the only normal refresh command. Explain that it captures ccusage output itself, writes data/raw/ and data/snapshots/, updates data/usage-sources.json, and advances data/latest.js only after validation succeeds. Explain how to add a second user manually and that that user’s raw file is not auto-refreshed. Remove the redirect example and the required explicit input/output generator command. Keep bun run share:build as the optional packaging command and state that it consumes the latest snapshot automatically.

- [ ] **Step 3: Run the real local refresh and inspect generated artifacts**

Run: bun run refresh

Expected: one new personal raw export and one new transformed snapshot appear in their separate directories; the manifest points to the new raw file; data/latest.json and data/latest.js select the new snapshot; prior artifacts remain unchanged.

- [ ] **Step 4: Run complete verification**

Run: bun run test

Expected: all tests pass with zero failures. Then run bun run share:build and inspect the ZIP listing to confirm it contains the stable packaged usage-data.js but no raw source data.

- [ ] **Step 5: Commit the completed workflow**

Run: git add README.md tests/generate-data.test.js package.json usage-sources.json && git commit -m "docs: streamline usage refresh workflow"

Do not stage ignored raw exports, transformed snapshots, node_modules, or dist/ unless the user explicitly requests generated data history in Git.

## Final self-review

- Confirm the spec requirements map to Tasks 1–4: one command, personal-only automatic refresh, manually configurable extra users, separate raw/transformed archives, immutable historical artifacts, stable latest browser loading, failure-safe publication, and packaging without a second generation command.
- Search this plan for TBD, TODO, implement later, and vague “handle” instructions; none may remain.
- Verify all referenced names are consistent: data/usage-sources.json, data/latest.json, data/latest.js, scripts/refresh-data.mjs, data/raw/, and data/snapshots/.
