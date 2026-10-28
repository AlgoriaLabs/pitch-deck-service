# Deploy in 5 moves

> One page. One thing at a time. Tick the box, then look only at the next one.
> ⏱ ~35 min the first time, most of it waiting. Every later deploy is one command.

```
[ 1 Collect ] → [ 2 Configure ] → [ 3 Apply ] → [ 4 Register ] → [ 5 Prove it ]      … later: [ Mainnet ]
    10 min          3 min           10 min          5 min            5 min                     10 min
```

**TL;DR** (once you've done moves 1–2):

```bash
cd deploy/terraform && terraform init && terraform apply
```

---

## 1 · Collect · 10 min

Get these seven things. Paste each into a scratch note as you go: you'll need them in move 2.

| ✓ | What | Where | Goes into |
| --- | --- | --- | --- |
| ☐ | Region + tenancy OCID | OCI console → profile → Tenancy | `region`, `compartment_ocid` |
| ☐ | OCI CLI auth | run `oci setup config`, upload the key it prints (profile → API keys) | `~/.oci/config` |
| ☐ | SSH key | `ls ~/.ssh/id_ed25519.pub \|\| ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519` | read automatically |
| ☐ | Testnet payTo address | the 3 commands below | `pay_to_testnet` |
| ☐ | Gemini API key | [aistudio.google.com](https://aistudio.google.com) → Get API key | `gemini_api_key` |
| ☐ | Your email | — | `acme_email` |
| ☐ | *(optional)* GitHub token, Groq key | [GitHub tokens](https://github.com/settings/personal-access-tokens) (no scopes) · [console.groq.com](https://console.groq.com) | `github_token`, `groq_api_key` |

Testnet payTo address (the key stays in the Stellar CLI; only the `G...` address goes anywhere):

```bash
stellar keys generate payto-testnet --network testnet --fund
stellar tx new change-trust --source-account payto-testnet --network testnet \
  --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
stellar keys address payto-testnet
```

> Tools needed: `terraform` ≥ 1.6, `oci`, `stellar`, `node` 24. Missing one? Install it, come back.

---

## 2 · Configure · 3 min

```bash
git clone https://github.com/AlgoriaLabs/pitch-deck-service.git
cd pitch-deck-service/deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

☐ Open `terraform.tfvars`. Fill only the lines marked ★. Leave everything else as it is.

---

## 3 · Apply · ~10 min

```bash
terraform init
terraform apply        # type "yes"
```

What you'll see, so you know it's not stuck:

| Minute | Happening |
| --- | --- |
| 0–2 | network, VM, IP get created |
| 2–8 | `terraform_data.deploy: Still creating…` — the VM installs Node + Caddy. **Normal. Go get water.** |
| 8–10 | app uploads, builds, starts, health check |

✅ **Checkpoint:** you see

```
✓ healthy: {"ok":true,"network":"testnet"}
manifest_url = "https://…sslip.io/.well-known/stellar-agent-services.json"
```

☐ Save it for the next moves:

```bash
export MANIFEST=$(terraform output -raw manifest_url)
cd ../..
```

---

## 4 · Register on Stellar 8004 · 5 min

Puts the service on chain so buyers and Stellar Agent Search can find it.

```bash
npm run vendor && npm install                                              # tools, once
npm run kit -- register --manifest $MANIFEST --source payto-testnet --dry-run   # look
npm run kit -- register --manifest $MANIFEST --source payto-testnet             # do
```

☐ Copy the **agent id** it prints → `agent_id_testnet = "<id>"` in `terraform.tfvars`
☐ Redeploy (1 min, same VM):

```bash
terraform -chdir=deploy/terraform apply
```

---

## 5 · Prove it · 5 min

Pay your own service from a separate wallet:

```bash
npm run stellar-pay -- wallet create
npm run stellar-pay -- wallet fund --usdc 2
npm run stellar-pay -- pay $MANIFEST pitch-deck '{"repoUrl":"https://github.com/AlgoriaLabs/stellar-agent-services"}'
npm run verifier -- check $MANIFEST
```

✅ **Checkpoint:** a `deckUrl` you can open, and every verifier check green.

🎉 **Done. You're live on testnet.** Stop here for today if you want.

---

## Later · Go mainnet · 10 min

Three things to collect, one line to flip.

| ✓ | What | Where | Goes into |
| --- | --- | --- | --- |
| ☐ | Mainnet RPC URL | [Stellar RPC providers](https://developers.stellar.org/docs/data/apis/rpc/providers) | `soroban_rpc_url_mainnet` |
| ☐ | Facilitator API key (shown once!) | [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) | `facilitator_api_key_mainnet` |
| ☐ | Mainnet payTo address | commands below, then send it ~3 XLM | `pay_to_mainnet` |
| ☐ | *(recommended)* your own domain | `A` record → `terraform output public_ip` | `domain` |

```bash
stellar network add mainnet --rpc-url <RPC URL> \
  --network-passphrase "Public Global Stellar Network ; September 2015"
stellar keys generate payto-mainnet
stellar keys address payto-mainnet
# send ~3 XLM to it first, then:
stellar tx new change-trust --source-account payto-mainnet --network mainnet \
  --line USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

**Flip:**

```hcl
stellar_network = "mainnet"
```

```bash
terraform -chdir=deploy/terraform apply
export MANIFEST=$(terraform -chdir=deploy/terraform output -raw manifest_url)
npm run kit -- register --manifest $MANIFEST --source payto-mainnet
# paste the new id into agent_id_mainnet, apply once more
```

> Something missing? The deploy **stops before switching** and names it. The old version keeps serving.
> Going back: `stellar_network = "testnet"` → apply. Each network keeps its own job database.

---

## Cheat sheet

| I want to… | Run |
| --- | --- |
| Ship a code change | `terraform -chdir=deploy/terraform apply` |
| Watch logs | `$(terraform -chdir=deploy/terraform output -raw logs)` |
| Check the service | `npm run kit -- check --manifest $MANIFEST` |
| Change price / keys | edit `terraform.tfvars` → apply |
| Roll back | `ssh ubuntu@<ip>` → `cd /opt/pitch-deck-agent && ls releases` → `sudo ln -sfn releases/<old> current && sudo systemctl restart pitch-deck-agent` |
| Delete everything | `terraform -chdir=deploy/terraform destroy` *(Stellar keys stay safe in your CLI)* |

## 🆘 If this, then that

| You see | Do |
| --- | --- |
| `Out of host capacity` | `availability_domain_index = 1` (or `2`) → apply. Or retry in an hour. |
| Stuck on `Still creating…` > 15 min | `ssh ubuntu@<ip> sudo tail -50 /var/log/cloud-init-output.log` |
| `✗ deploy stopped` | Read the line under it: it names the missing value. Fix tfvars → apply. |
| `✗ not healthy` | `ssh ubuntu@<ip> journalctl -u pitch-deck-agent -n 50` |
| Certificate error in the browser | `ssh ubuntu@<ip> sudo journalctl -u caddy -n 50`. On sslip.io, rate limits can hit: set `domain`. |
| Jobs fail: `GitHub rate limit` | Set `github_token` → apply. |
| Jobs fail: `no LLM produced a usable outline` | Free quota used up. Add `groq_api_key` / `openrouter_api_key` → apply. Nobody was charged. |
| `npm run kit` not found | `npm run vendor && npm install` |

Want to try it on your laptop first, before any cloud? See [SETUP.md](SETUP.md), part A.
