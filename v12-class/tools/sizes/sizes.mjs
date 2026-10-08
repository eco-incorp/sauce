// The size of every example and recipe program an SDK tree compiles, and of each intent body, by
// file and chain, as JSON on stdout. Usage:
//   SAUCE_COMPILER_PKG=<compiler>/crates/sauce-wasm/pkg \
//     node --import ./register.mjs sizes.mjs <sdk-tree> > sizes.json
// <sdk-tree> is an eco-incorp/sauce checkout whose SDK is built (`pnpm build`). Without
// SAUCE_COMPILER_PKG, the tree's own linked compiler is measured.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolvePath(process.argv[2] ?? ".");
const { compileSauceProgram } = await import(pathToFileURL(join(root, "sdk/dist/routes/index.js")).href);
const dirs = [
  join(root, "docs/examples"),
  ...readdirSync(join(root, "skills")).map((skill) => join(root, "skills", skill, "examples")),
  join(root, "sdk/src/recipes"),
];
const files = dirs
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".sauce.ts")).map((name) => join(dir, name)));
const options = {
  intents: { executionFee: 1000n, deadline: 2000000000n, openedAt: 1900000000n, salt: `0x${"5a".repeat(32)}` },
};
const sizes = {};
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const resolve = (path) => {
    const at = resolvePath(dirname(file), path);
    return existsSync(at) ? new TextEncoder().encode(readFileSync(at, "utf8")) : undefined;
  };
  for (const chain of ["base", "ethereum", "solana"]) {
    try {
      const program = compileSauceProgram(chain, text, { ...options, resolve });
      sizes[`${file.slice(root.length + 1)}@${chain}`] = [
        program.bytecode.length,
        ...(program.bodies ?? []).map((body) => body.bytecode.length),
      ];
    } catch {
      // A program for another chain, or one this compiler refuses: not measured.
    }
  }
}
console.log(JSON.stringify(sizes, null, 1));
