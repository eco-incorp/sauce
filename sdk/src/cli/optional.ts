/**
 * The packages one command of the `sauce` bin needs and nothing else does — the MCP SDK and zod for
 * `sauce mcp`, LiteSVM for a Solana rehearsal in a local copy — and how that command finds them.
 * They are OPTIONAL PEER dependencies of the package: a library install gets none of them, with no
 * flag, and no export reaches them (`optional-dependencies.test.ts`). The command that needs them
 * takes, in this order ({@link provide}):
 *
 *   1. the user's own copies, where the package's modules resolve them, when each is exactly the
 *      version the package pins;
 *   2. else this version's runtime folder, `~/.sauce/runtime/<version>`;
 *   3. else it installs that folder first, with `npm ci` on the lockfile the package ships
 *      (`sdk/runtime/`, every package pinned with its integrity hash) — only where the process was
 *      given the installer ({@link useRuntime}, by `main.ts`), so an in-process run (every test,
 *      the skills checker) installs nothing and reaches no registry.
 *
 * From the runtime folder they load through a resolve hook: an import of one of them by the
 * package's own modules resolves there, and their own imports go on from there.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CliError, UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

/** Runtime packages one command needs, taken together from one place. */
export interface Extra {
  /** The command that loads them, as `sauce runtime status` lists it. */
  readonly command: string;
  /** What needs them, as a message says it: "the MCP server". */
  readonly what: string;
  readonly packages: readonly string[];
  /** The directory of the modules that import them: where the user's own copies are looked for. */
  readonly importer: string;
}

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The MCP server's packages, imported by `mcp/dist` (beside `sdk/dist` in the package). */
export const MCP_EXTRA: Extra = {
  command: "sauce mcp",
  what: "the MCP server",
  packages: ["@modelcontextprotocol/sdk", "zod"],
  importer: here("../../../mcp/dist/"),
};

/** A Solana rehearsal's, imported by `svm-fork.ts`. */
export const LITESVM_EXTRA: Extra = {
  command: "Solana simulations",
  what: "simulating this cook in a local copy of the accounts it names",
  packages: ["litesvm"],
  importer: here("./"),
};

/** Where the package ships the runtime packages' manifest and lockfile. */
export const RUNTIME_SOURCE = here("../../runtime/");

/** The package's own directory, three levels above `sdk/{src,dist}/cli`. */
const PACKAGE_ROOT = here("../../../");

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** The runtime packages and the version of each the package pins: its shipped manifest's. */
export function pinned(): Readonly<Record<string, string>> {
  return readJson<{ dependencies: Record<string, string> }>(join(RUNTIME_SOURCE, "package.json"))
    .dependencies;
}

/** `name 1.2.3`, joined: what a message says is needed. */
export function specs(packages: readonly string[]): string {
  const pins = pinned();
  const each = packages.map((name) => `${name} ${pins[name]}`);

  return each.length === 1 ? each[0]! : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
}

/** Installs the shipped lockfile's packages into a runtime folder, whole or not at all. */
export interface RuntimeInstaller {
  install(dir: string): Promise<void>;
}

let installer: RuntimeInstaller | undefined;
let offlineProcess = false;
let rootOverride: string | undefined;

/**
 * What this process may do with runtime folders: `main.ts` gives the installer (`runtime.ts`), the
 * one place that runs `npm ci`; `sauce mcp --offline` makes the whole process install nothing, so a
 * Solana rehearsal one of its tools runs later refuses as the server's start would; a test gives a
 * folder of its own in place of `~/.sauce/runtime`.
 */
export function useRuntime(options: {
  installer?: RuntimeInstaller;
  offline?: boolean;
  root?: string;
}): void {
  if ("installer" in options) installer = options.installer;
  if ("offline" in options) offlineProcess = options.offline === true;
  if ("root" in options) rootOverride = options.root;
}

/** Where every version's runtime folder is: `~/.sauce/runtime`. */
export function runtimeRoot(): string {
  return rootOverride ?? join(homedir(), ".sauce", "runtime");
}

/** This version's runtime folder, named by the package's version. */
export function runtimeDir(): string {
  return join(
    runtimeRoot(),
    readJson<{ version: string }>(join(PACKAGE_ROOT, "package.json")).version,
  );
}

/** The copy of `name` that modules in `from` resolve, as Node.js looks for it; `undefined` where
 *  there is none. */
