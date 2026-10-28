// Generated decks on local disk, served at {origin}/decks/<random>.pptx.
// The name is 32 random bytes, so a URL can't be guessed. The spec wants output URLs to keep working
// while the job can be retrieved [S8], so a file lives for retentionSeconds plus an hour, then a sweep
// deletes it.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9_-]{43}\.pptx$/;

export class DeckStorage {
  constructor(
    readonly dir: string,
    private readonly publicOrigin: string,
    private readonly keepSeconds: number,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async save(buffer: Buffer): Promise<{ url: string; expiresAt: string }> {
    const name = `${randomBytes(32).toString("base64url")}.pptx`;
    await writeFile(join(this.dir, name), buffer, { mode: 0o640 });
    return {
      url: `${this.publicOrigin}/decks/${name}`,
      expiresAt: new Date(Date.now() + this.keepSeconds * 1000).toISOString(),
    };
  }

  /** The file path for a public name, or undefined for anything that isn't one of ours. */
  pathFor(name: string): string | undefined {
    return NAME.test(name) ? join(this.dir, name) : undefined;
  }

  async sweep(): Promise<number> {
    const cutoff = Date.now() - this.keepSeconds * 1000;
    let removed = 0;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!NAME.test(name)) continue;
      const path = join(this.dir, name);
      const info = await stat(path).catch(() => undefined);
      if (info !== undefined && info.mtimeMs < cutoff) {
        await unlink(path).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}
