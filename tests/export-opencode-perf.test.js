import assert from "node:assert/strict";
import test from "node:test";

import { aggregate } from "../scripts/export-opencode-perf.js";

function row({ session = "ses_1", created, streamed, firstToken = null, context = 0, output = 0 }) {
  return {
    session_id: session,
    created,
    firstToken,
    streamed,
    context,
    output,
  };
}

test("aggregates model time, overhead, and context buckets", () => {
  const report = aggregate(
    [
      row({ created: 1_000, firstToken: 3_000, streamed: 11_000, context: 10_000, output: 1_000 }),
      row({ created: 16_000, streamed: 21_000, context: 300_000, output: 100 }),
    ],
    1,
  );

  assert.equal(report.totals.turns, 2);
  assert.equal(report.totals.avgTurnsPerRequest, 2);
  // Turn 1: 10s model + 5s overhead; turn 2: 5s model + no next turn.
  assert.equal(report.totals.avgTurnSeconds, 10);
  assert.equal(report.totals.p95TurnSeconds, 15);
  assert.equal(report.totals.avgTtftSeconds, 2);
  assert.equal(report.totals.avgTokensPerSecond, 125);

  const buckets = Object.fromEntries(report.byContext.map((bucket) => [bucket.bucket, bucket]));
  assert.equal(buckets["<50k"].turns, 1);
  assert.equal(buckets["<50k"].avgModelSeconds, 10);
  assert.equal(buckets["<50k"].avgOverheadSeconds, 5);
  assert.equal(buckets["200-400k"].turns, 1);
  assert.equal(buckets["200-400k"].avgContext, 300_000);
});

test("ignores rows without a completed stream", () => {
  const report = aggregate([row({ created: 1_000, streamed: 500 })], 1);
  assert.equal(report.totals.turns, 0);
  assert.equal(report.totals.avgTurnSeconds, 0);
});