export function ownCopy(
  name: string,
  from: string,
): { readonly path: string; readonly version: string | undefined } | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    // Node.js never looks in `node_modules/node_modules`.
    const manifest = join(dir, "node_modules", name, "package.json");
    if (basename(dir) !== "node_modules" && existsSync(manifest)) {
      try {
        return {
          path: dirname(manifest),
          version: readJson<{ version?: string }>(manifest).version,
        };
      } catch {
        return { path: dirname(manifest), version: undefined };
      }
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** Whether `dir` holds the shipped lockfile's install, with each of `packages` at its pin. */
export function installedAt(
  dir: string,
  packages: readonly string[] = Object.keys(pinned()),
): boolean {
  try {
    const lock = (path: string) => readFileSync(join(path, "package-lock.json"), "utf8");
    if (lock(dir) !== lock(RUNTIME_SOURCE)) return false;
    const pins = pinned();

    return packages.every(
      (name) =>
        readJson<{ version?: string }>(join(dir, "node_modules", name, "package.json")).version ===
        pins[name],
    );
  } catch {
    return false;
  }
}

/**
 * Refuses to load code from the runtime folder `dir` unless it and each folder above it up to the
 * one holding the runtime root (`~/.sauce`), each resolved through symlinks, belongs to this user
 * and can be written by no one else — and `dir` itself is open to no one else at all (0700, as an
 * install creates it), so no folder inside it that someone loosened can be reached either. What it loads runs in a process that may hold a wallet's
 * password (`sauce mcp`, its wallets enabled), so it must be the user's alone, as the password file and a
 * wallet's policy must be. A folder not there yet is passed over: an install creates it 0700.
 * Windows has no owner or mode to read this way, and is not checked.
 */
export function assertPrivate(dir: string, uid: number | undefined = process.getuid?.()): void {
  if (uid === undefined) return;
  const root = runtimeRoot();
  const folders = [dir, root, dirname(root)].filter(
    (each, at, all) => all.indexOf(each) === at && existsSync(each),
  );
  for (const folder of folders) {
    const real = realpathSync(folder);
    const { uid: owner, mode } = statSync(real);
    const shown = real === folder ? folder : `${folder} (${real})`;
    if (owner !== uid) {
      throw new CliError(
        `${shown} belongs to another user (uid ${owner}): sauce loads code only from folders that ` +
          `are yours alone. Remove ${dir} to have it installed again`,
      );
    }
    const octal = (mode & 0o777).toString(8);
    if (folder === dir && (mode & 0o077) !== 0) {
      throw new CliError(
        `${shown} is open to ${whom(mode & 0o070, mode & 0o007)} (mode ${octal}): sauce loads ` +
          `code only from a runtime folder that is yours alone. Run chmod 700 ${real}`,
      );
    }
    if ((mode & 0o022) !== 0) {
      throw new CliError(
        `${shown} can be written by ${whom(mode & 0o020, mode & 0o002)} (mode ${octal}): sauce ` +
          `loads code only from folders no one else can write. Run chmod go-w ${real}`,
      );
    }
  }
}

/** "its group", "others", or both: whom a mode's group and other bits let in. */
const whom = (group: number, others: number): string =>
  [group !== 0 ? "its group" : "", others !== 0 ? "others" : ""]
    .filter((each) => each !== "")
    .join(" and ");

/** Where `extra`'s packages come from: the user's own copies, the runtime folder, or nowhere yet. */
export function sourceOf(extra: Extra): "own" | "runtime" | "missing" {
  const pins = pinned();
  if (extra.packages.every((name) => ownCopy(name, extra.importer)?.version === pins[name])) {
    return "own";
  }

  return installedAt(runtimeDir(), extra.packages) ? "runtime" : "missing";
}

/**
 * Makes `extra`'s packages importable by the package's modules, installing this version's runtime
 * folder first where it must and may. Progress goes to `log` (stderr: stdout is the MCP protocol's);
 * every failure is one line.
 */
export async function provide(
  extra: Extra,
  options: { readonly offline?: boolean; readonly log?: (text: string) => void } = {},
): Promise<void> {
  const source = sourceOf(extra);
  if (source === "own") return;
  const dir = runtimeDir();
  // The folders above it first: nothing is installed into, or loaded from, one another can write.
  assertPrivate(dir);
  if (source === "missing") {
    const needs = `${extra.what} needs ${specs(extra.packages)}, not installed for this sauce yet`;
    if (options.offline === true || offlineProcess) {
      throw new CliError(`${needs}, and --offline installs nothing: run \`sauce runtime install\``);
    }
    if (installer === undefined) throw new CliError(`${needs}: run \`sauce runtime install\``);
    const log = options.log ?? ((text: string) => void process.stderr.write(text));
    log(`sauce: ${needs}. Installing them into ${dir}, once for this version…\n`);
    const started = Date.now();
    try {
      await installer.install(dir);
    } catch (error) {
      throw new CliError(
        `${needs}, and installing them into ${dir} failed: ${(error as Error).message}. Nothing ` +
          "was left half-installed: `sauce runtime install` tries again",
      );
    }
    if (!installedAt(dir, extra.packages)) {
      throw new CliError(`${needs}: npm ci finished, but ${dir} does not hold them`);
    }
    log(`sauce: installed in ${Math.round((Date.now() - started) / 1000)}s\n`);
    assertPrivate(dir);
  }
  loadFrom(extra.packages, dir);
}

/** `module.registerHooks` (Node.js 22.15 and 23.5), typed here: the SDK's Node typings predate it. */
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: { parentURL?: string },
      nextResolve: (specifier: string, context?: { parentURL?: string }) => unknown,
    ): unknown;
  }): unknown;
};

