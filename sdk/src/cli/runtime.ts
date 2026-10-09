/**
 * The installer of a runtime folder (`optional.ts`): `npm ci` on the lockfile the package ships
 * (`sdk/runtime/`), into `~/.sauce/runtime/<version>`. `main.ts` gives it to the process, and it is
 * then, beside `sauce update` and `sauce init`'s install, the one thing that runs npm and so reaches
 * the npm registry: through npm and the user's own npm configuration (a mirror, a proxy), never a
 * URL of ours, and only when a command needs a package nothing else provides.
 *
 * The install is whole or nothing: npm runs in a temporary directory beside the folder, which is
 * renamed into place only once npm succeeded, so a crash leaves nothing half-installed. Both are
 * created owner-only (0700), as `~/.sauce` is. Afterwards the folders of older versions go, but the
 * newest of them; a newer version's is left to that version.
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { installedAt, RUNTIME_SOURCE, type RuntimeInstaller } from "./optional.js";
import { newer } from "./npm-registry.js";

/** How npm is run: `npm` itself, or, on Windows, its script with this Node.js (npm is a `.cmd`
 *  there, which only a shell runs, and this runs no shell). */
export interface Npm {
  readonly file: string;
  readonly args: readonly string[];
}

/** Runs npm with `args` in `cwd`; resolves its exit status (`null`: it could not be started) and
 *  what it printed on stderr. */
export type RunNpm = (
  args: readonly string[],
  cwd: string,
) => Promise<{ readonly status: number | null; readonly stderr: string; readonly error?: string }>;

/**
 * `npm ci`'s arguments: exactly the lockfile, no scripts, every platform binary it pins for this
 * platform (whatever a user's `omit=optional` says), quietly — and in the directory it runs in,
 * never in a workspace root above it whose `workspaces` glob happens to match the temporary
 * directory. Not `--prefix`, which would also move npm's global config (`$PREFIX/etc/npmrc`, where
 * an organisation sets its registry, proxy or CA) to the temporary directory, unread.
 */
export const NPM_CI = [
  "ci",
  "--ignore-scripts",
  "--include=optional",
  "--prefer-offline",
  "--no-audit",
  "--no-fund",
  "--loglevel=error",
  "--workspaces=false",
] as const;

/** Version folders are named by version; anything else under the root is left alone, but for the
 *  temporary directories an install leaves only if it was killed. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** npm's error lines that are not the error itself. */
const NPM_ASIDES = [
  /^(?:code|errno|syscall|path|dest)\b/,
  /^A complete log of this run/,
  /^Log files/,
  /^This is an error with npm itself/,
  /^<https:/,
];

/**
 * The reason npm gave, in one line: its error code and first message. Where npm says no more than
 * that it failed (npm 11 answers an unreachable registry with "Exit handler never called!"), the
 * network error its log records, and the log.
 */
export function npmReason(
  status: number | null,
  stderr: string,
  error?: string,
  readLog: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string {
  if (status === null) {
    return error === "ENOENT" ? "npm is not on PATH" : `npm could not be started (${error ?? "?"})`;
  }
  const lines = stderr
    .split("\n")
    .map((line) => /^npm (?:error|ERR!) (.*)$/.exec(line.trim())?.[1]?.trim())
    .filter((line): line is string => line !== undefined && line !== "");
  const code = lines.map((line) => /^code (\S+)$/.exec(line)?.[1]).find((each) => each);
  const log = lines
    .map((line) => /^A complete log of this run can be found in: (.+)$/.exec(line)?.[1])
    .find((each) => each);
  const message = lines.find((line) => !NPM_ASIDES.some((aside) => aside.test(line)));
  let network: string | undefined;
  if (code === undefined && log !== undefined) {
    try {
      network = /\bfailed with (E[A-Z_]+)\b/.exec(readLog(log))?.[1];
    } catch {
      // No log to read.
    }
  }
  const said =
    network !== undefined
      ? `it could not reach its registry (${network}); its log: ${log}`
      : [code, message]
          .filter((each) => each !== undefined)
          .join(": ")
          .slice(0, 300);

  return `npm ci exited with status ${status}${said === "" ? "" : ` (${said})`}`;
}

/**
 * Installs the shipped lockfile into `dir`: `npm ci` in a temporary directory beside it, renamed
 * into place. A folder already there that holds the install (another process's, which won the
 * race) is kept; one that does not (an older lockfile's, a damaged one) is replaced. Throws npm's
 * reason, having left nothing behind.
 */
export async function installRuntime(dir: string, runNpm: RunNpm): Promise<void> {
  const root = dirname(dir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(root, `.${basename(dir)}.`));
  try {
    copyFileSync(join(RUNTIME_SOURCE, "package.json"), join(temp, "package.json"));
    copyFileSync(join(RUNTIME_SOURCE, "package-lock.json"), join(temp, "package-lock.json"));
    const ran = await runNpm(NPM_CI, temp);
    if (ran.status !== 0) throw new Error(npmReason(ran.status, ran.stderr, ran.error));
    try {
      renameSync(temp, dir);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM") throw error;
      if (!installedAt(dir)) {
        const aside = `${temp}.replaced`;
        renameSync(dir, aside);
        renameSync(temp, dir);
        rmSync(aside, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  prune(root, basename(dir));
}

/**
 * Removes the version folders under `root` older than `current`, but the newest of them, and the
 * temporary directories of installs killed over an hour ago. A NEWER version's folder is never
 * this one's to remove: an older sauce (a project's pinned copy) runs beside a newer one (the
 * global install) whose server may be loading from it.
 */
export function prune(root: string, current: string): void {
  const entries = readdirSync(root);
  const older = VERSION.test(current)
    ? entries
        .filter((name) => VERSION.test(name) && newer(current, name))
        .sort((a, b) => (newer(a, b) ? 1 : -1))
    : [];
  const hourAgo = Date.now() - 3_600_000;
  for (const name of entries) {
    const path = join(root, name);
    const stale = VERSION.test(name)
      ? older.slice(0, -1).includes(name)
      : name.startsWith(".") && statSync(path).mtimeMs < hourAgo;
    if (stale) rmSync(path, { recursive: true, force: true });
  }
}

/** npm, run with no shell: `npm`, or on Windows its own script with `node`. */
export function npmCommand(platform: NodeJS.Platform, node: string): Npm {
  return platform === "win32"
    ? { file: node, args: [join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js")] }
    : { file: "npm", args: [] };
}

/** The real process's installer: this machine's npm. */
export function nodeRuntimeInstaller(): RuntimeInstaller {
  const npm = npmCommand(process.platform, process.execPath);
  const runNpm: RunNpm = (args, cwd) =>
    new Promise((resolve) => {
      // stdout is never ours to write (the MCP protocol's, or a command's report): npm's is dropped.
      const child = spawn(npm.file, [...npm.args, ...args], {
        cwd,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.once("error", (error: NodeJS.ErrnoException) =>
        resolve({ status: null, stderr, error: error.code ?? error.message }),
      );
      child.once("close", (code) => resolve({ status: code, stderr }));
    });

  return { install: (dir) => installRuntime(dir, runNpm) };
}
