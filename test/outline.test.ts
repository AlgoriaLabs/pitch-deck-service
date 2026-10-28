// The model's JSON is validated and repaired, never trusted as-is.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { OutlineError, parseOutline } from "../src/pipeline/outline.js";

const fixture = readFileSync(new URL("../../test/fixtures/outline.json", import.meta.url), "utf8");

test("the fixture outline is valid", () => {
  assert.equal(parseOutline(fixture).projectName, "Stellar Agent Services");
});

test("code fences and chatter around the JSON are ignored", () => {
  assert.equal(parseOutline(`Sure! Here it is:\n\`\`\`json\n${fixture}\n\`\`\`\nHope this helps`).roadmap.items.length, 4);
});

test("over-long strings are cut at a word and extra items dropped", () => {
  const raw = JSON.parse(fixture);
  raw.tagline = "word ".repeat(60);
  raw.problem.bullets = [...raw.problem.bullets, "fifth", "sixth"];
  const outline = parseOutline(JSON.stringify(raw));
  assert.ok(outline.tagline.length <= 100);
  assert.ok(outline.tagline.endsWith("…"));
  assert.equal(outline.problem.bullets.length, 4);
});

test("a missing section fails validation", () => {
  const raw = JSON.parse(fixture);
  delete raw.roadmap;
  assert.throws(() => parseOutline(JSON.stringify(raw)), OutlineError);
});

test("non-JSON fails cleanly", () => {
  assert.throws(() => parseOutline("I can't help with that"), OutlineError);
});
