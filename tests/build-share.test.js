import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "..");
const builderUrl = pathToFileURL(
  path.join(repositoryRoot, "scripts/build-share.js"),
).href;


function validExport() {
  return {
    daily: [{
      cacheCreationTokens: 0,
      cacheReadTokens: 20,
      costUSD: 0.42,
      date: "2026-07-09",
      inputTokens: 10,
      models: {
        "gpt-test": {
          cacheCreationTokens: 0,
          cacheReadTokens: 20,
          inputTokens: 10,
          isFallback: false,
          outputTokens: 5,
          reasoningOutputTokens: 2,
          totalTokens: 35,
        },
      },
      outputTokens: 5,
      reasoningOutputTokens: 2,
      totalTokens: 35,
    }],
    totals: {
      cacheCreationTokens: 0,
      cacheReadTokens: 20,
      costUSD: 0.42,
      inputTokens: 10,
      outputTokens: 5,
      reasoningOutputTokens: 2,
      totalTokens: 35,
    },
  };
}

async function makeFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-usage-share-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectRoot = path.join(directory, "project");
  const distRoot = path.join(directory, "dist");
  await mkdir(path.join(projectRoot, "vendor"), { recursive: true });

  for (const filename of ["index.html", "dashboard.js", "dashboard-core.js", "serve.js"]) {
    await copyFile(path.join(repositoryRoot, filename), path.join(projectRoot, filename));
  }
  for (const filename of [
    "chart.umd.min.js",
    "chartjs-adapter-date-fns.bundle.min.js",
    "THIRD_PARTY_LICENSES.md",
  ]) {
    await copyFile(
      path.join(repositoryRoot, "vendor", filename),
      path.join(projectRoot, "vendor", filename),
    );
  }
  const myself = validExport();
  const marius = validExport();
  marius.daily[0].date = "2026-07-10";
  await writeFile(path.join(projectRoot, "myself.json"), JSON.stringify(myself), "utf8");
  await writeFile(path.join(projectRoot, "marius.json"), JSON.stringify(marius), "utf8");
  await writeFile(path.join(projectRoot, "usage-sources.json"), JSON.stringify({
    users: [
      { id: "myself", name: "Myself", file: "myself.json" },
      { id: "marius", name: "Marius", file: "marius.json" },
    ],
  }), "utf8");
  const bundledData = {
    users: [
      { id: "myself", name: "Myself", data: myself },
      { id: "marius", name: "Marius", data: marius },
    ],
  };
  await mkdir(path.join(projectRoot, "data", "snapshots"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "data", "snapshots", "usage-fixture.js"),
    `window.CODEX_USAGE_DATA = ${JSON.stringify(bundledData)};\n`,
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "data", "latest.json"),
    JSON.stringify({ generatedAt: "2026-08-01T02:00:00.000Z", snapshot: "snapshots/usage-fixture.js" }),
    "utf8",
  );

  return {
    directory,
    projectRoot,
    distRoot,
    bundledData,
  };
}

test("builds the exact offline folder and ZIP with a faithful bundled snapshot", async (t) => {
  const { buildSharePackage } = await import(builderUrl);
  const { projectRoot, distRoot, bundledData } = await makeFixture(t);

  const result = await buildSharePackage({ projectRoot, distRoot });

  assert.equal(path.basename(result.packageDir), "codex-usage-dashboard");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const { stdout } = await execFileAsync("unzip", ["-Z1", result.zipPath]);
  assert.deepEqual(stdout.trim().split("\n").sort(), [
    "codex-usage-dashboard/",
    "codex-usage-dashboard/README.md",
    "codex-usage-dashboard/dashboard-core.js",
    "codex-usage-dashboard/dashboard.js",
    "codex-usage-dashboard/index.html",
    "codex-usage-dashboard/serve.js",
    "codex-usage-dashboard/usage-data.js",
    "codex-usage-dashboard/vendor/",
    "codex-usage-dashboard/vendor/THIRD_PARTY_LICENSES.md",
    "codex-usage-dashboard/vendor/chart.umd.min.js",
    "codex-usage-dashboard/vendor/chartjs-adapter-date-fns.bundle.min.js",
  ].sort());

  const packagedHtml = await readFile(path.join(result.packageDir, "index.html"), "utf8");
  assert.doesNotMatch(packagedHtml, /<script[^>]+src=["'](?:https?:)?\/\//i);
  const snapshot = await readFile(path.join(result.packageDir, "usage-data.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(snapshot, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA)),
    bundledData,
  );
});

test("packages the snapshot selected by the latest pointer", async (t) => {
  const { buildSharePackage } = await import(builderUrl);
  const { projectRoot, distRoot } = await makeFixture(t);
  const selectedSnapshot = "window.CODEX_USAGE_DATA = { selected: 'newest' };\n";
  await mkdir(path.join(projectRoot, "data", "snapshots"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "data", "snapshots", "usage-newest.js"),
    selectedSnapshot,
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "data", "latest.json"),
    JSON.stringify({ generatedAt: "2026-08-01T03:00:00.000Z", snapshot: "snapshots/usage-newest.js" }),
    "utf8",
  );

  const result = await buildSharePackage({ projectRoot, distRoot });

  assert.equal(
    await readFile(path.join(result.packageDir, "usage-data.js"), "utf8"),
    selectedSnapshot,
  );
});

test("a ZIP failure preserves the last successful archive and package folder", async (t) => {
  const { buildSharePackage } = await import(builderUrl);
  const { projectRoot, distRoot } = await makeFixture(t);
  const first = await buildSharePackage({ projectRoot, distRoot });
  const originalArchive = await readFile(first.zipPath);
  const originalPackageSnapshot = await readFile(
    path.join(first.packageDir, "usage-data.js"),
    "utf8",
  );
  const changedMyself = validExport();
  changedMyself.daily[0].date = "2026-07-11";
  await writeFile(
    path.join(projectRoot, "myself.json"),
    JSON.stringify(changedMyself),
    "utf8",
  );

  await assert.rejects(
    buildSharePackage({
      projectRoot,
      distRoot,
      async runZip() {
        throw new Error("simulated zip failure");
      },
    }),
    /simulated zip failure/,
  );

  assert.deepEqual(await readFile(first.zipPath), originalArchive);
  assert.deepEqual(
    await readFile(path.join(first.packageDir, "usage-data.js"), "utf8"),
    originalPackageSnapshot,
  );
});
