// Outline cache keyed by (repository, commit SHA). The same commit always gets the same outline, so a
// repeat order costs no LLM call: only GitHub metadata and a re-render.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Outline } from "./outline.js";

// Versioned: bump it when the prompt or the outline shape changes, so outlines written by the old prompt
// are not served again. The previous version's table is dropped.
const TABLE = "outlines_v2";

export class OutlineCache {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS outlines;
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        repo TEXT NOT NULL,
        sha TEXT NOT NULL,
        outline TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (repo, sha)
      );`);
  }

  get(repo: string, sha: string): Outline | undefined {
    const row = this.db.prepare(`SELECT outline FROM ${TABLE} WHERE repo = ? AND sha = ?`).get(repo.toLowerCase(), sha) as { outline: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.outline) as Outline);
  }

  set(repo: string, sha: string, outline: Outline, model: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${TABLE} (repo, sha, outline, model, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(repo.toLowerCase(), sha, JSON.stringify(outline), model, Date.now());
  }

  /** Keeps the table small: outlines older than `days` are dropped. */
  prune(days = 30): void {
    this.db.prepare(`DELETE FROM ${TABLE} WHERE created_at < ?`).run(Date.now() - days * 86_400_000);
  }

  close(): void {
    this.db.close();
  }
}
