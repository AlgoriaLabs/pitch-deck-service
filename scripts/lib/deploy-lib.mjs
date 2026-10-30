// Helpers shared by scripts/deploy.mjs, scripts/ci-setup.mjs and scripts/kit.mjs.
// Pure functions first (tested in deploy-lib.test.mjs), then the ones that run terraform and gh.
// Nothing here prints or stores a secret's value.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const TF_DIR = join(ROOT, "deploy/terraform");
export const STATE_DIR = join(ROOT, "deploy/state");
export const TFVARS = join(TF_DIR, "terraform.tfvars");
export const STATE_HCL = join(TF_DIR, "state.hcl");
export const DEFAULT_SSH_KEY = "~/.ssh/pitch-deck";
/** Where the deploy job writes the server's SSH key from its secret. */
export const CI_SSH_KEY = "~/.ssh/deploy";

// ─── Pure ────────────────────────────────────────────────────────────────────

export function expandHome(path) {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** The simple `key = "value"` / `key = 123` lines of a .tfvars file. Comments and blocks are ignored. */
export function parseTfvars(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s#]+))/.exec(line);
    if (match) values[match[1]] = match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : match[3];
  }
  return values;
}

/** Sets `key = "value"` in .tfvars text: replaces an existing line (commented-out ones too), else appends. */
export function setTfvar(text, key, value) {
  const line = `${key} = "${String(value).replace(/["\\]/g, "\\$&")}"`;
  const live = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, "m");
  if (live.test(text)) return text.replace(live, line);
  const commented = new RegExp(`^[ \\t]*#[ \\t]*${key}[ \\t]*=.*$`, "m");
  if (commented.test(text)) return text.replace(commented, line);
  return `${text.trimEnd()}\n${line}\n`;
}

/** deploy/terraform/state.hcl: where the shared state lives. Not secret: no credentials in it. */
export function stateHcl({ bucket, namespace, region, profile }) {
  return [
    "# Where Terraform keeps its state: a private OCI bucket, shared by your laptop and GitHub Actions.",
    "# Written by `npm run deploy`. Commit it. It holds no credentials.",
    `bucket              = "${bucket}"`,
    `namespace           = "${namespace}"`,
    `region              = "${region}"`,
    `key                 = "pitch-deck-agent.tfstate"`,
    `config_file_profile = "${profile}"`,
    "",
  ].join("\n");
}

