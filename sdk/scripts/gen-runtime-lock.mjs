#!/usr/bin/env node
// The runtime packages' manifest and lockfile, `sdk/runtime/`: what the `sauce` command installs
// for itself, with `npm ci`, into ~/.sauce/runtime/<version> when `sauce mcp` or a Solana rehearsal
// first needs them (`sdk/src/cli/optional.ts`, `runtime.ts`). Their one source is the root
// manifest's optional peer dependencies: this writes them as `sdk/runtime/package.json` and has npm
// resolve the whole tree into `sdk/runtime/package-lock.json`, every package pinned with its
// integrity hash — LiteSVM's native binary for every platform included, which `npm ci` then picks
// from by the platform it runs on.
//
// Run it after changing a pin (`pnpm --filter './sdk' gen-runtime-lock`), and commit both files;
// `optional-dependencies.test.ts` fails while they and the root manifest disagree. It reaches the
// registry the package is published to, through npm, and only when run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtime = join(root, "sdk/runtime");

const optional = Object.keys(manifest.peerDependenciesMeta ?? {}).filter(
  (name) => manifest.peerDependenciesMeta[name].optional === true,
);
const runtimeManifest = {
  name: "sauce-runtime",
  private: true,
  description:
    "What the sauce command installs for itself, with npm ci, into ~/.sauce/runtime/<version>: " +
    "the MCP server's packages and LiteSVM. Written by sdk/scripts/gen-runtime-lock.mjs.",
  dependencies: Object.fromEntries(
    optional.sort().map((name) => [name, manifest.peerDependencies[name]]),
  ),
};
const text = `${JSON.stringify(runtimeManifest, null, 2)}\n`;

const work = mkdtempSync(join(tmpdir(), "sauce-runtime-lock-"));
try {
  writeFileSync(join(work, "package.json"), text);
  execFileSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      // The registry the package itself is published to, whatever this machine's npm is set to:
      // the lockfile records each package's URL there.
      "--registry",
      manifest.publishConfig.registry,
    ],
    { cwd: work, stdio: "inherit" },
  );
  writeFileSync(join(runtime, "package.json"), text);
  writeFileSync(
    join(runtime, "package-lock.json"),
    readFileSync(join(work, "package-lock.json"), "utf8"),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
const lock = JSON.parse(readFileSync(join(runtime, "package-lock.json"), "utf8"));
console.log(
  `gen-runtime-lock: sdk/runtime pins ${optional.join(", ")} and ` +
    `${Object.keys(lock.packages).length - 1} packages in all`,
);
