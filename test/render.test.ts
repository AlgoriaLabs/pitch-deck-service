// The template's two judgement calls: text that runs long gets a smaller font instead of overflowing,
// and the traction tiles show only real, non-zero GitHub numbers.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepoFacts } from "../src/pipeline/digest.js";
import { fit, stats } from "../src/pipeline/render.js";

test("short text keeps the largest size; long text shrinks to fit, down to 70%", () => {
  assert.equal(fit("Ingest data", 2.6, 0.8, 18, true), 18);
  const size = fit("Source of truth for user mappings, repositories and schedules across all programs", 1.6, 1.0, 13);
  assert.ok(size < 13 && size >= 9, `got ${size}`);
  assert.equal(fit("word ".repeat(200), 1, 0.5, 20), 14);
});

test("traction tiles skip zero counts and end with the last update", () => {
  const facts = { stars: 0, forks: 0, contributors: 1, commits: 1234, latestRelease: undefined, pushedAt: "2026-10-01T00:00:00Z" } as RepoFacts;
  assert.deepEqual(stats(facts), [
    ["1", "contributor"],
    ["1.2k", "commits"],
    ["Oct 2026", "last update"],
  ]);
});

test("a popular repository shows its first three counts", () => {
  const facts = { stars: 4321, forks: 87, contributors: 56, commits: 1234, latestRelease: "v2.0.0", pushedAt: "2026-10-01T00:00:00Z" } as RepoFacts;
  assert.deepEqual(stats(facts).map(([, label]) => label), ["GitHub stars", "contributors", "commits", "last update"]);
});
