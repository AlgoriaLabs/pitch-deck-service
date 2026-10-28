// Process entry point: load config, build the app, check payments work, serve, clean up.

import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { ConfigError, describeConfig, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`✗ ${error.message}\n\nSee .env.example and SETUP.md.`);
  process.exit(78); // EX_CONFIG: systemd won't hot-loop on a config mistake (RestartPreventExitStatus)
}

const { app, provider, storage, cache } = await buildApp(config);
console.log(["pitch-deck-agent", ...describeConfig(config).map((line) => `  ${line}`)].join("\n"));

// Fails fast if the facilitator can't settle on this network, and resumes jobs a restart left behind.
await provider.ready();

const sweep = setInterval(() => {
  void storage.sweep().then((removed) => removed > 0 && console.log(`[sweep] removed ${removed} expired deck(s)`));
  cache.prune();
}, 15 * 60_000);
sweep.unref();

// Behind Caddy in production, so only loopback listens.
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.dev ? "localhost" : "127.0.0.1" }, () => {
  console.log(`listening on :${config.port}  manifest ${provider.manifestUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(sweep);
    server.close(() => void provider.close().then(() => (cache.close(), process.exit(0))));
  });
}
