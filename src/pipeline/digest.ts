// Turns a repository snapshot into (1) a compact text digest for the LLM and (2) hard facts that go on
// slides as-is. No LLM here: rules only, so the one model call stays small and the numbers on the
// traction slide come from GitHub, never from a model.

import type { RepoFile, RepoSnapshot } from "./github.js";

export interface RepoFacts {
  name: string;
  fullName: string;
  url: string;
  homepage: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  license: string;
  createdAt: string;
  pushedAt: string;
  latestRelease: string | undefined;
  topics: string[];
  languages: { name: string; share: number }[];
  /** Detected frameworks and tools, such as "React", "FastAPI", "Docker". */
  stack: string[];
  fileCount: number;
  hasTests: boolean;
  hasCi: boolean;
  hasDocker: boolean;
  hasDocs: boolean;
  sha: string;
}

export interface Digest {
  facts: RepoFacts;
  /** Plain text for the model, at most ~DIGEST_MAX_CHARS. */
  text: string;
}

export const DIGEST_MAX_CHARS = 60_000;

/** Dependency name (or prefix) → display name. Order is display order. */
const FRAMEWORKS: [RegExp, string][] = [
  [/^next$/, "Next.js"], [/^react$/, "React"], [/^vue$/, "Vue"], [/^svelte$|^@sveltejs\/kit$/, "Svelte"], [/^@angular\/core$/, "Angular"],
  [/^hono$/, "Hono"], [/^express$/, "Express"], [/^fastify$/, "Fastify"], [/^@nestjs\/core$/, "NestJS"],
  [/^electron$/, "Electron"], [/^react-native$/, "React Native"], [/^expo$/, "Expo"], [/^tailwindcss$/, "Tailwind"],
  [/^prisma$|^@prisma\/client$/, "Prisma"], [/^drizzle-orm$/, "Drizzle"], [/^@supabase\/supabase-js$/, "Supabase"],
  [/^@modelcontextprotocol\/sdk$/, "MCP"], [/^openai$/, "OpenAI API"], [/^@anthropic-ai\/sdk$/, "Claude API"], [/^langchain|^@langchain\//, "LangChain"],
  [/^@stellar\/stellar-sdk$|^stellar-sdk$/, "Stellar SDK"], [/^@x402\//, "x402"], [/^ethers$|^viem$|^wagmi$/, "EVM"], [/^@solana\/web3\.js$/, "Solana"],
  [/^django$/, "Django"], [/^flask$/, "Flask"], [/^fastapi$/, "FastAPI"], [/^torch$/, "PyTorch"], [/^tensorflow$/, "TensorFlow"],
  [/^transformers$/, "Hugging Face"], [/^pandas$/, "pandas"], [/^streamlit$/, "Streamlit"],
  [/^actix-web$/, "Actix"], [/^axum$/, "Axum"], [/^tokio$/, "Tokio"], [/^soroban-sdk$/, "Soroban"], [/^anchor-lang$/, "Anchor"],
  [/^github\.com\/gin-gonic\/gin$/, "Gin"], [/^github\.com\/gofiber\/fiber/, "Fiber"],
  [/^rails$/, "Rails"], [/^laravel\/framework$/, "Laravel"], [/^org\.springframework/, "Spring"],
];

export function buildDigest(snapshot: RepoSnapshot): Digest {
  const { meta, files } = snapshot;
  const byPath = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  const textOf = (file: RepoFile | undefined) => file?.text ?? "";
  const totalLang = Object.values(meta.languages).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(meta.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => ({ name, share: Math.round((bytes / totalLang) * 100) }))
    .filter((lang) => lang.share > 0);

  const dependencies = collectDependencies(files);
  const stack: string[] = [];
  for (const [pattern, label] of FRAMEWORKS) {
    if (!stack.includes(label) && dependencies.some((dep) => pattern.test(dep))) stack.push(label);
  }
  const paths = files.map((file) => file.path);
  const hasDocker = paths.some((p) => /(^|\/)(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(p));
  const hasCi = paths.some((p) => /^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\//i.test(p));
  const hasTests = paths.some((p) => /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/i.test(p));
  const hasDocs = paths.some((p) => /^docs?\//i.test(p));
  if (hasDocker) stack.push("Docker");

  const facts: RepoFacts = {
    name: meta.fullName.split("/")[1] ?? meta.fullName,
    fullName: meta.fullName,
    url: meta.htmlUrl,
    homepage: meta.homepage,
    description: meta.description,
    stars: meta.stars,
    forks: meta.forks,
    openIssues: meta.openIssues,
    license: meta.license,
    createdAt: meta.createdAt,
    pushedAt: meta.pushedAt,
    latestRelease: meta.latestRelease,
    topics: meta.topics,
    languages,
    stack: stack.slice(0, 10),
    fileCount: files.length,
    hasTests,
    hasCi,
    hasDocker,
    hasDocs,
    sha: meta.sha,
  };

  // Sections in priority order; each is cut to its budget, and the whole to DIGEST_MAX_CHARS.
  const readme = files.find((file) => /^readme(\.[a-z]+)?$/i.test(file.path));
  const sections: [string, string, number][] = [
    ["REPOSITORY", repoHeader(facts), 2_000],
    ["README", cleanMarkdown(textOf(readme)), 18_000],
    ["FILE TREE", fileTree(paths), 6_000],
    ["DEPENDENCY MANIFESTS", manifests(files), 8_000],
    ["DOCS", docs(files), 12_000],
    ["ENTRY POINTS", entryPoints(files), 10_000],
    ["ROADMAP / CHANGELOG", textOf(byPath.get("roadmap.md")) + "\n" + textOf(byPath.get("changelog.md")).slice(0, 3_000), 4_000],
  ];
  let text = "";
  for (const [title, body, budget] of sections) {
    const trimmed = body.trim();
    if (trimmed === "") continue;
    text += `\n===== ${title} =====\n${clip(trimmed, budget)}\n`;
  }
  return { facts, text: clip(text, DIGEST_MAX_CHARS) };
}

function repoHeader(facts: RepoFacts): string {
  return [
    `name: ${facts.fullName}`,
    `description: ${facts.description || "(none)"}`,
    `homepage: ${facts.homepage || "(none)"}`,
    `topics: ${facts.topics.join(", ") || "(none)"}`,
    `languages: ${facts.languages.map((l) => `${l.name} ${l.share}%`).join(", ")}`,
    `detected stack: ${facts.stack.join(", ") || "(unknown)"}`,
    `stars: ${facts.stars}, forks: ${facts.forks}, open issues: ${facts.openIssues}, license: ${facts.license}`,
    `created: ${facts.createdAt.slice(0, 10)}, last push: ${facts.pushedAt.slice(0, 10)}, latest release: ${facts.latestRelease ?? "none"}`,
    `files: ${facts.fileCount}, tests: ${facts.hasTests}, CI: ${facts.hasCi}, Docker: ${facts.hasDocker}, docs folder: ${facts.hasDocs}`,
  ].join("\n");
}

function collectDependencies(files: RepoFile[]): string[] {
  const deps: string[] = [];
  for (const file of files) {
    if (file.text === undefined) continue;
    const name = file.path.split("/").pop()!.toLowerCase();
    try {
      if (name === "package.json") {
        const json = JSON.parse(file.text) as Record<string, Record<string, string> | undefined>;
        deps.push(...Object.keys({ ...json["dependencies"], ...json["devDependencies"], ...json["peerDependencies"] }));
      } else if (name === "requirements.txt") {
        deps.push(...file.text.split("\n").map((line) => line.split(/[<>=~![;\s]/)[0]!.trim().toLowerCase()).filter(Boolean));
      } else if (name === "pyproject.toml" || name === "cargo.toml") {
        deps.push(...[...file.text.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:=|[<>=~]=?)/gm)].map((m) => m[1]!.toLowerCase()));
        deps.push(...[...file.text.matchAll(/"([A-Za-z0-9_.-]+)\s*[<>=~!]/g)].map((m) => m[1]!.toLowerCase()));
      } else if (name === "go.mod") {
        deps.push(...[...file.text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm)].map((m) => m[1]!));
      } else if (name === "composer.json") {
        deps.push(...Object.keys((JSON.parse(file.text) as { require?: Record<string, string> }).require ?? {}));
      } else if (name === "gemfile") {
        deps.push(...[...file.text.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((m) => m[1]!));
      } else if (name === "pom.xml" || name.startsWith("build.gradle")) {
        deps.push(...[...file.text.matchAll(/(org\.springframework[\w.-]*)/g)].map((m) => m[1]!));
      }
    } catch {
      // A malformed manifest is just skipped.
    }
  }
  return [...new Set(deps)];
}

function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images and badges
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/?(p|div|a|picture|source|br|h\d|sup|sub|details|summary)[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

function fileTree(paths: string[]): string {
  // Depth-2 folders with file counts, plus the top-level files.
  const counts = new Map<string, number>();
  const topFiles: string[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length === 1) topFiles.push(path);
    else {
      const key = parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const dirs = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 120).map(([dir, n]) => `${dir} (${n} files)`);
  return [...topFiles.slice(0, 40), ...dirs].join("\n");
}

function manifests(files: RepoFile[]): string {
  const out: string[] = [];
  for (const file of files) {
    if (file.text === undefined || file.path.split("/").length > 3) continue;
    const name = file.path.split("/").pop()!.toLowerCase();
    if (name === "package.json") {
      try {
        const json = JSON.parse(file.text) as Record<string, unknown>;
        const pick = { name: json["name"], description: json["description"], scripts: json["scripts"], dependencies: json["dependencies"], bin: json["bin"] };
        out.push(`--- ${file.path}\n${JSON.stringify(pick, null, 1)}`);
      } catch {
        out.push(`--- ${file.path}\n${file.text.slice(0, 1_500)}`);
      }
    } else if (/^(pyproject\.toml|cargo\.toml|go\.mod|requirements\.txt|gemfile|composer\.json|pubspec\.yaml|mix\.exs|deno\.json)$/.test(name)) {
      out.push(`--- ${file.path}\n${file.text.slice(0, 1_500)}`);
    }
  }
  return out.join("\n");
}

function docs(files: RepoFile[]): string {
  return files
    .filter((file) => file.text !== undefined && /^(docs?\/|architecture|design)/i.test(file.path))
    .slice(0, 8)
    .map((file) => `--- ${file.path}\n${clip(cleanMarkdown(file.text!), 3_000)}`)
    .join("\n");
}

function entryPoints(files: RepoFile[]): string {
  return files
    .filter((file) => file.text !== undefined && /(^|\/)(index|main|app|server|lib|mod|__init__|cli)\.[a-z]+$/i.test(file.path) && !/\.(json|md)$/i.test(file.path))
    .slice(0, 6)
    .map((file) => `--- ${file.path}\n${file.text!.split("\n").slice(0, 60).join("\n")}`)
    .join("\n");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…truncated]`;
}
