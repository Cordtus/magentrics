import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorPath = path.resolve(__dirname, "../scripts/generate-data.js");


function validExport() {
  return {
    daily: [
      {
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
      },
    ],
    metadata: "</script><script>unexpected()</script>\u2028\u2029",
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

function runGenerator(inputPath, outputPath) {
  return spawnSync(process.execPath, [generatorPath, inputPath, outputPath], {
    encoding: "utf8",
  });
}

async function makeTestDirectory(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "codex-usage-generator-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("valid JSON produces a safe browser-loadable snapshot of the raw export", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "usage-data.js");
  const raw = validExport();
  await writeFile(inputPath, JSON.stringify(raw), "utf8");

  const result = runGenerator(inputPath, outputPath);

  assert.equal(result.status, 0, result.stderr);
  const generatedScript = await readFile(outputPath, "utf8");
  assert.equal(generatedScript.includes("</script>"), false);
  assert.equal(generatedScript.includes("\u2028"), false);
  assert.equal(generatedScript.includes("\u2029"), false);

  const context = { window: {} };
  vm.runInNewContext(generatedScript, context);
  const generatedData = JSON.parse(
    JSON.stringify(context.window.CODEX_USAGE_DATA),
  );
  assert.deepEqual(generatedData, raw);
});

test("a named source manifest produces a browser bundle that preserves both users", async (t) => {
  const directory = await makeTestDirectory(t);
  const manifestPath = path.join(directory, "usage-sources.json");
  const outputPath = path.join(directory, "usage-data.js");
  const myself = validExport();
  const marius = validExport();
  marius.daily[0].date = "2026-07-10";
  await writeFile(path.join(directory, "myself.json"), JSON.stringify(myself), "utf8");
  await writeFile(path.join(directory, "marius.json"), JSON.stringify(marius), "utf8");
  await writeFile(manifestPath, JSON.stringify({
    users: [
      { id: "myself", name: "Myself", file: "myself.json" },
      { id: "marius", name: "Marius", file: "marius.json" },
    ],
  }), "utf8");

  const result = runGenerator(manifestPath, outputPath);

  assert.equal(result.status, 0, result.stderr);
  const context = { window: {} };
  vm.runInNewContext(await readFile(outputPath, "utf8"), context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA)),
    {
      users: [
        { id: "myself", name: "Myself", data: myself },
        { id: "marius", name: "Marius", data: marius },
      ],
    },
  );
});

test("a missing manifest source preserves the previous snapshot", async (t) => {
  const directory = await makeTestDirectory(t);
  const manifestPath = path.join(directory, "usage-sources.json");
  const outputPath = path.join(directory, "usage-data.js");
  const existingSnapshot = "window.CODEX_USAGE_DATA = { preserved: true };\n";
  await writeFile(manifestPath, JSON.stringify({
    users: [{ id: "marius", name: "Marius", file: "missing.json" }],
  }), "utf8");
  await writeFile(outputPath, existingSnapshot, "utf8");

  const result = runGenerator(manifestPath, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source file.*missing\.json/i);
  assert.equal(await readFile(outputPath, "utf8"), existingSnapshot);
});

test("malformed JSON fails without replacing an existing snapshot", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "usage-data.js");
  const existingSnapshot = "window.CODEX_USAGE_DATA = { preserved: true };\n";
  await writeFile(inputPath, "{ not valid JSON", "utf8");
  await writeFile(outputPath, existingSnapshot, "utf8");

  const result = runGenerator(inputPath, outputPath);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(outputPath, "utf8"), existingSnapshot);
});

test("inconsistent usage data fails without replacing an existing snapshot", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "usage-data.js");
  const existingSnapshot = "window.CODEX_USAGE_DATA = { preserved: true };\n";
  const inconsistent = validExport();
  inconsistent.totals.totalTokens = 36;
  await writeFile(inputPath, JSON.stringify(inconsistent), "utf8");
  await writeFile(outputPath, existingSnapshot, "utf8");

  const result = runGenerator(inputPath, outputPath);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(outputPath, "utf8"), existingSnapshot);
});

test("refuses to replace the source JSON when input and output paths are the same", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "codex-usage.json");
  const source = JSON.stringify(validExport());
  await writeFile(inputPath, source, "utf8");

  const result = runGenerator(inputPath, inputPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /input JSON and output script must be different files/i);
  assert.equal(await readFile(inputPath, "utf8"), source);
});

test("refuses distinct paths that point to the same source file", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "codex-usage.json");
  const outputPath = path.join(directory, "usage-data.js");
  const source = JSON.stringify(validExport());
  await writeFile(inputPath, source, "utf8");
  await link(inputPath, outputPath);

  const result = runGenerator(inputPath, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /input JSON and output script must be different files/i);
  assert.equal(await readFile(inputPath, "utf8"), source);
  assert.equal(await readFile(outputPath, "utf8"), source);
});

test("an atomic replacement failure preserves the existing snapshot and removes its temporary file", async (t) => {
  const directory = await makeTestDirectory(t);
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "usage-data.js");
  const existingSnapshot = "window.CODEX_USAGE_DATA = { preserved: true };\n";
  await writeFile(inputPath, JSON.stringify(validExport()), "utf8");
  await writeFile(outputPath, existingSnapshot, "utf8");
  const { generateSnapshot } = await import(pathToFileURL(generatorPath).href);

  await assert.rejects(
    generateSnapshot(inputPath, outputPath, {
      async rename() {
        throw new Error("simulated atomic rename failure");
      },
    }),
    /simulated atomic rename failure/,
  );

  assert.equal(await readFile(outputPath, "utf8"), existingSnapshot);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["input.json", "usage-data.js"],
    "the failed replacement must not leave a temporary script behind",
  );
});

test("the checked-in browser snapshot matches the configured named source bundle", async () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "usage-sources.json"), "utf8"),
  );
  const expected = {
    users: await Promise.all(manifest.users.map(async (user) => ({
      id: user.id,
      name: user.name,
      data: JSON.parse(await readFile(path.join(repositoryRoot, user.file), "utf8")),
    }))),
  };
  const generatedScript = await readFile(
    path.join(repositoryRoot, "usage-data.js"),
    "utf8",
  );
  const context = { window: {} };

  vm.runInNewContext(generatedScript, context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA)),
    expected,
  );
});
