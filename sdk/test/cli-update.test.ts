/**
 * `sauce update`, with nothing installed and nothing reached: how the running copy was installed,
 * read from fixture paths for each package manager, a project and the run-once caches; the command
 * each manager is run with; `--check` against a packument given here; and the skills a global update
 * brings along, updated by the new binary. Every package manager, the registry and the new binary
 * are the test's own `Updater`, which records what it was asked to run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { INSTALL_RECORD } from "../src/cli/skills.js";
import {
  globalInstall,
  installationOf,
  newer,
  PACKAGE,
  type Captured,
  type Installation,
  type Packument,
  type Updater,
} from "../src/cli/update.js";

const PACKUMENT: Packument = {
  distTags: { latest: "1.2.0", next: "1.3.0-beta.1" },
  versions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0-beta.1"],
};

/** An in-memory filesystem: `files` by path, `/`-separated. */
const filesOf = (files: Record<string, string>) => ({
  exists: (path: string) => path.replace(/\\/g, "/") in files,
  readText: (path: string) => {
    const text = files[path.replace(/\\/g, "/")];
    if (text === undefined)
      throw Object.assign(new Error(`${path}: no such file`), { code: "ENOENT" });

    return text;
  },
});

const manifest = (version: string) =>
  JSON.stringify({ name: PACKAGE, version, bin: { sauce: "./sdk/dist/cli/main.js" } });

describe("how the running copy was installed, from its path", () => {
  const none = filesOf({});
  it.each<[string, string, Installation]>([
    [
      "npm, globally",
      "/usr/local/lib/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "npm",
        root: "/usr/local/lib/node_modules/@eco-incorp/sauce",
        prefix: "/usr/local",
      },
    ],
    [
      "npm under nvm",
      "/home/me/.nvm/versions/node/v24.1.0/lib/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "npm",
        root: "/home/me/.nvm/versions/node/v24.1.0/lib/node_modules/@eco-incorp/sauce",
        prefix: "/home/me/.nvm/versions/node/v24.1.0",
      },
    ],
    [
      "npm on Windows",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@eco-incorp\\sauce",
      {
        kind: "global",
        manager: "npm",
        root: "C:/Users/me/AppData/Roaming/npm/node_modules/@eco-incorp/sauce",
        prefix: "C:/Users/me/AppData/Roaming/npm",
      },
    ],
    [
      "pnpm, globally, its store's real path",
      "/Users/me/Library/pnpm/global/5/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "pnpm",
        root: "/Users/me/Library/pnpm/global/5/node_modules/@eco-incorp/sauce",
      },
    ],
    [
      "pnpm on Linux",
      "/home/me/.local/share/pnpm/global/5/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "pnpm",
        root: "/home/me/.local/share/pnpm/global/5/node_modules/@eco-incorp/sauce",
      },
    ],
    [
      "yarn, globally",
      "/Users/me/.config/yarn/global/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "yarn",
        root: "/Users/me/.config/yarn/global/node_modules/@eco-incorp/sauce",
      },
    ],
    [
      "bun, globally",
      "/Users/me/.bun/install/global/node_modules/@eco-incorp/sauce",
      {
        kind: "global",
        manager: "bun",
        root: "/Users/me/.bun/install/global/node_modules/@eco-incorp/sauce",
      },
    ],
    [
      "npx's cache",
      "/Users/me/.npm/_npx/6a3f0b2c1d/node_modules/@eco-incorp/sauce",
      { kind: "ephemeral", runner: "npx" },
    ],
    [
      "pnpm dlx's cache",
      "/Users/me/Library/Caches/pnpm/dlx/abc123/19a/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      { kind: "ephemeral", runner: "pnpm dlx" },
    ],
    [
      "bunx's cache",
      "/tmp/bunx-501-@eco-incorp/sauce@latest/node_modules/@eco-incorp/sauce",
      { kind: "ephemeral", runner: "bunx" },
    ],
    [
      "a checkout of the repository",
      "/Users/me/src/sauce",
      { kind: "unknown", path: "/Users/me/src/sauce" },
    ],
  ])("%s", (_, path, expected) => {
    expect(installationOf(path, none)).toEqual(expected);
  });

  it.each<[string, Record<string, string>, string, Installation]>([
    [
      "npm, by its lockfile",
      { "/work/app/package.json": "{}", "/work/app/package-lock.json": "{}" },
      "/work/app/node_modules/@eco-incorp/sauce",
      { kind: "project", manager: "npm", project: "/work/app", dev: false },
    ],
    [
      "pnpm, by its lockfile, a devDependency",
      {
        "/work/app/package.json": JSON.stringify({ devDependencies: { [PACKAGE]: "1.0.0" } }),
        "/work/app/pnpm-lock.yaml": "",
      },
      "/work/app/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      { kind: "project", manager: "pnpm", project: "/work/app", dev: true },
    ],
    [
      "pnpm, by its layout, with no lockfile yet",
      { "/work/app/package.json": "{}" },
      "/work/app/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      { kind: "project", manager: "pnpm", project: "/work/app", dev: false },
    ],
    [
      "yarn",
      { "/work/app/package.json": "{}", "/work/app/yarn.lock": "" },
      "/work/app/node_modules/@eco-incorp/sauce",
      { kind: "project", manager: "yarn", project: "/work/app", dev: false },
    ],
    [
      "bun",
      { "/work/app/package.json": "{}", "/work/app/bun.lock": "" },
      "/work/app/node_modules/@eco-incorp/sauce",
      { kind: "project", manager: "bun", project: "/work/app", dev: false },
    ],
  ])("a project's own copy: %s", (_, files, path, expected) => {
    expect(installationOf(path, filesOf(files))).toEqual(expected);
  });
});

