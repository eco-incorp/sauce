// Compiles holdings.sauce.ts for Ethereum and for Base the way `sauce compile` does, and holds the
// sauce-chains skill to what that resolves: each name in the skill's table is, on each chain, the
// address `sauce globals` lists, the one the chain's reference file records and the one the
// compiled program carries, and `chainId` is the chain's id. A name the chain lacks is refused with
// the words the skill quotes; a chain-qualified contract is that chain's address, called or not,
// and a chain-qualified token is refused. Then payout-solana.sauce.ts: its accounts in order with their
// roles, its arguments, USDC an SPL Token mint and TSLAx a Token-2022 mint whose decimals the program
// passes. Last, the Sauce deployment: references/deployments.json holds the addresses the SDK builds
// every cook with, under the keys the skill's table names, and each chain's file points at it.
// Offline: nothing is sent.
//
//   node chains.mts
import { readFileSync } from "node:fs";

import { SAUCE_INTENT_POT_SALT, destinationPot, routes } from "@eco-incorp/sauce";
import {
  v12EngineAddress,
  v12KitchenAddress,
  v12KitchenImplementationAddress,
  v12PotDerivation,
  v12QuoteRouterAddress,
  v12RouterAddress,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "@eco-incorp/sauce/deployments";
import { address, getAddressEncoder } from "@eco-incorp/sauce/svm";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const skill = read("../SKILL.md");
const holdings = read("./holdings.sauce.ts");
const CHAINS = ["ethereum", "base"] as const;

/** Compiles `source` for `chain`: the program, and its bytes as hex. */
function compile(chain: string, source: string) {
  const program = routes.compileSauceProgram(chain, source);
  return { program, hex: Buffer.from(program.bytecode).toString("hex") };
}
/** Whether `hex` carries `address`. */
const carries = (hex: string, address: string) => hex.includes(address.slice(2).toLowerCase());

/** The message `source` is refused with on `chain`. */
function refusal(chain: string, source: string): string {
  try {
    routes.compileSauceProgram(chain, source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`check failed: compiled on ${chain}, where the skill says it is refused`);
}

// The table under "Names resolve per chain": `| \`name\` | \`on Ethereum\` | \`on Base\` |`.
const section = skill.slice(skill.indexOf("## Names resolve per chain"));
const table = section.slice(0, section.indexOf("\n## "));
const rows = [...table.matchAll(/^\| `([\w.]+)`[^|]*\| `(\w+)` +\| `(\w+)` +\|$/gm)].map((m) => ({
  name: m[1]!,
  on: { ethereum: m[2]!, base: m[3]! },
}));
check(
  rows.map((row) => row.name).join() === "USDC,WETH,bCSPX,UniswapV3.Factory,chainId",
  `the table names USDC, WETH, bCSPX, UniswapV3.Factory and chainId, not ${rows.map((r) => r.name)}`,
);
for (const chain of CHAINS) {
  const { hex } = compile(chain, holdings);
  const globals = routes.sourceGlobals(chain);
  const recorded = read(`../references/${chain}.md`) + read(`../references/${chain}-stocks.md`);
  for (const { name, on } of rows) {
    const cell = on[chain];
    if (name === "chainId") {
      check(String(globals.defines.chainId) === cell, `chainId on ${chain} is ${cell}`);
      continue;
    }
    check(holdings.includes(name), `holdings.sauce.ts uses ${name}`);
    check(recorded.includes(`\`${cell}\``), `references/${chain}.md records ${name} at ${cell}`);
    if (name.includes(".")) {
      const [namespace, contract] = name.split(".");
      const listed = globals.protocols
        .find((one) => one.namespace === namespace)
        ?.contracts.find((one) => one.name === contract)?.address;
      check(listed === cell, `sauce globals lists ${name} on ${chain} at ${cell}, not ${listed}`);
    } else {
      const listed = globals.tokens.find((one) => one.symbol === name)?.address;
      check(listed === cell, `sauce globals lists ${name} on ${chain} at ${cell}, not ${listed}`);
    }
    check(carries(hex, cell), `${name} compiles to ${cell} on ${chain}`);
  }
  console.log(`holdings.sauce.ts on ${chain}: ${rows.map((row) => row.on[chain]).join(", ")}`);
}

// A name the chain lacks is `undefined` there: a use of it is refused when the file is compiled, in
// the words the skill quotes, and a test of it compiles, leaving its branch out.
const quoted = (message: string, words: string) => {
  check(message.includes(words), `the refusal says "${words}": ${message}`);
  check(skill.includes(words), `the skill quotes "${words}"`);
};
refusal("base", "function main(to: Address, amount: Uint256) { USDT.transfer(to, amount); }");
compile(
  "base",
  "function main(to: Address, amount: Uint256) { if (USDT) { USDT.transfer(to, amount); } }",
);
quoted(
  refusal("ethereum", "function main(): Address { return AerodromeSlipstream.CLFactory; }"),
  "`AerodromeSlipstream.CLFactory` is `undefined`, so it has no run-time value here",
);
quoted(
  refusal("base", "function main(): Address { return USDCC; }"),
  "not a declared variable; did you mean `USDC`?",
);
// Tesla is a different symbol per issuer and chain: TSLAx on Ethereum and Solana, TSLAc or bTSLA
// on Base, which refuses TSLAx.
const tesla = (chain: string) =>
  routes
    .sourceGlobals(chain)
    .tokens.filter((one) => one.stock?.ticker === "TSLA")
    .map((one) => one.symbol);
check(tesla("ethereum").includes("TSLAx") && tesla("solana").includes("TSLAx"), "TSLAx");
check(tesla("base").join() === "TSLAc,bTSLA", `Tesla on Base is TSLAc or bTSLA: ${tesla("base")}`);
compile("ethereum", "function main(): Address { return TSLAx; }");
quoted(
  refusal("base", "function main(): Address { return TSLAx; }"),
  "so it has no run-time value here",
);

// Another chain's contract, by its name: its address there, as a value in a program for this one.
const factoryOnBase = rows.find((row) => row.name === "UniswapV3.Factory")!.on.base;
const qualified = compile(
  "ethereum",
  "function main(): Address { return Base.UniswapV3.Factory; }",
);
check(
  carries(qualified.hex, factoryOnBase),
  "Base.UniswapV3.Factory is Base's factory in a program for Ethereum",
);
// Called, it is still that address: a program for Ethereum calls Base's address on Ethereum.
const called = compile(
  "ethereum",
  "function main(): Address { return Base.UniswapV3.Factory.getPool(USDC, WETH, 500); }",
);
check(
  carries(called.hex, factoryOnBase),
  "a call on Base.UniswapV3.Factory, compiled for Ethereum, goes to Base's address",
);
check(skill.includes("calls that address on Ethereum"), "the skill says where the call goes");
// A token is never qualified: the symbol is the chain's own, or an address.
quoted(
  refusal("ethereum", "function main(): Address { return Base.USDC; }"),
  "a token is never qualified by a chain",
);

// payout-solana.sauce.ts: every account is a slot, in order, with its role; the scalars are the
// arguments; the symbols are Solana's mints.
const payoutSource = read("./payout-solana.sauce.ts");
const payout = routes.compileSauceProgram("solana", payoutSource);
const slots = (payout.manifest?.accounts ?? []).map((a) =>
  a.kind === "slot" ? `${a.name}:${a.requires}` : "remaining",
);
check(
  slots.join() ===
    "pot:readonly_signer,usdcProgram:readonly,potUsdc:writable,toUsdc:writable," +
      "tslaxProgram:readonly,tslaxMint:readonly,potTslax:writable,toTslax:writable",
  `manifest order and roles: ${slots}`,
);
check(
  payout.entryParams.map((param) => param.name).join() === "cash,shares",
  "the arguments are the scalar parameters",
);
const mints = routes.sourceGlobals("solana").tokens;
const usdc = mints.find((one) => one.symbol === "USDC")!;
const tslax = mints.find((one) => one.symbol === "TSLAx")!;
check(usdc.tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "USDC is SPL Token's");
check(
  tslax.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "TSLAx is Token-2022's",
);
check(
  usdc.decimals === 6 && tslax.decimals === 8 && tslax.stock !== undefined,
  "USDC has 6 decimals, and TSLAx, a stock, 8",
);
check(
  /transferChecked\(TSLAx,[^)]*, 8\)/.test(payoutSource),
  "transferChecked is given TSLAx's decimals",
);
for (const mint of [usdc, tslax]) {
  check(
    Buffer.from(payout.bytecode).toString("hex").includes(mint.address.slice(2)),
    `${mint.symbol} on Solana is its mint's key`,
  );
}
console.log(`payout-solana.sauce.ts: ${payout.bytecode.length} bytes, accounts ${slots}`);

// The Sauce deployment, the same on every chain: one file, the addresses every cook is built with.
const deployments = JSON.parse(read("../references/deployments.json"));
const { evm, svm } = deployments;
check(
  evm.engine.address === v12EngineAddress() &&
    evm.kitchen.address === v12KitchenAddress() &&
    evm.kitchenImplementation.address === v12KitchenImplementationAddress() &&
    evm.router.address === v12RouterAddress() &&
    evm.quoteRouter.address === v12QuoteRouterAddress() &&
    evm.pot.initCodeHash === v12PotDerivation().initCodeHash,
  "deployments.json gives the EVM contracts the SDK builds cooks with",
);
check(
  evm.intentPot.salt === SAUCE_INTENT_POT_SALT &&
    CHAINS.every((chain) => destinationPot(chain) === evm.intentPot.address),
  "deployments.json gives the shared intent Pot of every chain",
);
const svmKey = (programId: string) =>
  `0x${Buffer.from(getAddressEncoder().encode(address(programId))).toString("hex")}`;
check(
  svm.engine.programId === v12SvmEngineProgramId() &&
    svm.kitchen.programId === v12SvmKitchenProgramId() &&
    svm.engine.key === svmKey(svm.engine.programId) &&
    svm.kitchen.key === svmKey(svm.kitchen.programId),
  "deployments.json gives the Solana programs, each with its 32-byte key",
);
const deployment = skill.slice(skill.indexOf("## The Sauce deployment"));
const keys = [
  ...deployment.slice(0, deployment.indexOf("\n## ")).matchAll(/`((?:evm|svm)\.\w+)`/g),
];
check(keys.length >= 7, "the skill's table names the file's keys");
for (const [, key] of keys) {
  const value = key!.split(".").reduce((node, part) => node?.[part], deployments);
  check(value !== undefined, `deployments.json has ${key}`);
}
for (const chain of [...CHAINS, "solana"])
  check(
    read(`../references/${chain}.md`).includes("deployments.json"),
    `${chain}'s file points at deployments.json`,
  );
console.log(
  `deployments.json: the engine ${evm.engine.address}, the Kitchen ${evm.kitchen.address}`,
);
