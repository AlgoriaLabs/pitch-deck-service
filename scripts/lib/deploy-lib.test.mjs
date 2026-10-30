// The deploy helpers that touch files and secrets: parsing tfvars, editing them, and building the OCI profile
// CI gets. Offline; terraform and gh are tested by running the scripts against stand-ins (see the CI notes).

import assert from "node:assert/strict";
import { test } from "node:test";
import { ciOciConfig, parseOciConfig, parseTfvars, setTfvar, stateHcl, versionAtLeast } from "./deploy-lib.mjs";

const TFVARS = `# comment
region           = "eu-frankfurt-1"                # ★ the region= line
compartment_ocid = "ocid1.tenancy.oc1..aaa"
# availability_domain_index = 1
stellar_network = "testnet"
agent_id_testnet = ""
ocpus = 2
`;

test("parseTfvars reads quoted and bare values, ignores comments", () => {
  const vars = parseTfvars(TFVARS);
  assert.equal(vars.region, "eu-frankfurt-1");
  assert.equal(vars.compartment_ocid, "ocid1.tenancy.oc1..aaa");
  assert.equal(vars.agent_id_testnet, "");
  assert.equal(vars.ocpus, "2");
  assert.equal(vars.availability_domain_index, undefined);
});

test("setTfvar replaces a line, uncomments a commented one, or appends", () => {
  let text = setTfvar(TFVARS, "agent_id_testnet", "42");
  assert.match(text, /^agent_id_testnet = "42"$/m);
  assert.doesNotMatch(text, /agent_id_testnet = ""/);
  text = setTfvar(text, "availability_domain_index", 1);
  assert.match(text, /^availability_domain_index = "1"$/m);
  text = setTfvar(text, "agent_id_mainnet", "7");
  assert.ok(text.endsWith('agent_id_mainnet = "7"\n'));
  assert.equal(parseTfvars(text).region, "eu-frankfurt-1");
});

test("setTfvar escapes quotes, so a value can't break the file", () => {
  const text = setTfvar("", "domain", 'a"b');
  assert.equal(parseTfvars(text).domain, 'a"b');
});

const OCI = `[DEFAULT]
user=ocid1.user.oc1..u
fingerprint=aa:bb
tenancy=ocid1.tenancy.oc1..t
region=eu-frankfurt-1
key_file=~/.oci/oci_api_key.pem

[WORK]
user = ocid1.user.oc1..w
key_file = /keys/work.pem

[SESSION]
security_token_file=/tmp/token
key_file=/keys/s.pem
`;

test("ciOciConfig keeps one profile, drops key_file, and finds the key", () => {
  const { config, keyFile } = ciOciConfig(OCI, "DEFAULT");
  assert.equal(config, "[DEFAULT]\nuser=ocid1.user.oc1..u\nfingerprint=aa:bb\ntenancy=ocid1.tenancy.oc1..t\nregion=eu-frankfurt-1\n");
  assert.doesNotMatch(config, /key_file/);
  assert.ok(keyFile.endsWith("/.oci/oci_api_key.pem") && !keyFile.startsWith("~"));
});

test("ciOciConfig: other profiles inherit DEFAULT, as the OCI SDKs read them", () => {
  const { config, keyFile } = ciOciConfig(OCI, "WORK");
  assert.match(config, /^\[WORK\]\nuser=ocid1\.user\.oc1\.\.w\nfingerprint=aa:bb\ntenancy=/);
  assert.equal(keyFile, "/keys/work.pem");
});

test("ciOciConfig refuses session tokens and missing profiles", () => {
  assert.throws(() => ciOciConfig(OCI, "SESSION"), /session token/);
  assert.throws(() => ciOciConfig(OCI, "NOPE"), /isn't in/);
  assert.throws(() => ciOciConfig("[DEFAULT]\nuser=u\n", "DEFAULT"), /no fingerprint=/);
});

test("parseOciConfig handles spaces around =", () => {
  assert.equal(parseOciConfig(OCI).WORK.key_file, "/keys/work.pem");
});

test("stateHcl holds the location only", () => {
  const text = stateHcl({ bucket: "b", namespace: "ns", region: "eu-frankfurt-1", profile: "DEFAULT" });
  assert.match(text, /bucket\s+= "b"/);
  assert.match(text, /config_file_profile = "DEFAULT"/);
  assert.doesNotMatch(text, /fingerprint|key_file|ocid1\.user/);
});

test("versionAtLeast", () => {
  assert.ok(versionAtLeast("1.13.4", "1.12"));
  assert.ok(versionAtLeast("1.12.0", "1.12"));
  assert.ok(!versionAtLeast("1.11.9", "1.12"));
  assert.ok(versionAtLeast("2.0.0", "1.12"));
});
