/**
 * `sauce update`: updates the copy of the package that is running, the way it was installed.
 *
 * Where that copy lives says how it got there (`installationOf`, from the package directory's real
 * path): a global install by npm, pnpm, yarn or bun is updated by that manager's own global install,
 * run with no shell; a project's own copy is the project's to update, so the command it takes is
 * printed and nothing runs; a copy in npx's (or `pnpm dlx`'s, or bunx's) cache is printed the
 * command that fetches the latest; and anything else is refused with npm's command. After a global
 * update, skills installed in the current directory are brought to the new version by the NEW
 * binary's `sauce skills update`, and where the version replaced had its runtime folder installed
 * (`optional.ts`), the NEW binary installs its own (`sauce runtime install`).
 *
 * The npm registry is the command's one network access besides a chain's endpoints, and only this
 * command reaches it, only when it runs: there is no background or automatic check. Everything that
 * touches the outside — the registry, the package managers, the filesystem it inspects — is the
 * `Updater` the executable gives it (`main.ts`); a test gives its own, so nothing installs.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError, UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { runtimeRoot } from "./optional.js";
import { installedTargets } from "./skills.js";

/** The package this command updates. */
export const PACKAGE = "@eco-incorp/sauce";

/** Where the package is published (the root manifest's `publishConfig.registry`): the one registry
 *  this command reads. */
export const REGISTRY = "https://registry.npmjs.org/";

export type Manager = "npm" | "pnpm" | "yarn" | "bun";

/** How the running copy was installed, as its path says. */
export type Installation =
  | {
      readonly kind: "global";
      readonly manager: Manager;
      /** Where the manager links the package: the directory its manifest is read from after. */
      readonly root: string;
      /** npm's global prefix, passed back to it so it updates this copy and no other. */
      readonly prefix?: string;
    }
  | {
      readonly kind: "project";
      readonly manager: Manager;
      readonly project: string;
      /** Whether the project lists the package under `devDependencies`. */
      readonly dev: boolean;
    }
  | { readonly kind: "ephemeral"; readonly runner: "npx" | "pnpm dlx" | "bunx" }
  | { readonly kind: "unknown"; readonly path: string };

/** The registry's view of the package: its dist-tags and every published version. */
export interface Packument {
  readonly distTags: Readonly<Record<string, string>>;
  readonly versions: readonly string[];
}

