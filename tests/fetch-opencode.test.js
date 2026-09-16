"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const http = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const dashboardCore = require("../dashboard-core.js");
const fetcherPath = path.resolve(__dirname, "../scripts/fetch-opencode.mjs");
const fetcherUrl = pathToFileURL(fetcherPath).href;

function runFetcher(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fetcherPath, ...args], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

let messageCounter = 0;

function assistantMessage({ agent, cost = 0.01, created, modelID = "deepseek-v4-flash", tokens }) {
  messageCounter += 1;
  const info = {
    cost,
    id: `msg-${messageCounter}`,
    modelID,
    providerID: "opencode-go",
    role: "assistant",
    time: { created },
    tokens,
  };
  if (agent !== undefined) info.agent = agent;
  return { info, parts: [] };
}

function userMessage(created) {
  messageCounter += 1;
  return {
    info: {
      id: `msg-${messageCounter}`,
      model: { modelID: "deepseek-v4-flash", providerID: "opencode-go" },
      role: "user",
      time: { created },
    },
    parts: [],
  };
}

function tokenTotals(tokens) {
  return tokens.input + tokens.output + tokens.reasoning
    + tokens.cache.read + tokens.cache.write;
}

function startFakeServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const handler = routes[pathname];
      if (!handler) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(handler(request)));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function makeFakeServer(t, routes) {
  const server = await startFakeServer(routes);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

test("aggregateMessages rolls assistant usage up per day and model in the ccusage shape", async () => {
  const { aggregateMessages } = await import(fetcherUrl);
  const messages = [
    assistantMessage({
      cost: 0.01,
      created: Date.UTC(2026, 7, 6, 12, 0, 0),
      modelID: "deepseek-v4-flash",
      tokens: { cache: { read: 300, write: 0 }, input: 100, output: 50, reasoning: 20 },
    }),
    assistantMessage({
      cost: 0.02,
      created: Date.UTC(2026, 7, 6, 18, 0, 0),
      modelID: "claude-sonnet-5",
      tokens: { cache: { read: 20, write: 0 }, input: 10, output: 5, reasoning: 2 },
    }),
    assistantMessage({
      cost: 0.03,
      created: Date.UTC(2026, 7, 7, 0, 0, 0),
      modelID: "deepseek-v4-flash",
      tokens: { cache: { read: 1, write: 1 }, input: 1, output: 1, reasoning: 1 },
    }),
    userMessage(Date.UTC(2026, 7, 7, 1, 0, 0)),
    assistantMessage({
      created: Date.UTC(2026, 7, 7, 2, 0, 0),
      tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
    }),
  ];

  const { daily, totals } = aggregateMessages(messages.map((entry) => entry.info), utcDayKey);
  const { models: firstDayModels, ...firstDay } = daily[0];
  const { models: secondDayModels, ...secondDay } = daily[1];

  assert.deepEqual(
    daily.map((day) => day.date),
    ["2026-08-06", "2026-08-07"],
  );
  assert.deepEqual(firstDay, {
    cacheCreationTokens: 0,
    cacheReadTokens: 320,
    costUSD: 0.03,
    date: "2026-08-06",
    inputTokens: 110,
    outputTokens: 77,
    reasoningOutputTokens: 22,
    totalTokens: 507,
  });
  assert.deepEqual(daily[0].models["deepseek-v4-flash"], {
    cacheCreationTokens: 0,
    cacheReadTokens: 300,
    inputTokens: 100,
    isFallback: false,
    outputTokens: 70,
    reasoningOutputTokens: 20,
    totalTokens: 470,
  });
  assert.deepEqual(daily[0].models["claude-sonnet-5"], {
    cacheCreationTokens: 0,
    cacheReadTokens: 20,
    inputTokens: 10,
    isFallback: false,
    outputTokens: 7,
    reasoningOutputTokens: 2,
    totalTokens: 37,
  });
  assert.deepEqual(secondDay, {
    cacheCreationTokens: 1,
    cacheReadTokens: 1,
    costUSD: 0.03,
    date: "2026-08-07",
    inputTokens: 1,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    totalTokens: 5,
  });
  assert.deepEqual(totals, {
    cacheCreationTokens: 1,
    cacheReadTokens: 321,
    costUSD: 0.06,
    inputTokens: 111,
    outputTokens: 79,
    reasoningOutputTokens: 23,
    totalTokens: 512,
  });
});

test("aggregateMessages output passes dashboardCore validation", async () => {
  const { aggregateMessages } = await import(fetcherUrl);
  const messages = [
    assistantMessage({
      cost: 0.01,
      created: Date.UTC(2026, 7, 6, 12, 0, 0),
      modelID: "deepseek-v4-flash",
      tokens: { cache: { read: 300, write: 0 }, input: 100, output: 50, reasoning: 20 },
    }),
    assistantMessage({
      cost: 0.02,
      created: Date.UTC(2026, 7, 7, 12, 0, 0),
      modelID: "claude-sonnet-5",
      tokens: { cache: { read: 20, write: 5 }, input: 10, output: 5, reasoning: 2 },
    }),
  ];

  const usage = aggregateMessages(messages.map((entry) => entry.info), utcDayKey);
  const model = dashboardCore.buildDashboardData(usage);

  assert.equal(model.daily.length, 2);
  assert.equal(model.summary.totalTokens, usage.totals.totalTokens);
  assert.equal(model.summary.costUSD, 0.03);
});

test("fetchOpenCodeUsage lists sessions, fetches messages, and aggregates", async (t) => {
  const { baseUrl, server } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [
      { id: "ses-1", title: "First" },
      { id: "ses-2", title: "Second" },
    ],
    "/session/ses-1/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 12, 0, 0),
        tokens: { cache: { read: 10, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
    "/session/ses-2/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 13, 0, 0),
        tokens: { cache: { read: 20, write: 0 }, input: 6, output: 4, reasoning: 2 },
      }),
      userMessage(Date.UTC(2026, 7, 6, 14, 0, 0)),
    ],
  });

  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const result = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey });

  assert.equal(result.sessions, 2);
  assert.equal(result.messages, 3);
  assert.equal(result.usage.daily.length, 1);
  assert.equal(result.usage.daily[0].inputTokens, 11);
  assert.equal(result.usage.daily[0].outputTokens, 10);
  assert.equal(result.usage.daily[0].totalTokens, tokenTotals(
    { cache: { read: 30, write: 0 }, input: 11, output: 7, reasoning: 3 },
  ));
  assert.equal(result.usage.daily[0].costUSD, 0.02);
});

