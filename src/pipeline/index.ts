// The whole job: repository URL in, PPTX out.
//   meta (4 GitHub calls) → tarball → digest → outline (cache hit, or 1 LLM call) → render → save.

import type { Config } from "../config.js";
import type { DeckStorage } from "../storage.js";
import type { OutlineCache } from "./cache.js";
import { buildDigest } from "./digest.js";
import { GitHubClient, parseRepoUrl, type RepoSnapshot } from "./github.js";
import { generateOutline } from "./llm.js";
import { renderDeck } from "./render.js";

export interface DeckRequest {
  repoUrl: string;
  ref?: string;
}

export interface DeckResult {
  deckUrl: string;
  expiresAt: string;
  title: string;
  slideCount: number;
  repo: string;
  commitSha: string;
  [key: string]: string | number;
}

export interface PipelineDeps {
  config: Pick<Config, "githubToken" | "maxRepoBytes" | "llmProviders">;
  cache: OutlineCache;
  storage: DeckStorage;
  log?: Pick<Console, "info" | "warn">;
}

export async function makeDeck(request: DeckRequest, deps: PipelineDeps, signal: AbortSignal): Promise<DeckResult> {
  const started = Date.now();
  const ref = parseRepoUrl(request.repoUrl, request.ref);
  const github = new GitHubClient(deps.config.githubToken, deps.config.maxRepoBytes);
  const meta = await github.meta(ref, signal);

  // The digest is needed even on a cache hit, for its facts (stats, stack, language bar).
  const snapshot = await github.snapshot(ref, meta, signal);
  return deckFromSnapshot(snapshot, deps, signal, started);
}

/** Digest → outline (cached by commit) → render → save. Shared by the service and the local CLI. */
export async function deckFromSnapshot(snapshot: RepoSnapshot, deps: PipelineDeps, signal: AbortSignal, started = Date.now()): Promise<DeckResult> {
  const log = deps.log ?? console;
  const { meta } = snapshot;
  const digest = buildDigest(snapshot);

  let outline = deps.cache.get(meta.fullName, meta.sha);
  let source = "cache";
  if (outline === undefined) {
    const result = await generateOutline(deps.config.llmProviders, digest, signal, log as Console);
    outline = result.outline;
    source = `${result.provider}:${result.model}`;
    deps.cache.set(meta.fullName, meta.sha, outline, source);
  }

  const deck = await renderDeck(outline, digest.facts);
  const saved = await deps.storage.save(deck.buffer);
  log.info(`[deck] ${meta.fullName}@${meta.sha.slice(0, 7)} → ${deck.slideCount} slides via ${source} in ${((Date.now() - started) / 1000).toFixed(1)}s (digest ${digest.text.length} chars)`);
  return {
    deckUrl: saved.url,
    expiresAt: saved.expiresAt,
    title: deck.title,
    slideCount: deck.slideCount,
    repo: meta.htmlUrl,
    commitSha: meta.sha,
  };
}
