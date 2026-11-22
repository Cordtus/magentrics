import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { fetchOpenCodeUsageFromDb } from "../scripts/export-opencode.js";

test("reads assistant usage from the local database", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-db-"));
  const dbPath = path.join(dir, "opencode.db");
  try {
    execFileSync("sqlite3", [
      dbPath,
      `CREATE TABLE session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
       INSERT INTO session_message VALUES
         ('m1','s1','assistant',1,1795000000000,1795000000000,
          '{"time":{"created":1795000000000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.5,"tokens":{"input":10,"output":5,"reasoning":2,"cache":{"read":100,"write":0}}}'),
         ('m2','s1','assistant',2,1795000100000,1795000100000,
          '{"time":{"created":1795000100000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.25,"tokens":{"input":4,"output":1,"reasoning":0,"cache":{"read":20,"write":0}}}'),
         ('m3','s1','user',3,1795000200000,1795000200000,'{}');`,
    ]);
    const result = fetchOpenCodeUsageFromDb({ dbPath });
    assert.equal(result.messages, 2);
    assert.equal(result.sessions, 1);
    assert.equal(result.usage.totals.costUSD, 0.75);
    assert.equal(result.usage.totals.inputTokens, 14);
    assert.equal(result.usage.totals.outputTokens, 8);
    assert.equal(result.usage.totals.cacheReadTokens, 120);
    assert.equal(result.usage.daily.length, 1);
    assert.equal(result.agents.build.totals.totalTokens, result.usage.totals.totalTokens);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-reads only sessions whose signature changed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-db-inc-"));
  const dbPath = path.join(dir, "opencode.db");
  try {
    execFileSync("sqlite3", [
      dbPath,
      `CREATE TABLE session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
       INSERT INTO session_message VALUES
         ('m1','s1','assistant',1,1795000000000,1795000000000,
          '{"time":{"created":1795000000000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.5,"tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":100,"write":0}}}'),
         ('m2','s2','assistant',1,1795000100000,1795000100000,
          '{"time":{"created":1795000100000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.25,"tokens":{"input":4,"output":1,"reasoning":0,"cache":{"read":20,"write":0}}}');`,
    ]);

    const first = fetchOpenCodeUsageFromDb({ dbPath });
    assert.equal(first.fetchedSessions, 2);
    assert.equal(first.reusedSessions, 0);
    assert.equal(first.messages, 2);

    const second = fetchOpenCodeUsageFromDb({ dbPath, cache: first.cache });
    assert.equal(second.fetchedSessions, 0);
    assert.equal(second.reusedSessions, 2);
    assert.deepEqual(second.usage.totals, first.usage.totals);

    execFileSync("sqlite3", [
      dbPath,
      `INSERT INTO session_message VALUES
         ('m3','s1','assistant',2,1795000200000,1795000200000,
          '{"time":{"created":1795000200000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.5,"tokens":{"input":2,"output":3,"reasoning":0,"cache":{"read":10,"write":0}}}');`,
    ]);
    const third = fetchOpenCodeUsageFromDb({ dbPath, cache: second.cache });
    assert.equal(third.fetchedSessions, 1);
    assert.equal(third.reusedSessions, 1);
    assert.equal(third.usage.totals.inputTokens, 16);
    assert.equal(third.usage.totals.costUSD, 1.25);

    // Same count, changed body and timestamp: the time sum catches it.
    execFileSync("sqlite3", [
      dbPath,
      `UPDATE session_message
       SET data = replace(data, '"cost":0.25', '"cost":2.5'), time_updated = time_updated + 1
       WHERE id = 'm2';`,
    ]);
    const fourth = fetchOpenCodeUsageFromDb({ dbPath, cache: third.cache });
    assert.equal(fourth.fetchedSessions, 1);
    assert.equal(fourth.usage.totals.costUSD, 3.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("deleted sessions drop out of the cached totals", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-db-del-"));
  const dbPath = path.join(dir, "opencode.db");
  try {
    execFileSync("sqlite3", [
      dbPath,
      `CREATE TABLE session_message (id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
       INSERT INTO session_message VALUES
         ('m1','s1','assistant',1,1795000000000,1795000000000,
          '{"time":{"created":1795000000000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.5,"tokens":{"input":10,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}'),
         ('m2','s2','assistant',1,1795000100000,1795000100000,
          '{"time":{"created":1795000100000},"agent":"build","model":{"id":"m","providerID":"p"},"cost":0.25,"tokens":{"input":4,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}');`,
    ]);
    const full = fetchOpenCodeUsageFromDb({ dbPath });
    assert.equal(full.sessions, 2);
    execFileSync("sqlite3", [dbPath, "DELETE FROM session_message WHERE session_id = 's2';"]);
    const after = fetchOpenCodeUsageFromDb({ dbPath, cache: full.cache });
    assert.equal(after.sessions, 1);
    assert.equal(after.usage.totals.inputTokens, 10);
    assert.equal(after.usage.totals.costUSD, 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
