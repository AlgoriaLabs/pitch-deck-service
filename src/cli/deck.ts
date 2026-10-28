// Local deck maker, no payment involved:
//   npm run deck -- https://github.com/owner/repo [ref]     read the repo from GitHub
//   npm run deck -- --local ./some/checkout                  read a local folder instead (offline)
// Same pipeline and LLM chain as the paid service; writes ./<name>.pptx. Add --no-cache to force a
// fresh LLM call. LLM_MOCK=1 skips the LLM entirely (template work, tests).

import { execFileSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { OutlineCache } from "../pipeline/cache.js";
import { localSnapshot, type RepoMeta } from "../pipeline/github.js";
import { deckFromSnapshot, makeDeck, type DeckResult } from "../pipeline/index.js";
import { DeckStorage } from "../storage.js";

const args = process.argv.slice(2);
const noCache = args.includes("--no-cache");
const localIndex = args.indexOf("--local");
const positional = args.filter((a, i) => !a.startsWith("--") && i !== localIndex + 1);

if (localIndex === -1 && positional[0] === undefined) {
  console.error("usage: npm run deck -- https://github.com/owner/repo [ref] [--no-cache]\n       npm run deck -- --local <dir> [--no-cache]");
  process.exit(2);
}

// The CLI takes no payment, so a placeholder payTo keeps the config loader to the LLM settings.
const config = loadConfig({ PAY_TO: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", ...process.env, STELLAR_NETWORK: "testnet" });
const storage = new DeckStorage(`${config.dataDir}/decks`, "file://local", 3600);
await storage.init();
const cache = noCache ? new OutlineCache(":memory:") : new OutlineCache(config.cacheDbPath);
const deps = { config, cache, storage };
const signal = AbortSignal.timeout(180_000);

let result: DeckResult;
if (localIndex !== -1) {
  const dir = resolve(args[localIndex + 1] ?? ".");
  result = await deckFromSnapshot(await localSnapshot(dir, localMeta(dir)), deps, signal);
} else {
  result = await makeDeck({ repoUrl: positional[0]!, ...(positional[1] === undefined ? {} : { ref: positional[1] }) }, deps, signal);
}
const out = `${basename(result.repo)}.pptx`;
await copyFile(storage.pathFor(basename(result.deckUrl))!, out);
console.log(`✓ ${result.slideCount} slides → ${out}`);

/** GitHub-like metadata for a local folder: git remote and SHA when present, languages by file size. */
function localMeta(dir: string): RepoMeta {
  const git = (...a: string[]) => {
    try {
      return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const remote = git("remote", "get-url", "origin").replace(/\.git$/, "");
  const fullName = /github\.com[/:]([^/]+\/[^/]+)$/.exec(remote)?.[1] ?? `local/${basename(dir)}`;
  const sha = git("rev-parse", "HEAD") || "0".repeat(40);
  const languages: Record<string, number> = {};
  const names: Record<string, string> = { ".ts": "TypeScript", ".js": "JavaScript", ".py": "Python", ".rs": "Rust", ".go": "Go", ".svelte": "Svelte", ".css": "CSS", ".html": "HTML", ".sol": "Solidity", ".java": "Java", ".rb": "Ruby" };
  for (const line of git("ls-files", "-s").split("\n")) {
    const path = line.split("\t")[1] ?? "";
    const lang = names[extname(path)];
    if (lang !== undefined) languages[lang] = (languages[lang] ?? 0) + 1;
  }
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    description: "",
    homepage: "",
    stars: 0,
    forks: 0,
    openIssues: 0,
    topics: [],
    license: "unknown",
    createdAt: "",
    pushedAt: git("log", "-1", "--format=%cI"),
    defaultBranch: "main",
    languages,
    latestRelease: undefined,
    sha,
  };
}
