"use strict";

const assert = require("node:assert/strict");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const refreshUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/refresh-data.mjs"),
).href;

function validExport(date = "2026-07-31") {
  return {
    daily: [{
      cacheCreationTokens: 0,
      cacheReadTokens: 20,
      costUSD: 0.42,
      date,
      inputTokens: 10,
      models: {
        "gpt-test": {
          cacheCreationTokens: 0,
          cacheReadTokens: 20,
          inputTokens: 10,
          isFallback: false,
          outputTokens: 5,
          reasoningOutputTokens: 2,
          totalTokens: 35,
        },
      },
      outputTokens: 5,
      reasoningOutputTokens: 2,
      totalTokens: 35,
    }],
    totals: {
      cacheCreationTokens: 0,
      cacheReadTokens: 20,
      costUSD: 0.42,
      inputTokens: 10,
      outputTokens: 5,
      reasoningOutputTokens: 2,
      totalTokens: 35,
    },
  };
}

async function makeProject(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "codex-usage-refresh-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, "data"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "data", "usage-sources.json"),
    JSON.stringify({
      personalUserId: "myself",
      users: [{
        id: "myself",
        name: "Myself",
        file: "raw/old.json",
      }],
    }),
    "utf8",
  );
  return projectRoot;
}

test("refresh publishes a personal raw export and selects its transformed snapshot", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  const raw = validExport();

  const result = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T02:00:00.000Z"),
    runExporter: async () => JSON.stringify(raw),
  });

  assert.deepEqual(
    JSON.parse(await readFile(result.rawPath, "utf8")),
    raw,
  );
  assert.match(result.rawPath, /myself-20260801T020000Z\.json$/);
  assert.match(result.snapshotPath, /usage-20260801T020000Z\.js$/);
  assert.match(
    await readFile(result.latestPath, "utf8"),
    /usage-20260801T020000Z\.js/,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(projectRoot, "data", "usage-sources.json"), "utf8"))
      .users[0].file,
    "raw/myself-20260801T020000Z.json",
  );
});

test("a second refresh preserves the first raw and transformed artifacts", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  const first = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T02:00:00.000Z"),
    runExporter: async () => JSON.stringify(validExport("2026-07-31")),
  });
  const firstRaw = await readFile(first.rawPath);
  const firstSnapshot = await readFile(first.snapshotPath);

  const second = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T03:00:00.000Z"),
    runExporter: async () => JSON.stringify(validExport("2026-08-01")),
  });

  assert.deepEqual(await readFile(first.rawPath), firstRaw);
  assert.deepEqual(await readFile(first.snapshotPath), firstSnapshot);
  assert.notEqual(first.rawPath, second.rawPath);
  assert.notEqual(first.snapshotPath, second.snapshotPath);
  assert.match(await readFile(second.latestPath, "utf8"), /usage-20260801T030000Z\.js/);
});

test("manual additional users remain in the refreshed account bundle", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  await mkdir(path.join(projectRoot, "data", "raw"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "data", "raw", "marius.json"),
    JSON.stringify(validExport("2026-07-30")),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "data", "usage-sources.json"),
    JSON.stringify({
      personalUserId: "myself",
      users: [
        { id: "myself", name: "Myself", file: "raw/old.json" },
        { id: "marius", name: "Marius", file: "raw/marius.json" },
      ],
    }),
    "utf8",
  );

  const result = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T02:00:00.000Z"),
    runExporter: async () => JSON.stringify(validExport()),
  });
  const context = { window: {} };
  vm.runInNewContext(await readFile(result.snapshotPath, "utf8"), context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA.users.map(({ id, name }) => ({ id, name })))),
    [
      { id: "myself", name: "Myself" },
      { id: "marius", name: "Marius" },
    ],
  );
});

test("an invalid exporter result leaves the prior latest state active", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  const first = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T02:00:00.000Z"),
    runExporter: async () => JSON.stringify(validExport()),
  });
  const previousLatest = await readFile(first.latestPath, "utf8");
  const previousManifest = await readFile(first.manifestPath, "utf8");

  await assert.rejects(
    refresh({
      projectRoot,
      manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
      now: () => new Date("2026-08-01T03:00:00.000Z"),
      runExporter: async () => "{bad",
    }),
    /malformed JSON/i,
  );

  assert.equal(await readFile(first.latestPath, "utf8"), previousLatest);
  assert.equal(await readFile(first.manifestPath, "utf8"), previousManifest);
});

test("the latest browser loader selects the published transformed snapshot", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  const result = await refresh({
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    now: () => new Date("2026-08-01T02:00:00.000Z"),
    runExporter: async () => JSON.stringify(validExport()),
  });
  const loader = await readFile(path.join(projectRoot, "data/latest.js"), "utf8");
  const snapshot = await readFile(result.snapshotPath, "utf8");
  const context = {
    document: {
      write(value) {
        assert.match(value, /snapshots\/usage-20260801T020000Z\.js/);
        vm.runInNewContext(snapshot, context);
      },
    },
    window: {},
  };

  vm.runInNewContext(loader, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA.users[0].data)),
    validExport(),
  );
});
