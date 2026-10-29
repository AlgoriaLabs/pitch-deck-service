// Builds the provider and the HTTP app from a Config. server.ts runs it; tests build it with a fake
// facilitator and no chain reads.
//
// provider-kit answers the standard's routes (manifest, create-job, check-status, get-result). This
// file adds /decks/<file>.pptx downloads and /healthz.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createProvider, httpFacilitator, sqliteStore, type Facilitator, type JobStore, type Provider } from "@stellar-agent-services/provider-kit";
import { Hono } from "hono";
import type { Config } from "./config.js";
import { OutlineCache } from "./pipeline/cache.js";
import { pitchDeckService } from "./service.js";
import { DeckStorage } from "./storage.js";

export interface AppOverrides {
  facilitator?: Facilitator;
  store?: JobStore;
  rpc?: false;
}

export interface App {
  app: Hono;
  provider: Provider;
  storage: DeckStorage;
  cache: OutlineCache;
}

export async function buildApp(config: Config, overrides: AppOverrides = {}): Promise<App> {
  const storage = new DeckStorage(config.decksDir, config.publicOrigin, config.retentionSeconds + 3600);
  await storage.init();
  const cache = new OutlineCache(config.cacheDbPath);

  const rpc = overrides.rpc ?? config.rpcUrl;
  const provider = createProvider({
    baseUrl: config.publicOrigin,
    dev: config.dev,
    network: config.network,
    payTo: config.payTo,
    facilitator: overrides.facilitator ?? httpFacilitator(config.facilitatorUrl, { dev: config.dev, headers: config.facilitatorHeaders }),
    provider: {
      // name + description are what stellar-agent-search matches, through the 8004 registration file.
      name: "Pitch Deck Agent",
      // Search reads only this name and description, never the services: every word a buyer types goes here.
      // `npm run check` lists the words it would miss.
      description: "AI agent that turns a GitHub repository into a startup pitch deck: an investor presentation as PowerPoint PPTX slides. Paid per deck in USDC over x402.",
      dataUse: { storesInputs: false, trainsOnInputs: false },
      ...(config.agentId === undefined ? {} : { agentId: config.agentId }),
    },
    services: [pitchDeckService({ config, cache, storage }, config.priceUsdc)],
    store: overrides.store ?? sqliteStore(config.jobDbPath),
    // on-success needs expectedDurationSeconds ≤ maxTimeoutSeconds / 2 [S2]: 60 ≤ 150.
    maxTimeoutSeconds: 300,
    retentionSeconds: config.retentionSeconds,
    ...(rpc === undefined ? {} : { rpc }),
    // Behind Caddy, the client address arrives in X-Forwarded-For.
    rateLimit: { requests: 20, windowSeconds: 60, key: (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() },
  });

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, network: config.networkName }));
  app.get("/decks/:name", async (c) => {
    const path = storage.pathFor(c.req.param("name"));
    const info = path === undefined ? undefined : await stat(path).catch(() => undefined);
    if (path === undefined || info === undefined) return c.json({ error: "not found or expired" }, 404);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Length": String(info.size),
        "Content-Disposition": 'attachment; filename="pitch-deck.pptx"',
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "X-Robots-Tag": "noindex",
      },
    });
  });
  app.all("*", (c) => provider.fetch(c.req.raw));
  return { app, provider, storage, cache };
}
