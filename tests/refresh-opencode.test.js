"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const dashboardCore = require("../dashboard-core.js");

const publisherUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/refresh-opencode.mjs"),
).href;

const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

let messageCounter = 0;

function assistantMessage({ agent, cost = 0.01, created, tokens }) {
  messageCounter += 1;
  return {
    info: {
      agent,
      cost,
      id: `msg-${messageCounter}`,
      modelID: "deepseek-v4-flash",
      providerID: "opencode-go",
      role: "assistant",
      time: { created },
      tokens,
    },
    parts: [],
  };
}

function fakeFetch(routes) {
  return async (url) => {
    const parsed = new URL(url);
    const handler = routes[parsed.pathname];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => handler(parsed.searchParams) };
  };
}

function routesForAgents() {
  return {
    "/project": () => [],
    "/session": () => [
      { id: "ses-build", time: { updated: 100 } },
      { id: "ses-plan", time: { updated: 200 } },
    ],
    "/session/ses-build/message": () => [
      assistantMessage({
        agent: "build",
        created: Date.UTC(2026, 7, 6, 12, 0, 0),
        tokens: { cache: { read: 100, write: 0 }, input: 10, output: 5, reasoning: 2 },
      }),
    ],
    "/session/ses-plan/message": () => [
      assistantMessage({
        agent: "plan",
        created: Date.UTC(2026, 7, 6, 13, 0, 0),
        tokens: { cache: { read: 200, write: 0 }, input: 20, output: 8, reasoning: 3 },
      }),
    ],
  };
}

async function makeProject(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "codex-usage-opencode-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

test("refreshOpenCodeUsage publishes one user per agent and caches sessions", async (t) => {
  const projectRoot = await makeProject(t);
  let messageRequests = 0;
  const routes = routesForAgents();
  for (const key of ["/session/ses-build/message", "/session/ses-plan/message"]) {
    const handler = routes[key];
    routes[key] = () => {
      messageRequests += 1;
      return handler();
    };
  }

  const { refreshOpenCodeUsage } = await import(publisherUrl);
  const result = await refreshOpenCodeUsage({
    projectRoot,
    fetchImpl: fakeFetch(routes),
    dayKey: utcDayKey,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });

  assert.equal(messageRequests, 2);
  assert.equal(result.sessions, 2);
  assert.deepEqual(result.agents.map((agent) => agent.name), ["build", "plan"]);
  assert.match(result.snapshotPath, /usage-20260806T120000Z\.js$/);

  const dataRoot = path.join(projectRoot, "data");
  const latest = JSON.parse(await readFile(path.join(dataRoot, "latest.json"), "utf8"));
  assert.match(latest.snapshot, /usage-20260806T120000Z\.js/);

  const bundle = JSON.parse(await readFile(path.join(dataRoot, "latest-data.json"), "utf8"));
  assert.deepEqual(bundle.users.map((user) => user.id), ["build", "plan"]);
  const model = dashboardCore.buildMultiUserDashboardData(
    bundle.users.map((user) => ({ id: user.id, name: user.name, raw: user.data })),
  );
  assert.equal(model.users.length, 2);

  const cache = JSON.parse(await readFile(path.join(dataRoot, "opencode-cache.json"), "utf8"));
  assert.equal(cache.sessions["ses-build"].updated, 100);

  const second = await refreshOpenCodeUsage({
    projectRoot,
    fetchImpl: fakeFetch(routes),
    dayKey: utcDayKey,
    now: () => new Date("2026-08-06T12:01:00.000Z"),
  });
  assert.equal(second.reusedSessions, 2);
  assert.equal(second.fetchedSessions, 0);
  assert.equal(messageRequests, 2);
});

test("refreshOpenCodeUsage publishes an empty source when no usage exists", async (t) => {
  const projectRoot = await makeProject(t);
  const { refreshOpenCodeUsage } = await import(publisherUrl);
  const result = await refreshOpenCodeUsage({
    projectRoot,
    fetchImpl: fakeFetch({ "/project": () => [], "/session": () => [] }),
    dayKey: utcDayKey,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });

  assert.deepEqual(result.agents, [{ id: "opencode", name: "OpenCode" }]);
  const bundle = JSON.parse(
    await readFile(path.join(projectRoot, "data", "latest-data.json"), "utf8"),
  );
  assert.deepEqual(bundle.users.map((user) => user.id), ["opencode"]);
  dashboardCore.buildMultiUserDashboardData(
    bundle.users.map((user) => ({ id: user.id, name: user.name, raw: user.data })),
  );
});

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  return child;
}

test("withOpenCodeServer reuses a reachable server and never spawns one", async (t) => {
  const { withOpenCodeServer } = await import(publisherUrl);
  let spawned = 0;
  const result = await withOpenCodeServer(
    { fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }), spawn: () => { spawned += 1; } },
    async (baseUrl) => `used ${baseUrl}`,
  );

  assert.equal(spawned, 0);
  assert.equal(result.started, false);
  assert.equal(result.value, "used http://127.0.0.1:4096");
});

test("withOpenCodeServer starts a temporary server and stops it afterwards", async (t) => {
  const { withOpenCodeServer } = await import(publisherUrl);
  let ready = false;
  const calls = [];
  const child = fakeChild();
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/project") return { ok: ready, status: ready ? 200 : 500, json: async () => [] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const spawn = (bin, args) => {
    calls.push({ args, bin });
    ready = true;
    return child;
  };

  const result = await withOpenCodeServer({ fetchImpl, spawn }, async () => "done");

  assert.equal(result.started, true);
  assert.equal(result.value, "done");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, "opencode");
  assert.deepEqual(calls[0].args, ["serve", "--hostname", "127.0.0.1", "--port", "4096"]);
  assert.equal(child.signalCode, "SIGTERM");
});

test("withOpenCodeServer refuses to start a server for a remote address", async (t) => {
  const { withOpenCodeServer } = await import(publisherUrl);
  let spawned = 0;
  await assert.rejects(
    withOpenCodeServer(
      {
        baseUrl: "http://example.test:4096",
        fetchImpl: async () => { throw new Error("unreachable"); },
        spawn: () => { spawned += 1; },
      },
      async () => "done",
    ),
    /Cannot reach the opencode server/,
  );
  assert.equal(spawned, 0);
});
