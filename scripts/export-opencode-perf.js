#!/usr/bin/env node

// OpenCode performance export: turn latency, context size, and harness overhead.
// Reads the local opencode.db and writes data/opencode-perf.json for the dashboard.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSqliteJson } from "./export-opencode.js";
import { writeAtomically } from "./snapshot.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultOutput = path.resolve(scriptDirectory, "..", "data", "opencode-perf.json");
const defaultDb = path.join(process.env.HOME ?? "", ".local", "share", "opencode", "opencode.db");

const USAGE = `Usage: node scripts/export-opencode-perf.js [options]

Reads the local OpenCode database and writes turn-latency metrics:
model time, between-turn overhead, time to first token, tokens/second,
context size, and turns per request.

Options:
  --db <path>      opencode.db (default: ~/.local/share/opencode/opencode.db)
  --output <path>  Output JSON (default: data/opencode-perf.json)
  --days <n>       Window in days (default: 30)
  --help           Show this help
`;

function parseArgs(args) {
  const options = { days: 30 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    const value = args[index + 1];
    if (arg === "--db" || arg === "--output" || arg === "--days") {
      if (value === undefined) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = arg === "--days" ? Number(value) : value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${USAGE}`);
  }
  return options;
}

function localDayKey(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

const CONTEXT_BUCKETS = [
  { label: "<50k", max: 50_000 },
  { label: "50-200k", max: 200_000 },
  { label: "200-400k", max: 400_000 },
  { label: "400-600k", max: 600_000 },
  { label: "600k+", max: Number.POSITIVE_INFINITY },
];

function bucketFor(context) {
  return CONTEXT_BUCKETS.find((bucket) => context < bucket.max) ?? CONTEXT_BUCKETS.at(-1);
}

// Pure aggregation so the shape can be tested without a database.
export function aggregate(rows, requestCount) {
  const turns = [];
  const bySession = new Map();
  for (const row of rows) {
    const created = Number(row.created);
    const firstToken = Number(row.firstToken);
    const streamed = Number(row.streamed);
    if (!Number.isFinite(created) || !Number.isFinite(streamed) || streamed < created) continue;
    const turn = {
      session: row.session_id,
      created,
      modelSeconds: (streamed - created) / 1000,
      hasTtft: firstToken > created,
      ttftSeconds: firstToken > created ? (firstToken - created) / 1000 : 0,
      genSeconds: firstToken > created ? (streamed - firstToken) / 1000 : 0,
      context: Number(row.context) || 0,
      output: Number(row.output) || 0,
      gapSeconds: null,
    };
    turns.push(turn);
    if (!bySession.has(turn.session)) bySession.set(turn.session, []);
    bySession.get(turn.session).push(turn);
  }

  for (const sessionTurns of bySession.values()) {
    for (let index = 0; index < sessionTurns.length - 1; index += 1) {
      const gap = (sessionTurns[index + 1].created - sessionTurns[index].created -
        sessionTurns[index].modelSeconds * 1000) / 1000;
      if (gap >= 0 && gap < 120) sessionTurns[index].gapSeconds = gap;
    }
  }

  const dayMap = new Map();
  const bucketMap = new Map(CONTEXT_BUCKETS.map((bucket) => [bucket.label, {
    bucket: bucket.label, turns: 0, modelSeconds: 0, overheadSeconds: 0, contextSum: 0,
  }]));
  let modelSeconds = 0;
  let overheadSeconds = 0;
  let ttftSeconds = 0;
  let ttftCount = 0;
  let genSeconds = 0;
  let genOutput = 0;
  let output = 0;
  let contextSum = 0;
  const turnSeconds = [];

  for (const turn of turns) {
    modelSeconds += turn.modelSeconds;
    if (turn.hasTtft) {
      ttftSeconds += turn.ttftSeconds;
      ttftCount += 1;
      genSeconds += turn.genSeconds;
      genOutput += turn.output;
    }
    output += turn.output;
    contextSum += turn.context;
    const gap = turn.gapSeconds ?? 0;
    overheadSeconds += gap;
    turnSeconds.push(turn.modelSeconds + gap);

    const day = localDayKey(turn.created);
    if (!dayMap.has(day)) {
      dayMap.set(day, {
        date: day, turns: 0, modelSeconds: 0, overheadSeconds: 0, contextSum: 0,
        maxContext: 0, ttftSeconds: 0, ttftCount: 0, genSeconds: 0, genOutput: 0, output: 0,
      });
    }
    const entry = dayMap.get(day);
    entry.turns += 1;
    entry.modelSeconds += turn.modelSeconds;
    entry.overheadSeconds += gap;
    entry.contextSum += turn.context;
    entry.maxContext = Math.max(entry.maxContext, turn.context);
    if (turn.hasTtft) {
      entry.ttftSeconds += turn.ttftSeconds;
      entry.ttftCount += 1;
      entry.genSeconds += turn.genSeconds;
      entry.genOutput += turn.output;
    }
    entry.output += turn.output;

    const bucket = bucketMap.get(bucketFor(turn.context).label);
    bucket.turns += 1;
    bucket.modelSeconds += turn.modelSeconds;
    bucket.overheadSeconds += gap;
    bucket.contextSum += turn.context;
  }

  const round = (value) => Math.round(value * 10) / 10;
  return {
    totals: {
      turns: turns.length,
      requests: requestCount,
      avgTurnsPerRequest: requestCount > 0 ? round(turns.length / requestCount) : 0,
      modelSeconds: Math.round(modelSeconds),
      overheadSeconds: Math.round(overheadSeconds),
      avgTurnSeconds: turns.length ? round((modelSeconds + overheadSeconds) / turns.length) : 0,
      p95TurnSeconds: round(percentile(turnSeconds, 0.95)),
      avgContext: turns.length ? Math.round(contextSum / turns.length) : 0,
      avgTtftSeconds: ttftCount ? round(ttftSeconds / ttftCount) : 0,
      avgTokensPerSecond: genSeconds > 0 ? Math.round(genOutput / genSeconds) : 0,
    },
    byDay: [...dayMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({
        date: entry.date,
        turns: entry.turns,
        modelSeconds: Math.round(entry.modelSeconds),
        overheadSeconds: Math.round(entry.overheadSeconds),
        avgContext: Math.round(entry.contextSum / entry.turns),
        maxContext: entry.maxContext,
        avgTtftSeconds: entry.ttftCount ? round(entry.ttftSeconds / entry.ttftCount) : 0,
        tokensPerSecond: entry.genSeconds > 0 ? Math.round(entry.genOutput / entry.genSeconds) : 0,
      })),
    byContext: [...bucketMap.values()].map((bucket) => ({
      bucket: bucket.bucket,
      turns: bucket.turns,
      avgModelSeconds: bucket.turns ? round(bucket.modelSeconds / bucket.turns) : 0,
      avgOverheadSeconds: bucket.turns ? round(bucket.overheadSeconds / bucket.turns) : 0,
      avgContext: bucket.turns ? Math.round(bucket.contextSum / bucket.turns) : 0,
    })),
  };
}

function readDatabase(dbPath, sinceMs) {
  const query = `
    SELECT session_id, time_created AS created,
      json_extract(data, '$.time.created') AS createdAt,
      json_extract(data, '$.time.firstToken') AS firstToken,
      json_extract(data, '$.time.streamed') AS streamed,
      json_extract(data, '$.tokens.cache.read') + json_extract(data, '$.tokens.input') AS context,
      json_extract(data, '$.tokens.output') + json_extract(data, '$.tokens.reasoning') AS output
    FROM session_message
    WHERE type = 'assistant' AND time_created >= ${Math.floor(sinceMs)}
    ORDER BY session_id, time_created;`;
  const outputText = runSqliteJson(dbPath, query, 256 * 1024 * 1024).trim();
  const rows = outputText ? JSON.parse(outputText) : [];

  const userQuery = `SELECT count(*) AS n FROM session_message WHERE type = 'user' AND time_created >= ${Math.floor(sinceMs)};`;
  const userText = runSqliteJson(dbPath, userQuery, 64 * 1024 * 1024).trim();
  const requestCount = userText ? JSON.parse(userText)[0].n : 0;

  return {
    rows: rows.map((row) => ({ ...row, created: row.createdAt ?? row.created })),
    requestCount,
  };
}

export function buildPerformance(dbPath, days) {
  const sinceMs = Date.now() - days * 86_400_000;
  const { rows, requestCount } = readDatabase(dbPath, sinceMs);
  return {
    generatedAt: new Date().toISOString(),
    sinceDays: days,
    source: "opencode.db",
    ...aggregate(rows, requestCount),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = options.db ?? defaultDb;
  const outputPath = path.resolve(options.output ?? defaultOutput);
  const report = buildPerformance(dbPath, options.days);
  await writeAtomically(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(process.cwd(), outputPath)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