test("fetchOpenCodeUsage aggregates every project by default and dedupes sessions", async (t) => {
  const directories = [];
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [
      { id: "proj-a", worktree: "/repo/a" },
      { id: "proj-b", worktree: "/repo/b" },
    ],
    "/session": (request) => {
      const directory = new URL(request.url, baseUrl).searchParams.get("directory");
      directories.push(directory);
      if (directory === null) return [{ id: "ses-home", title: "Home" }];
      return directory === "/repo/a"
        ? [{ id: "ses-shared", title: "In A" }, { id: "ses-a", title: "Only A" }]
        : [{ id: "ses-shared", title: "In A" }, { id: "ses-b", title: "Only B" }];
    },
    "/session/ses-home/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 10, 0, 0),
        tokens: { cache: { read: 0, write: 0 }, input: 1, output: 1, reasoning: 0 },
      }),
    ],
    "/session/ses-shared/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 12, 0, 0),
        tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
    "/session/ses-a/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 13, 0, 0),
        tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
    "/session/ses-b/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 14, 0, 0),
        tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
  });

  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const result = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey });

  assert.deepEqual(directories, [null, "/repo/a", "/repo/b"]);
  assert.equal(result.sessions, 4);
  assert.equal(result.messages, 4);
  assert.equal(result.usage.daily[0].inputTokens, 16);
});

test("fetchOpenCodeUsage scopes to a single directory with --directory", async (t) => {
  const directories = [];
  const { baseUrl } = await makeFakeServer(t, {
    "/session": (request) => {
      const directory = new URL(request.url, baseUrl).searchParams.get("directory");
      directories.push(directory);
      return [{ id: "ses-a", title: "Only A" }];
    },
    "/session/ses-a/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 12, 0, 0),
        tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
  });

  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const result = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey, directory: "/repo/a" });

  assert.deepEqual(directories, ["/repo/a"]);
  assert.equal(result.sessions, 1);
  assert.equal(result.messages, 1);
});

test("fetchOpenCodeUsage reports a friendly error when the server is unreachable", async (t) => {
  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const server = await startFakeServer({ "/session": () => [] });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => server.close(resolve));

  await assert.rejects(
    fetchOpenCodeUsage({ baseUrl }),
    /Cannot reach the opencode server.*"opencode serve"/,
  );
});

test("fetchOpenCodeUsage exposes the ccusage shape through the CLI", async (t) => {
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [
      { id: "ses-1", title: "First" },
    ],
    "/session/ses-1/message": () => [
      assistantMessage({
        created: Date.UTC(2026, 7, 6, 12, 0, 0),
        tokens: { cache: { read: 10, write: 0 }, input: 5, output: 3, reasoning: 1 },
      }),
    ],
  });

  const directory = await mkdtemp(path.join(tmpdir(), "codex-usage-fetcher-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "opencode.json");

  const result = await runFetcher(["--base-url", baseUrl, "--output", outputPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Aggregated 1 assistant message across 1 session/);

  const usage = JSON.parse(await readFile(outputPath, "utf8"));
  const model = dashboardCore.buildDashboardData(usage);
  assert.equal(model.daily.length, 1);
  assert.equal(usage.totals.totalTokens, model.summary.totalTokens);
});

test("the CLI prints the export to stdout by default", async (t) => {
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [],
  });

  const result = await runFetcher(["--base-url", baseUrl]);

  assert.equal(result.status, 0, result.stderr);
  const usage = JSON.parse(result.stdout);
  dashboardCore.buildDashboardData(usage);
  assert.deepEqual(usage.daily, []);
});

