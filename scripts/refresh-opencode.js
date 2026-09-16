#!/usr/bin/env node

import { spawn as spawnProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BASE_URL, fetchOpenCodeUsage } from "./fetch-opencode.js";
import { publishSnapshot } from "./refresh-data.js";
import { writeAtomically } from "./generate-data.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const DEFAULT_CACHE_FILENAME = "opencode-cache.json";

const USAGE = `Usage: node scripts/refresh-opencode.js [options]

Collects assistant usage from the opencode server (incrementally, reusing
unchanged sessions from the cache) and publishes a dashboard snapshot with one
user per agent. If no server is reachable at the target address (loopback
only) it starts a temporary one and stops it when finished; an already-running
server is left untouched.

Options:
  --base-url <url>      Server base URL (default: $OPENCODE_BASE_URL)
  --directory <path>    Only include sessions from this project directory
  --cache <path>        Cache file (default: data/${DEFAULT_CACHE_FILENAME})
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
    if (arg === "--base-url" || arg === "--directory" || arg === "--cache") {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${USAGE}`);
  }
  return options;
}

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 250;

function isLoopback(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function serverResponds(baseUrl, fetchImpl) {
  try {
    const response = await fetchImpl(`${baseUrl}/project`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureOpenCodeServer(options = {}) {
  const baseUrl = (options.baseUrl || process.env.OPENCODE_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;

  if (await serverResponds(baseUrl, fetchImpl)) {
    return { baseUrl, started: false, stop: async () => {} };
  }
  if (options.startServer === false || !isLoopback(baseUrl)) {
    throw new Error(`Cannot reach the opencode server at ${baseUrl}; start it with "opencode serve"`);
  }

  const { hostname, port } = new URL(baseUrl);
  const bin = options.opencodeBin || process.env.OPENCODE_BIN || "opencode";
  const spawnImpl = options.spawn || spawnProcess;
  const child = spawnImpl(bin, ["serve", "--hostname", hostname, "--port", port || "4096"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  };

  try {
    const deadline = Date.now() + (options.readyTimeoutMs || READY_TIMEOUT_MS);
    while (!(await serverResponds(baseUrl, fetchImpl))) {
      if (child.exitCode !== null) {
        throw new Error(`opencode server exited before becoming ready (code ${child.exitCode})`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`opencode server did not become ready at ${baseUrl} in time`);
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
    return { baseUrl, started: true, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function withOpenCodeServer(options, action) {
  const server = await ensureOpenCodeServer(options);
  try {
    return { baseUrl: server.baseUrl, started: server.started, value: await action(server.baseUrl) };
  } finally {
    await server.stop();
  }
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "agent";
}

function agentSources(agents, fallbackUsage) {
  const entries = Object.entries(agents).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  const usedIds = new Set();
  const sources = entries.map(([agent, raw]) => {
    let id = slugify(agent);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${slugify(agent)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return { id, name: agent, raw };
  });
  if (sources.length === 0) {
    sources.push({ id: "opencode", name: "OpenCode", raw: fallbackUsage });
  }
  return sources;
}

async function readCache(cachePath, fileOperations) {
  try {
    const parsed = JSON.parse(await fileOperations.readFile(cachePath, "utf8"));
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

export async function refreshOpenCodeUsage(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const dataRoot = path.resolve(options.dataRoot || path.join(projectRoot, "data"));
  const cachePath = path.resolve(
    options.cachePath || path.join(dataRoot, DEFAULT_CACHE_FILENAME),
  );
  const fileOperations = {
    readFile,
    ...(options.fileOperations || {}),
  };
  const cache = options.cache || await readCache(cachePath, fileOperations);

  const result = await fetchOpenCodeUsage({
    baseUrl: options.baseUrl,
    dayKey: options.dayKey,
    directory: options.directory,
    fetchImpl: options.fetchImpl,
    cache,
    onProgress: options.onProgress,
  });

  if (options.writeCache !== false) {
    await writeAtomically(cachePath, `${JSON.stringify(result.cache)}\n`, fileOperations);
  }

  const sources = agentSources(result.agents, result.usage);
  const stats = {
    agents: sources.map(({ id, name }) => ({ id, name })),
    cachePath,
    fetchedSessions: result.fetchedSessions,
    messages: result.messages,
    reusedSessions: result.reusedSessions,
    sessions: result.sessions,
  };

  if (options.skipUnchanged) {
    const snapshotData = { users: sources.map(({ id, name, raw }) => ({ id, name, data: raw })) };
    try {
      const previous = await fileOperations.readFile(path.join(dataRoot, "latest-data.json"), "utf8");
      if (previous === `${JSON.stringify(snapshotData, null, 2)}\n`) {
        return { ...stats, unchanged: true };
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }

  const published = await publishSnapshot(sources, {
    projectRoot,
    dataRoot,
    fileOperations: options.fileOperations,
    now: options.now,
  });

  return { ...published, ...stats, unchanged: false };
}

function progressReporter() {
  let reported = 0;
  return ({ done, total, fetchedSessions }) => {
    if (fetchedSessions - reported < 25) return;
    reported = fetchedSessions;
    process.stderr.write(`Scanned ${done}/${total} sessions (${fetchedSessions} fetched)...\n`);
  };
}

export async function runOpenCodeRefresh(options = {}) {
  const run = (baseUrl) => refreshOpenCodeUsage({
    ...options,
    baseUrl,
    onProgress: options.onProgress || (options.quiet ? undefined : progressReporter()),
  });

  let started = false;
  let result;
  if (options.server) {
    result = await run(options.server.baseUrl);
  } else {
    const outcome = await withOpenCodeServer(options, run);
    started = outcome.started;
    result = outcome.value;
  }

  if (!options.quiet) {
    const messageWord = result.messages === 1 ? "message" : "messages";
    const reusedNote = result.reusedSessions > 0 ? `, ${result.reusedSessions} unchanged` : "";
    console.log(`Aggregated ${result.messages} ${messageWord} from ${result.sessions} sessions${reusedNote}`);
    console.log(`Agents: ${result.agents.map((agent) => agent.name).join(", ") || "none"}`);
    console.log(result.unchanged
      ? "No changes since the last snapshot."
      : `Published dashboard snapshot: ${result.snapshotPath}`);
    if (started) console.log("Used a temporary opencode server (started and stopped by this run).");
  }
  return { ...result, started };
}

async function main() {
  await runOpenCodeRefresh(parseArgs(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to refresh opencode usage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
