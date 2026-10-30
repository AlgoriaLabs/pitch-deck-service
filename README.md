# Pitch Deck Agent

A paid AI agent service on Stellar. Send it a public GitHub repository, get back a 10-slide PowerPoint pitch deck.
Buyers (people or agents) pay per deck in USDC over x402 and are charged **only if the deck is delivered**.

Built on [Stellar Agent Services](https://github.com/AlgoriaLabs/stellar-agent-services) Provider Standard v1 (Provider Kit
@ `afa5cd0`), and
discoverable through [Stellar Agent Search](https://github.com/berkingurcan/stellar-agent-search) once registered
on Stellar 8004.

👉 **Deploying? [DEPLOY.md](DEPLOY.md)** (6 short steps, one page). On your laptop: [SETUP.md](SETUP.md).

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
| CI/CD | GitHub Actions: test → deploy on push to `main` | $0 (public repo; 2,000 min/month private) |
| Terraform state | OCI Object Storage bucket, private, versioned, locked | $0 (Always Free 20 GB) |
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
start until its facilitator key is set.

## Wallets and keys

Nothing here holds a Stellar secret key: not the server, not the scripts. The wallet that receives payments is
your own browser wallet (Freighter, xBull, Albedo, Hana, Ledger…). The two owner actions, the USDC trustline
(`npm run wallet`) and the 8004 registration (`npm run register`), open a page on your computer where you
approve them in that wallet. The registering wallet becomes the agent's wallet, which is why it must be `payTo`.

## Commands

| | |
| --- | --- |
| `npm ci` | install (the Provider Kit is packed in `vendor/`) |
| `npm test` | offline tests, incl. a full 402 → pay → download flow |
| `npm run deck -- <github url>` | make a deck locally, no payment |
| `npm start` | run the service |
| `npm run wallet [-- mainnet]` | set up the wallet buyers pay, approved in your browser wallet |
| `npm run register` | register on Stellar 8004, approved in your wallet; saves the agent id to tfvars |
| `npm run try` | pay for one deck with test money (throwaway payer, testnet only) |
| `npm run check` | Provider Standard self-check, and how agents find you in search |
| `npm run verify` | external standard check C1–C7 (after `npm run update-kit` once) |
| `npm run deploy` | deploy or update the server (Terraform, shared state in an OCI bucket) |
| `npm run ci:setup` | turn on automatic deploys: every push to `main` tests and deploys |
| `npm run update-kit` | update the packed Provider Kit to a pinned stellar-agent-services commit |

`check`, `try`, `register` and `verify` find the service by themselves: `$MANIFEST`, else `terraform output`,
else `http://localhost:8787`.

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
| `scripts/kit.mjs` | `npm run wallet / check / try / register / verify` |
| `vendor/` | the Provider Kit, packed (`scripts/update-kit.sh` refreshes it; commit it) |
| `scripts/deploy.mjs`, `scripts/ci-setup.mjs` | `npm run deploy`, `npm run ci:setup` |
| `deploy/terraform/` | OCI network + VM + reserved IP, cloud-init, deploy-on-apply |
| `deploy/state/` | the private bucket for Terraform state (made once by `npm run deploy`) |
| `.github/workflows/ci-cd.yml` | test on every push and PR; deploy `main` once `ci:setup` turned it on |

## Known limits (v1)

- Public GitHub repositories only, up to 40 MB.
- Free LLM tiers can rate-limit and may use prompts for training; only public code is sent.
  Gemini's free tier isn't allowed for apps serving the EEA, Switzerland or the UK: use Groq/OpenRouter there,
  or a paid key.
- One fixed template. Customization is the next milestone.