describe("the command each package manager runs, with no shell", () => {
  const spec = `${PACKAGE}@1.2.0`;
  const global = (manager: "npm" | "pnpm" | "yarn" | "bun") =>
    ({
      kind: "global",
      manager,
      root: `/g/node_modules/${PACKAGE}`,
      ...(manager === "npm" ? { prefix: "/usr/local" } : {}),
    }) as const;

  it("runs each manager's global install of the version", () => {
    expect(globalInstall(global("npm"), spec, "linux", "/usr/bin/node")).toEqual({
      file: "npm",
      args: ["install", "--global", "--prefix", "/usr/local", spec],
    });
    expect(globalInstall(global("pnpm"), spec, "darwin", "/usr/bin/node")).toEqual({
      file: "pnpm",
      args: ["add", "--global", spec],
    });
    expect(globalInstall(global("yarn"), spec, "linux", "/usr/bin/node")).toEqual({
      file: "yarn",
      args: ["global", "add", spec],
    });
    expect(globalInstall(global("bun"), spec, "darwin", "/usr/bin/node")).toEqual({
      file: "bun",
      args: ["add", "--global", spec],
    });
  });

  it("on Windows runs npm's own script with this Node.js, and refuses the managers only a shell runs", () => {
    const run = globalInstall(global("npm"), spec, "win32", "/nodejs/node.exe");
    expect(run?.file).toBe("/nodejs/node.exe");
    expect(run?.args[0]!.replace(/\\/g, "/")).toBe("/nodejs/node_modules/npm/bin/npm-cli.js");
    expect(run?.args.slice(1)).toEqual(["install", "--global", "--prefix", "/usr/local", spec]);
    expect(globalInstall(global("pnpm"), spec, "win32", "/nodejs/node.exe")).toBeUndefined();
    expect(globalInstall(global("yarn"), spec, "win32", "/nodejs/node.exe")).toBeUndefined();
    expect(globalInstall(global("bun"), spec, "win32", "/nodejs/node.exe")?.file).toBe("bun");
  });
});

