// Reads a public GitHub repository without cloning it: a few REST calls for metadata, then the
// tarball of one commit, streamed through tar and kept in memory only for the files the digest needs.
// Repository content is untrusted input: it is size-capped here and labelled as data in the prompt.

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Parser, type ReadEntry } from "tar";

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string | undefined;
}

export interface RepoMeta {
  fullName: string;
  htmlUrl: string;
  description: string;
  homepage: string;
  stars: number;
  forks: number;
  openIssues: number;
  topics: string[];
  license: string;
  createdAt: string;
  pushedAt: string;
  defaultBranch: string;
  languages: Record<string, number>;
  latestRelease: string | undefined;
  sha: string;
}

export interface RepoFile {
  path: string;
  size: number;
  text: string | undefined;
}

export interface RepoSnapshot {
  meta: RepoMeta;
  /** Every path in the tarball (without the top folder), with sizes; text only for files we keep. */
  files: RepoFile[];
  truncated: boolean;
}

export class RepoError extends Error {
  override name = "RepoError";
}

const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export function parseRepoUrl(url: string, ref?: string): RepoRef {
  const match = REPO_URL.exec(url.trim());
  if (match === null) throw new RepoError("repoUrl must look like https://github.com/owner/repo");
  return { owner: match[1]!, repo: match[2]!, ref: ref === undefined || ref === "" ? undefined : ref };
}

/** Files whose text the digest may read. Everything else is listed by path only. */
const KEEP_TEXT = [
  /^readme(\.[a-z]+)?$/i,
  /^(package\.json|pyproject\.toml|setup\.py|setup\.cfg|requirements\.txt|cargo\.toml|go\.mod|gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|deno\.json|mix\.exs|pubspec\.yaml|project\.clj|.*\.csproj)$/i,
  /^(dockerfile|docker-compose\.ya?ml|compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|wrangler\.toml|serverless\.ya?ml)$/i,
  /^(license|licence|copying)(\.[a-z]+)?$/i,
  /^(roadmap|changelog|todo|architecture|design)(\.[a-z]+)?$/i,
  /^docs?\/[^/]+\.(md|mdx|rst|txt)$/i,
  /^(src|app|lib|cmd|server|api|contracts?|packages\/[^/]+\/src)\/([^/]+\/)?(index|main|app|server|lib|mod|__init__|cli)\.[a-z]+$/i,
  /^(index|main|app|server)\.(ts|js|py|go|rs|rb|java|kt|swift)$/i,
  /^\.github\/workflows\/[^/]+\.ya?ml$/i,
];
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|target|\.next|\.git|coverage|__pycache__|\.venv|venv)\//;
const MAX_TEXT_FILE = 48 * 1024;
const MAX_TEXT_TOTAL = 400 * 1024;
const MAX_ENTRIES = 50_000;

/**
 * The same snapshot from a local checkout, with the same filters. For offline tests and template
 * work (`npm run deck -- --local <dir>`); the paid service always reads GitHub.
 */
export async function localSnapshot(dir: string, meta: RepoMeta): Promise<RepoSnapshot> {
  const { readdir, readFile } = await import("node:fs/promises");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: RepoFile[] = [];
  let textTotal = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = `${entry.parentPath}/${entry.name}`;
    const path = full.slice(dir.replace(/\/+$/, "").length + 1);
    if (SKIP_DIR.test(path) || path.startsWith(".git/")) continue;
    const buffer = await readFile(full);
    const file: RepoFile = { path, size: buffer.length, text: undefined };
    if (KEEP_TEXT.some((p) => p.test(path)) && buffer.length <= MAX_TEXT_FILE * 4 && textTotal < MAX_TEXT_TOTAL) {
      const head = buffer.subarray(0, MAX_TEXT_FILE);
      if (!head.includes(0)) {
        file.text = head.toString("utf8");
        textTotal += head.length;
      }
    }
    files.push(file);
    if (files.length >= MAX_ENTRIES) break;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { meta, files, truncated: files.length >= MAX_ENTRIES };
}

