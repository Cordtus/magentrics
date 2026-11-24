import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const snapshotUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/snapshot.js"),
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

async function makeTestDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-usage-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("serializeSnapshot keeps arbitrary text out of the script body", async () => {
  const { serializeSnapshot } = await import(snapshotUrl);
  const raw = validExport();
  const script = serializeSnapshot(raw);

  assert.equal(script.includes("</script>"), false);
  assert.equal(script.includes("\u2028"), false);
  assert.equal(script.includes("\u2029"), false);

  const context = { window: {} };
  vm.runInNewContext(script, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.CODEX_USAGE_DATA)), raw);
});

test("a failed atomic replacement preserves the existing file and removes its temporary", async (t) => {
  const directory = await makeTestDirectory(t);
  const outputPath = path.join(directory, "usage-data.js");
  const existingSnapshot = "window.CODEX_USAGE_DATA = { preserved: true };\n";
  await writeFile(outputPath, existingSnapshot, "utf8");
  const { writeAtomically } = await import(snapshotUrl);

  await assert.rejects(
    writeAtomically(outputPath, "replacement", {
      async rename() {
        throw new Error("simulated atomic rename failure");
      },
    }),
    /simulated atomic rename failure/,
  );

  assert.equal(await readFile(outputPath, "utf8"), existingSnapshot);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["usage-data.js"],
    "the failed replacement must not leave a temporary file behind",
  );
});