describe("sauce update", () => {
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-update-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const NPM_ROOT = "/usr/local/lib/node_modules/@eco-incorp/sauce";

  /**
   * An updater for a copy at `root`, at `version`, in `cwd`, whose files are `files`: each install
   * it is asked to run sets the package's manifest to the version it installs, as a real one would,
   * the new binary's `skills update` answers `skills`, and its `runtime install` answers `installs`.
   */
  function updater(options: {
    root?: string;
    version?: string;
    files?: Record<string, string>;
    cwd?: string;
    packument?: Packument | Error;
    status?: number | null;
    skills?: Captured;
    runtime?: string;
    installs?: Captured;
    platform?: NodeJS.Platform;
  }) {
    const root = options.root ?? NPM_ROOT;
    const files: Record<string, string> = {
      [`${root}/package.json`]: manifest(options.version ?? "1.0.0"),
      ...options.files,
    };
    const fs = filesOf(files);
    const exec: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const captured: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    let packumentReads = 0;
    const self: Updater = {
      root,
      cwd: options.cwd ?? work,
      platform: options.platform ?? "linux",
      node: "/usr/bin/node",
      ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
      ...fs,
      packument: async () => {
        packumentReads++;
        if (options.packument instanceof Error) throw options.packument;

        return options.packument ?? PACKUMENT;
      },
      exec: async (file, args, cwd) => {
        exec.push({ file, args, cwd });
        const installed = /@eco-incorp\/sauce@(.+)$/.exec(args.at(-1) ?? "")?.[1];
        const linked = /^(.*\/global\/\d+\/node_modules)\//.exec(root)?.[1];
        const at = linked === undefined ? root : `${linked}/${PACKAGE}`;
        if (installed !== undefined && (options.status ?? 0) === 0) {
          files[`${at}/package.json`] = manifest(installed);
        }

        return options.status === undefined ? 0 : options.status;
      },
      capture: async (file, args, cwd) => {
        captured.push({ file, args, cwd });
        if (args[1] === "runtime") {
          return options.installs ?? { status: 0, stdout: "zod 4.6.5: installed\n", stderr: "" };
        }

        return options.skills ?? { status: 0, stdout: "skills are up to date\n", stderr: "" };
      },
    };

    return { self, exec, captured, packumentReads: () => packumentReads };
  }

  async function sauce(given: Updater | undefined, ...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      run: () => {
        throw new Error("sauce update runs nothing through io.run");
      },
      updater: given,
    };

    return { code: await runCli(["update", ...argv], io), stdout, stderr };
  }

  it("--check reports the version installed and the latest, and installs nothing", async () => {
    const { self, exec } = updater({});
    const run = await sauce(self, "--check");
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      `${PACKAGE} 1.0.0, a global install by npm (${NPM_ROOT}); the latest is 1.2.0\n` +
        `sauce update installs it: npm install --global --prefix /usr/local ${PACKAGE}@1.2.0\n`,
    );
    expect(exec).toEqual([]);
    const json = JSON.parse((await sauce(self, "--check", "--json")).stdout);
    expect(json).toMatchObject({
      current: "1.0.0",
      latest: "1.2.0",
      target: "1.2.0",
      upToDate: false,
      updated: false,
      installation: { kind: "global", manager: "npm", prefix: "/usr/local" },
    });
    // A dist-tag or an exact version, from the same packument.
    expect(
      JSON.parse((await sauce(self, "--check", "--json", "--version", "next")).stdout),
    ).toMatchObject({ target: "1.3.0-beta.1" });
    expect(exec).toEqual([]);
  });

  it("updates a global npm install with npm, under its own prefix, and prints the versions", async () => {
    const { self, exec, captured } = updater({});
    const run = await sauce(self);
    expect(run.code).toBe(0);
    expect(exec).toEqual([
      {
        file: "npm",
        args: ["install", "--global", "--prefix", "/usr/local", `${PACKAGE}@1.2.0`],
        cwd: work,
      },
    ]);
    expect(run.stdout).toBe(
      `${PACKAGE} 1.0.0 -> 1.2.0 (npm install --global --prefix /usr/local ${PACKAGE}@1.2.0)\n`,
    );
    // No skills here: the new binary is not asked.
    expect(captured).toEqual([]);
  });

  it.each([
    [
      "pnpm",
      "/Users/me/Library/pnpm/global/5/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      ["add", "--global"],
    ],
    ["yarn", "/Users/me/.config/yarn/global/node_modules/@eco-incorp/sauce", ["global", "add"]],
    ["bun", "/Users/me/.bun/install/global/node_modules/@eco-incorp/sauce", ["add", "--global"]],
  ])("updates a global %s install with that manager", async (manager, root, verb) => {
    const { self, exec } = updater({ root, version: "1.1.0" });
    const run = await sauce(self, "--version", "1.2.0", "--json");
    expect(run.code).toBe(0);
    expect(exec).toEqual([{ file: manager, args: [...verb, `${PACKAGE}@1.2.0`], cwd: work }]);
    // The version read back from the manifest the manager linked, after the install.
    expect(JSON.parse(run.stdout)).toMatchObject({
      current: "1.1.0",
      version: "1.2.0",
      updated: true,
    });
  });

  it("does nothing when the copy is already the version asked for, or newer than the latest", async () => {
    const { self, exec } = updater({ version: "1.2.0" });
    const run = await sauce(self);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Up to date.");
    // A prerelease past the latest is not taken back to it, unless --version says so.
    const ahead = updater({ version: "1.3.0-beta.1" });
    expect((await sauce(ahead.self)).stdout).toContain(
      "Newer than latest: nothing to install (--version 1.2.0 installs it).",
    );
    expect([...exec, ...ahead.exec]).toEqual([]);
    expect((await sauce(ahead.self, "--version", "1.2.0")).code).toBe(0);
    expect(ahead.exec.map((each) => each.args.at(-1))).toEqual([`${PACKAGE}@1.2.0`]);
  });

  it("orders versions as semver does", () => {
    expect(newer("1.10.0", "1.9.9")).toBe(true);
    expect(newer("1.2.0", "1.2.0-beta.1")).toBe(true);
    expect(newer("1.3.0-beta.1", "1.2.0")).toBe(true);
    expect(newer("1.3.0-beta.10", "1.3.0-beta.2")).toBe(true);
    expect(newer("1.2.0", "1.2.0")).toBe(false);
    expect(newer("0.99.8", "1.0.0")).toBe(false);
    expect(newer("unknown", "1.0.0")).toBe(false);
  });

  it("has the new binary install its runtime packages where the version replaced had them", async () => {
    const runtime = "/home/me/.sauce/runtime";
    const { self, captured } = updater({ runtime, files: { [`${runtime}/1.0.0`]: "" } });
    const run = await sauce(self, "--json");
    expect(run.code).toBe(0);
    expect(captured).toEqual([
      {
        file: "/usr/bin/node",
        args: [join(NPM_ROOT, "./sdk/dist/cli/main.js"), "runtime", "install"],
        cwd: work,
      },
    ]);
    expect(JSON.parse(run.stdout).runtime).toEqual({
      installed: true,
      output: "zod 4.6.5: installed",
    });
    // The version replaced had none: its first use installs the new one's, not the update.
    const none = updater({ runtime });
    expect((await sauce(none.self)).code).toBe(0);
    expect(none.captured).toEqual([]);
    // An install that fails leaves the update standing, and says so.
    const failing = updater({
      runtime,
      files: { [`${runtime}/1.0.0`]: "" },
      installs: { status: 1, stdout: "", stderr: "sauce runtime: npm is not on PATH\n" },
    });
    const failed = await sauce(failing.self);
    expect(failed.code).toBe(0);
    expect(failed.stderr).toContain(
      "The new sauce did not install its runtime packages (its first sauce mcp does): " +
        "sauce runtime: npm is not on PATH",
    );
  });

  it("updates the skills installed here with the new binary, and says what changed", async () => {
    const project = join(work, "with-skills");
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    writeFileSync(join(project, ".claude", "skills", INSTALL_RECORD), "{}\n");
    const { self, captured } = updater({
      cwd: project,
      skills: { status: 0, stdout: "updated .claude/skills: 3 files\n", stderr: "" },
    });
    const run = await sauce(self);
    expect(run.code).toBe(0);
    // The NEW binary, by the manifest the install left, with this Node.js and no shell.
    expect(captured).toEqual([
      {
        file: "/usr/bin/node",
        args: [join(NPM_ROOT, "./sdk/dist/cli/main.js"), "skills", "update", "--dir", project],
        cwd: project,
      },
    ]);
    expect(run.stdout).toContain(
      `Skills in ${project}, updated by the new sauce:\n  updated .claude/skills: 3 files`,
    );
    // Skills the new binary would not update: the update stands, and the command says so.
    const refused = updater({
      cwd: project,
      skills: { status: 1, stdout: "", stderr: "a skill file was edited: pass --force\n" },
    });
    const partly = await sauce(refused.self);
    expect(partly.code).toBe(1);
    expect(partly.stdout).toContain(
      `Skills in ${project} were not updated:\n  a skill file was edited`,
    );
  });

  it("prints a project's own command for its copy, and runs nothing", async () => {
    const root =
      "/work/app/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce";
    const { self, exec } = updater({
      root,
      files: { "/work/app/package.json": "{}", "/work/app/pnpm-lock.yaml": "" },
    });
    const run = await sauce(self);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `in /work/app, run pnpm add --save-exact ${PACKAGE}@latest, then sauce skills update`,
    );
    expect(exec).toEqual([]);
  });

  it("prints npx's command for a copy in its cache, even with the registry unreachable", async () => {
    const { self, exec } = updater({
      root: "/Users/me/.npm/_npx/6a3f0b2c1d/node_modules/@eco-incorp/sauce",
      packument: new Error("getaddrinfo ENOTFOUND registry.npmjs.org"),
    });
    const run = await sauce(self);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`run npx -y ${PACKAGE}@latest <command>`);
    expect(run.stderr).toContain("getaddrinfo ENOTFOUND");
    expect(exec).toEqual([]);
  });

  it("refuses a copy it cannot place, with npm's command", async () => {
    const { self, exec } = updater({ root: "/Users/me/src/sauce" });
    const run = await sauce(self);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      `cannot tell how this sauce (/Users/me/src/sauce) was installed, so it updates nothing: ` +
        `install the latest with npm install --global ${PACKAGE}@latest`,
    );
    expect(exec).toEqual([]);
  });

  it("refuses what it cannot do, and says so", async () => {
    // A version the registry does not have, and one that is no version at all.
    expect((await sauce(updater({}).self, "--version", "9.9.9")).stderr).toContain(
      "--version 9.9.9: @eco-incorp/sauce has no such version on the registry",
    );
    expect((await sauce(updater({}).self, "--version", "--force")).code).toBe(2);
    // A registry it cannot read, for a global update.
    const offline = await sauce(updater({ packument: new Error("fetch failed") }).self);
    expect(offline.code).toBe(1);
    expect(offline.stderr).toContain(
      "reading @eco-incorp/sauce's versions from https://registry.npmjs.org/ failed: fetch failed",
    );
    // A manager that fails: nothing changed.
    const failed = updater({ status: 1 });
    const broken = await sauce(failed.self);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain("exited with status 1: @eco-incorp/sauce stays at 1.0.0");
    // pnpm on Windows runs through a shell, which this command never uses.
    const windows = updater({
      root: "C:/Users/me/AppData/Local/pnpm/global/5/node_modules/.pnpm/@eco-incorp+sauce@1.0.0/node_modules/@eco-incorp/sauce",
      platform: "win32",
    });
    const shelled = await sauce(windows.self);
    expect(shelled.code).toBe(1);
    expect(shelled.stderr).toContain(`run pnpm add --global ${PACKAGE}@1.2.0 yourself`);
    expect(windows.exec).toEqual([]);
    // In process, with no updater (a test, the skills checker), nothing is updated.
    expect((await sauce(undefined)).stderr).toContain("run it as `sauce update`");
  });
});
