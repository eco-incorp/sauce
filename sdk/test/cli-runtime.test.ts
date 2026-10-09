/**
 * The runtime packages a command finds for itself (`cli/optional.ts`) and the installer of their
 * folder (`cli/runtime.ts`), with the folder under a temporary root and npm stood in for: what each
 * finds where, how each refuses, and that an install is whole or nothing. `check-packed-package.mjs`
 * runs the real `npm ci` on the shipped lockfile, from the installed tarball.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installedAt,
  LITESVM_EXTRA,
  MCP_EXTRA,
  ownCopy,
  pinned,
  provide,
  RUNTIME_SOURCE,
  runtimeDir,
  sourceOf,
  useRuntime,
  type Extra,
  type RuntimeInstaller,
} from "../src/cli/optional.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { installRuntime, npmCommand, npmReason, NPM_CI, prune } from "../src/cli/runtime.js";

let work: string;
let root: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-runtime-"));
  root = join(work, "runtime");
  useRuntime({ root, installer: undefined });
});

afterEach(() => {
  useRuntime({ root: undefined, installer: undefined });
  rmSync(work, { recursive: true, force: true });
});

/** A package at `version` under `dir`'s node_modules. */
function place(dir: string, name: string, version: string): void {
  mkdirSync(join(dir, "node_modules", name), { recursive: true });
  writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
}

/** What `npm ci` leaves in `dir`: the shipped lockfile, and every runtime package at its pin. */
function installed(dir: string): void {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(RUNTIME_SOURCE, "package-lock.json"), join(dir, "package-lock.json"));
  for (const [name, version] of Object.entries(pinned())) place(dir, name, version);
}

/** An extra whose own copies are looked for under `importer`. */
const extra = (importer: string): Extra => ({
  command: "sauce test",
  what: "the test",
  packages: ["zod"],
  importer,
});

