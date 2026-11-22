#!/usr/bin/env node

// One-shot OpenCode export printer: writes the ccusage { daily, totals } shape to stdout.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as dashboardCore from "../dashboard-core.js";
import { writeAtomically } from "./snapshot.js";

export const DEFAULT_BASE_URL = "http://127.0.0.1:4096";
const REQUEST_TIMEOUT_MS = 30_000;

export class OpenCodeApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenCodeApiError";
    this.code = "OPENCODE_API";
  }
}

const USAGE = `Usage: node scripts/export-opencode.js [options]

Fetches assistant message usage from the opencode server API and emits the
ccusage daily export shape ({ "daily": [...], "totals": {...} }) on stdout.

Aggregates sessions from every registered project by default (plus the
server's current project), so a bare run covers all local usage. Assistant
messages are split by their agent, so a project using several agents reports
usage per agent.

Requires a running server: start one with "opencode serve" (default port 4096).

Options:
  --base-url <url>      Server base URL (default: $OPENCODE_BASE_URL or ${DEFAULT_BASE_URL})
  --directory <path>    Only include sessions from this project directory
  --cache <path>        Reuse per-session results whose updated time is unchanged
  --output <path>       Write the export to a file instead of stdout
  --help                Show this help
`;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    const value = args[index + 1];
    if (arg === "--base-url" || arg === "--directory" || arg === "--cache" || arg === "--output") {
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${USAGE}`);
  }
  return options;
}

function localDayKey(createdMs) {
  const date = new Date(createdMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function requestJson(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OpenCodeApiError(
      `Cannot reach the opencode server at ${url} (${reason}); start it with "opencode serve"`,
    );
  }
  if (!response.ok) {
    throw new OpenCodeApiError(`${label} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OpenCodeApiError(`${label} could not be read (${reason})`);
  }
}

function messageUsage(info) {
  if (info.role !== "assistant") return null;
  const tokens = info.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  const total = tokens.total ?? input + output + reasoning + cacheRead + cacheWrite;
  if (total <= 0) return null;
  return { cacheRead, cacheWrite, cost: info.cost ?? 0, input, output, reasoning, total };
}

function addUsage(target, usage) {
  target.inputTokens += usage.input;
  target.outputTokens += usage.output + usage.reasoning;
  target.reasoningOutputTokens += usage.reasoning;
  target.cacheCreationTokens += usage.cacheWrite;
  target.cacheReadTokens += usage.cacheRead;
  target.totalTokens += usage.total;
}

