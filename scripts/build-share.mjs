#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const PACKAGE_NAME = "codex-usage-dashboard";
const RUNTIME_FILES = [
  "index.html",
  "dashboard.js",
  "dashboard-core.js",
  "usage-data.js",
  "serve.mjs",
];
const VENDOR_FILES = [
  "chart.umd.min.js",
  "chartjs-adapter-date-fns.bundle.min.js",
  "THIRD_PARTY_LICENSES.md",
];

const RECIPIENT_README = `# Codex Usage Dashboard

This folder is a self-contained, offline Codex usage dashboard.

## Open it

Open \`index.html\` in a browser. It immediately shows the bundled usage snapshot.

On macOS, unpack and open it with one command:

\`\`\`bash
unzip -q codex-usage-dashboard.zip && open codex-usage-dashboard/index.html
\`\`\`

The package is already built; no dependency installation or build command is required.

If your browser restricts local \`file://\` pages, run:

\`\`\`bash
node serve.mjs
\`\`\`

Then open the loopback URL printed in the terminal. No install step is required.

## Load another JSON export

Use **Load JSON** or drag a JSON file onto the page. The dashboard accepts output from:

\`\`\`bash
npx ccusage@latest codex daily -j
\`\`\`

The selected file stays in the browser for the current page session only. Reload the page to return to the bundled snapshot.

## Privacy

\`usage-data.js\` contains the separate user and account-total usage dates, costs, and model names from the bundled exports. The raw JSON files are omitted, but the bundled snapshot is not anonymized.

The dashboard and its charts do not require internet access.
`;

async function defaultRunZip({ archivePath, cwd }) {
  await execFileAsync("zip", ["-rq", archivePath, PACKAGE_NAME], { cwd });
}

async function assertRuntimeSources(projectRoot) {
  for (const relativePath of [
    ...RUNTIME_FILES.filter((filename) => filename !== "usage-data.js"),
    ...VENDOR_FILES.map((filename) => path.join("vendor", filename)),
  ]) {
    const sourcePath = path.join(projectRoot, relativePath);
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) throw new Error("not a file");
    } catch (_error) {
      throw new Error(`Required package file is missing: ${relativePath}`);
    }
  }

  const html = await readFile(path.join(projectRoot, "index.html"), "utf8");
  if (/<script[^>]+src=["'](?:https?:)?\/\//i.test(html)) {
    throw new Error("index.html still contains an external script reference");
  }
}

async function resolveLatestSnapshot(projectRoot) {
  const dataRoot = path.join(projectRoot, "data");
  let pointer;
  try {
    pointer = JSON.parse(await readFile(path.join(dataRoot, "latest.json"), "utf8"));
  } catch (error) {
    throw new Error(`Latest usage snapshot pointer is unavailable: ${error.message}`);
  }
  if (!pointer || typeof pointer.snapshot !== "string" || pointer.snapshot.length === 0) {
    throw new Error("Latest usage snapshot pointer is invalid");
  }
  const snapshotPath = path.resolve(dataRoot, pointer.snapshot);
  const relativePath = path.relative(dataRoot, snapshotPath);
  if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Latest usage snapshot points outside the data directory");
  }
  try {
    const snapshotStat = await stat(snapshotPath);
    if (!snapshotStat.isFile()) throw new Error("not a file");
  } catch (error) {
    throw new Error(`Latest usage snapshot is unavailable: ${error.message}`);
  }
  return snapshotPath;
}

async function publishDirectory(stagedPath, finalPath) {
  const backupPath = `${finalPath}.backup-${randomUUID()}`;
  let hadExisting = false;

  try {
    await rename(finalPath, backupPath);
    hadExisting = true;
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  try {
    await rename(stagedPath, finalPath);
  } catch (error) {
    if (hadExisting) await rename(backupPath, finalPath).catch(() => {});
    throw error;
  }

  return hadExisting ? backupPath : null;
}

async function restoreDirectory(finalPath, backupPath) {
  await rm(finalPath, { recursive: true, force: true });
  if (backupPath) await rename(backupPath, finalPath);
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

export async function buildSharePackage(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const distRoot = path.resolve(options.distRoot || path.join(projectRoot, "dist"));
  const runZip = options.runZip || defaultRunZip;
  const packageDir = path.join(distRoot, PACKAGE_NAME);
  const zipPath = path.join(distRoot, `${PACKAGE_NAME}.zip`);

  await assertRuntimeSources(projectRoot);
  const latestSnapshotPath = await resolveLatestSnapshot(projectRoot);
  await mkdir(distRoot, { recursive: true });

  const stagingRoot = await mkdtemp(path.join(distRoot, ".share-stage-"));
  const stagedPackage = path.join(stagingRoot, PACKAGE_NAME);
  const temporaryZip = path.join(
    distRoot,
    `.${PACKAGE_NAME}.${process.pid}.${randomUUID()}.zip`,
  );
  let packageBackupPath = null;

  try {
    await mkdir(path.join(stagedPackage, "vendor"), { recursive: true });
    await Promise.all(RUNTIME_FILES.map(async (filename) => {
      const sourcePath = path.join(projectRoot, filename);
      const targetPath = path.join(stagedPackage, filename);
      if (filename === "index.html") {
        const html = await readFile(sourcePath, "utf8");
        await writeFile(targetPath, html.replace("data/latest.js", "usage-data.js"), "utf8");
        return;
      }
      if (filename === "usage-data.js") {
        await copyFile(latestSnapshotPath, targetPath);
        return;
      }
      await copyFile(sourcePath, targetPath);
    }));
    await Promise.all(VENDOR_FILES.map((filename) => copyFile(
      path.join(projectRoot, "vendor", filename),
      path.join(stagedPackage, "vendor", filename),
    )));
    await writeFile(path.join(stagedPackage, "README.md"), RECIPIENT_README, "utf8");

    await runZip({ archivePath: temporaryZip, cwd: stagingRoot });
    const zipStat = await stat(temporaryZip);
    if (!zipStat.isFile() || zipStat.size === 0) {
      throw new Error("zip did not produce a usable archive");
    }
    packageBackupPath = await publishDirectory(stagedPackage, packageDir);
    try {
      await rename(temporaryZip, zipPath);
    } catch (error) {
      await restoreDirectory(packageDir, packageBackupPath);
      packageBackupPath = null;
      throw error;
    }
    if (packageBackupPath) {
      await rm(packageBackupPath, { recursive: true, force: true });
      packageBackupPath = null;
    }

    return {
      packageDir,
      sha256: await sha256(zipPath),
      size: zipStat.size,
      zipPath,
    };
  } finally {
    if (packageBackupPath) {
      await restoreDirectory(packageDir, packageBackupPath).catch(() => {});
    }
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(temporaryZip, { force: true });
  }
}

async function main() {
  const result = await buildSharePackage();
  console.log(`Folder: ${result.packageDir}`);
  console.log(`ZIP: ${result.zipPath}`);
  console.log(`Size: ${result.size} bytes`);
  console.log(`SHA-256: ${result.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Failed to build share package: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
