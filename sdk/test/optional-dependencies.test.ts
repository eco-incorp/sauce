/**
 * What the published package depends on, held to what its code imports.
 *
 *   - Its `dependencies` are what a library import loads: every package the module graph of every
 *     export reaches is one of them, and nothing else is.
 *   - Its `optionalDependencies` are the MCP SDK and zod (`sauce mcp`) and LiteSVM (a Solana
 *     rehearsal), at the versions the workspaces that use them pin. No export reaches them, nor any
 *     module of the `sauce` command or the MCP server; the command loads each by a dynamic import
 *     only when it needs it, so a library install leaves them out with `--omit=optional`
 *     (`cli/optional.ts`), and `check-packed-package.mjs` proves it on the installed tarball.
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

import {
  LITESVM_DEPENDENCY,
  MCP_DEPENDENCIES,
  OPTIONAL_DEPENDENCIES,
  missingPackage,
  optionalMissing,
} from "../src/cli/optional.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(join(REPO, file), "utf8");
const manifestOf = (file: string) =>
  JSON.parse(read(file)) as {
    exports: Record<string, string | { default?: string }>;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
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

describe("the package's dependencies", () => {
  it("declares the MCP SDK, zod and LiteSVM optional, at the versions their workspaces pin", () => {
    expect(Object.keys(ROOT.optionalDependencies ?? {}).sort()).toEqual(OPTIONAL_DEPENDENCIES);
    const mcp = manifestOf("mcp/package.json").dependencies ?? {};
    const sdk = manifestOf("sdk/package.json").dependencies ?? {};
    for (const name of MCP_DEPENDENCIES) {
      expect([name, ROOT.optionalDependencies?.[name]]).toEqual([name, mcp[name]]);
    }
    expect(ROOT.optionalDependencies?.[LITESVM_DEPENDENCY]).toBe(sdk[LITESVM_DEPENDENCY]);
    for (const name of [...OPTIONAL_DEPENDENCIES, "typescript", "dotenv"]) {
      expect([name, ROOT.dependencies?.[name]]).toEqual([name, undefined]);
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
      importsOf(file).some((each) =>
        (MCP_DEPENDENCIES as readonly string[]).includes(packageOf(each.specifier) ?? ""),
      ),
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
        .filter((each) => packageOf(each.specifier) === LITESVM_DEPENDENCY)
        .map((each) => ({ file, ...each })),
    );
    expect(uses.filter((each) => !each.typeOnly)).toEqual([
      { file: "sdk/src/cli/svm-fork.ts", specifier: "litesvm", dynamic: true, typeOnly: false },
    ]);
    expect(uses.every((each) => each.file === "sdk/src/cli/svm-fork.ts")).toBe(true);
  });

  it("the sauce command loads no optional dependency until a command needs it", () => {
    const { packages } = graph(["sdk/src/cli/main.ts"], false);
    expect(packages.size).toBeGreaterThan(0);
    for (const name of [...OPTIONAL_DEPENDENCIES, "typescript", "dotenv"]) {
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

describe("a command whose optional dependency was left out", () => {
  it("knows Node's refusal of a missing package, and nothing else, for one", () => {
    // Node's own words, as an import of a package that is not installed throws them.
    const thrown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'try { await import("sauce-not-installed/sub/path.js"); } catch (e) { ' +
            "console.log(JSON.stringify({ code: e.code, message: e.message })); }",
        ],
        { cwd: REPO, encoding: "utf8" },
      ),
    ) as { code: string; message: string };
    expect(missingPackage(thrown, ["sauce-not-installed"])).toBe("sauce-not-installed");
    expect(missingPackage(thrown, MCP_DEPENDENCIES)).toBeUndefined();
    // A module of the package's own (an unbuilt mcp/dist), or a native binary that fails to load.
    const own = {
      code: "ERR_MODULE_NOT_FOUND",
      message: "Cannot find module '/x/mcp/dist/entry.js'",
    };
    expect(missingPackage(own, MCP_DEPENDENCIES)).toBeUndefined();
    expect(
      missingPackage(new Error("Cannot find package 'zod'"), MCP_DEPENDENCIES),
    ).toBeUndefined();
  });

  it("says what needs which package, and the line that installs it at the version pinned", () => {
    const pins = ROOT.optionalDependencies!;
    expect(optionalMissing("the MCP server", MCP_DEPENDENCIES)).toBe(
      "the MCP server needs @modelcontextprotocol/sdk and zod, optional dependencies of " +
        "@eco-incorp/sauce that this install left out (--omit=optional): install them with " +
        `\`npm i @modelcontextprotocol/sdk@${pins["@modelcontextprotocol/sdk"]} zod@${pins.zod}\`, ` +
        "or install @eco-incorp/sauce without --omit=optional",
    );
    // A range is quoted, as every shell keeps it.
    expect(optionalMissing("rehearsing", [LITESVM_DEPENDENCY])).toContain(
      `an optional dependency of @eco-incorp/sauce that this install left out (--omit=optional): ` +
        `install it with \`npm i "litesvm@${pins.litesvm}"\``,
    );
  });
});
