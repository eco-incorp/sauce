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
  "function main(to: Address, token: Address, amount: Uint256) { USDT.transfer(to, amount); USDT.approve(to, amount); const t = Token(token); t.transferFrom(to, pot, amount); require(pot.USDC > 0); }",
).source;
check(/__sauce_transfer\(USDT,/.test(writes), "USDT.transfer is SafeERC20");
check(/__sauce_approve\(USDT,/.test(writes), "USDT.approve is forceApprove");
check(/__sauce_transferFrom\(t,/.test(writes), "a bound Token's transferFrom is SafeERC20");
check(/IERC20\.at\(USDC\)\.balanceOf\(ctx\.self\(\)\)/.test(writes), "reads are plain typed calls");
check(!/IERC20\.at\([^)]*\)\.(transfer|approve|transferFrom)\(/.test(writes), "no raw writes");

// A balance is `<holder>.<TOKEN>`, `<TOKEN>.balanceOf(<holder>)` to the byte: the Pot as `pot`, a
// parameter or variable, an address written out, and a program's own `pot`. The coin is `.balance`.
const reads = (body: string) =>
  routes.compileSauceProgram("ethereum", `function main(who: Address): Uint256 { ${body} }`)
    .bytecode;
// Any address will do as a holder; this one is Ethereum's USDC contract.
const holder = routes
  .sourceGlobals("ethereum")
  .tokens.find((one) => one.symbol === "USDC")!.address;
const spellings: Array<[short: string, long: string]> = [
  ["return pot.USDC;", "return USDC.balanceOf(ctx.self());"],
  ["return who.TSLAx;", "return TSLAx.balanceOf(who);"],
  [`return ${holder}.WETH;`, `return WETH.balanceOf(${holder});`],
  ["const pot = who; return pot.USDT;", "const pot = who; return USDT.balanceOf(pot);"],
  ["return pot.balance;", "return ctx.selfBalance();"],
  ["return who.balance;", "return ctx.balance(who);"],
];
for (const [short, long] of spellings) {
  check(Buffer.from(reads(short)).equals(Buffer.from(reads(long))), `${short} is ${long}`);
}

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
  rejects("base", "function main(t: Address) { require(IERC20.at(t).balanceOf(pot) > 0); }"),
  "IERC20 needs an import",
);
check(
  !rejects(
    "base",
    'import { IERC20 as Erc20 } from "./artifacts/IERC20.json";\nfunction main(t: Address) { require(Erc20.at(t).balanceOf(pot) > pot.USDC); }',
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
// A name the chain lacks is zero there. A test of it is decided while the program compiles and the
// branch it rules out is not compiled; any other use is refused at the use, naming the chain. A
// name no chain has is an error either way, and there is no `available` call.
const refusal = (slug: string, body: string): string => {
  try {
    routes.compileSauceProgram(slug, body);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};
const call = "UniswapV3.Factory.getPool(USDC, WETH, 500)";
for (const slug of ["linea", "solana"]) {
  check(
    !rejects(
      slug,
      `function main(): Uint256 { if (UniswapV3.Factory) { return ${call}; } return 0; }`,
    ),
    `if (UniswapV3.Factory) compiles on ${slug}, its branch left out`,
  );
  check(
    refusal(slug, `function main(): Address { return ${call}; }`).includes(
      `\`UniswapV3.Factory\` is not deployed on ${slug}.`,
    ),
    `a call on UniswapV3.Factory is refused on ${slug}, naming the chain`,
  );
}
// Every test the skill lists compiles to the bytes of the program written without it: on Linea,
// which lacks the factory, the branch is gone; on Base, which has it, the call is all there is.
const bytes = (slug: string, body: string): string =>
  Buffer.from(
    routes.compileSauceProgram(slug, `function main(): Uint256 {\n${body}\n}`).bytecode,
  ).toString("hex");
for (const [tested, absent, present] of [
  [`if (UniswapV3.Factory) { return ${call}; }\nreturn 0;`, "return 0;", `return ${call};`],
  [`if (!UniswapV3.Factory) { return 0; }\nreturn ${call};`, "return 0;", `return ${call};`],
  [`if (UniswapV3.Factory != 0) { return ${call}; }\nreturn 0;`, "return 0;", `return ${call};`],
  [
    `if (UniswapV3.Factory == 0) { return 0; } else { return ${call}; }`,
    "return 0;",
    `return ${call};`,
  ],
  [`return UniswapV3.Factory ? ${call} : 0;`, "return 0;", `return ${call};`],
]) {
  check(bytes("linea", tested) === bytes("linea", absent), `${tested} on linea is ${absent}`);
  check(bytes("base", tested) === bytes("base", present), `${tested} on base is ${present}`);
}
// A require of a name the chain lacks rules nothing out: it fails whatever the program does, and
// is refused; where the chain has the name it compiles.
check(
  refusal("linea", "function main() { require(UniswapV3.Factory != 0); }").includes(
    "fails on linea whatever the program does",
  ),
  "require(UniswapV3.Factory != 0) is refused on linea",
);
check(
  !rejects("base", "function main() { require(UniswapV3.Factory != 0); }"),
  "require(UniswapV3.Factory != 0) compiles on base",
);
// It takes a token symbol too: Base registers no USDT, so the tested transfer is left out there.
check(
  !rejects("base", "function main() { if (USDT) { USDT.transfer(pot, 1); } }"),
  "if (USDT) leaves the transfer out on Base",
);
check(
  refusal("base", "function main() { USDT.transfer(pot, 1); }").includes(
    "`USDT` is not a token on base.",
  ),
  "a transfer of USDT is refused on Base, naming the chain",
);
// A decision held in a variable is live code: the name in its branch is refused.
check(
  refusal(
    "base",
    "function main() { let has = USDT != 0; if (has) { USDT.transfer(pot, 1); } }",
  ).includes("`USDT` is not a token on base."),
  "a branch behind a variable is live",
);
check(
  refusal(
    "base",
    "function main(): Uint256 { if (Uniswapp.Factory) { return 1; } return 0; }",
  ).includes("`Uniswapp` is not a token or protocol on base."),
  "a name no chain has is an error, even tested",
);
check(
  refusal(
    "base",
    "function main(): Uint256 { if (UniswapV3.Factroy) { return 1; } return 0; }",
  ).includes("`UniswapV3.Factroy` is not a contract of UniswapV3"),
  "a contract no chain has is an error, even tested",
);
// The removed call is refused, in the words that say to test the name.
check(
  refusal(
    "base",
    "function main(): Uint256 { if (available(UniswapV3.Factory)) { return 1; } return 0; }",
  ).includes("`available(X)` is removed"),
  "there is no such call: a program tests the name itself",
);
// The Pot's own balance of a symbol, and the chain's id.
check(
  !rejects("base", "function main() { require(pot.USDC >= 0 && chainId == 8453); }"),
  "pot.USDC and chainId",
);
console.log(
  writes
    .split("\n")
    .filter((line) => line.includes("__sauce_"))
    .join("\n"),
);
