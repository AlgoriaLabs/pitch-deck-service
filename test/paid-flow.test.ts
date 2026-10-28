// End to end, offline: a buyer asks for a deck, gets a 402, pays with a real (offline-signed) x402
// payment, and downloads a 10-slide PPTX. GitHub is faked by serving a tarball built here; the
// facilitator is faked; the LLM is the mock. Everything else (provider-kit, digest, render, storage)
// is the production code.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { signTestPayment } from "@stellar-agent-services/provider-kit/testing";
import type { Facilitator } from "@stellar-agent-services/provider-kit";
import { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { create as tarCreate } from "tar";
import { buildApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const SHA = "a".repeat(40);
const realFetch = globalThis.fetch;
let dir: string;
let built: App;
let settles = 0;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "deck-test-"));
  const tarball = await fixtureTarball(dir);

  // Fake GitHub: four API calls and the tarball.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (url === "https://api.github.com/repos/acme/rocket") {
      return json({ full_name: "acme/rocket", html_url: "https://github.com/acme/rocket", description: "Launches rockets from YAML", stargazers_count: 4321, forks_count: 87, open_issues_count: 5, topics: ["rockets"], license: { spdx_id: "MIT" }, default_branch: "main", created_at: "2025-01-01T00:00:00Z", pushed_at: "2026-10-01T00:00:00Z" });
    }
    if (url.startsWith("https://api.github.com/repos/acme/rocket/commits/")) return new Response(SHA);
    if (url === "https://api.github.com/repos/acme/rocket/languages") return json({ TypeScript: 9000, Python: 1000 });
    if (url === "https://api.github.com/repos/acme/rocket/releases/latest") return new Response("{}", { status: 404 });
    if (url === `https://codeload.github.com/acme/rocket/tar.gz/${SHA}`) return new Response(new Uint8Array(tarball));
    if (url.startsWith("https://api.github.com/")) return new Response("{}", { status: 404 });
    return realFetch(input, init);
  }) as typeof fetch;

  const config = loadConfig({
    STELLAR_NETWORK: "testnet",
    PUBLIC_ORIGIN: "http://localhost:8787",
    PAY_TO_TESTNET: Keypair.random().publicKey(),
    LLM_MOCK: "1",
    DATA_DIR: join(dir, "data"),
  });
  const facilitator: Facilitator = {
    verify: async () => ({ isValid: true }),
    settle: async (_payload, requirements) => ({ success: true, transaction: (++settles).toString(16).padStart(64, "0"), network: requirements.network }),
  };
  built = await buildApp(config, { facilitator, rpc: false });
  await built.provider.ready();
});

after(async () => {
  globalThis.fetch = realFetch;
  await built.provider.close();
  built.cache.close();
  await rm(dir, { recursive: true, force: true });
});

const createJob = (headers: Record<string, string> = {}, body: unknown = { repoUrl: "https://github.com/acme/rocket" }) =>
  built.app.fetch(
    new Request("http://localhost:8787/services/pitch-deck/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

test("the manifest lists the pitch-deck service at 0.10 USDC, charged on success", async () => {
  const response = await built.app.fetch(new Request("http://localhost:8787/.well-known/stellar-agent-services.json"));
  assert.equal(response.status, 200);
  const manifest = (await response.json()) as { services: { name: string; price: { amount: string }; charge: string }[]; payment: { accepts: { network: string }[] } };
  assert.equal(manifest.services[0]!.name, "pitch-deck");
  assert.equal(manifest.services[0]!.price.amount, "1000000");
  assert.equal(manifest.services[0]!.charge, "on-success");
  assert.equal(manifest.payment.accepts[0]!.network, "stellar:testnet");
});

test("bad input is rejected before any payment is asked for", async () => {
  const response = await createJob({}, { repoUrl: "https://gitlab.com/a/b" });
  assert.equal(response.status, 400);
});

test("pay → deck: 402, paid request, 10-slide PPTX download", async () => {
  const challenge = await createJob();
  assert.equal(challenge.status, 402);
  const required = decodePaymentRequiredHeader(challenge.headers.get("PAYMENT-REQUIRED")!);
  const requirements = required.accepts[0] as PaymentRequirements;
  assert.equal(requirements.amount, "1000000");

  const payment = encodePaymentSignatureHeader(await signTestPayment(requirements, Keypair.random()));
  const paid = await createJob({ "PAYMENT-SIGNATURE": payment });
  const view = (await paid.json()) as { status: string; charged: boolean; output?: { deckUrl: string; slideCount: number; commitSha: string; title: string } };
  assert.equal(paid.status, 200, JSON.stringify(view));
  assert.equal(view.status, "succeeded");
  assert.equal(view.charged, true);
  assert.equal(settles, 1);
  assert.equal(view.output!.slideCount, 10);
  assert.equal(view.output!.commitSha, SHA);

  const name = view.output!.deckUrl.split("/").pop()!;
  const download = await built.app.fetch(new Request(`http://localhost:8787/decks/${name}`));
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), "PK"); // a zip, as every .pptx is
  assert.ok(bytes.length > 20_000);
});

test("deck URLs can't be guessed or traversed", async () => {
  for (const name of ["../config.ts", "abc.pptx", "%2e%2e%2fjobs-testnet.sqlite"]) {
    const response = await built.app.fetch(new Request(`http://localhost:8787/decks/${name}`));
    assert.equal(response.status, 404);
  }
});

async function fixtureTarball(root: string): Promise<Buffer> {
  const top = join(root, "repo", `acme-rocket-${SHA.slice(0, 7)}`);
  await mkdir(join(top, "src"), { recursive: true });
  await mkdir(join(top, "docs"), { recursive: true });
  await writeFile(join(top, "README.md"), "# Rocket\n\nLaunch rockets from a YAML file.\n\n![badge](https://x/y.svg)\n\n## Roadmap\n- Mars\n");
  await writeFile(join(top, "package.json"), JSON.stringify({ name: "rocket", dependencies: { hono: "4", "@stellar/stellar-sdk": "16" } }));
  await writeFile(join(top, "src", "index.ts"), "export const launch = () => 'liftoff';\n");
  await writeFile(join(top, "docs", "guide.md"), "# Guide\nHow to launch.\n");
  await writeFile(join(top, "Dockerfile"), "FROM node:24\n");
  const chunks: Buffer[] = [];
  const stream = tarCreate({ gzip: true, cwd: join(root, "repo") }, [`acme-rocket-${SHA.slice(0, 7)}`]);
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
