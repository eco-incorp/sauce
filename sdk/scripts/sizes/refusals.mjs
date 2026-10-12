// What each of a set of refused compiles says — a namespace used as a contract, on its chain and on
// another, a contract a chain lacks, a `receive` token the destination lacks, a hop to Solana — or
// the hash of what it compiles to, as JSON on stdout, for comparing two SDK builds:
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
const R = "0x6666666666666666666666666666666666666666";
const hop = (dest, receive) => `function main() {
  await ${dest}.hop({ send: { token: USDC, amount: 1000 }, ${receive} refundee: ${R} });
}`;
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
  ["base", hop("Optimism", "receive: { token: SPCXc, amount: 1 },")],
  ["base", hop("Ethereum", "receive: { token: SPCXc, amount: 1 },")],
  ["base", hop("Ethereum", "receive: { token: USDC, amount: 1 },")],
  ["base", hop("Arbitrum", "receive: [{ token: USDC, amount: 1 }, { token: WETH, amount: 2 }],")],
  ["ethereum", hop("Base", "receive: { token: TSLAx, amount: 1 },")],
  ["ethereum", hop("Base", "receive: { token: WETH, amount: 1 },")],
  ["base", hop("Solana", "")],
  ["base", "function main(): Uint256 { return Optimism + 1; }"],
  ["base", "function main(): Uint256 { return Ethereum.Portal + 1; }"],
];
const out = [];
for (const [chain, source] of cases) {
  try {
    const p = compileSauceProgram(chain, source, {
      intents: {
        executionFee: 1000n,
        deadline: 2000000000n,
        openedAt: 1900000000n,
        salt: `0x${"5a".repeat(32)}`,
      },
    });
    out.push({
      chain,
      source,
      bytes: createHash("sha256").update(p.bytecode).digest("hex").slice(0, 16),
      bodies: (p.bodies ?? []).map((b) =>
        createHash("sha256").update(b.bytecode).digest("hex").slice(0, 16),
      ),
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
