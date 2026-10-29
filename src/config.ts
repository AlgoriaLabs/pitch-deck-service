// Configuration from environment variables, with one switch for the Stellar network.
//
// STELLAR_NETWORK=testnet | mainnet picks every network-specific value at once: the CAIP-2 id, the
// facilitator, the Soroban RPC, the payTo address, the 8004 agent id and the job database. Each
// network has its own variables (PAY_TO_TESTNET / PAY_TO_MAINNET …) so switching is one line, and
// testnet and mainnet jobs never share a database (stellar-agent-services AGENTS.md rule 6).
//
// Only public values and API keys live here. A Stellar secret key never does (rule 1).

import { SOROBAN_RPC_URL, type StellarNetwork } from "@stellar-agent-services/protocol";

export type NetworkName = "testnet" | "mainnet";

export interface LlmProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Config {
  networkName: NetworkName;
  network: StellarNetwork;
  publicOrigin: string;
  dev: boolean;
  port: number;
  payTo: string;
  agentId: number | undefined;
  facilitatorUrl: string;
  facilitatorHeaders: Record<string, string>;
  rpcUrl: string | undefined;
  priceUsdc: string;
  dataDir: string;
  jobDbPath: string;
  cacheDbPath: string;
  decksDir: string;
  retentionSeconds: number;
  githubToken: string | undefined;
  llmProviders: LlmProviderConfig[];
  maxRepoBytes: number;
}

/** Network defaults. Every value can be overridden per network with the variables in .env.example. */
const NETWORKS: Record<NetworkName, { network: StellarNetwork; facilitator: string; rpc: string | undefined; price: string }> = {
  // The facilitator stellar-agent-services develops against: sponsored fees, no key.
  testnet: { network: "stellar:testnet", facilitator: "https://x402.org/facilitator", rpc: SOROBAN_RPC_URL["stellar:testnet"], price: "0.10" },
  // OpenZeppelin's free public Stellar facilitator (sponsored fees). Needs an API key: see DEPLOY.md.
  // The RPC is the public endpoint the kit's own 8004 tooling uses on mainnet (@trionlabs/stellar8004
  // MAINNET_CONFIG). SDF runs none, so the protocol package leaves pubnet without a default.
  mainnet: { network: "stellar:pubnet", facilitator: "https://channels.openzeppelin.com/x402", rpc: "https://mainnet.sorobanrpc.com", price: "0.10" },
};

