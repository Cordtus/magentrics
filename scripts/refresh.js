#!/usr/bin/env node

// CLI entry point: bun run refresh <codex|claude|opencode> [--watch] [--serve].

import path from "node:path";
import { fileURLToPath } from "node:url";

import { startStaticServer } from "../serve.js";
import { refresh } from "./refresh-ccusage.js";
import { ensureOpenCodeServer, runOpenCodeRefresh } from "./refresh-opencode.js";

const PROVIDERS = ["codex", "claude", "opencode"];
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_PORT = 8765;

const USAGE = `Usage: node scripts/refresh.js [provider] [mode] [options]

Refreshes the local usage snapshot. The provider is required as the first
argument:
  codex      Codex usage via "ccusage codex daily --json"
  claude     Claude usage via "ccusage claude daily --json"
  opencode   Per-agent usage from a local opencode server (starts a temporary
             one when none is reachable, reuses one that is already running)

Example: bun run refresh opencode

Modes (combine freely; default is update data once and exit):
  --watch        Keep refreshing on an interval until stopped
  --serve        Update, then serve the dashboard on loopback

Mode options:
  --interval <s> Refresh interval for --watch (default: ${DEFAULT_INTERVAL_SECONDS})
  --port <n>     Dashboard port for --serve (default: ${DEFAULT_PORT})

OpenCode options:
  --base-url <url>      Server base URL (default: $OPENCODE_BASE_URL)
  --directory <path>    Only include sessions from this project directory
  --cache <path>        Cache file (default: data/opencode-cache.json)
  --help                Show this help
`;

function parseNumber(value, option, { min = 0, integer = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || (integer && !Number.isInteger(number))) {
    throw new Error(`${option} must be ${integer ? "an integer" : "a number"} >= ${min}`);
  }
  return number;
}

export function parseArgs(args) {
  const options = { provider: null, serve: false, watch: false };
  const selectProvider = (provider) => {
    if (options.provider && options.provider !== provider) {
      throw new Error(`Choose only one provider\n${USAGE}`);
    }
    options.provider = provider;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (arg === "--serve") {
      options.serve = true;
      continue;
    }
    if (arg === "--watch") {
      options.watch = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      if (!PROVIDERS.includes(arg)) throw new Error(`Unknown provider: ${arg}\n${USAGE}`);
      selectProvider(arg);
      continue;
    }
    if (arg === "--interval") {
      options.interval = parseNumber(args[index + 1], "--interval", { min: 1 });
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = parseNumber(args[index + 1], "--port", { min: 0 });
      if (options.port > 65535) throw new Error("--port must be an integer from 0 to 65535");
      index += 1;
      continue;
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

  if (!options.provider) {
    throw new Error(
      `No provider specified. Choose one of: ${PROVIDERS.join(", ")}\n`
      + `Example: bun run refresh ${PROVIDERS[0]}\n\n${USAGE}`,
    );
  }
  return options;
}

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

function summarize(options, result) {
  if (result.unchanged) return "no changes";
  const snapshot = path.basename(result.snapshotPath);
  if (options.provider !== "opencode") return `published ${snapshot}`;
  const changed = result.fetchedSessions === 1 ? "1 session changed" : `${result.fetchedSessions} sessions changed`;
  return `published ${snapshot} (${result.messages} messages, ${changed})`;
}

async function refreshOnce(options) {
  if (options.provider === "opencode") return runOpenCodeRefresh(options);
  const result = await refresh({ provider: options.provider, skipUnchanged: options.skipUnchanged });
  if (!options.quiet) {
    console.log(result.unchanged
      ? `No changes to the ${options.provider} export.`
      : `Refreshed ${options.provider} raw export: ${result.rawPath}`);
    if (!result.unchanged) console.log(`Published dashboard snapshot: ${result.snapshotPath}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const looping = Boolean(options.watch || options.serve);

  let openCodeServer = null;
  if (options.provider === "opencode" && looping) {
    openCodeServer = await ensureOpenCodeServer(options);
    if (openCodeServer.started) console.log(`Started a temporary opencode server at ${openCodeServer.baseUrl}.`);
  }

  const runOnce = () => refreshOnce({
    ...options,
    server: openCodeServer,
    quiet: looping,
    skipUnchanged: looping,
  });

  const first = await runOnce();
  if (!looping) return;
  console.log(`[${clock()}] ${summarize(options, first)}`);

  let server = null;
  if (options.serve) {
    ({ server } = await startStaticServer({ port: options.port }));
    const { port } = server.address();
    console.log(`AI Usage: http://127.0.0.1:${port}${options.watch ? "/?live=1" : "/"}`);
  }

  let refreshTimer = null;
  let busy = false;
  const shutdown = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (server) server.close();
    if (openCodeServer) openCodeServer.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (options.watch) {
    const intervalSeconds = options.interval || DEFAULT_INTERVAL_SECONDS;
    console.log(`Refreshing every ${intervalSeconds}s; press Ctrl-C to stop.`);
    refreshTimer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await runOnce();
        console.log(`[${clock()}] ${summarize(options, result)}`);
      } catch (error) {
        console.error(`[${clock()}] refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        busy = false;
      }
    }, intervalSeconds * 1000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to refresh usage data: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
