#!/usr/bin/env node
// The SDK build's last step. A source map ships only where it works: a `.d.ts.map` whose every
// source ships too (the protocols' and the Hylo venue's, under `sdk/src`), so Go to Definition in a
// consumer's editor lands in the shipped `.ts`. Every other map is deleted, and the trailer tsc wrote
// to name it (`//# sourceMappingURL=<name>.map`, the last line of a file in a workspace's `dist`)
// taken off: `lib/source-maps.mjs`, the rule the packed check holds the tarball to. Nothing else is
// changed; any other `sourceMappingURL` the rule refuses fails the build, named.
//
// What ships is npm's own list, `npm pack --dry-run --json --ignore-scripts` at the repository
// root: the root `files` as npm reads them, with their globs, any `.npmignore` inside a listed
// folder, and the files npm always adds or leaves out. `check-packed-package.mjs` packs with the
// same command, so the two cannot disagree; a reading of `files` written here could.
//
// It runs at the end of the SDK's build, not in a `prepack` hook: every path that ships or checks the
// package builds the SDK with this script (CI's build action, `pnpm build` in publish.yml), while the
// packed check packs with `--ignore-scripts` and publish.yml publishes with `pnpm publish`, so a hook
// would run on one and not the other.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditSourceMaps, pruneSourceMaps } from "./lib/source-maps.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const listed = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 256 * 2 ** 20,
  stdio: ["ignore", "pipe", "pipe"],
});
const [{ files }] = JSON.parse(listed);
const packed = new Set(files.map((file) => file.path));
const { kept, removed, stripped } = pruneSourceMaps(root, packed);
console.log(
  `prune-source-maps: kept ${kept} declaration maps whose sources ship; removed ` +
    `${removed.length} other maps and ${stripped} sourceMappingURL comments`,
);
for (const path of removed) packed.delete(path);
const left = auditSourceMaps(root, packed);
if (left.length > 0) {
  console.error(
    `prune-source-maps: ${left.length} refused that the prune does not change (it takes off only ` +
      "tsc's trailer, `//# sourceMappingURL=<name>.map` on the last line of a build file, with the " +
      `map it names); fix each where it is written:\n${left.join("\n")}`,
  );
  process.exitCode = 1;
}
