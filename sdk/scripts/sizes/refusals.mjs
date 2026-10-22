// What each of a set of refused compiles says — a namespace used as a contract, on its chain and on
// another, a contract a chain lacks — or the hash of what it compiles to, as
// JSON on stdout, for comparing two SDK builds:
//   node refusals.mjs <sdk-tree> > refusals.json
// Two runs that must say the same thing are equal but for the compiler's offsets into the SDK's
// generated modules, `(bytes N..M)`, which move with any change to a module.
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const { compileSauceProgram } = await import(
  pathToFileURL(join(root, "sdk/dist/routes/index.js")).href
);
const cases = [
  ["base", "function main(): Uint256 { return UniswapV3 + 1; }"],
  ["base", "function main(): Uint256 { return Optimism.UniswapV3 + 1; }"],
  ["ethereum", "function main(): Uint256 { return Base.Uniswap + 1; }"],
  ["base", "function main(): Uint256 { return Abracadabra + 1; }"],
  ["base", "function main(): Uint256 { return Optimism.Abracadabra + 1; }"],
  ["ethereum", "function main(): Uint256 { return Arbitrum.Abracadabra + 1; }"],
  ["base", "function main(): Uint256 { return Ethereum.Lido + 1; }"],
  ["ethereum", "function main(): Uint256 { return Lido + 1; }"],
  ["base", "function main(): Uint256 { return Optimism.AerodromeSlipstream + 1; }"],
  ["base", "function main(): Uint256 { return Pancakeswap + 1; }"],
  ["base", "function main(): Uint256 { return Optimism + 1; }"],
  ["base", "function main(): Uint256 { return Ethereum.Portal + 1; }"],
];
const out = [];
for (const [chain, source] of cases) {
  try {
    const p = compileSauceProgram(chain, source);
    out.push({
      chain,
      source,
      bytes: createHash("sha256").update(p.bytecode).digest("hex").slice(0, 16),
    });
  } catch (e) {
    const strip = (s) =>
      String(s).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    out.push({
      chain,
      source,
      error: strip(e.message),
      diagnostics: (e.diagnostics ?? e.cause?.diagnostics ?? []).map(
        ({ code, path, message, start, end }) => ({
          code,
          path,
          message: strip(message),
          start,
          end,
        }),
      ),
    });
  }
}
console.log(JSON.stringify(out, null, 1));