/** The sections of an OCI config file. Other profiles inherit DEFAULT's keys, as the OCI SDKs read it. */
export function parseOciConfig(text) {
  const sections = {};
  let current;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = sections[header[1]] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (current && eq > 0) current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

/**
 * The one profile CI needs, as config text without its key_file line (the deploy job adds the path it writes the
 * key to), and the local key file to upload with it. Refuses session-token profiles: they expire within hours.
 */
export function ciOciConfig(text, profile) {
  const sections = parseOciConfig(text);
  if (sections[profile] === undefined) throw new Error(`profile [${profile}] isn't in ~/.oci/config`);
  const values = { ...(profile === "DEFAULT" ? {} : sections["DEFAULT"]), ...sections[profile] };
  if (values["security_token_file"]) {
    throw new Error(`profile [${profile}] signs in with a session token, which expires. CI needs an API key profile (DEPLOY.md step 1).`);
  }
  for (const key of ["user", "fingerprint", "tenancy", "region", "key_file"]) {
    if (!values[key]) throw new Error(`profile [${profile}] in ~/.oci/config has no ${key}=`);
  }
  const lines = [`[${profile}]`];
  for (const key of ["user", "fingerprint", "tenancy", "region", "pass_phrase"]) {
    if (values[key]) lines.push(`${key}=${values[key]}`);
  }
  return { config: `${lines.join("\n")}\n`, keyFile: expandHome(values["key_file"]) };
}

/** "1.13.4" ≥ "1.12"? */
export function versionAtLeast(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// ─── Side effects ────────────────────────────────────────────────────────────

export function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

export function readTfvars() {
  if (!existsSync(TFVARS)) fail("deploy/terraform/terraform.tfvars is missing. Fill it in first (DEPLOY.md step 3).");
  return parseTfvars(readFileSync(TFVARS, "utf8"));
}

/** Runs terraform with the terminal attached. Exits on failure unless `allowFail`. */
export function terraform(dir, args, { allowFail = false } = {}) {
  const result = spawnSync("terraform", [`-chdir=${dir}`, ...args], { stdio: "inherit", cwd: ROOT });
  if (result.error) fail("Terraform isn't installed. Install 1.12 or later: https://developer.hashicorp.com/terraform/install");
  if (result.status !== 0 && !allowFail) fail(`terraform ${args[0]} failed (see above).`);
  return result.status ?? 1;
}

export function terraformOutput(dir, name) {
  const result = spawnSync("terraform", [`-chdir=${dir}`, "output", "-raw", name], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export function checkTerraformVersion() {
  const result = spawnSync("terraform", ["version", "-json"], { encoding: "utf8" });
  if (result.error) fail("Terraform isn't installed. Install 1.12 or later: https://developer.hashicorp.com/terraform/install");
  const version = JSON.parse(result.stdout || "{}").terraform_version ?? "0";
  if (!versionAtLeast(version, "1.12")) fail(`Terraform ${version} is too old: the shared state needs 1.12 or later.`);
}

/**
 * Makes sure the shared state exists. The first time, it creates the bucket (deploy/state) and writes state.hcl.
 * Returns true when it just created it: then a local state from an earlier deploy may be moved into it.
 */
export function ensureStateBucket(vars) {
  if (existsSync(STATE_HCL)) return false;
  const region = vars["region"];
  const compartment = vars["compartment_ocid"];
  const profile = vars["oci_profile"] ?? "DEFAULT";
  if (!region || !compartment) fail("region and compartment_ocid must be set in terraform.tfvars first.");
  console.log("\n→ First time: creating a private bucket for Terraform's state (~1 min)\n");
  terraform(STATE_DIR, ["init", "-input=false"]);
  terraform(STATE_DIR, ["apply", "-input=false", "-auto-approve", "-var", `region=${region}`, "-var", `compartment_ocid=${compartment}`, "-var", `oci_profile=${profile}`]);
  const bucket = terraformOutput(STATE_DIR, "bucket");
  const namespace = terraformOutput(STATE_DIR, "namespace");
  if (!bucket || !namespace) fail("the state bucket was created, but its name couldn't be read. Run npm run deploy again.");
  writeFileSync(STATE_HCL, stateHcl({ bucket, namespace, region, profile }));
  console.log(`\n✓ State bucket ready: ${bucket}. Wrote deploy/terraform/state.hcl (commit it).\n`);
  return true;
}

/**
 * terraform init against the shared state. A local terraform.tfstate from before (an earlier deploy from this
 * laptop) is copied into the bucket only when the bucket was just created, so a stale copy can never overwrite
 * newer state, then kept aside as *.migrated-backup.
 */
export function initMain({ justCreated }) {
  const localState = join(TF_DIR, "terraform.tfstate");
  if (existsSync(localState)) {
    if (!justCreated) {
      fail(
        "deploy/terraform/terraform.tfstate is a local state, but the shared state already exists.\n" +
          "  If this laptop deployed before the shared state was set up elsewhere, check which is current before deleting it.",
      );
    }
    console.log("→ Moving your existing local state into the bucket\n");
    terraform(TF_DIR, ["init", "-input=false", "-migrate-state", "-force-copy", "-backend-config=state.hcl"]);
    renameSync(localState, `${localState}.migrated-backup`);
    return;
  }
  terraform(TF_DIR, ["init", "-input=false", "-reconfigure", "-backend-config=state.hcl"]);
}

// ─── GitHub CLI ──────────────────────────────────────────────────────────────

export function gh(args, input) {
  return spawnSync("gh", args, { cwd: ROOT, encoding: "utf8", input });
}

export function ghRepo() {
  const result = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** True when this repo deploys from GitHub Actions (npm run ci:setup ran). False when gh is missing too. */
export function ciEnabled(repo = ghRepo()) {
  if (repo === undefined) return false;
  const result = gh(["variable", "get", "DEPLOY_ENABLED", "--repo", repo]);
  return result.status === 0 && result.stdout.trim() === "true";
}

export function setSecret(repo, name, value) {
  const result = gh(["secret", "set", name, "--repo", repo], value);
  if (result.status !== 0) fail(`couldn't set the GitHub secret ${name}: ${result.stderr.trim()}`);
}