export class GitHubClient {
  constructor(
    private readonly token: string | undefined,
    private readonly maxBytes: number,
  ) {}

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      Accept: accept,
      "User-Agent": "pitch-deck-agent",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(this.token === undefined ? {} : { Authorization: `Bearer ${this.token}` }),
    };
  }

  private async api<T>(path: string, signal: AbortSignal, accept?: string): Promise<{ status: number; body: T | undefined }> {
    const response = await fetch(`https://api.github.com${path}`, { headers: this.headers(accept), signal });
    if (response.status === 403 || response.status === 429) {
      throw new RepoError("GitHub rate limit reached; set GITHUB_TOKEN for 5,000 requests an hour");
    }
    if (!response.ok) return { status: response.status, body: undefined };
    const body = accept === "application/vnd.github.sha" ? ((await response.text()) as T) : ((await response.json()) as T);
    return { status: response.status, body };
  }

  /** Metadata and the commit SHA. Cheap: used first, so a cached deck needs no download. */
  async meta(ref: RepoRef, signal: AbortSignal): Promise<RepoMeta> {
    const base = `/repos/${ref.owner}/${ref.repo}`;
    const repo = await this.api<Record<string, any>>(base, signal);
    if (repo.body === undefined) throw new RepoError("repository not found, or it is private (only public repositories are supported)");
    const r = repo.body;
    const commitRef = ref.ref ?? String(r["default_branch"]);
    const [sha, languages, release] = await Promise.all([
      this.api<string>(`${base}/commits/${encodeURIComponent(commitRef)}`, signal, "application/vnd.github.sha"),
      this.api<Record<string, number>>(`${base}/languages`, signal),
      this.api<Record<string, any>>(`${base}/releases/latest`, signal),
    ]);
    if (sha.body === undefined || !/^[0-9a-f]{40}$/.test(sha.body.trim())) throw new RepoError(`ref "${commitRef}" not found`);
    return {
      fullName: String(r["full_name"]),
      htmlUrl: String(r["html_url"]),
      description: String(r["description"] ?? ""),
      homepage: String(r["homepage"] ?? ""),
      stars: Number(r["stargazers_count"] ?? 0),
      forks: Number(r["forks_count"] ?? 0),
      openIssues: Number(r["open_issues_count"] ?? 0),
      topics: Array.isArray(r["topics"]) ? r["topics"].map(String).slice(0, 15) : [],
      license: String(r["license"]?.["spdx_id"] ?? "none"),
      createdAt: String(r["created_at"] ?? ""),
      pushedAt: String(r["pushed_at"] ?? ""),
      defaultBranch: String(r["default_branch"]),
      languages: languages.body ?? {},
      latestRelease: release.body === undefined ? undefined : String(release.body["tag_name"] ?? ""),
      sha: sha.body.trim(),
    };
  }

  /** Streams the commit's tarball and keeps only what the digest reads. */
  async snapshot(ref: RepoRef, meta: RepoMeta, signal: AbortSignal): Promise<RepoSnapshot> {
    const url = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${meta.sha}`;
    const response = await fetch(url, { headers: { "User-Agent": "pitch-deck-agent" }, signal });
    if (!response.ok || response.body === null) throw new RepoError(`could not download the repository (${response.status})`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > this.maxBytes) throw new RepoError(`repository archive is larger than ${Math.round(this.maxBytes / 1048576)} MB`);

    const files: RepoFile[] = [];
    let textTotal = 0;
    let truncated = false;
    let downloaded = 0;
    const maxBytes = this.maxBytes;

    const parser = new Parser({ strict: false });
    parser.on("entry", (entry: ReadEntry) => {
      const path = entry.path.replace(/^[^/]+\//, "");
      if (entry.type !== "File" || path === "" || SKIP_DIR.test(`${path}`) || files.length >= MAX_ENTRIES) {
        if (files.length >= MAX_ENTRIES) truncated = true;
        entry.resume();
        return;
      }
      const file: RepoFile = { path, size: entry.size ?? 0, text: undefined };
      files.push(file);
      const wanted = KEEP_TEXT.some((pattern) => pattern.test(path)) && file.size <= MAX_TEXT_FILE * 4;
      if (!wanted || textTotal >= MAX_TEXT_TOTAL) {
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      entry.on("data", (chunk: Buffer) => {
        if (length < MAX_TEXT_FILE) chunks.push(chunk);
        length += chunk.length;
      });
      entry.on("end", () => {
        const buffer = Buffer.concat(chunks).subarray(0, MAX_TEXT_FILE);
        if (buffer.includes(0)) return; // binary
        file.text = buffer.toString("utf8");
        textTotal += buffer.length;
      });
    });

    const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    source.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      if (downloaded > maxBytes) source.destroy(new RepoError(`repository archive is larger than ${Math.round(maxBytes / 1048576)} MB`));
    });
    try {
      await pipeline(source, createGunzip(), parser);
    } catch (error) {
      if (error instanceof RepoError) throw error;
      if (signal.aborted) throw signal.reason;
      throw new RepoError("could not read the repository archive");
    }
    return { meta, files, truncated };
  }
}
