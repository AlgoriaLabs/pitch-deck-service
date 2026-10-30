#!/usr/bin/env node
// npm run deploy: one command for every deploy, from your laptop or from GitHub Actions.
//
//   1. The first time, creates the private state bucket and writes deploy/terraform/state.hcl
//   2. terraform init against that shared state (moving an older local state into it, once)
//   3. When CI/CD is on, uploads terraform.tfvars to GitHub, so the next automatic deploy uses the same values
//   4. terraform apply: shows the plan and asks (add -- --yes to skip the question)
//
// GitHub Actions runs `node scripts/deploy.mjs --ci`: no bucket creation, no question, its own SSH key path.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import {
  CI_SSH_KEY,
  checkTerraformVersion,
  ciEnabled,
  ensureStateBucket,
  expandHome,
  fail,
  ghRepo,
  initMain,
  readTfvars,
  setSecret,
  STATE_HCL,
  terraform,
  terraformOutput,
  TF_DIR,
  TFVARS,
} from "./lib/deploy-lib.mjs";

const ci = process.argv.includes("--ci");
const yes = ci || process.argv.includes("--yes");

const vars = readTfvars();
checkTerraformVersion();

let justCreated = false;
if (ci) {
  if (!existsSync(STATE_HCL)) fail("deploy/terraform/state.hcl isn't committed. Run npm run ci:setup on your laptop, then commit it.");
} else {
  justCreated = ensureStateBucket(vars);
}
initMain({ justCreated });

if (!ci) {
  const repo = ghRepo();
  if (repo !== undefined && ciEnabled(repo)) {
    setSecret(repo, "TFVARS", readFileSync(TFVARS, "utf8"));
    console.log(`✓ Updated terraform.tfvars in GitHub (${repo}), so automatic deploys use the same values\n`);
  }
}

const sshOverride = ci ? ["-var", `ssh_public_key_path=${expandHome(CI_SSH_KEY)}.pub`, "-var", `ssh_private_key_path=${expandHome(CI_SSH_KEY)}`] : [];
terraform(TF_DIR, ["apply", "-input=false", ...(yes ? ["-auto-approve"] : []), ...sshOverride]);

const manifest = terraformOutput(TF_DIR, "manifest_url");
const network = terraformOutput(TF_DIR, "network") ?? vars["stellar_network"] ?? "testnet";
console.log(`\n✓ Deployed on ${network}: ${manifest ?? "(no manifest_url output)"}`);
if (!ci) console.log("  Next: npm run check");

if (process.env.GITHUB_STEP_SUMMARY && manifest) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Deployed on ${network}\n\n- Manifest: ${manifest}\n- Commit: ${process.env.GITHUB_SHA ?? ""}\n`);
}
