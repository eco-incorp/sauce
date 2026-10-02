// Compiles globals.sauce.ts the way `sauce compile` does (`routes.compileSauceProgram`, with the
// chain's names), and pins how token writes lower: every spelling becomes a SafeERC20 function of
// @sauce/token, reads stay typed calls, and a write returns nothing. The name tables live in
// ../references/, generated from the registries.
//
//   node globals.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const source = readFileSync(new URL("./globals.sauce.ts", import.meta.url), "utf8");
for (const slug of ["ethereum", "optimism"]) {
  const program = routes.compileSauceProgram(slug, source);
  console.log(`globals.sauce.ts on ${slug}: ${program.bytecode.length} bytes`);
}

// Writes lower to @sauce/token in every spelling; reads stay typed IERC20 calls.
const writes = routes.compileSauceProgram(
  "ethereum",
  "function main(to: Address, token: Address, amount: Uint256) { USDT.transfer(to, amount); USDT.approve(to, amount); const t = Token(token); t.transferFrom(to, ctx.self(), amount); require(USDC.balanceOf(ctx.self()) > 0); }",
).source;
check(/__sauce_transfer\(USDT,/.test(writes), "USDT.transfer is SafeERC20");
check(/__sauce_approve\(USDT,/.test(writes), "USDT.approve is forceApprove");
check(/__sauce_transferFrom\(t,/.test(writes), "a bound Token's transferFrom is SafeERC20");
check(/IERC20\.at\(USDC\)\.balanceOf\(/.test(writes), "reads are plain typed calls");
check(!/IERC20\.at\([^)]*\)\.(transfer|approve|transferFrom)\(/.test(writes), "no raw writes");

const rejects = (slug: string, body: string) => {
  try {
    routes.compileSauceProgram(slug, body);
  } catch {
    return true;
  }
  return false;
};
// A write returns nothing.
check(
  rejects("ethereum", "function main(to: Address) { const ok = USDT.transfer(to, 1); }"),
  "no bool to read",
);
// IERC20 is imported, never ambient, and under its own name it collides with the binding a token
// read brings in; an alias does not.
check(
  rejects("base", "function main(t: Address) { require(IERC20.at(t).balanceOf(ctx.self()) > 0); }"),
  "IERC20 needs an import",
);
check(
  !rejects(
    "base",
    'import { IERC20 as Erc20 } from "./artifacts/IERC20.json";\nfunction main(t: Address) { require(Erc20.at(t).balanceOf(ctx.self()) > USDC.balanceOf(ctx.self())); }',
  ),
  "IERC20 imported under another name, beside a token read",
);
// A family alias resolves only where one member owns the name.
check(
  !rejects("base", "function main() { require(Uniswap.UniversalRouter != 0); }"),
  "Uniswap.UniversalRouter",
);
check(
  rejects("base", "function main() { require(Uniswap.Factory != 0); }"),
  "Uniswap.Factory is ambiguous",
);
// A namespace's default contract is called by the namespace alone.
check(
  !rejects(
    "base",
    "function main(amount: Uint256, to: Uint256) { Cctp.depositForBurn(amount, 3, to, USDC, 0, 0, 2000); }",
  ),
  "Cctp.depositForBurn calls Cctp.TokenMessenger",
);
// A namespace absent on the chain is a compile error, unless `available(...)` rules its branch out;
// a name no chain has is an error either way.
check(rejects("linea", "function main() { require(UniswapV3.Factory != 0); }"), "absent namespace");
check(
  !rejects(
    "linea",
    "function main() { if (available(UniswapV3.Factory)) { require(UniswapV3.Factory != 0); } }",
  ),
  "available() removes the branch where the chain lacks the contract",
);
// It takes a token symbol too: Base registers no USDT, so the guarded transfer is removed there.
check(rejects("base", "function main() { USDT.transfer(ctx.self(), 1); }"), "no USDT on Base");
check(
  !rejects("base", "function main() { if (available(USDT)) { USDT.transfer(ctx.self(), 1); } }"),
  "available(USDT) removes the branch on Base",
);
check(
  rejects("base", "function main() { if (available(UniswapV9.Factory)) { require(false); } }"),
  "available() of a name no chain has is an error",
);
// The Pot's own balance of a symbol, and the chain's id.
check(
  !rejects("base", "function main() { require(self.USDC >= 0 && chainId == 8453); }"),
  "self.USDC and chainId",
);
console.log(
  writes
    .split("\n")
    .filter((line) => line.includes("__sauce_"))
    .join("\n"),
);
