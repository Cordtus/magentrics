#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as dashboardCore from "../dashboard-core.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultFileOperations = {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
};

function withFileOperations(overrides = {}) {
  return { ...defaultFileOperations, ...overrides };
}

function serializeSnapshot(raw) {
  const jsonText = JSON.stringify(raw);
  const safeStringLiteral = JSON.stringify(jsonText)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `window.CODEX_USAGE_DATA = JSON.parse(${safeStringLiteral});\n`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function writeAtomically(outputPath, contents, operationOverrides = {}) {
  const fileOperations = withFileOperations(operationOverrides);
  const outputDirectory = dirname(outputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await fileOperations.mkdir(outputDirectory, { recursive: true });

  try {
    await fileOperations.writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await fileOperations.rename(temporaryPath, outputPath);
  } catch (error) {
    await fileOperations.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function assertDistinctPaths(inputPath, outputPath, operationOverrides = {}) {
  const fileOperations = withFileOperations(operationOverrides);
  if (inputPath === outputPath) {
    throw new Error("Input JSON and output script must be different files");
  }

  const inputStat = await fileOperations.stat(inputPath);
  try {
    const outputStat = await fileOperations.stat(outputPath);
    if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
      throw new Error("Input JSON and output script must be different files");
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}

async function readSourceManifest(manifestPath, manifest, operationOverrides = {}) {
  const fileOperations = withFileOperations(operationOverrides);
  if (!Array.isArray(manifest.users) || manifest.users.length === 0) {
    throw new Error("usage source manifest must contain a non-empty users array");
  }

  const ids = new Set();
  const sources = [];
  for (const [index, user] of manifest.users.entries()) {
    const path = `users[${index}]`;
    if (!isObject(user)) {
      throw new Error(`${path} must be an object`);
    }
    if (typeof user.id !== "string" || user.id.length === 0) {
      throw new Error(`${path}.id must be a non-empty string`);
    }
    if (ids.has(user.id)) {
      throw new Error(`usage source manifest has duplicate id ${user.id}`);
    }
    ids.add(user.id);
    if (typeof user.name !== "string" || user.name.length === 0) {
      throw new Error(`${path}.name must be a non-empty string`);
    }
    if (typeof user.file !== "string" || user.file.length === 0) {
      throw new Error(`${path}.file must be a non-empty string`);
    }

    const sourcePath = resolve(dirname(manifestPath), user.file);
    let sourceText;
    try {
      sourceText = await fileOperations.readFile(sourcePath, "utf8");
    } catch (_error) {
      throw new Error(`Source file is unavailable: ${user.file}`);
    }

    let raw;
    try {
      raw = JSON.parse(sourceText);
    } catch (error) {
      throw new Error(`Source file ${user.file} contains malformed JSON: ${error.message}`);
    }
    sources.push({ id: user.id, name: user.name, path: sourcePath, raw });
  }

  dashboardCore.buildMultiUserDashboardData(sources);
  return sources;
}

async function readSnapshotData(inputPath, operationOverrides = {}) {
  const fileOperations = withFileOperations(operationOverrides);
  const source = await fileOperations.readFile(inputPath, "utf8");
  const raw = JSON.parse(source);

  if (!isObject(raw) || !hasOwn(raw, "users")) {
    dashboardCore.buildDashboardData(raw);
    return { data: raw, sourcePaths: [inputPath] };
  }

  const sources = await readSourceManifest(inputPath, raw, fileOperations);
  return {
    data: {
      users: sources.map(({ id, name, raw: userData }) => ({
        id,
        name,
        data: userData,
      })),
    },
    sourcePaths: [inputPath, ...sources.map((source) => source.path)],
  };
}

async function generateSnapshot(inputPath, outputPath, operationOverrides = {}) {
  const fileOperations = withFileOperations(operationOverrides);
  await assertDistinctPaths(inputPath, outputPath, fileOperations);
  const snapshot = await readSnapshotData(inputPath, fileOperations);
  for (const sourcePath of snapshot.sourcePaths.slice(1)) {
    await assertDistinctPaths(sourcePath, outputPath, fileOperations);
  }

  await writeAtomically(outputPath, serializeSnapshot(snapshot.data), fileOperations);
}

const USAGE = `Usage: node scripts/generate-data.js [input-json] [output-script]

Validates a usage export (or a manifest of named sources) and writes a
browser-loadable snapshot script atomically. Defaults to the gitignored
root files usage-sources.json -> usage-data.js.

This is the legacy standalone path; the supported refresh flow is
"bun run refresh <codex|claude|opencode>".
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.length > 2) {
    throw new Error(`Too many arguments.\n\n${USAGE}`);
  }

  const inputPath = args[0]
    ? resolve(process.cwd(), args[0])
    : join(repositoryRoot, "usage-sources.json");
  const outputPath = args[1]
    ? resolve(process.cwd(), args[1])
    : join(repositoryRoot, "usage-data.js");

  await generateSnapshot(inputPath, outputPath);
  console.log(`Generated ${outputPath} from ${inputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate usage snapshot: ${message}`);
    process.exitCode = 1;
  });
}

export { generateSnapshot, serializeSnapshot, writeAtomically };