const USAGE_TOKEN_FIELDS = [
  "cacheCreationTokens",
  "cacheReadTokens",
  "inputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];
const USAGE_TOTALS_FIELDS = [...USAGE_TOKEN_FIELDS, "costUSD"];

function emptyUsage() {
  return {
    daily: [],
    totals: {
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUSD: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  };
}

function cloneDay(day) {
  return {
    ...day,
    models: Object.fromEntries(
      Object.entries(day.models).map(([name, model]) => [name, { ...model }]),
    ),
  };
}

export function mergeUsage(target, source) {
  const byDate = new Map(target.daily.map((day) => [day.date, day]));
  for (const day of source.daily) {
    const existing = byDate.get(day.date);
    if (!existing) {
      const created = cloneDay(day);
      target.daily.push(created);
      byDate.set(day.date, created);
    } else {
      for (const field of USAGE_TOKEN_FIELDS) existing[field] += day[field];
      existing.costUSD += day.costUSD;
      for (const [name, model] of Object.entries(day.models)) {
        const targetModel = existing.models[name];
        if (!targetModel) {
          existing.models[name] = { ...model };
        } else {
          for (const field of USAGE_TOKEN_FIELDS) targetModel[field] += model[field];
          targetModel.isFallback = targetModel.isFallback || model.isFallback;
        }
      }
    }
    for (const field of USAGE_TOTALS_FIELDS) target.totals[field] += day[field];
  }
  target.daily.sort((left, right) => {
    if (left.date < right.date) return -1;
    if (left.date > right.date) return 1;
    return 0;
  });
  return target;
}

function mergeUsages(usages) {
  return usages.reduce((merged, usage) => mergeUsage(merged, usage), emptyUsage());
}

function mergeAgentMaps(maps) {
  const agents = {};
  for (const map of maps) {
    for (const [agent, usage] of Object.entries(map)) {
      if (!agents[agent]) agents[agent] = emptyUsage();
      mergeUsage(agents[agent], usage);
    }
  }
  return agents;
}

export function aggregateByAgent(messages, dayKey = localDayKey) {
  const buckets = new Map();
  for (const info of messages) {
    if (typeof info?.time?.created !== "number") continue;
    if (!messageUsage(info)) continue;
    const agent = typeof info.agent === "string" && info.agent.length > 0 ? info.agent : "unknown";
    let bucket = buckets.get(agent);
    if (!bucket) {
      bucket = [];
      buckets.set(agent, bucket);
    }
    bucket.push(info);
  }

  const agents = {};
  for (const [agent, infos] of buckets) {
    agents[agent] = aggregateMessages(infos, dayKey);
  }
  return agents;
}

export function aggregateMessages(messages, dayKey = localDayKey) {
  const days = new Map();

  for (const info of messages) {
    if (typeof info?.time?.created !== "number") continue;
    const usage = messageUsage(info);
    if (!usage) continue;

    const date = dayKey(info.time.created);
    let day = days.get(date);
    if (!day) {
      day = {
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costUSD: 0,
        date,
        inputTokens: 0,
        models: new Map(),
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      };
      days.set(date, day);
    }

    const modelName = info.modelID || info.providerID || "unknown";
    let model = day.models.get(modelName);
    if (!model) {
      model = {
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        inputTokens: 0,
        isFallback: false,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      };
      day.models.set(modelName, model);
    }

    addUsage(day, usage);
    addUsage(model, usage);
    day.costUSD += usage.cost;
  }

  const daily = [];
  const totals = {
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  for (const [date, day] of Array.from(days).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  })) {
    daily.push({
      cacheCreationTokens: day.cacheCreationTokens,
      cacheReadTokens: day.cacheReadTokens,
      costUSD: day.costUSD,
      date,
      inputTokens: day.inputTokens,
      models: Object.fromEntries(Array.from(day.models).sort(([left], [right]) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      })),
      outputTokens: day.outputTokens,
      reasoningOutputTokens: day.reasoningOutputTokens,
      totalTokens: day.totalTokens,
    });
    for (const field of [
      "inputTokens",
      "outputTokens",
      "reasoningOutputTokens",
      "cacheCreationTokens",
      "cacheReadTokens",
      "totalTokens",
    ]) {
      totals[field] += day[field];
    }
    totals.costUSD += day.costUSD;
  }

  return { daily, totals };
}

async function resolveDirectories(baseUrl, fetchImpl, options) {
  if (options.directory !== undefined) return [options.directory];

  const directories = [undefined];
  const projects = await requestJson(`${baseUrl}/project`, fetchImpl, "Project listing");
  for (const project of projects) {
    if (typeof project.worktree === "string" && project.worktree.length > 0 && project.worktree !== "/") {
      directories.push(project.worktree);
    }
  }
  return directories;
}