/** Default LLM chain: free tiers first. Each entry is used only when its API key is set. */
const LLM_DEFAULTS = [
  { name: "gemini", keyVar: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite" },
  { name: "groq", keyVar: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  { name: "openrouter", keyVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3-coder:free" },
] as const;

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Env = Record<string, string | undefined>;

export function parseNetworkName(value: string | undefined): NetworkName {
  const v = (value ?? "testnet").trim().toLowerCase();
  if (v === "testnet" || v === "stellar:testnet") return "testnet";
  if (v === "mainnet" || v === "pubnet" || v === "stellar:pubnet") return "mainnet";
  throw new ConfigError(`STELLAR_NETWORK must be "testnet" or "mainnet", not "${value}"`);
}

export function loadConfig(env: Env = process.env): Config {
  const networkName = parseNetworkName(env["STELLAR_NETWORK"]);
  const defaults = NETWORKS[networkName];
  const suffix = networkName.toUpperCase();
  // PAY_TO_MAINNET, then PAY_TO: the per-network name wins.
  const pick = (name: string): string | undefined => {
    const value = env[`${name}_${suffix}`] ?? env[name];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };
  const problems: string[] = [];

  const port = Number(env["PORT"] ?? "8787");
  const publicOrigin = (env["PUBLIC_ORIGIN"] ?? `http://localhost:${port}`).replace(/\/+$/, "");
  const dev = publicOrigin.startsWith("http://localhost") || publicOrigin.startsWith("http://127.0.0.1");
  if (!dev && !publicOrigin.startsWith("https://")) problems.push("PUBLIC_ORIGIN must be https:// (http://localhost only for local development)");

  const payTo = pick("PAY_TO");
  if (payTo === undefined) problems.push(`set PAY_TO_${suffix}: the public G... address that receives ${networkName} USDC`);
  else if (!/^G[A-Z2-7]{55}$/.test(payTo)) problems.push(`PAY_TO_${suffix} must be a public G... address (never a secret S... key)`);

  const agentIdText = pick("AGENT_ID");
  const agentId = agentIdText === undefined ? undefined : Number(agentIdText);
  if (agentId !== undefined && (!Number.isInteger(agentId) || agentId < 0)) problems.push(`AGENT_ID_${suffix} must be a whole number`);

  const facilitatorUrl = pick("FACILITATOR_URL") ?? defaults.facilitator;
  const facilitatorKey = pick("FACILITATOR_API_KEY");
  if (networkName === "mainnet" && facilitatorUrl.includes("openzeppelin.com") && facilitatorKey === undefined) {
    problems.push("set FACILITATOR_API_KEY_MAINNET: the OpenZeppelin facilitator needs an API key (DEPLOY.md, Mainnet)");
  }

  // Reads the chain to decide payment_uncertain jobs and to time on-success jobs. Public defaults on both
  // networks; set SOROBAN_RPC_URL_MAINNET to your own provider for more headroom.
  const rpcUrl = pick("SOROBAN_RPC_URL") ?? defaults.rpc;

  const priceUsdc = pick("PRICE_USDC") ?? defaults.price;
  if (!/^\d+(\.\d{1,7})?$/.test(priceUsdc) || Number(priceUsdc) <= 0) problems.push("PRICE_USDC must be a positive decimal such as 0.10");

  const llmProviders: LlmProviderConfig[] = [];
  for (const llm of LLM_DEFAULTS) {
    const apiKey = env[llm.keyVar]?.trim();
    if (apiKey === undefined || apiKey === "") continue;
    const upper = llm.name.toUpperCase();
    llmProviders.push({
      name: llm.name,
      apiKey,
      baseUrl: (env[`${upper}_BASE_URL`] ?? llm.baseUrl).replace(/\/+$/, ""),
      model: env[`${upper}_MODEL`] ?? llm.model,
    });
  }
  if (env["LLM_MOCK"] === "1") llmProviders.push({ name: "mock", apiKey: "", baseUrl: "", model: "mock" });
  if (llmProviders.length === 0) problems.push("set at least one of GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY (or LLM_MOCK=1 for local tests)");

  if (problems.length > 0) throw new ConfigError(`configuration for ${networkName}:\n  - ${problems.join("\n  - ")}`);

  const dataDir = (env["DATA_DIR"] ?? "./data").replace(/\/+$/, "");
  const retentionSeconds = Number(env["RETENTION_SECONDS"] ?? "86400");

  return {
    networkName,
    network: defaults.network,
    publicOrigin,
    dev,
    port,
    payTo: payTo!,
    agentId,
    facilitatorUrl,
    facilitatorHeaders: facilitatorKey === undefined ? {} : { Authorization: `Bearer ${facilitatorKey}` },
    rpcUrl,
    priceUsdc,
    dataDir,
    // One job database per network: a testnet job can never be recovered on mainnet, or the reverse.
    jobDbPath: `${dataDir}/jobs-${networkName}.sqlite`,
    cacheDbPath: `${dataDir}/cache.sqlite`,
    decksDir: `${dataDir}/decks`,
    retentionSeconds,
    githubToken: env["GITHUB_TOKEN"]?.trim() || undefined,
    llmProviders,
    maxRepoBytes: Number(env["MAX_REPO_MB"] ?? "40") * 1024 * 1024,
  };
}

/** One line per setting for the startup log. Never prints keys. */
export function describeConfig(config: Config): string[] {
  return [
    `network      ${config.networkName} (${config.network})`,
    `origin       ${config.publicOrigin}${config.dev ? "  [dev mode]" : ""}`,
    `payTo        ${config.payTo}`,
    `agentId      ${config.agentId ?? "(not registered yet)"}`,
    `price        ${config.priceUsdc} USDC per deck`,
    `facilitator  ${config.facilitatorUrl}${Object.keys(config.facilitatorHeaders).length > 0 ? " (with API key)" : ""}`,
    `rpc          ${config.rpcUrl}`,
    `llm chain    ${config.llmProviders.map((p) => `${p.name}:${p.model}`).join(" → ")}`,
    `job db       ${config.jobDbPath}`,
  ];
}