/** A command run with no shell, its output captured. */
export interface Captured {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Everything `sauce update` reaches outside itself. */
export interface Updater {
  /** The running copy's package directory, as a real path. */
  readonly root: string;
  /** The directory whose installed skills follow an update. */
  readonly cwd: string;
  /** Where the versions' runtime folders are: the new version's follows the old one's. */
  readonly runtime?: string;
  readonly platform: NodeJS.Platform;
  /** This Node.js, which runs the new binary and, on Windows, npm's own script. */
  readonly node: string;
  readonly exists: (path: string) => boolean;
  readonly readText: (path: string) => string;
  /** The package's packument from {@link REGISTRY}. */
  packument(): Promise<Packument>;
  /** Runs `file` with `args` in `cwd`, no shell, its output to stderr; resolves its exit status. */
  exec(file: string, args: readonly string[], cwd: string): Promise<number | null>;
  /** Runs `file` with `args` in `cwd`, no shell, capturing what it prints. */
  capture(file: string, args: readonly string[], cwd: string): Promise<Captured>;
}

const LOCKFILES: ReadonlyArray<readonly [string, Manager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

/** The package's directory under `nodeModules`. */
const under = (nodeModules: string): string => `${nodeModules}/${PACKAGE}`;

/**
 * How the copy at `root` (a real path) was installed: by its path, the directories each package
 * manager installs into, and for a project's copy the project's manifest and lockfile.
 */
export function installationOf(
  root: string,
  files: {
    readonly exists: (path: string) => boolean;
    readonly readText: (path: string) => string;
  },
): Installation {
  const path = root.replace(/\\/g, "/").replace(/\/+$/, "");
  // A cache that runs a package once: npx (`_npx`), pnpm dlx and bunx.
  if (/\/_npx\//.test(path)) return { kind: "ephemeral", runner: "npx" };
  if (/\/pnpm\/dlx\//i.test(path)) return { kind: "ephemeral", runner: "pnpm dlx" };
  if (/\/bunx-[^/]*\//.test(path)) return { kind: "ephemeral", runner: "bunx" };
  // A manager's global directory. Each holds a package.json, so they come before a project's copy.
  const bun = /^(.*\/\.bun\/install\/global\/node_modules)\//.exec(path);
  if (bun !== null) return { kind: "global", manager: "bun", root: under(bun[1]!) };
  const yarn = /^(.*\/(?:\.config\/yarn|\.yarn|Yarn\/Data)\/global\/node_modules)\//i.exec(path);
  if (yarn !== null) return { kind: "global", manager: "yarn", root: under(yarn[1]!) };
  const pnpm = /^(.*\/pnpm\/global\/\d+\/node_modules)\//i.exec(path);
  if (pnpm !== null) return { kind: "global", manager: "pnpm", root: under(pnpm[1]!) };
  // A project's own copy: the directory before the first node_modules holds the project's manifest.
  const project = /^(.*?)\/node_modules\//.exec(path)?.[1];
  if (project !== undefined && files.exists(`${project}/package.json`)) {
    const lock = LOCKFILES.find(([file]) => files.exists(`${project}/${file}`))?.[1];
    let dev = false;
    try {
      const manifest = JSON.parse(files.readText(`${project}/package.json`)) as {
        devDependencies?: Record<string, string>;
      };
      dev = manifest.devDependencies?.[PACKAGE] !== undefined;
    } catch {
      // A manifest that does not parse lists nothing: the command is printed for dependencies.
    }

    return {
      kind: "project",
      manager: lock ?? (path.includes("/node_modules/.pnpm/") ? "pnpm" : "npm"),
      project,
      dev,
    };
  }
  // npm's global install: <prefix>/lib/node_modules on POSIX, <prefix>/node_modules on Windows.
  const npm =
    /^(.*)\/lib\/node_modules\/@eco-incorp\/sauce$/.exec(path) ??
    /^(.*\/npm)\/node_modules\/@eco-incorp\/sauce$/i.exec(path);
  if (npm !== null) {
    return { kind: "global", manager: "npm", root: path, prefix: npm[1]! };
  }

  return { kind: "unknown", path };
}

/**
 * The command a global install of `spec` runs, with no shell. On Windows npm is a `.cmd`, which
 * only a shell runs, so its own script is run with this Node.js instead; pnpm and yarn are refused
 * there (`undefined`), their command printed for the user to run.
 */
export function globalInstall(
  installation: Extract<Installation, { kind: "global" }>,
  spec: string,
  platform: NodeJS.Platform,
  node: string,
): { readonly file: string; readonly args: readonly string[] } | undefined {
  switch (installation.manager) {
    case "npm": {
      const args = ["install", "--global", "--prefix", installation.prefix!, spec];
      if (platform !== "win32") return { file: "npm", args };
      const script = join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js");

      return { file: node, args: [script, ...args] };
    }
    case "pnpm":
      return platform === "win32" ? undefined : { file: "pnpm", args: ["add", "--global", spec] };
    case "yarn":
      return platform === "win32" ? undefined : { file: "yarn", args: ["global", "add", spec] };
    case "bun":
      return { file: "bun", args: ["add", "--global", spec] };
  }
}

/** The global install of `spec` as a person types it. */
export function globalInstallLine(
  installation: Extract<Installation, { kind: "global" }>,
  spec: string,
): string {
  switch (installation.manager) {
    case "npm":
      return `npm install --global --prefix ${quoted(installation.prefix!)} ${spec}`;
    case "pnpm":
      return `pnpm add --global ${spec}`;
    case "yarn":
      return `yarn global add ${spec}`;
    case "bun":
      return `bun add --global ${spec}`;
  }
}

/** A project's update of its own copy to `spec`, pinned exactly as `sauce init` pins it. */
export function projectInstallLine(
  installation: Extract<Installation, { kind: "project" }>,
  spec: string,
): string {
  const dev = installation.dev;
  switch (installation.manager) {
    case "npm":
      return `npm install --save-exact${dev ? " --save-dev" : ""} ${spec}`;
    case "pnpm":
      return `pnpm add --save-exact${dev ? " --save-dev" : ""} ${spec}`;
    case "yarn":
      return `yarn add --exact${dev ? " --dev" : ""} ${spec}`;
    case "bun":
      return `bun add --exact${dev ? " --dev" : ""} ${spec}`;
  }
}

const quoted = (text: string): string => (/^[\w./:@+-]+$/.test(text) ? text : JSON.stringify(text));

/** `--version`: an exact version, or a dist-tag (`latest`, `next`). */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TAG = /^[a-z][a-z0-9-]*$/i;

/** What `sauce update` was asked. */
export interface UpdateInput {
  /** Report the version installed and the one an update would install; install nothing. */
  readonly check: boolean;
  /** `--version`: the version or dist-tag to install; `latest` when absent. */
  readonly version?: string;
}

const describe = (installation: Installation): string => {
  switch (installation.kind) {
    case "global":
      return `a global install by ${installation.manager} (${installation.root})`;
    case "project":
      return `${installation.project}'s own copy (${installation.manager})`;
    case "ephemeral":
      return `${installation.runner}'s cache`;
    case "unknown":
      return `${installation.path}, installed by no package manager this command knows`;
  }
};

/**
 * Whether version `a` is newer than `b`, by their numbers and a prerelease below its release;
 * `false` where either is no version.
 */
export function newer(a: string, b: string): boolean {
  const parse = (text: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(text);

    return match === null
      ? undefined
      : { numbers: [1, 2, 3].map((at) => BigInt(match[at]!)), pre: match[4] };
  };
  const [x, y] = [parse(a), parse(b)];
  if (x === undefined || y === undefined) return false;
  for (let at = 0; at < 3; at++) {
    if (x.numbers[at] !== y.numbers[at]) return x.numbers[at]! > y.numbers[at]!;
  }
  if (x.pre === undefined || y.pre === undefined) return x.pre === undefined && y.pre !== undefined;

  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
}

/** The version `wanted` (a version or a dist-tag) names in `packument`. */
function resolveVersion(packument: Packument, wanted: string): string {
  if (VERSION.test(wanted)) {
    if (!packument.versions.includes(wanted)) {
      throw new UsageError(`--version ${wanted}: ${PACKAGE} has no such version on the registry`);
    }

    return wanted;
  }
  const tagged = packument.distTags[wanted];
  if (tagged === undefined) {
    throw new UsageError(
      `--version ${wanted}: ${PACKAGE} has no such dist-tag (it has ` +
        `${Object.keys(packument.distTags).join(", ")})`,
    );
  }

  return tagged;
}

/** A manifest's version, or `undefined` where it cannot be read. */
function versionAt(updater: Updater, root: string): string | undefined {
  try {
    return (JSON.parse(updater.readText(join(root, "package.json"))) as { version?: string })
      .version;
  } catch {
    return undefined;
  }
}

/** `sauce update`. */
export async function updateCommand(
  input: UpdateInput,
  updater: Updater | undefined,
): Promise<CommandOutput> {
  if (updater === undefined) {
    throw new CliError(
      "sauce update updates the installed sauce command: run it as `sauce update`",
    );
  }
  const wanted = input.version ?? "latest";
  if (!VERSION.test(wanted) && !TAG.test(wanted)) {
    throw new UsageError(`--version: '${wanted}' is neither a version (1.2.3) nor a dist-tag`);
  }
  const installation = installationOf(updater.root, updater);
  const current = versionAt(updater, updater.root) ?? "unknown";
  // The registry says what `wanted` is. A global update needs it; the other installs only print a
  // command, so they print it without the registry too.
  let packument: Packument | undefined;
  let unreachable: string | undefined;
  try {
    packument = await updater.packument();
  } catch (error) {
    unreachable = `reading ${PACKAGE}'s versions from ${REGISTRY} failed: ${(error as Error).message}`;
    if (installation.kind === "global") throw new CliError(unreachable);
  }
  const target = packument === undefined ? undefined : resolveVersion(packument, wanted);
  const base = {
    package: PACKAGE,
    installation: { ...installation, description: describe(installation) },
    current,
    latest: packument?.distTags.latest ?? null,
    target: target ?? null,
    // Without --version, a copy newer than the latest (a prerelease) is not taken back to it.
    upToDate:
      target === undefined
        ? null
        : current === target || (input.version === undefined && newer(current, target)),
  };
  const head =
    `${PACKAGE} ${current}, ${describe(installation)}` +
    (target === undefined
      ? ""
      : `; ${wanted === "latest" ? "the latest is" : `${wanted} is`} ${target}`);
  const notes = unreachable === undefined ? [] : [unreachable];
  // What a printed command installs: the version or tag asked for, as the person would type it.
  const asked = `${PACKAGE}@${wanted}`;

  if (installation.kind === "unknown") {
    const line = `npm install --global ${asked}`;
    if (input.check) {
      return {
        text: [head, `Not updated here: install it with ${line}`].join("\n"),
        json: { ...base, command: line },
        notes,
      };
    }
    throw new CliError(
      `cannot tell how this sauce (${installation.path}) was installed, so it updates nothing: ` +
        `install the ${wanted === "latest" ? "latest" : wanted} with ${line}`,
    );
  }
  if (installation.kind === "ephemeral") {
    const line = `${installation.runner === "npx" ? "npx -y" : installation.runner} ${asked} <command>`;

    return {
      text: [
        head,
        `This sauce runs from ${installation.runner}'s cache, which nothing updates: run ${line}.`,
      ].join("\n"),
      json: { ...base, command: line },
      notes,
    };
  }
  if (installation.kind === "project") {
    const line = projectInstallLine(installation, asked);

    return {
      text: [
        head,
        base.upToDate === true
          ? "This is the project's own copy, and it is up to date."
          : `This is the project's own copy, which the project updates, not this command: in ` +
            `${installation.project}, run ${line}, then sauce skills update.`,
      ].join("\n"),
      json: { ...base, command: line, project: installation.project },
      notes,
    };
  }
  // A global install: the registry was read, or the command stopped above.
  const spec = `${PACKAGE}@${target!}`;
  const upToDate = base.upToDate === true;

  const line = globalInstallLine(installation, spec);
  if (input.check || upToDate) {
    return {
      text: [
        head,
        upToDate
          ? current === target
            ? "Up to date."
            : `Newer than ${wanted}: nothing to install (--version ${target} installs it).`
          : `sauce update installs it: ${line}`,
      ].join("\n"),
      json: { ...base, command: line, updated: false },
    };
  }
  const argv = globalInstall(installation, spec, updater.platform, updater.node);
  if (argv === undefined) {
    throw new CliError(
      `${installation.manager} runs through a shell on Windows, which this command never uses: ` +
        `run ${line} yourself`,
    );
  }
  const status = await updater.exec(argv.file, argv.args, updater.cwd);
  if (status !== 0) {
    throw new CliError(
      `${line} exited with ${status === null ? "no status (it could not be run)" : `status ${status}`}: ` +
        `${PACKAGE} stays at ${current}`,
    );
  }
  const now = versionAt(updater, installation.root);
  if (now !== target) {
    notes.push(
      `${installation.root}/package.json says ${now ?? "nothing readable"} after the install, ` +
        `not ${target}: check which ${installation.manager} installed it`,
    );
  }

  // The skills installed here follow the command: the NEW binary updates them. So does the runtime
  // folder, where the version replaced had one: an agent's next start of `sauce mcp` waits for none.
  const skills = await followSkills(updater, installation.root);
  const runtime = await followRuntime(updater, installation.root, current);
  if (runtime !== undefined && runtime.status !== 0) {
    notes.push(
      `The new sauce did not install its runtime packages (its first sauce mcp does): ` +
        (runtime.stderr.trim() || runtime.stdout.trim()),
    );
  }

  return {
    text: [
      `${PACKAGE} ${current} -> ${now ?? target} (${line})`,
      ...(skills === undefined
        ? []
        : skills.status === 0
          ? [`Skills in ${updater.cwd}, updated by the new sauce:`, ...indented(skills.stdout)]
          : [
              `Skills in ${updater.cwd} were not updated:`,
              ...indented(skills.stdout + skills.stderr),
            ]),
      ...(runtime !== undefined && runtime.status === 0 ? indented(runtime.stdout) : []),
    ].join("\n"),
    json: {
      ...base,
      command: line,
      updated: true,
      version: now ?? null,
      skills:
        skills === undefined
          ? null
          : { dir: updater.cwd, updated: skills.status === 0, output: skills.stdout.trim() },
      runtime:
        runtime === undefined
          ? null
          : { installed: runtime.status === 0, output: runtime.stdout.trim() },
    },
    ...(notes.length === 0 ? {} : { notes }),
    ...(skills !== undefined && skills.status !== 0 ? { exitCode: 1 } : {}),
  };
}

const indented = (text: string): string[] =>
  text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `  ${line}`);

/** The `sauce` binary of the package installed at `root`. */
function binaryAt(updater: Updater, root: string): string {
  let bin = "sdk/dist/cli/main.js";
  try {
    const manifest = JSON.parse(updater.readText(join(root, "package.json"))) as {
      bin?: Record<string, string>;
    };
    bin = manifest.bin?.sauce ?? bin;
  } catch {
    // The binary where the package keeps it.
  }

  return join(root, bin);
}

/** `sauce skills update` in the current directory, by the binary now installed at `root`, when
 *  skills are installed there; `undefined` when none are. */
async function followSkills(updater: Updater, root: string): Promise<Captured | undefined> {
  if (installedTargets(updater.cwd).length === 0) return undefined;

  return updater.capture(
    updater.node,
    [binaryAt(updater, root), "skills", "update", "--dir", updater.cwd],
    updater.cwd,
  );
}

/** `sauce runtime install`, by the binary now installed at `root`, when the version replaced had
 *  its runtime folder installed; `undefined` when it had none. */
async function followRuntime(
  updater: Updater,
  root: string,
  replaced: string,
): Promise<Captured | undefined> {
  if (updater.runtime === undefined || !updater.exists(join(updater.runtime, replaced))) {
    return undefined;
  }

  return updater.capture(
    updater.node,
    [binaryAt(updater, root), "runtime", "install"],
    updater.cwd,
  );
}

/** The real process's updater: this package's directory, the registry, and the package managers. */
export function nodeUpdater(): Updater {
  return {
    // Three levels above `sdk/dist/cli`: the package's own directory.
    root: realpathSync(fileURLToPath(new URL("../../../", import.meta.url))),
    cwd: process.cwd(),
    runtime: runtimeRoot(),
    platform: process.platform,
    node: process.execPath,
    exists: existsSync,
    readText: (path) => readFileSync(path, "utf8"),
    packument: async () => {
      const response = await fetch(`${REGISTRY}${PACKAGE.replace("/", "%2f")}`, {
        // The abbreviated document: dist-tags and versions, without every version's readme.
        headers: { accept: "application/vnd.npm.install-v1+json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`the registry answered ${response.status}`);
      const body = (await response.json()) as {
        "dist-tags"?: Record<string, string>;
        versions?: Record<string, unknown>;
      };

      return { distTags: body["dist-tags"] ?? {}, versions: Object.keys(body.versions ?? {}) };
    },
    exec: (file, args, cwd) =>
      new Promise((resolve) => {
        // No shell; the manager's output goes to stderr, so stdout stays this command's report.
        const child = spawn(file, [...args], { cwd, shell: false, stdio: ["ignore", 2, 2] });
        child.once("error", () => resolve(null));
        child.once("close", (code) => resolve(code));
      }),
    capture: (file, args, cwd) =>
      new Promise((resolve) => {
        const child = spawn(file, [...args], {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.once("error", (error) => resolve({ status: null, stdout, stderr: error.message }));
        child.once("close", (code) => resolve({ status: code, stdout, stderr }));
      }),
  };
}