async function sauce(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

describe("where a command's runtime packages come from", () => {
  it("finds the user's own copy as Node.js does, up the directories, never node_modules/node_modules", () => {
    place(join(work, "project"), "zod", "4.6.5");
    const deep = join(work, "project", "node_modules", "@eco-incorp", "sauce", "mcp", "dist");
    mkdirSync(deep, { recursive: true });
    expect(ownCopy("zod", deep)).toEqual({
      path: join(work, "project", "node_modules", "zod"),
      version: "4.6.5",
    });
    expect(ownCopy("litesvm", deep)).toBeUndefined();
  });

  it("takes the user's own copies at the pins, else the runtime folder, else none", () => {
    const importer = join(work, "app");
    place(importer, "zod", pinned().zod!);
    expect(sourceOf(extra(importer))).toBe("own");
    // A copy at another version is not the one pinned: it is passed over.
    place(importer, "zod", "3.25.0");
    expect(sourceOf(extra(importer))).toBe("missing");
    installed(runtimeDir());
    expect(sourceOf(extra(importer))).toBe("runtime");
    // A folder of another lockfile is not this version's install.
    writeFileSync(join(runtimeDir(), "package-lock.json"), "{}\n");
    expect(installedAt(runtimeDir())).toBe(false);
  });

  it("in this repository, every command's own copies are the pinned ones", () => {
    expect(sourceOf(MCP_EXTRA)).toBe("own");
    expect(sourceOf(LITESVM_EXTRA)).toBe("own");
  });

  it("refuses on one line where it may not install, and says the command that does", async () => {
    const importer = join(work, "app");
    mkdirSync(importer);
    const needs = `the test needs zod ${pinned().zod}, not installed for this sauce yet`;
    await expect(provide(extra(importer), { offline: true })).rejects.toThrow(
      `${needs}, and --offline installs nothing: run \`sauce runtime install\``,
    );
    // An in-process run was given no installer: it never runs npm.
    await expect(provide(extra(importer))).rejects.toThrow(
      `${needs}: run \`sauce runtime install\``,
    );
    const failing: RuntimeInstaller = {
      install: async () => {
        throw new Error("npm is not on PATH");
      },
    };
    useRuntime({ installer: failing });
    const logged: string[] = [];
    await expect(provide(extra(importer), { log: (text) => logged.push(text) })).rejects.toThrow(
      `${needs}, and installing them into ${runtimeDir()} failed: npm is not on PATH. Nothing ` +
        "was left half-installed: `sauce runtime install` tries again",
    );
    expect(logged).toEqual([
      `sauce: ${needs}. Installing them into ${runtimeDir()}, once for this version…\n`,
    ]);
  });

  it("returns at once where the user's own copies are the pinned ones", async () => {
    const importer = join(work, "app");
    place(importer, "zod", pinned().zod!);
    const never: RuntimeInstaller = {
      install: () => Promise.reject(new Error("installed")),
    };
    useRuntime({ installer: never });
    await expect(provide(extra(importer), { offline: true })).resolves.toBeUndefined();
  });
});

describe("sauce runtime", () => {
  it("status says where each command's packages come from", async () => {
    const run = await sauce("runtime", "--json");
    expect(run.code).toBe(0);
    const status = JSON.parse(run.stdout);
    expect(status).toMatchObject({
      dir: runtimeDir(),
      installed: false,
      uses: { "sauce mcp": "own", "Solana rehearsals": "own" },
    });
    expect(Object.keys(status.packages).sort()).toEqual(Object.keys(pinned()).sort());
    const text = (await sauce("runtime", "status")).stdout;
    expect(text).toContain(`Runtime packages, in ${runtimeDir()} (not installed):`);
    expect(text).toMatch(/sauce mcp +@modelcontextprotocol\/sdk \S+ and zod \S+: your own copies/);
  });

  it("install installs the folder once, with the installer the process was given", async () => {
    const refused = await sauce("runtime", "install");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toBe(
      "sauce runtime: sauce runtime install runs this machine's npm: run it as a command\n",
    );
    let installs = 0;
    useRuntime({
      installer: {
        install: async (dir) => {
          installs++;
          installed(dir);
        },
      },
    });
    const first = await sauce("runtime", "install", "--json");
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({ dir: runtimeDir(), installed: true, changed: true });
    expect(first.stderr).toMatch(/^Installing @modelcontextprotocol\/sdk \S+, litesvm \S+ and zod/);
    expect(JSON.parse((await sauce("runtime", "install", "--json")).stdout).changed).toBe(false);
    expect(installs).toBe(1);
    expect((await sauce("runtime", "prune")).code).toBe(2);
  });
});

describe("the runtime folder's installer", () => {
  const dir = () => join(root, "1.0.0");
  /** npm ci, stood in for: writes what npm would into the directory it runs in, or fails. */
  const npm =
    (status = 0, stderr = "") =>
    async (args: readonly string[], cwd: string) => {
      expect(args).toEqual(NPM_CI);
      if (status === 0) installed(cwd);

      return { status, stderr };
    };

  it("installs into a temporary directory renamed into place, owner-only, leaving nothing else", async () => {
    await installRuntime(dir(), npm());
    expect(installedAt(dir())).toBe(true);
    expect(readdirSync(root)).toEqual(["1.0.0"]);
    if (process.platform !== "win32") {
      expect(statSync(root).mode & 0o777).toBe(0o700);
      expect(statSync(dir()).mode & 0o777).toBe(0o700);
    }
  });

  it("leaves nothing where npm fails, and throws npm's reason", async () => {
    await expect(
      installRuntime(
        dir(),
        npm(1, "npm error code ETARGET\nnpm error notarget No matching version"),
      ),
    ).rejects.toThrow("npm ci exited with status 1 (ETARGET: notarget No matching version)");
    expect(readdirSync(root)).toEqual([]);
  });

  it("keeps a folder another process installed first, and replaces one that is not this install", async () => {
    installed(dir());
    writeFileSync(join(dir(), "theirs"), "");
    await installRuntime(dir(), npm());
    expect(existsSync(join(dir(), "theirs"))).toBe(true);
    writeFileSync(join(dir(), "package-lock.json"), "{}\n");
    await installRuntime(dir(), npm());
    expect(installedAt(dir())).toBe(true);
    expect(existsSync(join(dir(), "theirs"))).toBe(false);
    expect(readdirSync(root)).toEqual(["1.0.0"]);
  });

  it("keeps this version's folder and the newest older one, and an install still running", () => {
    for (const name of ["0.9.0", "0.99.12", "1.0.0", "1.1.0", ".1.0.0.old", ".1.0.0.running"]) {
      mkdirSync(join(root, name), { recursive: true });
    }
    const longAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(root, ".1.0.0.old"), longAgo, longAgo);
    prune(root, "1.0.0");
    expect(readdirSync(root).sort()).toEqual([".1.0.0.running", "0.99.12", "1.0.0"]);
  });

  it("says why npm failed in one line", () => {
    expect(npmReason(null, "", "ENOENT")).toBe("npm is not on PATH");
    expect(npmReason(null, "", "EACCES")).toBe("npm could not be started (EACCES)");
    expect(
      npmReason(
        1,
        "npm error code ENOTFOUND\nnpm error syscall getaddrinfo\n" +
          "npm error network request to https://example.test/zod failed\n",
      ),
    ).toBe(
      "npm ci exited with status 1 (ENOTFOUND: network request to https://example.test/zod failed)",
    );
    // npm 11 answers an unreachable registry with no more than this: its log has the error.
    const log = join(work, "debug.log");
    expect(
      npmReason(
        1,
        "npm error Exit handler never called!\nnpm error This is an error with npm itself. " +
          "Please report this error at:\nnpm error   <https://github.com/npm/cli/issues>\n" +
          `npm error A complete log of this run can be found in: ${log}\n`,
        undefined,
        () => "12 http fetch GET http://127.0.0.1:9/zod attempt 1 failed with ECONNREFUSED\n",
      ),
    ).toBe(
      `npm ci exited with status 1 (it could not reach its registry (ECONNREFUSED); its log: ${log})`,
    );
  });

  it("runs npm with no shell: on Windows its own script, with this Node.js", () => {
    expect(npmCommand("linux", "/usr/bin/node")).toEqual({ file: "npm", args: [] });
    expect(npmCommand("win32", "C:\\node\\node.exe").args[0]).toMatch(/npm-cli\.js$/);
  });
});
