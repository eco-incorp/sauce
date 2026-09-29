#!/usr/bin/env node
// Every browser-facing export of the package, bundled for the browser: no module the package ships
// may import a Node builtin, or read a Node-only global, on the way to any of them.
//
//   node sdk/scripts/check-browser-bundles.mjs [--package-root <dir>] [--consumer <dir>]
//
// `--package-root` is the package whose `exports` are checked (default: this repository);
// `check-packed-package.mjs` points it at the INSTALLED tarball, so what is proven is the shipped
// `exports` map. Each subpath is imported BY NAME from `--consumer` (default: the package root,
// which resolves through the package's self-reference), through esbuild's `browser` conditions.
//
// Two findings fail the run:
//   - an import of a Node builtin (`node:fs`, `path`, …) anywhere in a bundle, named with the
//     module that wrote it — a dependency's as much as the package's own, since either breaks a
//     browser build;
//   - a free reference to a Node-only global (`Buffer`, `process`, `__dirname`, …) in one of the
//     package's own modules. A dependency may probe one behind `typeof`, which is its business; the
//     SDK has no reason to name one at all.
//
// `NODE_ONLY` names the subpaths that are Node-only on purpose and documented as such.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a directory`);

  return resolve(value);
}

// Real paths: esbuild reports every module by its real path, and a temporary directory is often
// reached through a symlink (macOS `/var` -> `/private/var`), which would make no module "own".
const packageRoot = realpathSync(argument("--package-root", REPO));
const consumer = realpathSync(argument("--consumer", packageRoot));

/** Subpaths that need Node by design: `svm/engine-artifacts` hands a local LiteSVM harness file
 *  paths to the packaged `.so` binaries. */
const NODE_ONLY = new Set(["./svm/engine-artifacts"]);

/** Node-only globals the package's own modules must not name. */
const NODE_GLOBALS = ["Buffer", "process", "global", "__dirname", "__filename", "setImmediate"];
const MARKER = "__SAUCE_NODE_GLOBAL__";

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** Every JavaScript subpath of `exports`, with `./protocols/*` expanded over the shipped slugs. */
function browserSubpaths() {
  const subpaths = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const file = typeof target === "string" ? target : target.default;
    if (!file.endsWith(".js")) continue;
    if (!subpath.includes("*")) {
      subpaths.push(subpath);
      continue;
    }
    const [before, after] = file.split("*");
    const dir = join(packageRoot, before);
    for (const slug of readdirSync(dir).sort()) {
      if (existsSync(join(dir, slug + after))) subpaths.push(subpath.replace("*", slug));
    }
  }

  return subpaths;
}

/** The package's own shipped modules — the ones the Node-global check applies to. */
const ownDirs = ["sdk/dist", "actions/dist"].map((dir) => join(packageRoot, dir) + sep);
const isOwn = (path) => ownDirs.some((dir) => path.startsWith(dir));

const subpaths = browserSubpaths();
const checked = subpaths.filter((subpath) => !NODE_ONLY.has(subpath));
const findings = new Map(); // subpath -> Set of lines
const globalsChecked = new Map(); // own module path -> [globals it names]

function record(subpath, line) {
  if (!findings.has(subpath)) findings.set(subpath, new Set());
  findings.get(subpath).add(line);
}

const display = (path) => relative(packageRoot, path) || path;

for (const subpath of checked) {
  const specifier = `${manifest.name}${subpath.slice(1)}`;
  await esbuild
    .build({
      stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: consumer },
      absWorkingDir: consumer,
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      logLevel: "silent",
      plugins: [
        {
          name: "node-builtins",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (!builtins.has(args.path)) return undefined;
              record(subpath, `imports ${args.path} (${display(args.importer)})`);

              return { path: args.path, external: true };
            });
            build.onLoad({ filter: /\.js$/ }, (args) => {
              if (!isOwn(args.path)) return undefined;
              if (!globalsChecked.has(args.path)) {
                // `define` replaces only FREE references — a local of the same name is untouched —
                // so any marker left in the output is a Node global the module reads.
                const { code } = esbuild.transformSync(readFileSync(args.path, "utf8"), {
                  loader: "js",
                  format: "esm",
                  define: Object.fromEntries(NODE_GLOBALS.map((name) => [name, MARKER + name])),
                });
                const named = NODE_GLOBALS.filter((name) => code.includes(MARKER + name));
                if (/\bimport\.meta\.(dirname|filename)\b/.test(code))
                  named.push("import.meta.dirname");
                globalsChecked.set(args.path, named);
              }
              for (const name of globalsChecked.get(args.path)) {
                record(subpath, `reads the Node global ${name} (${display(args.path)})`);
              }

              return undefined;
            });
          },
        },
      ],
    })
    .catch((error) => {
      record(subpath, `does not bundle for the browser: ${error.message.split("\n")[0]}`);
    });
}

// A check that saw none of the package's own modules checked nothing — a path mismatch, not a pass.
if (globalsChecked.size === 0) {
  console.error(`check-browser-bundles: no module under ${ownDirs.join(", ")} was bundled`);
  process.exit(1);
}

if (findings.size > 0) {
  const report = [...findings].map(
    ([subpath, lines]) => `  ${subpath}\n${[...lines].map((line) => `    ${line}`).join("\n")}`,
  );
  console.error(
    `check-browser-bundles: ${findings.size} browser-facing export(s) of ${manifest.name} reach Node:\n` +
      report.join("\n"),
  );
  process.exit(1);
}

console.log(
  `check-browser-bundles: ${checked.length} exports of ${manifest.name} bundle for the browser with no ` +
    `Node builtin or global (${globalsChecked.size} of its own modules checked; Node-only by design: ` +
    `${[...NODE_ONLY].join(", ")})`,
);
