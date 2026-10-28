// The network switch: one variable picks every network-specific value, and mainnet refuses to start
// without the values it has no safe default for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

const A = "GBZSBASBFMV5RGKPRIPCB5QQVAJ35IXKMTF2A2766MOA4ZHQ7MLSIPXU";
const B = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const base = { PUBLIC_ORIGIN: "https://deck.example.com", GEMINI_API_KEY: "k", PAY_TO_TESTNET: A, PAY_TO_MAINNET: B };

test("testnet is the default and needs no RPC or facilitator key", () => {
  const config = loadConfig(base);
  assert.equal(config.network, "stellar:testnet");
  assert.equal(config.payTo, A);
  assert.equal(config.facilitatorUrl, "https://x402.org/facilitator");
  assert.equal(config.rpcUrl, "https://soroban-testnet.stellar.org");
  assert.equal(config.jobDbPath, "./data/jobs-testnet.sqlite");
  assert.deepEqual(config.facilitatorHeaders, {});
});

test("STELLAR_NETWORK=mainnet switches payTo, facilitator, RPC and job database together", () => {
  const config = loadConfig({
    ...base,
    STELLAR_NETWORK: "mainnet",
    SOROBAN_RPC_URL_MAINNET: "https://mainnet.sorobanrpc.com",
    FACILITATOR_API_KEY_MAINNET: "secret",
    AGENT_ID_MAINNET: "42",
    AGENT_ID_TESTNET: "7",
  });
  assert.equal(config.network, "stellar:pubnet");
  assert.equal(config.payTo, B);
  assert.equal(config.agentId, 42);
  assert.equal(config.facilitatorUrl, "https://channels.openzeppelin.com/x402");
  assert.deepEqual(config.facilitatorHeaders, { Authorization: "Bearer secret" });
  assert.equal(config.rpcUrl, "https://mainnet.sorobanrpc.com");
  assert.equal(config.jobDbPath, "./data/jobs-mainnet.sqlite");
});

test("mainnet without RPC or facilitator key refuses to start, naming both", () => {
  assert.throws(
    () => loadConfig({ ...base, STELLAR_NETWORK: "pubnet" }),
    (error: unknown) => error instanceof ConfigError && /SOROBAN_RPC_URL_MAINNET/.test(error.message) && /FACILITATOR_API_KEY_MAINNET/.test(error.message),
  );
});

test("a secret key in PAY_TO is rejected", () => {
  assert.throws(() => loadConfig({ ...base, PAY_TO_TESTNET: "SBZSBASBFMV5RGKPRIPCB5QQVAJ35IXKMTF2A2766MOA4ZHQ7MLSIPXU" }), /never a secret/);
});

test("a public origin must be https", () => {
  assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: "http://deck.example.com" }), /https/);
  assert.equal(loadConfig({ ...base, PUBLIC_ORIGIN: "http://localhost:8787" }).dev, true);
});

test("LLM chain keeps the free-tier order and only providers with keys", () => {
  const config = loadConfig({ ...base, GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o", GROQ_API_KEY: "" });
  assert.deepEqual(config.llmProviders.map((p) => p.name), ["gemini", "openrouter"]);
});
