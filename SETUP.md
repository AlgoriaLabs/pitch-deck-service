# Local development

> Make a deck on your laptop, run the service locally, run the tests. No cloud, no wallet.
> To deploy, use [DEPLOY.md](DEPLOY.md).

## 1. Install · 1 min

```bash
npm ci          # the Provider Kit comes packed in vendor/, nothing to build
npm test
```

✅ `# pass 19`, `# fail 0`.

## 2. Make one deck · 3 min

```bash
cp .env.example .env      # then set GEMINI_API_KEY=… in .env (free: aistudio.google.com)
npm run build
npm run deck -- https://github.com/AlgoriaLabs/stellar-agent-services
```

✅ `stellar-agent-services.pptx` appears. Open it.

| Variation | Command |
| --- | --- |
| No AI key, canned text | `LLM_MOCK=1 npm run deck -- <github url>` |
| A local folder, offline | `npm run deck -- --local ../some-repo` |
| Fresh AI call (skip cache) | add `--no-cache` |

## 3. Run the service locally · 2 min

In `.env`, set `PAY_TO_TESTNET=G…` (`npm run wallet` makes one: see DEPLOY.md step 2). Then:

```bash
npm start                 # http://localhost:8787
npm run check             # in a second terminal: checks it, and shows how agents find it
npm run try               # pays for one deck with test money, from a throwaway account
```

The commands find the service by themselves: `$MANIFEST`, else the deployed one (`terraform output`), else
localhost. To aim at localhost while a deployment exists: `MANIFEST=http://localhost:8787/.well-known/stellar-agent-services.json npm run check`.

## Where things are

| Path | What |
| --- | --- |
| `src/service.ts` | The paid service: price, schemas, example |
| `src/app.ts` | Provider setup, and the name and description search reads |
| `src/pipeline/` | GitHub → digest → AI outline → PPTX |
| `src/pipeline/render.ts` | The slide template |
| `scripts/kit.mjs` | `npm run wallet / check / try / register / verify` |
| `scripts/update-kit.sh` | Updates the packed Provider Kit in `vendor/` |
| `deploy/terraform/` | The server |
