#!/usr/bin/env node

// Combined provider: publishes one snapshot with a source per provider.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportCcusage, publishSnapshot } from "./refresh-ccusage.js";
import { collectOpenCodeUsage, ensureOpenCodeServer } from "./refresh-opencode.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const CCUSAGE_PROVIDERS = ["codex", "claude"];
const LABELS = { claude: "Claude", codex: "Codex", opencode: "OpenCode" };

function hasUsage(raw) {
  return Boolean(raw) && Array.isArray(raw.daily) && raw.daily.length > 0;
}

function reason(error) {
  return error instanceof Error ? error.message : String(error);
}

async function collectOpenCode(options) {
  const server = options.server || await ensureOpenCodeServer(options);
  try {
    const collected = await collectOpenCodeUsage({
      ...options,
      baseUrl: options.baseUrl || server.baseUrl,
    });
    return hasUsage(collected.usage)
      ? { id: "opencode", name: LABELS.opencode, raw: collected.usage }
      : null;
  } finally {
    if (!options.server) await server.stop();
  }
}

export async function refreshCombined(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const dataRoot = path.resolve(options.dataRoot || path.join(projectRoot, "data"));
  const sources = [];
  const skipped = [];

  for (const provider of CCUSAGE_PROVIDERS) {
    try {
      const raw = await exportCcusage(provider, {
        runExporter: options.runCcusage ? () => options.runCcusage(provider) : undefined,
      });
      if (hasUsage(raw)) sources.push({ id: provider, name: LABELS[provider], raw });
      else skipped.push(provider);
    } catch (error) {
      skipped.push(`${provider} (${reason(error)})`);
    }
  }

  try {
    const source = await collectOpenCode(options);
    if (source) sources.push(source);
    else skipped.push("opencode");
  } catch (error) {
    skipped.push(`opencode (${reason(error)})`);
  }

  if (sources.length === 0) {
    throw new Error("no provider returned usage data");
  }

  const listed = sources.map(({ id, name }) => ({ id, name }));

  if (options.skipUnchanged) {
    const snapshotData = { users: sources.map(({ id, name, raw }) => ({ id, name, data: raw })) };
    try {
      const previous = await readFile(path.join(dataRoot, "latest-data.json"), "utf8");
      if (previous === `${JSON.stringify(snapshotData, null, 2)}\n`) {
        return { skipped, sources: listed, unchanged: true };
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
  return { ...published, skipped, sources: listed, unchanged: false };
}

const USAGE = `Usage: node scripts/refresh-combined.js

Runs every supported provider (codex, claude, opencode) and publishes one
snapshot holding a source per provider. Providers with no usage are skipped.
Prefer "bun run refresh combined".
`;

async function main() {
  if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const result = await refreshCombined();
  console.log(`Sources: ${result.sources.map((source) => source.name).join(", ")}`);
  if (result.skipped.length > 0) console.log(`Skipped: ${result.skipped.join(", ")}`);
  console.log(`Published dashboard snapshot: ${result.snapshotPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to refresh combined usage: ${reason(error)}`);
    process.exitCode = 1;
  });
}
