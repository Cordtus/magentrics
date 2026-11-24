import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const combinedUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/refresh-combined.js"),
).href;

const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function canonicalExport(date) {
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

function fakeFetch(routes) {
  return async (url) => {
    const { pathname } = new URL(url);
    const handler = routes[pathname];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => handler() };
  };
}

function openCodeRoutes() {
  return {
    "/project": () => [],
    "/session": () => [{ id: "ses-1", time: { updated: 100 } }],
    "/session/ses-1/message": () => [{
      info: {
        agent: "build",
        cost: 0.01,
        modelID: "deepseek-v4-flash",
        providerID: "opencode-go",
        role: "assistant",
        time: { created: Date.UTC(2026, 7, 6, 12, 0, 0) },
        tokens: { cache: { read: 10, write: 0 }, input: 20, output: 5 },
      },
      parts: [],
    }],
  };
}

async function makeProject(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "codex-usage-combined-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

test("refreshCombined publishes one source per provider and skips empty ones", async (t) => {
  const projectRoot = await makeProject(t);
  const { refreshCombined } = await import(combinedUrl);

  const result = await refreshCombined({
    projectRoot,
    dayKey: utcDayKey,
    startServer: false,
    fetchImpl: fakeFetch(openCodeRoutes()),
    runCcusage: async (provider) => (provider === "codex"
      ? JSON.stringify(canonicalExport("2026-08-01"))
      : JSON.stringify({ daily: [], totals: {} })),
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });

  assert.deepEqual(result.sources.map((source) => source.id), ["codex", "opencode"]);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /^claude/);

  const bundle = JSON.parse(await readFile(path.join(projectRoot, "data", "latest-data.json"), "utf8"));
  assert.deepEqual(bundle.users.map((user) => user.id), ["codex", "opencode"]);
});

test("refreshCombined reads opencode from the database when a --db path is given", async (t) => {
  const projectRoot = await makeProject(t);
  const dbPath = path.join(projectRoot, "opencode.db");
  execFileSync("sqlite3", [
    dbPath,
    `CREATE TABLE session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
     INSERT INTO session_message VALUES
       ('m1','s1','assistant',1,1786000000000,1786000000000,
        '{"time":{"created":1786000000000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.5,"tokens":{"input":10,"output":5,"reasoning":2,"cache":{"read":100,"write":0}}}');`,
  ]);
  const { refreshCombined } = await import(combinedUrl);

  const result = await refreshCombined({
    projectRoot,
    dbPath,
    dayKey: utcDayKey,
    fetchImpl: () => { throw new Error("--db must not probe the opencode server"); },
    runCcusage: async () => JSON.stringify({ daily: [], totals: {} }),
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });

  assert.deepEqual(result.sources.map((source) => source.id), ["opencode"]);
});

test("refreshCombined reports when no provider returns usage", async (t) => {
  const projectRoot = await makeProject(t);
  const { refreshCombined } = await import(combinedUrl);

  await assert.rejects(
    refreshCombined({
      projectRoot,
      dayKey: utcDayKey,
    startServer: false,
      fetchImpl: fakeFetch({}),
      runCcusage: async () => JSON.stringify({ daily: [], totals: {} }),
    }),
    /no provider returned usage data/,
  );
});