export async function fetchOpenCodeUsage(options = {}) {
  const baseUrl = (options.baseUrl || process.env.OPENCODE_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const dayKey = options.dayKey || localDayKey;
  const previousSessions = options.cache && typeof options.cache.sessions === "object"
    ? options.cache.sessions
    : {};
  const nextSessions = {};

  const directories = await resolveDirectories(baseUrl, fetchImpl, options);
  const sessionsById = new Map();
  for (const directory of directories) {
    const url = directory === undefined
      ? `${baseUrl}/session`
      : `${baseUrl}/session?${new URLSearchParams({ directory })}`;
    const sessions = await requestJson(url, fetchImpl, "Session listing");
    for (const session of sessions) {
      if (typeof session.id === "string" && session.id.length > 0) {
        sessionsById.set(session.id, session);
      }
    }
  }

  const agentMaps = [];
  let messages = 0;
  let fetchedSessions = 0;
  let reusedSessions = 0;
  let processed = 0;
  const total = sessionsById.size;
  const reportProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  for (const session of sessionsById.values()) {
    const updated = session.time && typeof session.time.updated === "number"
      ? session.time.updated
      : null;
    const cached = updated === null ? undefined : previousSessions[session.id];
    if (cached && cached.updated === updated && cached.byAgent) {
      nextSessions[session.id] = cached;
      agentMaps.push(cached.byAgent);
      reusedSessions += 1;
      processed += 1;
      if (reportProgress) reportProgress({ done: processed, fetchedSessions, reusedSessions, total });
      continue;
    }

    const listed = await requestJson(
      `${baseUrl}/session/${encodeURIComponent(session.id)}/message`,
      fetchImpl,
      `Messages for session ${session.id}`,
    );
    const infos = [];
    for (const entry of listed) {
      if (entry?.info) infos.push(entry.info);
    }
    const byAgent = aggregateByAgent(infos, dayKey);
    nextSessions[session.id] = { updated, byAgent };
    agentMaps.push(byAgent);
    fetchedSessions += 1;
    messages += infos.length;
    processed += 1;
    if (reportProgress) reportProgress({ done: processed, fetchedSessions, reusedSessions, total });
  }

  const agents = mergeAgentMaps(agentMaps);
  const usage = mergeUsages(Object.values(agents));
  if (options.validate !== false) dashboardCore.buildDashboardData(usage);
  return {
    agents,
    cache: { version: 1, sessions: nextSessions },
    fetchedSessions,
    messages,
    reusedSessions,
    sessions: sessionsById.size,
    usage,
  };
}

async function readCache(cachePath, fileOperations = {}) {
  const read = fileOperations.readFile || readFile;
  try {
    const parsed = JSON.parse(await read(cachePath, "utf8"));
    if (parsed && typeof parsed.sessions === "object" && parsed.sessions !== null) {
      return parsed;
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      console.error(`Ignoring unreadable cache at ${cachePath}: ${error.message}`);
    }
  }
  return { version: 1, sessions: {} };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cachePath = options.cache ? path.resolve(process.cwd(), options.cache) : null;
  const cache = cachePath ? await readCache(cachePath) : undefined;
  let reported = 0;
  const onProgress = ({ done, total, fetchedSessions }) => {
    if (fetchedSessions - reported < 25) return;
    reported = fetchedSessions;
    process.stderr.write(`Scanned ${done}/${total} sessions (${fetchedSessions} fetched)...\n`);
  };
  let fetched;
  let usedDb = false;
  try {
    fetched = await fetchOpenCodeUsage({ ...options, cache, onProgress });
  } catch (error) {
    if (!(error instanceof OpenCodeApiError)) throw error;
    usedDb = true;
    console.error(`OpenCode API unavailable (${error.message}); reading the local database instead.`);
    fetched = fetchOpenCodeUsageFromDb({ dbPath: options.dbPath });
  }
  const { agents, messages, reusedSessions, sessions, usage, cache: nextCache } = fetched;
  const json = `${JSON.stringify(usage, null, 2)}\n`;
  if (options.output) {
    await writeAtomically(path.resolve(process.cwd(), options.output), json);
    console.error(`Wrote opencode usage export: ${options.output}`);
  } else {
    process.stdout.write(json);
  }
  if (cachePath && !usedDb) {
    await writeAtomically(cachePath, `${JSON.stringify(nextCache)}\n`);
  }
  const messageWord = messages === 1 ? "message" : "messages";
  const sessionWord = sessions === 1 ? "session" : "sessions";
  const agentWord = Object.keys(agents).length === 1 ? "agent" : "agents";
  const reusedNote = reusedSessions > 0 ? ` (${reusedSessions} unchanged)` : "";
  console.error(
    `Aggregated ${messages} assistant ${messageWord} across ${sessions} ${sessionWord}${reusedNote} `
    + `for ${Object.keys(agents).length} ${agentWord}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to fetch opencode usage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export function runSqliteJson(dbPath, query, maxBuffer = 512 * 1024 * 1024) {
  try {
    return execFileSync("sqlite3", ["-json", dbPath, query], { encoding: "utf8", maxBuffer });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        "sqlite3 CLI not found; install sqlite3 (or run OpenCode on Node 22+ with node:sqlite)",
      );
    }
    throw error;
  }
}

// count + timestamps catch new, edited, and deleted messages without reading
// message bodies. An in-place edit that leaves every timestamp untouched is not
// detected until the session next changes; those sessions are idle in practice.
const SESSION_SIGNATURE_SQL = `
  SELECT session_id,
    count(*) AS count,
    coalesce(max(time_updated), max(time_created)) AS updated,
    sum(coalesce(time_updated, 0)) AS updatedSum
  FROM session_message
  WHERE type = 'assistant'
  GROUP BY session_id;`;

function signatureOf(row) {
  return `${row.count}:${row.updated}:${row.updatedSum}`;
}

function readSignatures(dbPath) {
  const text = runSqliteJson(dbPath, SESSION_SIGNATURE_SQL, 64 * 1024 * 1024).trim();
  return text ? JSON.parse(text) : [];
}

export function fetchOpenCodeUsageFromDb(options = {}) {
  const dbPath = options.dbPath || path.join(
    process.env.HOME ?? "",
    ".local",
    "share",
    "opencode",
    "opencode.db",
  );
  const dayKey = options.dayKey || localDayKey;
  const previous = options.cache && options.cache.version === 3
    && options.cache.sessions && typeof options.cache.sessions === "object"
    ? options.cache.sessions
    : {};

  // Cheap change detector: one grouped scan instead of reading every message.
  const sessions = {};
  const changed = [];
  for (const row of readSignatures(dbPath)) {
    const sessionId = row.session_id;
    const signature = signatureOf(row);
    const cached = previous[sessionId];
    if (cached && cached.signature === signature && cached.agents && Number.isFinite(cached.messages)) {
      sessions[sessionId] = cached;
    } else {
      changed.push({ sessionId, signature });
    }
  }

  let nextCache = sessions;
  if (changed.length > 0) {
    const bySession = new Map(changed.map((entry) => [entry.sessionId, []]));
    const ids = changed.map((entry) => entry.sessionId);
    const chunkSize = 400;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize)
        .map((id) => `'${String(id).replaceAll("'", "''")}'`)
        .join(",");
      const text = runSqliteJson(
        dbPath,
        `SELECT session_id,
          json_extract(data, '$.time.created') AS created,
          time_created AS createdAt,
          json_extract(data, '$.agent') AS agent,
          json_extract(data, '$.model.id') AS modelID,
          json_extract(data, '$.model.providerID') AS providerID,
          json_extract(data, '$.cost') AS cost,
          json_extract(data, '$.tokens') AS tokens
        FROM session_message
        WHERE type = 'assistant' AND json_extract(data, '$.tokens') IS NOT NULL
          AND session_id IN (${chunk})
        ORDER BY time_created;`,
      ).trim();
      const rows = text ? JSON.parse(text) : [];
      for (const row of rows) {
        const messages = bySession.get(row.session_id);
        if (!messages) continue;
        messages.push({
          role: "assistant",
          agent: row.agent || "unknown",
          modelID: row.modelID || undefined,
          providerID: row.providerID || undefined,
          cost: Number(row.cost) || 0,
          tokens: JSON.parse(row.tokens),
          time: { created: Number(row.created ?? row.createdAt) },
        });
      }
    }

    for (const entry of changed) {
      const messages = bySession.get(entry.sessionId) ?? [];
      sessions[entry.sessionId] = {
        agents: aggregateByAgent(messages, dayKey),
        messages: messages.length,
        signature: entry.signature,
      };
    }

    // A write between the signature scan and the detail scan would otherwise be
    // recorded with the newer signature and the older rows, pinning stale data
    // forever. Re-check and leave moved sessions out of the cache so the next
    // run re-reads them.
    const current = new Map(readSignatures(dbPath).map((row) => [row.session_id, signatureOf(row)]));
    nextCache = {};
    for (const [sessionId, entry] of Object.entries(sessions)) {
      if (current.get(sessionId) === entry.signature) nextCache[sessionId] = entry;
    }
  }

  const entries = Object.values(sessions);
  const usageOf = (entry) => mergeUsages(Object.values(entry.agents));
  return {
    agents: mergeAgentMaps(entries.map((entry) => entry.agents)),
    cache: { version: 3, sessions: nextCache },
    fetchedSessions: changed.length,
    messages: entries.reduce((total, entry) => total + entry.messages, 0),
    reusedSessions: entries.length - changed.length,
    sessions: entries.length,
    usage: mergeUsages(entries.map(usageOf)),
  };
}

export { emptyUsage, localDayKey };
