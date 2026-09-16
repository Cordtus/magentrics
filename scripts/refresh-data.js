#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import * as dashboardCore from "../dashboard-core.js";
import { serializeSnapshot, writeAtomically } from "./generate-data.js";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const defaultManifestPath = path.join(defaultProjectRoot, "data", "usage-sources.json");
const defaultFileOperations = { mkdir, readFile, rename, stat, unlink, writeFile };

function withFileOperations(overrides = {}) {
  return { ...defaultFileOperations, ...overrides };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestampFor(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function formatTimestamp(date) {
  return timestampFor(date).replace(/Z$/, "Z");
}

async function nextAvailablePath(directory, filename, fileOperations) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  let candidate = path.join(directory, filename);
  let suffix = 2;
  while (true) {
    try {
      await fileOperations.stat(candidate);
      candidate = path.join(directory, `${stem}-${suffix}${extension}`);
      suffix += 1;
    } catch (error) {
      if (error && error.code === "ENOENT") return candidate;
      throw error;
    }
  }
}

export function ccusageArgs(provider) {
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`Unsupported ccusage provider: ${provider}`);
  }
  return [provider, "daily", "--json"];
}

async function runDefaultExporter(provider) {
  const result = await execFileAsync("ccusage", ccusageArgs(provider), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

async function readManifest(manifestPath, fileOperations) {
  let parsed;
  try {
    parsed = JSON.parse(await fileOperations.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read usage manifest: ${error.message}`);
  }
  if (!isObject(parsed) || !Array.isArray(parsed.users) || parsed.users.length === 0) {
    throw new Error("usage manifest must contain a non-empty users array");
  }
  if (typeof parsed.personalUserId !== "string" || parsed.personalUserId.length === 0) {
    throw new Error("usage manifest must contain a personalUserId");
  }
  const personal = parsed.users.find((user) => user && user.id === parsed.personalUserId);
  if (!personal) throw new Error(`personal user is not configured: ${parsed.personalUserId}`);
  for (const [index, user] of parsed.users.entries()) {
    if (!isObject(user) || typeof user.id !== "string" || user.id.length === 0) {
      throw new Error(`users[${index}].id must be a non-empty string`);
    }
    if (typeof user.name !== "string" || user.name.length === 0) {
      throw new Error(`users[${index}].name must be a non-empty string`);
    }
    if (typeof user.file !== "string" || user.file.length === 0) {
      throw new Error(`users[${index}].file must be a non-empty string`);
    }
  }
  return parsed;
}

async function readValidatedExport(sourcePath, label, fileOperations) {
  let raw;
  try {
    raw = JSON.parse(await fileOperations.readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} contains malformed JSON: ${error.message}`);
  }
  try {
    dashboardCore.buildDashboardData(raw);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
  return raw;
}

function makeLatestLoader(snapshotFilename) {
  const source = `./snapshots/${snapshotFilename}`;
  const safeSource = JSON.stringify(source).replace(/<\/script/gi, "<\\/script");
  return `document.write('<script src=' + ${JSON.stringify(safeSource)} + '><\\/script>');\n`;
}

async function publishJson(filePath, value, fileOperations) {
  await writeAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`, fileOperations);
}

export async function refresh(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const manifestPath = path.resolve(options.manifestPath || path.join(projectRoot, "data", "usage-sources.json"));
  const dataRoot = path.dirname(manifestPath);
  const rawDirectory = path.join(dataRoot, "raw");
  const snapshotDirectory = path.join(dataRoot, "snapshots");
  const latestJsonPath = path.join(dataRoot, "latest.json");
  const latestDataPath = path.join(dataRoot, "latest-data.json");
  const latestLoaderPath = path.join(dataRoot, "latest.js");
  const fileOperations = withFileOperations(options.fileOperations);
  const provider = options.provider || "codex";
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`Unsupported ccusage provider: ${provider}`);
  }
  const runExporter = options.runExporter || (() => runDefaultExporter(provider));
  const now = options.now ? options.now() : new Date();
  const timestamp = formatTimestamp(now);
  const manifest = await readManifest(manifestPath, fileOperations);
  const personal = manifest.users.find((user) => user.id === manifest.personalUserId);
  const personalJson = await runExporter();
  let personalRaw;
  try {
    personalRaw = JSON.parse(personalJson);
  } catch (error) {
    throw new Error(`ccusage produced malformed JSON: ${error.message}`);
  }
  try {
    dashboardCore.buildDashboardData(personalRaw);
  } catch (error) {
    throw new Error(`ccusage export is invalid: ${error.message}`);
  }

  if (options.skipUnchanged) {
    try {
      const previousRaw = await fileOperations.readFile(path.resolve(dataRoot, personal.file), "utf8");
      if (previousRaw === `${JSON.stringify(personalRaw, null, 2)}\n`) {
        return { manifestPath, snapshotPath: null, unchanged: true };
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }

  await fileOperations.mkdir(rawDirectory, { recursive: true });
  await fileOperations.mkdir(snapshotDirectory, { recursive: true });
  const rawFilename = `${personal.id}-${timestamp}.json`;
  const rawPath = await nextAvailablePath(rawDirectory, rawFilename, fileOperations);
  await publishJson(rawPath, personalRaw, fileOperations);

  const updatedManifest = {
    ...manifest,
    users: manifest.users.map((user) => user.id === personal.id
      ? { ...user, file: path.relative(dataRoot, rawPath).split(path.sep).join("/") }
      : user),
  };
  const sources = [];
  for (const user of updatedManifest.users) {
    const sourcePath = user.id === personal.id
      ? rawPath
      : path.resolve(dataRoot, user.file);
    const raw = user.id === personal.id
      ? personalRaw
      : await readValidatedExport(sourcePath, `Source file ${user.file}`, fileOperations);
    sources.push({ id: user.id, name: user.name, raw });
  }
  dashboardCore.buildMultiUserDashboardData(sources);
  const snapshotData = {
    users: sources.map(({ id, name, raw }) => ({ id, name, data: raw })),
  };
  const snapshotFilename = `usage-${timestamp}.js`;
  const snapshotPath = await nextAvailablePath(snapshotDirectory, snapshotFilename, fileOperations);
  await writeAtomically(snapshotPath, serializeSnapshot(snapshotData), fileOperations);

  await publishJson(manifestPath, updatedManifest, fileOperations);
  const latest = {
    generatedAt: now.toISOString(),
    snapshot: `snapshots/${path.basename(snapshotPath)}`,
  };
  await publishJson(latestDataPath, snapshotData, fileOperations);
  await publishJson(latestJsonPath, latest, fileOperations);
  await writeAtomically(
    latestLoaderPath,
    makeLatestLoader(path.basename(snapshotPath)),
    fileOperations,
  );

  return {
    latestDataPath,
    latestPath: latestJsonPath,
    manifestPath,
    rawPath,
    snapshotPath,
    unchanged: false,
  };
}

export async function publishSnapshot(sources, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const dataRoot = path.resolve(options.dataRoot || path.join(projectRoot, "data"));
  const snapshotDirectory = path.join(dataRoot, "snapshots");
  const latestJsonPath = path.join(dataRoot, "latest.json");
  const latestDataPath = path.join(dataRoot, "latest-data.json");
  const latestLoaderPath = path.join(dataRoot, "latest.js");
  const fileOperations = withFileOperations(options.fileOperations);
  const now = options.now ? options.now() : new Date();
  const timestamp = formatTimestamp(now);

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("sources must be a non-empty array");
  }
  dashboardCore.buildMultiUserDashboardData(sources);
  const snapshotData = {
    users: sources.map(({ id, name, raw }) => ({ id, name, data: raw })),
  };

  await fileOperations.mkdir(snapshotDirectory, { recursive: true });
  const snapshotFilename = `usage-${timestamp}.js`;
  const snapshotPath = await nextAvailablePath(snapshotDirectory, snapshotFilename, fileOperations);
  await writeAtomically(snapshotPath, serializeSnapshot(snapshotData), fileOperations);

  await publishJson(latestJsonPath, {
    generatedAt: now.toISOString(),
    snapshot: `snapshots/${path.basename(snapshotPath)}`,
  }, fileOperations);
  await publishJson(latestDataPath, snapshotData, fileOperations);
  await writeAtomically(
    latestLoaderPath,
    makeLatestLoader(path.basename(snapshotPath)),
    fileOperations,
  );

  return {
    latestDataPath,
    latestPath: latestJsonPath,
    snapshotPath,
    timestamp,
  };
}

const USAGE = `Usage: node scripts/refresh-data.js [codex|claude]

Fetches the personal usage export, archives it under data/raw/, publishes a
browser snapshot under data/snapshots/, and advances the data/latest.* pointers
atomically. Previous raw exports and snapshots are never overwritten.

Prefer "bun run refresh <provider> [--watch] [--serve]", which runs this with
the pinned ccusage binary on PATH. Running this file directly needs ccusage
installed (otherwise "ccusage" is reported as not found).
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const provider = args[0];
  if (args.length > 1 || (provider !== undefined && provider !== "codex" && provider !== "claude")) {
    throw new Error(`Unknown argument: ${args.join(" ")}\n\n${USAGE}`);
  }
  const result = await refresh({ provider });
  console.log(`Refreshed ${provider || "codex"} raw export: ${result.rawPath}`);
  console.log(`Published dashboard snapshot: ${result.snapshotPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to refresh usage data: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { makeLatestLoader, readManifest, timestampFor };
