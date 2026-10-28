// The free-tier fallback chain: a rate-limited provider hands over to the next, and a bad JSON
// answer gets one repair retry before moving on.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import type { LlmProviderConfig } from "../src/config.js";
import type { Digest } from "../src/pipeline/digest.js";
import { generateOutline, LlmError } from "../src/pipeline/llm.js";

const fixture = readFileSync(new URL("../../test/fixtures/outline.json", import.meta.url), "utf8");
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const provider = (name: string): LlmProviderConfig => ({ name, baseUrl: `https://${name}.test/v1`, apiKey: "k", model: `${name}-model` });
const digest = { text: "repo", facts: {} } as unknown as Digest;
const quiet = { warn: () => {}, info: () => {} } as unknown as Console;
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

function fakeLlm(answers: Record<string, (() => Response)[]>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const host = new URL(String(input)).hostname.split(".")[0]!;
    calls.push(host);
    const next = answers[host]?.shift();
    if (next === undefined) throw new Error(`unexpected call to ${host}`);
    return next();
  }) as typeof fetch;
  return calls;
}

test("a 429 from the first provider falls through to the second", async () => {
  const calls = fakeLlm({ gemini: [() => new Response("quota", { status: 429 })], groq: [() => completion(fixture)] });
  const result = await generateOutline([provider("gemini"), provider("groq")], digest, AbortSignal.timeout(5000), quiet);
  assert.equal(result.provider, "groq");
  assert.deepEqual(calls, ["gemini", "groq"]);
});

test("invalid JSON gets one repair retry on the same provider", async () => {
  const calls = fakeLlm({ gemini: [() => completion("{ not json"), () => completion(fixture)] });
  const result = await generateOutline([provider("gemini")], digest, AbortSignal.timeout(5000), quiet);
  assert.equal(result.provider, "gemini");
  assert.deepEqual(calls, ["gemini", "gemini"]);
});

test("when every provider fails the job fails (and the buyer is not charged)", async () => {
  fakeLlm({ gemini: [() => new Response("down", { status: 503 })], openrouter: [() => completion("nope"), () => completion("still nope")] });
  await assert.rejects(generateOutline([provider("gemini"), provider("openrouter")], digest, AbortSignal.timeout(5000), quiet), LlmError);
});
