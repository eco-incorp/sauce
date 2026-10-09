/**
 * What the published package depends on, held to what its code imports.
 *
 *   - Its `dependencies` are what a library import loads: every package the module graph of every
 *     export reaches is one of them, and nothing else is.
 *   - Its OPTIONAL PEER dependencies are the MCP SDK and zod (`sauce mcp`) and LiteSVM (a Solana
 *     rehearsal), at exact pins, the versions the workspaces that use them pin. A library install
 *     gets none of them. No export reaches them, nor any module of the `sauce` command or the MCP
 *     server; the command takes the user's own copies at those versions, else installs them for
 *     itself into a runtime folder from the lockfile the package ships, `sdk/runtime/`
 *     (`cli/optional.ts`, `cli/runtime.ts`), which this holds to the pins and to completeness:
 *     `npm ci` installs exactly it, every package by its integrity hash.
 *   - Nothing it ships imports TypeScript or dotenv: neither is a dependency. The TypeScript plugin
 *     for SauceScript is handed the editor's own TypeScript, and the project `sauce init` writes
 *     depends on TypeScript itself.
 *
 * Imports are read with TypeScript's parser, so a module specifier in a string or a comment (a
 * SauceScript template's `@sauce/token`) is not one. `import type` and `export type` are erased.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { LITESVM_EXTRA, MCP_EXTRA, pinned } from "../src/cli/optional.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(join(REPO, file), "utf8");
const manifestOf = (file: string) =>
  JSON.parse(read(file)) as {
    exports: Record<string, string | { default?: string }>;
    files?: string[];
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    devDependencies?: Record<string, string>;
    publishConfig?: { registry?: string };
  };
const ROOT = manifestOf("package.json");

/** One import of a module: what it names, and whether it loads anything at run time. */
interface Import {
  readonly specifier: string;
  /** `import(…)`: loaded when that line runs, not when the module is. */
  readonly dynamic: boolean;
  /** `import type`, `export type`: erased. */
  readonly typeOnly: boolean;
}