test("the CLI rejects unknown options", async () => {
  const result = await runFetcher(["--nonsense"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
});

test("aggregateByAgent splits assistant usage by agent and stays dashboardCore-valid", async () => {
  const { aggregateByAgent } = await import(fetcherUrl);
  const messages = [
    assistantMessage({
      agent: "build",
      created: Date.UTC(2026, 7, 6, 12, 0, 0),
      tokens: { cache: { read: 100, write: 0 }, input: 10, output: 5, reasoning: 2 },
    }),
    assistantMessage({
      agent: "plan",
      created: Date.UTC(2026, 7, 6, 13, 0, 0),
      tokens: { cache: { read: 200, write: 0 }, input: 20, output: 8, reasoning: 3 },
    }),
    assistantMessage({
      created: Date.UTC(2026, 7, 6, 14, 0, 0),
      tokens: { cache: { read: 0, write: 0 }, input: 1, output: 1, reasoning: 0 },
    }),
  ].map((entry) => entry.info);

  const agents = aggregateByAgent(messages, utcDayKey);

  assert.deepEqual(Object.keys(agents), ["build", "plan", "unknown"]);
  assert.equal(agents.build.totals.inputTokens, 10);
  assert.equal(agents.plan.totals.inputTokens, 20);
  dashboardCore.buildDashboardData(agents.build);
  dashboardCore.buildDashboardData(agents.plan);
  dashboardCore.buildDashboardData(agents.unknown);
});

test("fetchOpenCodeUsage reuses unchanged sessions and refetches changed ones", async (t) => {
  let messageRequests = 0;
  let updated = 100;
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [{ id: "ses-1", time: { created: 1, updated } }],
    "/session/ses-1/message": () => {
      messageRequests += 1;
      return [
        assistantMessage({
          agent: "build",
          created: Date.UTC(2026, 7, 6, 12, 0, 0),
          tokens: { cache: { read: 10, write: 0 }, input: 5, output: 3, reasoning: 1 },
        }),
      ];
    },
  });

  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const first = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey });
  assert.equal(first.fetchedSessions, 1);
  assert.equal(first.reusedSessions, 0);
  assert.equal(messageRequests, 1);

  const second = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey, cache: first.cache });
  assert.equal(second.fetchedSessions, 0);
  assert.equal(second.reusedSessions, 1);
  assert.equal(second.messages, 0);
  assert.equal(messageRequests, 1);
  assert.deepEqual(second.usage, first.usage);
  assert.deepEqual(second.agents, first.agents);

  updated = 200;
  const third = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey, cache: second.cache });
  assert.equal(third.fetchedSessions, 1);
  assert.equal(third.reusedSessions, 0);
  assert.equal(messageRequests, 2);
});

test("sessions without an updated time are always refetched", async (t) => {
  let messageRequests = 0;
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [{ id: "ses-untimed" }],
    "/session/ses-untimed/message": () => {
      messageRequests += 1;
      return [
        assistantMessage({
          created: Date.UTC(2026, 7, 6, 12, 0, 0),
          tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
        }),
      ];
    },
  });

  const { fetchOpenCodeUsage } = await import(fetcherUrl);
  const first = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey });
  const second = await fetchOpenCodeUsage({ baseUrl, dayKey: utcDayKey, cache: first.cache });

  assert.equal(second.reusedSessions, 0);
  assert.equal(messageRequests, 2);
});

test("the CLI persists an incremental cache between runs", async (t) => {
  let messageRequests = 0;
  const { baseUrl } = await makeFakeServer(t, {
    "/project": () => [],
    "/session": () => [{ id: "ses-1", time: { updated: 42 } }],
    "/session/ses-1/message": () => {
      messageRequests += 1;
      return [
        assistantMessage({
          created: Date.UTC(2026, 7, 6, 12, 0, 0),
          tokens: { cache: { read: 0, write: 0 }, input: 5, output: 3, reasoning: 1 },
        }),
      ];
    },
  });

  const directory = await mkdtemp(path.join(tmpdir(), "codex-usage-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cachePath = path.join(directory, "opencode-cache.json");

  const first = await runFetcher(["--base-url", baseUrl, "--cache", cachePath]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(messageRequests, 1);

  const second = await runFetcher(["--base-url", baseUrl, "--cache", cachePath]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(messageRequests, 1);
  assert.match(second.stderr, /1 unchanged/);

  const cache = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(cache.sessions["ses-1"].updated, 42);
});

