# Deploy

> One page. Do one box, then look only at the next one.
> ⏱ about 30 min the first time, mostly waiting.

```
1 Get keys → 2 Wallet → 3 Fill form → 4 Deploy → 5 Register → 6 Try it        later: Mainnet
  10 min      2 min      2 min          10 min      3 min         2 min
```

You need: **Node.js 24**, **Terraform**, and a **Stellar browser wallet** (Freighter, xBull, Albedo, Hana…).
No Stellar CLI. Your wallet signs everything, in your browser. No secret key is ever typed or saved.

---

## 1 · Get keys · 10 min

- [ ] **Oracle Cloud account**: [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
      Pick a home region near you. You can't change it later.
- [ ] **Oracle API key**: console → profile icon → **My profile** → **API keys** → **Add API key** →
      **Generate API key pair** → **Download private key** → **Add**.
      Copy the text box it shows into `~/.oci/config`. Fix its `key_file=` line to point at the downloaded key.
- [ ] **SSH key**: `ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`
- [ ] **Gemini key** (free): [aistudio.google.com](https://aistudio.google.com) → **Get API key**

---

## 2 · Wallet · 2 min

This is where buyers' money goes. Your own browser wallet works (your treasury too).

- [ ] In your wallet, switch the network to **Testnet**.
- [ ] Run:

```bash
git clone https://github.com/AlgoriaLabs/pitch-deck-service.git
cd pitch-deck-service
npm ci
npm run wallet
```

A page opens. **Connect** your wallet, **approve**. It gets free test money and can now receive USDC.

✅ The terminal prints `PAY_TO=G...`. Copy that address.

---

## 3 · Fill the form · 2 min

```bash
cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars
```

Open `deploy/terraform/terraform.tfvars`. Fill these 5 lines:

```hcl
region           = "eu-frankfurt-1"        # region= line in ~/.oci/config
compartment_ocid = "ocid1.tenancy.oc1..…"  # tenancy= line in ~/.oci/config
acme_email       = "you@example.com"
pay_to_testnet   = "G…"                    # from step 2
gemini_api_key   = "…"                     # from step 1
```

---

## 4 · Deploy · 10 min

```bash
terraform -chdir=deploy/terraform init
terraform -chdir=deploy/terraform apply      # type: yes
```

Minutes 2–8 show `Still creating…`. **Normal.** The server is installing. Get water.

✅ You see `✓ healthy: {"ok":true,"network":"testnet"}`

---

## 5 · Register · 3 min

Puts your service on the Stellar map, so agents can find it.

- [ ] Run `npm run register`. A page opens. **Connect** the same wallet, **approve**.

✅ You see `✓ Saved agent_id_testnet = "…"`. Then publish it:

```bash
terraform -chdir=deploy/terraform apply      # ~1 min
```

---

## 6 · Try it · 2 min

```bash
npm run try
```

It asks `Pay 0.10 USDC in test money?` → press **Enter**. Wait ~1 min.

✅ You get a deck link. Open it. Your wallet received 0.10 test USDC.

```bash
npm run check        # every line green
```

🎉 **Done. You're live on testnet.**

---

## Later · Mainnet · 10 min

- [ ] **Facilitator key** (free, shown once): [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen)
- [ ] Your wallet on **Mainnet**, with ~2 XLM in it. Then: `npm run wallet -- mainnet` → approve.
- [ ] *(recommended)* A domain: add an `A` record pointing at `terraform -chdir=deploy/terraform output -raw public_ip`.
- [ ] In `terraform.tfvars`:

```hcl
stellar_network             = "mainnet"   # ← the switch
pay_to_mainnet              = "G…"        # your wallet (the same address is fine)
facilitator_api_key_mainnet = "…"
domain                      = "deck.example.com"
```

```bash
terraform -chdir=deploy/terraform apply
npm run register                           # approve in your wallet (on Mainnet)
terraform -chdir=deploy/terraform apply
npm run check
```

Something missing? The deploy **stops before switching** and names it. The old version keeps running.
Back to testnet: `stellar_network = "testnet"` → apply.

---

## Cheat sheet

| I want to… | Run |
| --- | --- |
| Ship a code change | `terraform -chdir=deploy/terraform apply` |
| Check the service | `npm run check` |
| Pay for one test deck | `npm run try` |
| See logs | `$(terraform -chdir=deploy/terraform output -raw logs)` |
| Change price or keys | edit `terraform.tfvars` → apply |
| Update the Provider Kit | `npm run update-kit` → commit → apply |
| Delete everything | `terraform -chdir=deploy/terraform destroy` |

## 🆘 If this, then that

| You see | Do |
| --- | --- |
| The wallet page didn't open | Copy the `http://localhost:8790/#…` link from the terminal into your browser. |
| "Switch it to G…" on the wallet page | Your wallet connected another account. Pick the `pay_to` account in the wallet. |
| `Out of host capacity` | Add `availability_domain_index = 1` (or `2`) to tfvars → apply. Or retry in an hour. |
| `Still creating…` over 15 min | `ssh ubuntu@$(terraform -chdir=deploy/terraform output -raw public_ip) sudo tail -50 /var/log/cloud-init-output.log` |
| `✗ deploy stopped` | Read the line under it: it names the missing value. Fix tfvars → apply. |
| `✗ not healthy` | Check the logs (cheat sheet). |
| `npm run try`: no USDC for sale | The testnet market is empty right now. Try again later. Nothing was paid. |
| Jobs fail: `GitHub rate limit` | Add `github_token` to tfvars ([make one](https://github.com/settings/personal-access-tokens), no scopes) → apply. |
| Jobs fail: `no LLM produced a usable outline` | Free AI quota used up. Add `groq_api_key` ([console.groq.com](https://console.groq.com)) → apply. Nobody was charged. |
| Browser shows a certificate error | Set `domain` in tfvars (sslip.io can hit limits) → apply. |

Want to see a deck on your laptop first, before any cloud? [SETUP.md](SETUP.md).
