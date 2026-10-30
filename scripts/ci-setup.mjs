#!/usr/bin/env node
// npm run ci:setup: turns on automatic deploys from GitHub Actions. Run it once, on the laptop you deploy from.
//
//   - makes sure the shared Terraform state exists (creates the bucket the first time)
//   - uploads 5 GitHub secrets: the OCI API key and its profile, the server's SSH key pair, terraform.tfvars
//   - sets the repository variable DEPLOY_ENABLED=true, which turns the deploy job on
//
// npm run ci:sync uploads terraform.tfvars only (npm run deploy also does it by itself).
// Needs the GitHub CLI, logged in: brew install gh && gh auth login.
// No Stellar key is involved: the server and CI never hold one.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  checkTerraformVersion,
  ciOciConfig,
  DEFAULT_SSH_KEY,
  ensureStateBucket,
  expandHome,
  fail,
  gh,
  ghRepo,
  initMain,
  readTfvars,
  ROOT,
  setSecret,
  TFVARS,
} from "./lib/deploy-lib.mjs";

const syncOnly = process.argv.includes("--sync");

// 1. GitHub CLI and the repository
if (gh(["--version"]).error) fail("The GitHub CLI isn't installed. Install it (brew install gh), then: gh auth login");
if (gh(["auth", "status"]).status !== 0) fail("The GitHub CLI isn't logged in. Run: gh auth login");
const repo = ghRepo();
if (repo === undefined) fail("This folder isn't a GitHub repository gh can see. Clone it from GitHub, or check: git remote -v");

const vars = readTfvars();

if (syncOnly) {
  setSecret(repo, "TFVARS", readFileSync(TFVARS, "utf8"));
  console.log(`✓ Updated terraform.tfvars in ${repo}`);
  process.exit(0);
}

console.log(`Turning on automatic deploys for ${repo}\n`);

// 2. Everything CI needs must exist locally before anything is uploaded
const profile = vars["oci_profile"] ?? "DEFAULT";
const configPath = expandHome("~/.oci/config");
if (!existsSync(configPath)) fail("~/.oci/config is missing (DEPLOY.md step 1).");
let oci;
try {
  oci = ciOciConfig(readFileSync(configPath, "utf8"), profile);
} catch (error) {
  fail(error.message);
}
if (!existsSync(oci.keyFile)) fail(`The OCI API key file ${oci.keyFile} (key_file= in ~/.oci/config) is missing.`);

const sshPrivate = expandHome(vars["ssh_private_key_path"] ?? DEFAULT_SSH_KEY);
const sshPublic = expandHome(vars["ssh_public_key_path"] ?? `${DEFAULT_SSH_KEY}.pub`);
for (const path of [sshPrivate, sshPublic]) if (!existsSync(path)) fail(`SSH key ${path} is missing (DEPLOY.md step 1).`);
if (/^ssh-(ed25519|rsa)/.test(readFileSync(sshPrivate, "utf8"))) fail(`${sshPrivate} looks like a public key. Point ssh_private_key_path at the private one.`);

const cidr = vars["ssh_allowed_cidr"];
if (cidr !== undefined && cidr !== "0.0.0.0/0") {
  console.log(`! ssh_allowed_cidr is ${cidr}. GitHub's runners connect from changing addresses, so deploys from CI will fail to`);
  console.log("  reach the server. Remove that line from terraform.tfvars (SSH accepts keys only), then run npm run deploy.\n");
}

// 3. The shared state (CI and this laptop must use the same one)
checkTerraformVersion();
const justCreated = ensureStateBucket(vars);
initMain({ justCreated });

// 4. Secrets and the switch
console.log("\n→ Uploading secrets to GitHub (encrypted; nobody can read them back, CI only uses them)");
setSecret(repo, "OCI_CONFIG", oci.config);
setSecret(repo, "OCI_API_KEY", readFileSync(oci.keyFile, "utf8"));
setSecret(repo, "SSH_PRIVATE_KEY", readFileSync(sshPrivate, "utf8"));
setSecret(repo, "SSH_PUBLIC_KEY", readFileSync(sshPublic, "utf8"));
setSecret(repo, "TFVARS", readFileSync(TFVARS, "utf8"));
const variable = gh(["variable", "set", "DEPLOY_ENABLED", "--body", "true", "--repo", repo]);
if (variable.status !== 0) fail(`couldn't set the variable DEPLOY_ENABLED: ${variable.stderr.trim()}`);
console.log("  ✓ OCI_CONFIG  ✓ OCI_API_KEY  ✓ SSH_PRIVATE_KEY  ✓ SSH_PUBLIC_KEY  ✓ TFVARS  ✓ DEPLOY_ENABLED=true");

// 5. What's left: committing state.hcl, so CI finds the shared state
const status = spawnSync("git", ["status", "--porcelain", "--", "deploy/terraform/state.hcl"], { cwd: ROOT, encoding: "utf8" });
console.log("\n✓ Automatic deploys are on.\n");
if (status.stdout.trim() !== "") {
  console.log("Last step: commit the state location and push. That push deploys.\n");
  console.log("  git add deploy/terraform/state.hcl");
  console.log('  git commit -m "Turn on automatic deploys"');
  console.log("  git push\n");
} else {
  console.log("Every push to main now tests and deploys. To deploy now without a push: gh workflow run ci-cd.yml\n");
}
console.log(`Watch it: https://github.com/${repo}/actions`);
