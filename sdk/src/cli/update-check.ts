/**
 * The update check: one line on stderr after a command when a newer `@eco-incorp/sauce` is
 * published — `sauce 0.99.12 → 0.99.13 is available: run `sauce update`` — and, for `sauce mcp`,
 * one note in the first tool result of the server's life.
 *
 * It never slows a command down. What it says comes from a cache, `~/.sauce/update-check.json` (when
 * it last checked, the latest version it saw, and the version that checked), read synchronously; a
 * cache a day old, missing or unreadable is refreshed by `update-refresh.ts` in a process of its own,
 * started detached, its output ignored and unref'd, so the command neither waits for it nor stays
 * alive for it. A refresh in the command's own process could not do both: a request (and the DNS
 * lookup before it) keeps the process alive until it settles, and one unref'd instead dies with a
 * short command before the registry answers, so a quick `sauce compile` would never refresh. The
 * notice for a run is the cache's, so the first run after a release may print nothing.
 *
 * It is silent whatever goes wrong: a missing, unreadable or corrupt cache, an unreachable registry
 * or an answer that is no version says nothing, and nothing here throws. It is off with `--offline`,
 * `--no-update-check`, or `"updateCheck": false` in the `--config` file ({@link updateCheckOff}),
 * and only the executable creates one (`main.ts`), so importing a module starts nothing. The
 * registry is read through `npm-registry.ts`, and only by the refresh.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { newer, PACKAGE, readLatest, VERSION } from "./npm-registry.js";

/** How old a cache may be before it is refreshed. */
export const DAY = 24 * 60 * 60 * 1000;

/** The cache, as `~/.sauce/update-check.json` holds it. */
export interface UpdateCache {
  /** When the registry was last asked, as an ISO 8601 time. */
  readonly checkedAt: string;
  /** The `latest` dist-tag the registry last answered; absent until it has answered one. */
  readonly latest?: string;
  /** The version that asked. */
  readonly version: string;
}

/** The cache in `text`, its time in milliseconds; `undefined` for anything that is not one. A
 *  `latest` that is no version is left out. */
export function parseCache(
  text: string | undefined,
): { readonly at: number; readonly latest?: string } | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const { checkedAt, latest } = parsed as { checkedAt?: unknown; latest?: unknown };
  const at = typeof checkedAt === "string" ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(at)) return undefined;

  return typeof latest === "string" && VERSION.test(latest) ? { at, latest } : { at };
}

/** The cache's text for `cache`. */
export const cacheText = (cache: UpdateCache): string => `${JSON.stringify(cache, null, 2)}\n`;

const prerelease = (version: string): boolean => /^[^+]*-/.test(version);

/**
 * Whether `latest` is worth a notice to the copy running `version`: both are versions, `latest` is
 * the newer, and it is a release unless the running copy is a prerelease itself.
 */
export function noticeDue(latest: string, version: string): boolean {
  if (!VERSION.test(latest) || !VERSION.test(version)) return false;
  if (prerelease(latest) && !prerelease(version)) return false;

  return newer(latest, version);
}

/** The line the `sauce` command prints on stderr after a command. */
export const updateNotice = (version: string, latest: string): string =>
  `sauce ${version} → ${latest} is available: run \`sauce update\``;

/** The note the MCP server adds to the first tool result of its life. */
export const updateNote = (version: string, latest: string): string =>
  `A newer ${PACKAGE} is available: ${latest} (this server runs ${version}). Whoever runs the ` +
  "server updates it: `sauce update` updates the sauce command (or says how, for the way it was " +
  `installed), and \`npx -y ${PACKAGE}@latest mcp setup --force\` moves a project's MCP entry, ` +
  "which pins a version, to it. The server runs the new version once it restarts.";

/** What a command reads of the update check. */
export interface UpdateCheck {
  /** The running copy's version. */
  readonly version: string;
  /**
   * The newer version the cache records, when a notice is due for it ({@link noticeDue}). A cache
   * a day old, missing or unreadable starts a refresh first — at most once a day in a process —
   * which this never waits for: it answers from the cache as it read it.
   */
  latest(): string | undefined;
}

/** What the update check reaches: injected, so a test gives the time, the cache and the refresh. */
export interface UpdateCheckIo {
  readonly version: string;
  readonly now: () => number;
  /** The cache's text; `undefined` (or a throw) where there is none to read. */
  readonly read: () => string | undefined;
  /** Starts a refresh and returns at once: nothing waits for it. A throw starts none. */
  readonly refresh: () => void;
}

