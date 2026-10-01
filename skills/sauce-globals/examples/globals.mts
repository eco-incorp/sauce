// Compiles globals.sauce.ts the way `sauce compile` does (`routes.compileSauceProgram`, with the
// chain's names), and pins what token names compile to: every write, in every spelling, is a
// SafeERC20 function of @sauce/token, a read its `balanceOf`, and a write returns nothing. The name tables live in
// ../references/, generated from the registries.
//
//   node globals.mts
import { readFileSync } from "node:fs";

import { requireChain, routes } from "@eco-incorp/sauce";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const source = readFileSync(new URL("./globals.sauce.ts", import.meta.url), "utf8");
for (const slug of ["ethereum", "optimism"]) {
  const program = routes.compileSauceProgram(slug, source);
  console.log(`globals.sauce.ts on ${slug}: ${program.bytecode.length} bytes`);
}

// Token names compile to @sauce/token in every spelling: the program is byte for byte the one that
// calls the library's functions with the token's address first.
const ethereum = requireChain("ethereum");
const addressOf = (symbol: string) =>
  `0x${routes.registryTokenAddress(ethereum, symbol)!.toString(16).padStart(40, "0")}`;
const named = routes.compileSauceProgram(
  "ethereum",
  "function main(to: Address, token: Address, amount: Uint256) { USDT.transfer(to, amount); USDT.approve(to, amount); const t = Token(token); t.transferFrom(to, ctx.self(), amount); require(USDC.balanceOf(ctx.self()) > 0n); }",
);
const byHand = routes.compileSauceProgram(
  "ethereum",
  `import { approve, balanceOf, transfer, transferFrom } from "@sauce/token";
function main(to: Address, token: Address, amount: Uint256) { transfer(${addressOf("USDT")}, to, amount); approve(${addressOf("USDT")}, to, amount); const t = token; transferFrom(t, to, ctx.self(), amount); require(balanceOf(${addressOf("USDC")}, ctx.self()) > 0n); }`,
);
check(
  Buffer.from(named.bytecode).equals(Buffer.from(byHand.bytecode)),
  "USDT.transfer, USDT.approve (forceApprove) and a bound Token's transferFrom are SafeERC20, and USDC.balanceOf the library's read",
);

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
  rejects("ethereum", "function main(to: Address) { const ok = USDT.transfer(to, 1n); }"),
  "no bool to read",
);
// IERC20 is imported, never ambient, and under its own name it collides with the binding a token
// read brings in; an alias does not.
check(
  rejects(
    "base",
    "function main(t: Address) { require(IERC20.at(t).balanceOf(ctx.self()) > 0n); }",
  ),
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
  !rejects("base", "function main() { require(Uniswap.UniversalRouter != 0n); }"),
  "Uniswap.UniversalRouter",
);
check(
  rejects("base", "function main() { require(Uniswap.Factory != 0n); }"),
  "Uniswap.Factory is ambiguous",
);
// A namespace's default contract is called by the namespace alone.
check(
  !rejects(
    "base",
    "function main(amount: Uint256, to: Uint256) { Cctp.depositForBurn(amount, 3n, to, USDC, 0n, 0n, 2000n); }",
  ),
  "Cctp.depositForBurn calls Cctp.TokenMessenger",
);
// A namespace absent on the chain is zero there: using it is a compile error, and comparing it with
// zero rules its branch out. A name no chain has is an error either way.
check(
  rejects("linea", "function main() { UniswapV3.Factory.getPool(ctx.self(), ctx.self(), 500n); }"),
  "absent namespace",
);
check(
  !rejects(
    "linea",
    "function main() { if (UniswapV3.Factory != 0n) { UniswapV3.Factory.getPool(ctx.self(), ctx.self(), 500n); } }",
  ),
  "comparing with zero removes the branch where the chain lacks the contract",
);
// A token symbol too: Base registers no USDT, so the guarded transfer is removed there.
check(rejects("base", "function main() { USDT.transfer(ctx.self(), 1n); }"), "no USDT on Base");
check(
  !rejects("base", "function main() { if (USDT != 0n) { USDT.transfer(ctx.self(), 1n); } }"),
  "USDT != 0n removes the branch on Base",
);
check(
  rejects("base", "function main() { if (UniswapV9.Factory != 0n) { require(false); } }"),
  "a name no chain has is an error",
);
// The Pot's own balance of a symbol, and the chain's id.
check(
  !rejects("base", "function main() { require(self.USDC >= 0n && chainId == 8453n); }"),
  "self.USDC and chainId",
);
console.log(`token names: ${named.bytecode.length} bytes, as the @sauce/token calls by hand`);
