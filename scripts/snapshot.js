// Shared snapshot helpers: atomic writes and browser snapshot serialization.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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

export { serializeSnapshot, writeAtomically };
