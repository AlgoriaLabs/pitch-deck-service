#!/usr/bin/env node
// Short commands around the provider-kit CLI, so nobody types the manifest URL:
//
//   npm run wallet [-- mainnet]   set up the wallet buyers pay (USDC trustline), approved in your browser wallet
//   npm run check                 check the service, and see how agents find it
//   npm run try                   pay for one deck with test money (testnet only)
//   npm run register              register on Stellar 8004, approved in your browser wallet; saves the agent id
//                                 to deploy/terraform/terraform.tfvars (then: npm run deploy)
//   npm run verify                the external standard check (C1–C7); needs scripts/update-kit.sh once
//   npm run kit -- <anything>     the provider-kit CLI itself
//
// The service is found in this order: $MANIFEST, then `terraform output` in deploy/terraform, then the local
// server (npm start). Every command signs in your own wallet or not at all: this script never sees a key.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTfvar, TFVARS } from "./lib/deploy-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(root, "node_modules/@stellar-agent-services/provider-kit/dist/cli/index.js");
const VERIFIER = join(root, "vendor/stellar-agent-services/packages/verifier/dist/cli/index.js");
const SERVICE = "pitch-deck";

const [command = "help", ...rest] = process.argv.slice(2);

function run(cli, args) {
  if (!existsSync(cli)) {
    console.error(cli === KIT ? "✗ The kit isn't installed. Run: npm install" : "✗ The verifier comes with the kit's source. Run once: bash scripts/update-kit.sh");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { stdio: "inherit", cwd: root });
  process.exit(result.status ?? 1);
}

/**
 * provider-kit register, with its output shown as it comes. When it prints "Registered agent N on stellar:…",
 * the id is saved to terraform.tfvars as agent_id_<network>, so the next `terraform apply` publishes it [I2].
 */
function register(args) {
  if (!existsSync(KIT)) run(KIT, []);
  // Streamed, not buffered: the approval page's link must show at once, in case no browser opens.
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", KIT, "register", ...args], {
    stdio: ["inherit", "pipe", "inherit"],
    cwd: root,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  // Ctrl+C reaches the child too (same process group); let it cancel cleanly.
  process.on("SIGINT", () => {});
  child.on("close", (status) => afterRegister(status ?? 1, output));
}

function afterRegister(status, output) {
  const match = /Registered agent (\d+) on stellar:(testnet|pubnet)/.exec(output);
  if (status === 0 && match) {
    const [, id, net] = match;
    const key = `agent_id_${net === "pubnet" ? "mainnet" : "testnet"}`;
    if (existsSync(TFVARS)) {
      writeFileSync(TFVARS, setTfvar(readFileSync(TFVARS, "utf8"), key, id));
      console.log(`\n✓ Saved ${key} = "${id}" to deploy/terraform/terraform.tfvars`);
      console.log("  Next: npm run deploy   (publishes the id, ~1 min; also updates GitHub when CI/CD is on)");
    } else {
      console.log(`\n→ Put ${key} = "${id}" in deploy/terraform/terraform.tfvars, then npm run deploy.`);
    }
  }
  process.exit(status);
}

function findManifest() {
  if (process.env.MANIFEST) return { url: process.env.MANIFEST, from: "$MANIFEST" };
  const tf = spawnSync("terraform", ["-chdir=deploy/terraform", "output", "-raw", "manifest_url"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (tf.status === 0 && tf.stdout.startsWith("https://")) return { url: tf.stdout.trim(), from: "terraform output" };
  const port = process.env.PORT ?? "8787";
  return { url: `http://localhost:${port}/.well-known/stellar-agent-services.json`, from: "local server (npm start)" };
}

function withManifest(args) {
  const { url, from } = findManifest();
  console.log(`→ service: ${url}  (${from})\n`);
  const dev = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1") ? ["--dev"] : [];
  return ["--manifest", url, ...args, ...dev];
}

switch (command) {
  case "wallet": {
    const network = rest[0] === "mainnet" ? "mainnet" : "testnet";
    console.log(`→ Opening a page to connect your wallet (${network}). Switch the wallet itself to ${network === "mainnet" ? "Mainnet" : "Testnet"} too.\n`);
    run(KIT, ["trustline", "--network", network, ...rest.filter((a) => a !== "mainnet" && a !== "testnet")]);
    break;
  }
  case "check":
    run(KIT, ["check", ...withManifest(rest)]);
    break;
  case "try":
    // --dev isn't a try flag: it reads the provider as it is.
    run(KIT, ["try", SERVICE, ...withManifest(rest).filter((a) => a !== "--dev")]);
    break;
  case "register":
    register(withManifest(rest).filter((a) => a !== "--dev"));
    break;
  case "verify": {
    const { url, from } = findManifest();
    console.log(`→ service: ${url}  (${from})\n`);
    run(VERIFIER, ["check", url, ...rest]);
    break;
  }
  case "kit":
    run(KIT, rest);
    break;
  default:
    console.log("Commands: wallet [mainnet] · check · try · register · verify · kit -- <args>");
    process.exit(command === "help" ? 0 : 2);
}