/** Every import of `file` (repo-relative): static, re-exports, `import(…)` and `require(…)`. */
function importsOf(file: string): Import[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : node.isTypeOnly;
      found.push({ specifier: node.moduleSpecifier.text, dynamic: false, typeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      found.push({ specifier: node.arguments[0].text, dynamic, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** The package a bare specifier names (`@solana/kit/x` is `@solana/kit`); `undefined` for a path. */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined;
  const [first, second] = specifier.split("/");

  return first!.startsWith("@") ? `${first}/${second}` : first;
}

/** The source file a relative specifier names; the built `sdk/dist` is its `sdk/src`. */
function resolveRelative(from: string, specifier: string): string | undefined {
  if (/\.json$/.test(specifier)) return undefined; // data: artifacts, ABIs
  const target = relative(REPO, join(REPO, dirname(from), specifier)).replace(
    /^(sdk|actions)\/dist\//,
    "$1/src/",
  );
  const candidates = [target.replace(/\.js$/, ".ts"), target, `${target}.ts`, `${target}/index.ts`];
  const found = candidates.find(
    (each) => /\.(ts|js|cjs)$/.test(each) && existsSync(join(REPO, each)),
  );
  if (found === undefined) throw new Error(`${from}: cannot resolve ${specifier}`);

  return found;
}

/**
 * Every module the run-time graph from `entries` reaches, with the packages each loads. With
 * `dynamic: false`, only what loads with the module itself.
 */
function graph(entries: readonly string[], dynamic: boolean) {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const each of importsOf(file)) {
      if (each.typeOnly || (each.dynamic && !dynamic)) continue;
      const name = packageOf(each.specifier);
      if (name === undefined) {
        if (each.specifier.startsWith(".")) {
          const next = resolveRelative(file, each.specifier);
          if (next !== undefined) queue.push(next);
        }
        continue;
      }
      packages.set(name, [...(packages.get(name) ?? []), file]);
    }
  }

  return { files, packages };
}

/** Every module an export of the package names, as its source. */
function exportEntries(): string[] {
  return Object.values(ROOT.exports).flatMap((value) => {
    const target = typeof value === "string" ? value : value.default;
    if (target === undefined || !/\.js$/.test(target)) return []; // types, assets, JSON
    const source = target.replace(/^\.\//, "").replace(/^(sdk|actions)\/dist\//, "$1/src/");
    if (!source.includes("*")) return [source.replace(/\.js$/, ".ts")];
    const [before, after] = source.split("*") as [string, string];
    const listed = execFileSync(
      "git",
      ["ls-files", "--", `${before}*${after.replace(/\.js$/, ".ts")}`],
      {
        cwd: REPO,
        encoding: "utf8",
      },
    );

    return listed.split("\n").filter((file) => file !== "");
  });
}

/** Every module the package ships as code: the SDK (the `sauce` command too), actions, the MCP server. */
function shippedModules(): string[] {
  const listed = execFileSync("git", ["ls-files", "--", "sdk/src", "actions/src", "mcp/src"], {
    cwd: REPO,
    encoding: "utf8",
  });

  return [
    ...listed
      .split("\n")
      // SauceScript is source for the compiler, not a module Node loads.
      .filter((file) => /\.ts$/.test(file) && !/\.sauce\.ts$/.test(file))
      .filter((file) => !file.startsWith("sdk/src/std/")),
    "sdk/sauce-script/ts-plugin.cjs",
  ];
}

/** The runtime packages: each command's, together. */
const RUNTIME = [...MCP_EXTRA.packages, ...LITESVM_EXTRA.packages].sort();

/** The shipped lockfile's entries: each package's path in the tree and what npm recorded of it. */
interface LockEntry {
  readonly name?: string;
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly optional?: boolean;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
const LOCK = JSON.parse(read("sdk/runtime/package-lock.json")) as {
  name: string;
  lockfileVersion: number;
  packages: Record<string, LockEntry>;
};

/** Where npm finds `name` for the package at `path` in the lockfile: as Node.js would, upwards. */
function lockedAt(path: string, name: string): string | undefined {
  for (let at = path; ; at = at.replace(/\/?node_modules\/(?:@[^/]+\/)?[^/]+$/, "")) {
    const candidate = `${at === "" ? "" : `${at}/`}node_modules/${name}`;
    if (LOCK.packages[candidate] !== undefined) return candidate;
    if (at === "") return undefined;
  }
}

describe("the package's dependencies", () => {
  it("are what a library import loads; the runtime packages are exact optional peers", () => {
    expect(ROOT.optionalDependencies).toBeUndefined();
    expect(Object.keys(ROOT.peerDependencies ?? {}).sort()).toEqual(RUNTIME);
    for (const name of RUNTIME) {
      expect([name, ROOT.peerDependencies![name]]).toEqual([name, pinned()[name]]);
      expect(pinned()[name]).toMatch(/^\d+\.\d+\.\d+$/);
      expect([name, ROOT.peerDependenciesMeta?.[name]?.optional]).toEqual([name, true]);
    }
    // The workspaces that import them take exactly those versions.
    const mcp = manifestOf("mcp/package.json").dependencies ?? {};
    const sdk = manifestOf("sdk/package.json").dependencies ?? {};
    for (const name of MCP_EXTRA.packages)
      expect([name, mcp[name]]).toEqual([name, pinned()[name]]);
    for (const name of LITESVM_EXTRA.packages) {
      expect([name, sdk[name]]).toEqual([name, pinned()[name]]);
    }
    for (const name of [...RUNTIME, "typescript", "dotenv"]) {
      expect([name, ROOT.dependencies?.[name]]).toEqual([name, undefined]);
    }
    expect(ROOT.files).toContain("sdk/runtime");
  });

  it("the runtime lockfile is the pins', complete, and every package in it has its integrity", () => {
    const manifest = JSON.parse(read("sdk/runtime/package.json")) as {
      dependencies: Record<string, string>;
    };
    // Written by gen-runtime-lock.mjs from the root's peers: a pin changed without it is stale.
    expect(manifest.dependencies).toEqual(
      Object.fromEntries(RUNTIME.map((name) => [name, ROOT.peerDependencies![name]])),
    );
    expect(LOCK.lockfileVersion).toBe(3);
    expect(LOCK.packages[""]?.dependencies).toEqual(manifest.dependencies);
    for (const name of RUNTIME) {
      expect([name, LOCK.packages[`node_modules/${name}`]?.version]).toEqual([
        name,
        manifest.dependencies[name],
      ]);
    }
    const entries = Object.entries(LOCK.packages).filter(([path]) => path !== "");
    expect(entries.length).toBeGreaterThan(100);
    const registry = ROOT.publishConfig!.registry!;
    for (const [path, entry] of entries) {
      expect([path, entry.resolved?.startsWith(registry)]).toEqual([path, true]);
      expect([path, entry.integrity]).toEqual([path, expect.stringMatching(/^sha512-/)]);
    }
    // Complete: every package's dependencies are in it where npm looks, optional ones included,
    // so `npm ci` installs it as written.
    const missing = entries.flatMap(([path, entry]) =>
      [
        ...Object.keys(entry.dependencies ?? {}),
        ...Object.keys(entry.optionalDependencies ?? {}),
        ...Object.keys(entry.peerDependencies ?? {}).filter(
          (peer) => entry.peerDependenciesMeta?.[peer]?.optional !== true,
        ),
      ]
        .filter((name) => lockedAt(path, name) === undefined)
        .map((name) => `${path} -> ${name}`),
    );
    expect(missing).toEqual([]);
    // LiteSVM's native binary for every platform it ships one for, each npm's to pick by os and cpu.
    const binaries = Object.keys(LOCK.packages["node_modules/litesvm"]!.optionalDependencies ?? {});
    expect(binaries.length).toBeGreaterThanOrEqual(4);
    for (const binary of binaries) {
      const entry = LOCK.packages[`node_modules/${binary}`];
      expect([binary, entry?.optional, entry?.os?.length, entry?.cpu?.length]).toEqual([
        binary,
        true,
        1,
        1,
      ]);
    }
  });

  it("every package an export loads is a dependency, and no export reaches the command", () => {
    const entries = exportEntries();
    // A move cannot leave this passing over nothing: the root, the compiler, a protocol, actions.
    for (const entry of [
      "sdk/src/index.ts",
      "sdk/src/compiler.ts",
      "sdk/src/protocols/uniswap-v3/index.ts",
      "actions/src/index.ts",
    ]) {
      expect(entries).toContain(entry);
    }
    const { files, packages } = graph(entries, true);
    expect(files.size).toBeGreaterThan(100);
    expect(
      [...files].filter((file) => file.startsWith("sdk/src/cli/") || file.startsWith("mcp/")),
    ).toEqual([]);
    const undeclared = [...packages].filter(([name]) => ROOT.dependencies?.[name] === undefined);
    expect(undeclared).toEqual([]);
    expect([...packages.keys()]).toEqual(expect.arrayContaining(["viem", "sauce-compiler"]));
  });

  it("the MCP SDK and zod are the MCP server's alone", () => {
    const importers = shippedModules().filter((file) =>
      importsOf(file).some((each) => MCP_EXTRA.packages.includes(packageOf(each.specifier) ?? "")),
    );
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((file) => !file.startsWith("mcp/src/"))).toEqual([]);
    // The command reaches the server only by its build, loaded when `sauce mcp` runs.
    const loaders = shippedModules().filter((file) => read(file).includes("mcp/dist/entry.js"));
    expect(loaders).toEqual(["sdk/src/cli/mcp.ts"]);
  });

  it("LiteSVM loads only when a Solana rehearsal needs it", () => {
    const uses = shippedModules().flatMap((file) =>
      importsOf(file)
        .filter((each) => LITESVM_EXTRA.packages.includes(packageOf(each.specifier) ?? ""))
        .map((each) => ({ file, ...each })),
    );
    // A type-only import, which compiles to nothing, and the one dynamic import.
    expect(uses.filter((each) => !each.typeOnly)).toEqual([
      { file: "sdk/src/cli/svm-fork.ts", specifier: "litesvm", dynamic: true, typeOnly: false },
    ]);
    expect(uses.every((each) => each.file === "sdk/src/cli/svm-fork.ts")).toBe(true);
  });

  it("the sauce command loads no runtime package until a command needs it", () => {
    const { packages } = graph(["sdk/src/cli/main.ts"], false);
    expect(packages.size).toBeGreaterThan(0);
    for (const name of [...RUNTIME, "typescript", "dotenv"]) {
      expect([name, packages.get(name)]).toEqual([name, undefined]);
    }
  });

  it("nothing shipped imports TypeScript or dotenv", () => {
    const modules = shippedModules();
    expect(modules).toContain("sdk/src/cli/run.ts");
    const found = modules.flatMap((file) =>
      importsOf(file)
        .filter((each) => ["typescript", "dotenv"].includes(packageOf(each.specifier) ?? ""))
        .map((each) => `${file}: ${each.specifier}`),
    );
    expect(found).toEqual([]);
  });
});