export function updateCheck(io: UpdateCheckIo): UpdateCheck {
  let refreshed: number | undefined;

  return {
    version: io.version,
    latest: () => {
      try {
        const now = io.now();
        let text: string | undefined;
        try {
          text = io.read();
        } catch {
          text = undefined;
        }
        const cache = parseCache(text);
        // A day old, or from a clock that has since gone back: asked again.
        const stale = cache === undefined || !(now - cache.at < DAY) || now < cache.at;
        if (stale && (refreshed === undefined || !(now - refreshed < DAY))) {
          refreshed = now;
          try {
            io.refresh();
          } catch {
            // No refresh: the cache stays as it is, and is asked about again tomorrow.
          }
        }

        return cache?.latest !== undefined && noticeDue(cache.latest, io.version)
          ? cache.latest
          : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** What a refresh reaches: the time, the cache, and the registry's latest version. */
export interface RefreshIo {
  readonly now: () => number;
  readonly read: () => string | undefined;
  readonly write: (text: string) => void;
  readonly latest: () => Promise<string>;
}

/**
 * The refresh `update-refresh.ts` runs for the copy running `version`. The attempt is written
 * first, keeping the latest version already known, so no other command starts a refresh while this
 * one asks the registry, and a registry that cannot be reached is asked again a day later; then the
 * registry's answer, when it is a version. Never throws.
 */
export async function refreshCache(io: RefreshIo, version: string): Promise<void> {
  let known: string | undefined;
  try {
    known = parseCache(io.read())?.latest;
  } catch {
    known = undefined;
  }
  const record = (latest: string | undefined): void => {
    try {
      const checkedAt = new Date(io.now()).toISOString();
      io.write(cacheText({ checkedAt, ...(latest === undefined ? {} : { latest }), version }));
    } catch {
      // Unwritable: the next command finds the cache as it was, and starts another refresh.
    }
  };
  record(known);
  let latest: string;
  try {
    latest = await io.latest();
  } catch {
    return;
  }
  if (VERSION.test(latest)) record(latest);
}

/**
 * Whether the update check is off for a command given these flags: `--offline` (which reaches no
 * network at all), `--no-update-check`, or `"updateCheck": false` in its `--config` file. A config
 * file that cannot be read or parsed says nothing here; the command reports it, if it reads it.
 */
export function updateCheckOff(
  values: Readonly<Record<string, unknown>>,
  readText: (path: string) => string,
): boolean {
  if (values.offline === true || values["no-update-check"] === true) return true;
  const config = values.config;
  if (typeof config !== "string") return false;
  try {
    return (
      (JSON.parse(readText(config)) as { updateCheck?: unknown } | null)?.updateCheck === false
    );
  } catch {
    return false;
  }
}

/** The cache file: `~/.sauce/update-check.json`. */
export const defaultCacheFile = (): string => join(homedir(), ".sauce", "update-check.json");

/**
 * Writes `text` to `file` whole: a temporary file, owner-only, renamed over the cache, in a
 * directory created owner-only — as a wallet is written, but replacing the file that is there.
 */
export function writeCacheFile(file: string, text: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = join(
    dir,
    `.${basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Starts `script` with `args` in a Node.js process of its own and returns at once: detached, with
 * its output ignored and the handle unref'd, so this process neither waits for it nor stays alive
 * for it. A failure to start it is silent.
 */
export function startDetached(script: string, args: readonly string[]): ChildProcess {
  const child = spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", () => undefined);
  child.unref();

  return child;
}

/** The refresh's script, built beside this module. */
const REFRESH_SCRIPT = fileURLToPath(new URL("./update-refresh.js", import.meta.url));

/**
 * The real process's update check: the version in the package's manifest, the cache under
 * `~/.sauce`, and the refresh in a process of its own. Only the executable creates it (`main.ts`).
 */
export function nodeUpdateCheck(file: string = defaultCacheFile()): UpdateCheck {
  let version = "unknown";
  try {
    // Three levels above `sdk/dist/cli`: the package's own manifest.
    const manifest = new URL("../../../package.json", import.meta.url);
    version =
      (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version ?? version;
  } catch {
    // No version: no notice is due for it.
  }

  return updateCheck({
    version,
    now: Date.now,
    read: () => readFileSync(file, "utf8"),
    refresh: () => void startDetached(REFRESH_SCRIPT, [file, version]),
  });
}

/** The real process's refresh of the cache at `file`, through the registry (`update-refresh.ts`). */
export const nodeRefresh = (file: string): RefreshIo => ({
  now: Date.now,
  read: () => readFileSync(file, "utf8"),
  write: (text) => writeCacheFile(file, text),
  latest: () => readLatest(),
});
