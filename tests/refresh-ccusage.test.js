import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const refreshUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/refresh-ccusage.js"),
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
  assert.deepEqual(
    JSON.parse(await readFile(result.latestDataPath, "utf8")),
    { users: [{ id: "myself", name: "Myself", data: raw }] },
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

test("ccusageArgs builds daily exports for codex and claude only", async () => {
  const { ccusageArgs } = await import(refreshUrl);
  assert.deepEqual(ccusageArgs("codex"), ["codex", "daily", "--json"]);
  assert.deepEqual(ccusageArgs("claude"), ["claude", "daily", "--json"]);
  assert.throws(() => ccusageArgs("opencode"), /Unsupported ccusage provider/);
});

test("refresh rejects an unsupported provider before touching the manifest", async () => {
  const { refresh } = await import(refreshUrl);
  await assert.rejects(refresh({ provider: "gemini" }), /Unsupported ccusage provider/);
});

test("refresh.js parseArgs takes the provider as the first argument", async () => {
  const { parseArgs } = await import(pathToFileURL(
    path.resolve(__dirname, "../scripts/refresh.js"),
  ).href);

  assert.equal(parseArgs(["codex"]).provider, "codex");
  assert.equal(parseArgs(["claude"]).provider, "claude");
  assert.equal(parseArgs(["opencode"]).provider, "opencode");
  assert.deepEqual(parseArgs(["opencode", "--cache", "x.json"]).cache, "x.json");
  assert.throws(() => parseArgs(["codex", "claude"]), /Choose only one provider/);
  assert.throws(() => parseArgs(["gemini"]), /Unknown provider/);
});

test("refresh.js requires a provider and explains the choices", async () => {
  const { parseArgs } = await import(pathToFileURL(
    path.resolve(__dirname, "../scripts/refresh.js"),
  ).href);

  assert.throws(() => parseArgs([]), /No provider specified\. Choose one of: codex, claude, opencode/);
  assert.throws(() => parseArgs([]), /bun run refresh codex/);
  assert.throws(() => parseArgs(["--serve"]), /No provider specified/);
  assert.throws(() => parseArgs(["--watch"]), /No provider specified/);
});

test("refresh.js parseArgs takes --serve and --watch modes", async () => {
  const { parseArgs } = await import(pathToFileURL(
    path.resolve(__dirname, "../scripts/refresh.js"),
  ).href);

  assert.deepEqual(parseArgs(["codex", "--serve"]), { provider: "codex", serve: true, watch: false });
  assert.equal(parseArgs(["codex", "--watch"]).watch, true);
  assert.deepEqual(
    parseArgs(["opencode", "--serve", "--watch", "--interval", "5", "--port", "9000"]),
    { provider: "opencode", serve: true, watch: true, interval: 5, port: 9000 },
  );
  assert.throws(() => parseArgs(["--interval", "0"]), /--interval must be/);
  assert.throws(() => parseArgs(["--port", "70000"]), /--port must be/);
});

test("skipUnchanged leaves the last snapshot in place when the export is identical", async (t) => {
  const projectRoot = await makeProject(t);
  const { refresh } = await import(refreshUrl);
  const options = {
    projectRoot,
    manifestPath: path.join(projectRoot, "data", "usage-sources.json"),
    runExporter: async () => JSON.stringify(validExport()),
  };

  const first = await refresh({ ...options, skipUnchanged: true, now: () => new Date("2026-08-01T02:00:00.000Z") });
  assert.equal(first.unchanged, false);
  const second = await refresh({ ...options, skipUnchanged: true, now: () => new Date("2026-08-01T03:00:00.000Z") });

  assert.equal(second.unchanged, true);
  assert.equal(second.snapshotPath, null);
  assert.match(await readFile(path.join(projectRoot, "data", "latest.json"), "utf8"), /usage-20260801T020000Z\.js/);
});
