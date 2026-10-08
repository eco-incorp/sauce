// A sha256 of every example and recipe program an SDK tree compiles, of each intent body, and of
// what a refused compile says, by file and chain, as JSON on stdout. Usage:
//   SAUCE_COMPILER_PKG=<compiler>/crates/sauce-wasm/pkg \
//     node --import ./register.mjs bytes.mjs <sdk-tree> > bytes.json
// <sdk-tree> is an eco-incorp/sauce checkout whose SDK is built (`pnpm build`). Without
// SAUCE_COMPILER_PKG, the tree's own linked compiler is measured.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolvePath(process.argv[2] ?? ".");
const { compileSauceProgram } = await import(
  pathToFileURL(join(root, "sdk/dist/routes/index.js")).href
);
const dirs = [
  join(root, "docs/examples"),
  ...readdirSync(join(root, "skills")).map((skill) => join(root, "skills", skill, "examples")),
  join(root, "sdk/src/recipes"),
];
const files = dirs
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".sauce.ts"))
      .map((name) => join(dir, name)),
  );
const options = {
  intents: {
    executionFee: 1000n,
    deadline: 2000000000n,
    openedAt: 1900000000n,
    salt: `0x${"5a".repeat(32)}`,
  },
};
const hashes = {};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const said = (error) =>
  String(error?.message ?? error).replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    "",
  );
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const resolve = (path) => {
    const at = resolvePath(dirname(file), path);
    return existsSync(at) ? new TextEncoder().encode(readFileSync(at, "utf8")) : undefined;
  };
  for (const chain of ["base", "ethereum", "solana"]) {
    try {
      const program = compileSauceProgram(chain, text, { ...options, resolve });
      hashes[`${file.slice(root.length + 1)}@${chain}`] = [
        sha(program.bytecode),
        ...(program.bodies ?? []).map((body) => sha(body.bytecode)),
        ...(program.manifest === undefined ? [] : [sha(JSON.stringify(program.manifest))]),
      ];
    } catch (error) {
      // A program for another chain, or one this compiler refuses: what it says, and where.
      hashes[`${file.slice(root.length + 1)}@${chain}`] = {
        error: said(error),
        diagnostics: (error?.diagnostics ?? error?.cause?.diagnostics ?? []).map(
          ({ code, path, message, start }) => ({ code, path, message, start }),
        ),
      };
    }
  }
}
console.log(JSON.stringify(hashes, null, 1));
