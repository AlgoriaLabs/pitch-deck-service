# Pitch Deck Agent

A paid AI agent service on Stellar. Send it a public GitHub repository, get back a 10-slide PowerPoint pitch deck.
Buyers (people or agents) pay per deck in USDC over x402 and are charged **only if the deck is delivered**.

Built on [Stellar Agent Services](https://github.com/AlgoriaLabs/stellar-agent-services) Provider Standard v1, and
discoverable through [Stellar Agent Search](https://github.com/berkingurcan/stellar-agent-search) once registered
on Stellar 8004.

👉 **Setting it up? Go to [SETUP.md](SETUP.md).**

## How it works

```
buyer ──POST /services/pitch-deck/jobs──▶ provider-kit ──402──▶ buyer pays (x402, USDC)
                                              │
                                              ▼  job handler (this repo)
        GitHub API + tarball ─▶ digest (rules, no LLM) ─▶ outline (1 LLM call, cached per commit)
                                              ─▶ pptxgenjs render ─▶ /decks/<random>.pptx (24 h)
                                              │
                                              ▼  output valid → facilitator settles → 200 + deckUrl
```

| Piece | Choice | Cost |
| --- | --- | --- |
| Hosting | Oracle Cloud Always Free Ampere A1 VM, via Terraform | $0 |
| HTTPS | Caddy + Let's Encrypt (`<ip>.sslip.io` or your domain) | $0 |
| Database | SQLite (provider-kit job store + outline cache) on the VM | $0 |
| Deck files | VM disk, deleted after 24 h | $0 |
| LLM | Gemini Flash-Lite → Groq → OpenRouter free tiers, one call per new commit | $0 |
| Payments | x402.org facilitator (testnet), OpenZeppelin facilitator (mainnet), fees sponsored | $0 |

## The service

`POST /services/pitch-deck/jobs` with `{ "repoUrl": "https://github.com/owner/repo", "ref": "optional" }`.

Output: `{ deckUrl, expiresAt, title, slideCount, repo, commitSha }`. Price: `PRICE_USDC` (default 0.10).
Charge mode `on-success`: if GitHub or every LLM fails, the job fails and the payment never settles.

Slides: title · problem · solution · how it works · architecture & stack · features · traction (real GitHub
numbers) · use cases · roadmap · the ask. Speaker notes included. All shapes are native, so the deck is editable.

## Testnet ⇄ mainnet

One variable: `STELLAR_NETWORK=testnet|mainnet` (`.env`), or `stellar_network` in `terraform.tfvars`.
Each network has its own `PAY_TO_*`, `AGENT_ID_*` and job database, so the two never mix. Mainnet refuses to
start until its RPC URL and facilitator key are set.

## Commands

| | |
| --- | --- |
| `npm run vendor` | fetch + build provider-kit, verifier, payment client (pinned commit) |
| `npm test` | offline tests, incl. a full 402 → pay → download flow |
| `npm run deck -- <github url>` | make a deck locally, no payment |
| `npm run deck -- --local <dir>` | same, from a local folder (offline) |
| `npm start` | run the provider |
| `npm run kit -- check --manifest <url>` | provider-kit conformance check |
| `npm run kit -- register --manifest <url> --source <key>` | register on Stellar 8004 |
| `npm run verifier -- check <url>` | external standard check (C1–C7) |
| `npm run stellar-pay -- pay <manifest> pitch-deck '<json>'` | pay your own service |

## Layout

| Path | What |
| --- | --- |
| `src/config.ts` | env → config; the network switch |
| `src/service.ts` | the `pitch-deck` service (`defineService`) |
| `src/app.ts`, `src/server.ts` | `createProvider`, `/decks`, `/healthz`, process lifecycle |
| `src/pipeline/github.ts` | GitHub metadata + streamed tarball, size-capped |
| `src/pipeline/digest.ts` | repo → compact LLM digest + hard facts |
| `src/pipeline/outline.ts` | outline schema, prompt, validation + repair |
| `src/pipeline/llm.ts` | OpenAI-compatible fallback chain |
| `src/pipeline/render.ts` | PPTX template (pptxgenjs) |
| `src/pipeline/cache.ts`, `src/storage.ts` | outline cache, deck files |
| `deploy/terraform/` | OCI network + VM + reserved IP, cloud-init, deploy-on-apply |

## Known limits (v1)

- Public GitHub repositories only, up to 40 MB.
- Free LLM tiers can rate-limit and may use prompts for training; only public code is sent.
  Gemini's free tier isn't allowed for apps serving the EEA, Switzerland or the UK: use Groq/OpenRouter there,
  or a paid key.
- One fixed template. Customization is the next milestone.
