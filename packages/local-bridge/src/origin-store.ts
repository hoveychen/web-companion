import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type OriginVerdict = 'allow' | 'deny';

export interface OriginStoreFile {
  origins: Record<string, OriginVerdict>;
}

const DEFAULT_CONFIG_DIR = join(homedir(), '.web-companion');
const DEFAULT_CONFIG_FILE = join(DEFAULT_CONFIG_DIR, 'origins.json');

/**
 * Persistent allowlist/denylist for which website origins this bridge will
 * accept sdk connections from. Backed by a JSON file under `~/.web-companion/`
 * so the user can audit / hand-edit it.
 *
 * v0.3 supports two verdicts: 'allow' / 'deny'. A missing entry means
 * "undecided" — the runtime then either prompts via stdin (in --no-mcp mode)
 * or denies-with-warning (in MCP mode).
 */
export class OriginStore {
  private cache: Record<string, OriginVerdict> = {};

  constructor(private readonly path: string = DEFAULT_CONFIG_FILE) {
    this.load();
  }

  static defaultPath(): string {
    return DEFAULT_CONFIG_FILE;
  }

  lookup(origin: string): OriginVerdict | undefined {
    return this.cache[origin];
  }

  set(origin: string, verdict: OriginVerdict): void {
    this.cache[origin] = verdict;
    this.save();
  }

  remove(origin: string): boolean {
    if (!(origin in this.cache)) return false;
    delete this.cache[origin];
    this.save();
    return true;
  }

  list(): Array<{ origin: string; verdict: OriginVerdict }> {
    return Object.entries(this.cache).map(([origin, verdict]) => ({
      origin,
      verdict,
    }));
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) {
        this.cache = {};
        return;
      }
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OriginStoreFile>;
      this.cache = sanitizeOrigins(parsed.origins);
    } catch {
      this.cache = {};
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const data: OriginStoreFile = { origins: this.cache };
      writeFileSync(this.path, JSON.stringify(data, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (err) {
      process.stderr.write(
        `[web-companion] failed to persist origin store: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

function sanitizeOrigins(
  input: Record<string, unknown> | undefined,
): Record<string, OriginVerdict> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, OriginVerdict> = {};
  for (const [origin, verdict] of Object.entries(input)) {
    if (verdict === 'allow' || verdict === 'deny') {
      out[origin] = verdict;
    }
  }
  return out;
}
