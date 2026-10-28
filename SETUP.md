# Setup guide

> **Goal:** Pitch Deck Agent live on HTTPS, paid in testnet USDC, registered on Stellar 8004.
> Then a one-line switch to mainnet.
>
> **Time:** ~45 min the first time. Every step is short. Tick the box, move on.

```
 A. Local (10 min)  →  B. Accounts (10 min)  →  C. Deploy (15 min)  →  D. Register + pay (10 min)  →  E. Mainnet (later)
```

Rules of the road:

- 🔑 **Secret keys never leave the Stellar CLI keychain.** The server only ever sees the public `G...` address.
- 📍 Run every command from the repo root unless the step says `cd`.
- 🆘 Stuck? Jump to [Troubleshooting](#troubleshooting) at the bottom.

---

## A. Local — prove it works on your laptop

### A1. Install the tools · 3 min

- [ ] Node.js 24 (`node -v` → `v24.x`; 22.13+ also works)
- [ ] Terraform ≥ 1.6 (`terraform -v`)
- [ ] OCI CLI (`oci -v`) → [install](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm)
- [ ] Stellar CLI (`stellar --version`) → [install](https://developers.stellar.org/docs/tools/cli)

### A2. Build and test · 3 min

```bash
npm run vendor     # fetches + builds provider-kit (pinned commit), ~1 min once
npm install
npm test
```

✅ You see `# pass 18`, `# fail 0`.

### A3. Make one deck · 4 min

- [ ] Get a free Gemini key: [aistudio.google.com](https://aistudio.google.com) → **Get API key**
- [ ] Create `.env`:

```bash
cp .env.example .env
# open .env and set GEMINI_API_KEY=...
```

```bash
npm run build
npm run deck -- https://github.com/AlgoriaLabs/stellar-agent-services
```

✅ You get `stellar-agent-services.pptx`. Open it. That's the product.

> No key yet? `LLM_MOCK=1 npm run deck -- <url>` makes a deck with canned text.

---

## B. Accounts — the three things you need

### B1. Your payTo address (testnet) · 2 min

This is the public address that receives USDC. It needs a USDC trustline.

```bash
stellar keys generate payto-testnet --network testnet --fund
stellar tx new change-trust --source-account payto-testnet --network testnet \
  --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
stellar keys address payto-testnet
```

- [ ] Copy the `G...` address. You'll paste it as `pay_to_testnet`.

### B2. Oracle Cloud · 6 min

- [ ] Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Pick your **home region** carefully:
      Always Free Ampere VMs only run there.
- [ ] Run `oci setup config` and follow the prompts (it makes `~/.oci/config` and an API key).
- [ ] Upload the public API key it printed: Console → your profile → **API keys** → **Add API key** → paste.
- [ ] Copy your **tenancy OCID** (profile → Tenancy) and **region id** (e.g. `eu-frankfurt-1`).

✅ `oci iam region list` prints regions without an error.

### B3. SSH key · 30 s

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

### B4. Optional but recommended · 2 min

- [ ] GitHub token (no scopes, public read only): [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
      → lifts GitHub from 60 to 5,000 requests/hour.
- [ ] A fallback LLM key: [console.groq.com](https://console.groq.com) and/or [openrouter.ai](https://openrouter.ai).

---

## C. Deploy — one `terraform apply`

### C1. Fill in the variables · 3 min

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

- [ ] Fill every line marked ★. Leave mainnet lines empty for now.

### C2. Apply · ~10 min (mostly waiting)

```bash
terraform init
terraform apply
```

It creates a network, an Ampere VM, a reserved IP, then uploads and starts the app.

✅ The last lines show:

```
✓ healthy: {"ok":true,"network":"testnet"}
manifest_url = "https://<ip>.sslip.io/.well-known/stellar-agent-services.json"
```

- [ ] Save the manifest URL: `export MANIFEST=$(terraform output -raw manifest_url)`

### C3. Check it from outside · 2 min

```bash
cd ../..
curl -s $MANIFEST | head -c 300; echo
npm run kit -- check --manifest $MANIFEST
```

✅ Every line passes, except "agent id missing". That's next.

---

## D. Register and take a real (testnet) payment

### D1. Register on Stellar 8004 · 3 min

This puts your service on chain, so Stellar Agent Search can find it. It signs with your `payto-testnet` key from
the CLI keychain.

```bash
npm run kit -- register --manifest $MANIFEST --source payto-testnet --dry-run   # look first
npm run kit -- register --manifest $MANIFEST --source payto-testnet
```

- [ ] Copy the **agent id** it prints into `terraform.tfvars` → `agent_id_testnet = "<id>"`
- [ ] Redeploy: `cd deploy/terraform && terraform apply && cd ../..` (≈1 min, same VM)
- [ ] `npm run kit -- check --manifest $MANIFEST` → all green now.

### D2. Pay your own service · 4 min

Use a **separate** payer wallet (never your payTo).

```bash
npm run stellar-pay -- wallet create
npm run stellar-pay -- wallet fund --usdc 2
npm run stellar-pay -- pay $MANIFEST pitch-deck '{"repoUrl":"https://github.com/AlgoriaLabs/stellar-agent-services"}'
```

✅ You approve 0.10 USDC, wait ~30–60 s, and get a `deckUrl`. Open it. The transfer is on chain.

### D3. Standard check · 2 min

```bash
npm run verifier -- check $MANIFEST
```

✅ C1–C7 pass. 🎉 **Testnet is done.**

---

## E. Switch to mainnet

Do this when you're ready to earn real USDC. Three preparation steps, one line, then register.

### M1. Mainnet Soroban RPC · 2 min

- [ ] Pick a provider from [Stellar's RPC list](https://developers.stellar.org/docs/data/apis/rpc/providers)
      (several have free tiers or public endpoints) and copy its URL.

### M2. Facilitator API key · 1 min

- [ ] [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) → sign in with GitHub → copy the key.
      It's shown **once**.

### M3. Mainnet payTo address · 5 min

```bash
stellar network add mainnet --rpc-url <RPC URL from M1> \
  --network-passphrase "Public Global Stellar Network ; September 2015"
stellar keys generate payto-mainnet
stellar keys address payto-mainnet
```

- [ ] Send ~3 XLM to that address (from an exchange or another wallet). It activates the account.
- [ ] Add the USDC trustline (mainnet issuer):

```bash
stellar tx new change-trust --source-account payto-mainnet --network mainnet \
  --line USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

### M4. Flip the switch · 3 min

In `deploy/terraform/terraform.tfvars`:

```hcl
stellar_network             = "mainnet"      # ← the switch
pay_to_mainnet              = "G..."         # from M3
soroban_rpc_url_mainnet     = "https://..."  # from M1
facilitator_api_key_mainnet = "..."          # from M2
domain                      = "deck.example.com"  # strongly recommended on mainnet (see note)
```

```bash
cd deploy/terraform && terraform apply && cd ../..
export MANIFEST=$(terraform -chdir=deploy/terraform output -raw manifest_url)
```

✅ `{"ok":true,"network":"mainnet"}`. If a value is missing, the deploy stops before switching and names it;
the old release keeps serving.

> **Why a real domain on mainnet?** Your manifest URL goes on chain in the 8004 registration. With your own domain
> you can move servers later without re-registering. Point an `A` record at `terraform output public_ip` before
> applying.

### M5. Register on mainnet · 3 min

```bash
npm run kit -- register --manifest $MANIFEST --source payto-mainnet --dry-run
npm run kit -- register --manifest $MANIFEST --source payto-mainnet
```

- [ ] Put the new id in `agent_id_mainnet`, then `terraform apply` again.
- [ ] Check how buyers see you: `npx -y stellar-agent-search@0.1.0 find "pitch deck"`

### Going back to testnet

`stellar_network = "testnet"` → `terraform apply`. Each network keeps its own job database, so nothing is lost
or mixed.

---

## Day 2

| I want to… | Do this |
| --- | --- |
| Ship a code change | `terraform -chdir=deploy/terraform apply` (zips the repo, builds on the VM, restarts) |
| See logs | `$(terraform -chdir=deploy/terraform output -raw logs)` |
| Roll back | SSH in → `cd /opt/pitch-deck-agent && ls releases` → `sudo ln -sfn releases/<old> current && sudo systemctl restart pitch-deck-agent` |
| Change the price | `price_usdc` in tfvars → apply |
| Rotate an API key | edit tfvars → apply |
| Tear it all down | `terraform -chdir=deploy/terraform destroy` (keep your Stellar keys!) |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Out of host capacity` on apply | Free A1 capacity is busy. Set `availability_domain_index = 1` (or 2) and apply again, or retry later. |
| Apply hangs at "Still creating… terraform_data.deploy" | First boot installs Node + Caddy (~5 min). Normal. Over 15 min: `ssh ubuntu@<ip> sudo tail -50 /var/log/cloud-init-output.log` |
| `✗ deploy stopped` with `configuration for mainnet:` | A mainnet value is missing; the message names it. Fill it in tfvars, apply. The old release kept running. |
| `facilitator … does not support` at start | Wrong facilitator for the network, or a bad key. Check `FACILITATOR_*` for that network. |
| Browser shows a certificate error | Let's Encrypt needs ports 80/443 open and DNS pointing at the VM. Check `sudo journalctl -u caddy -n 50`. With sslip.io, rate limits can hit; use your own domain. |
| Jobs fail with `GitHub rate limit` | Set `github_token`. |
| Jobs fail, log says `no LLM produced a usable outline` | Free-tier quota used up. Add a second key (Groq / OpenRouter) so the chain can fall back. Buyers weren't charged. |
| `npm run kit` says command not found | Run `npm run vendor` first. |
| Need to change Ampere size | Edit `ocpus` / `memory_gb` and apply. Stay inside your Always Free allowance in the OCI console, or it bills. |