/** Each runtime package loaded from a runtime folder, and a URL in that folder to resolve it from. */
const redirected = new Map<string, string>();

/** The package a bare specifier names (`zod/v4` is `zod`); `undefined` for any other. */
function packageOf(specifier: string): string | undefined {
  if (/^(?:[./]|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return undefined;
  const [first, second] = specifier.split("/");

  return first!.startsWith("@") ? `${first}/${second}` : first;
}

/** Resolves the package's own imports of `packages` in `dir` from now on. */
function loadFrom(packages: readonly string[], dir: string): void {
  const hooked = redirected.size > 0;
  const from = pathToFileURL(join(dir, "package.json")).href;
  for (const name of packages) redirected.set(name, from);
  if (hooked) return;
  const ours = pathToFileURL(PACKAGE_ROOT).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const target = redirected.get(packageOf(specifier) ?? "");
      const parent = context.parentURL;
      // The package's own modules (not a package installed under it): theirs resolve as ever.
      if (
        target !== undefined &&
        parent?.startsWith(ours) === true &&
        !parent.slice(ours.length).includes("node_modules/")
      ) {
        return nextResolve(specifier, { ...context, parentURL: target });
      }

      return nextResolve(specifier, context);
    },
  });
}

/** Every command's runtime packages. */
const EXTRAS = [MCP_EXTRA, LITESVM_EXTRA];

/** `sauce runtime [status | install]`. */
export async function runtimeCommand(
  sub: string | undefined,
  log: (text: string) => void,
): Promise<CommandOutput> {
  if (sub !== undefined && sub !== "status" && sub !== "install") {
    throw new UsageError(`unknown subcommand '${sub}': status or install`);
  }
  const dir = runtimeDir();
  const all = Object.keys(pinned());
  if (sub === "install") {
    if (installedAt(dir)) {
      return {
        text: `${specs(all)}: already installed in ${dir}`,
        json: { dir, installed: true, changed: false },
      };
    }
    if (installer === undefined) {
      throw new CliError("sauce runtime install runs this machine's npm: run it as a command");
    }
    assertPrivate(dir);
    log(`Installing ${specs(all)} into ${dir}…\n`);
    try {
      await installer.install(dir);
    } catch (error) {
      throw new CliError(
        `installing ${specs(all)} into ${dir} failed: ${(error as Error).message}. Nothing was ` +
          "left half-installed",
      );
    }

    return {
      text: `${specs(all)}: installed in ${dir}`,
      json: { dir, installed: true, changed: true },
    };
  }
  const installed = installedAt(dir);
  const pins = pinned();
  const owns = Object.fromEntries(
    EXTRAS.flatMap((extra) =>
      extra.packages.map((name) => [name, ownCopy(name, extra.importer) ?? null] as const),
    ),
  );
  const uses = EXTRAS.map((extra) => {
    const source = sourceOf(extra);
    const mismatched = extra.packages.filter(
      (name) => owns[name] !== null && owns[name]!.version !== pins[name],
    );
    const said =
      source === "own"
        ? "your own copies"
        : source === "runtime"
          ? "the runtime folder"
          : "not installed: its first use installs them, or sauce runtime install now";
    const ignored = mismatched.map(
      (name) => `your ${name} is ${owns[name]!.version ?? "unreadable"}, not ${pins[name]}`,
    );

    return { extra, source, ignored, line: `${specs(extra.packages)}: ${said}` };
  });

  return {
    text: [
      `Runtime packages, in ${dir} (${installed ? "installed" : "not installed"}):`,
      ...uses.flatMap(({ extra, line, ignored }) => [
        `  ${extra.command.padEnd(18)} ${line}`,
        ...ignored.map((each) => `  ${"".padEnd(18)} (${each}: that copy is not used)`),
      ]),
    ].join("\n"),
    json: {
      dir,
      installed,
      packages: Object.fromEntries(
        all.map((name) => [name, { pinned: pins[name], own: owns[name] ?? null }]),
      ),
      uses: Object.fromEntries(uses.map(({ extra, source }) => [extra.command, source])),
    },
  };
}
