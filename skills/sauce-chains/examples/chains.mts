// Compiles holdings.sauce.ts for Ethereum and for Base the way `sauce compile` does, and holds the
// sauce-chains skill to what that resolves: each name in the skill's table is, on each chain, the
// address the compile resolves, the one the chain's reference file records and the one the
// compiled program carries, and `chainId` is the chain's id. A name the chain lacks is refused with
// the words the skill quotes; a chain-qualified contract is that chain's address, called or not,
// and a chain-qualified token is refused. Then payout-solana.sauce.ts: the accounts compiling adds
// to main and how each is derived, its arguments, USDC an SPL Token mint moved by transfer and TSLAx
// a Token-2022 mint moved by transferChecked with its decimals. Last, the Sauce deployment: references/deployments.json holds the addresses the SDK builds
// every cook with, under the keys the skill's table names, `evm.pot` gives an owner's default Pot
// under the zero salt, and each chain's file points at it.
// Offline: nothing is sent.
//
//   node chains.mts
import { readFileSync } from "node:fs";

import { DEFAULT_POT_SALT, routes, v12PredictPot } from "@eco-incorp/sauce";
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
import { encodeAbiParameters, getCreate2Address, keccak256, type Hex } from "viem";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const skill = read("../SKILL.md");
const holdings = read("./holdings.sauce.ts");
const CHAINS = ["ethereum", "base"] as const;

/** Compiles `source` for `chain`, with each contract reference the compile resolved. */
function compile(chain: string, source: string) {
  const contracts = new Map<string, { chain: string; address: string }>();
  const program = routes.compileSauceProgram(chain, source, {
    accessors: {
      onContract: (reference, target) =>
        contracts.set(reference, { chain: target.chain.slug, address: target.address }),
    },
  });
  return { program, contracts, hex: Buffer.from(program.bytecode).toString("hex") };
}

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
  const { contracts, hex } = compile(chain, holdings);
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
      const resolved = contracts.get(name);
      check(
        resolved?.chain === chain && resolved.address === cell,
        `${name} compiles to ${cell} on ${chain}`,
      );
    } else {
      const listed = globals.tokens.find((one) => one.symbol === name)?.address;
      check(listed === cell, `sauce globals lists ${name} on ${chain} at ${cell}, not ${listed}`);
      check(hex.includes(cell.slice(2).toLowerCase()), `${name} compiles to ${cell} on ${chain}`);
    }
  }
  console.log(`holdings.sauce.ts on ${chain}: ${rows.map((row) => row.on[chain]).join(", ")}`);
}

// A name the chain lacks is zero there: a use of it that is not a test of it is refused when the
// file is compiled, at the use, naming the chain, in the words the skill quotes; a test of it
// compiles, its branch left out.
const quoted = (message: string, words: string) => {
  check(message.includes(words), `the refusal says "${words}": ${message}`);
  check(skill.includes(words), `the skill quotes "${words}"`);
};
quoted(
  refusal("base", "function main(to: Address, amount: Uint256) { USDT.transfer(to, amount); }"),
  "`USDT` is not a token on base.",
);
compile(
  "base",
  "function main(to: Address, amount: Uint256) { if (USDT) { USDT.transfer(to, amount); } }",
);
check(skill.includes("`if (USDT) { … }`"), "the skill says to test the name");
quoted(
  refusal(
    "ethereum",
    "function main(fee: Uint256): Address { return AerodromeSlipstream.CLFactory.getPool(USDC, WETH, fee); }",
  ),
  "`AerodromeSlipstream.CLFactory` is not deployed on ethereum.",
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
  "`TSLAx` is not a token on base.",
);

// Another chain's contract, by its name: its address there, as a value in a program for this one.
const factoryOnBase = rows.find((row) => row.name === "UniswapV3.Factory")!.on.base;
const qualified = compile(
  "ethereum",
  "function main(): Address { return Base.UniswapV3.Factory; }",
);
check(
  qualified.contracts.get("Base.UniswapV3.Factory")?.address === factoryOnBase,
  "Base.UniswapV3.Factory is Base's factory in a program for Ethereum",
);
// Called, it is still that address: a program for Ethereum calls Base's address on Ethereum.
const called = compile(
  "ethereum",
  "function main(): Address { return Base.UniswapV3.Factory.getPool(USDC, WETH, 500); }",
);
check(
  called.contracts.get("Base.UniswapV3.Factory")?.address === factoryOnBase &&
    called.hex.includes(factoryOnBase.slice(2).toLowerCase()),
  "a call on Base.UniswapV3.Factory, compiled for Ethereum, goes to Base's address",
);
check(skill.includes("calls that address on Ethereum"), "the skill says where the call goes");
// A token is never qualified: the symbol is the chain's own, or an address.
quoted(
  refusal("ethereum", "function main(): Address { return Base.USDC; }"),
  "`Base.USDC` is not a protocol on base.",
);

// payout-solana.sauce.ts: written as on an EVM chain, it names no account. Compiling adds each one
// its calls move through to main, with how it is derived: both token programs, the Pot, the Pot's
// and the recipient's token accounts and TSLAx's mint, which its checked write takes. The scalars
// are main's own arguments; the symbols are Solana's mints.
const payoutSource = read("./payout-solana.sauce.ts");
const payout = routes.compileSauceProgram("solana", payoutSource);
const slots = (payout.manifest?.accounts ?? []).map((a) =>
  a.kind === "slot" ? `${a.name}:${a.requires}` : "remaining",
);
check(
  JSON.stringify(payout.derivedAccounts) ===
    JSON.stringify({
      potUSDC: "pot:USDC",
      pot: "pot",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      recipientUSDC: "@recipient:USDC",
      recipientTSLAx: "@recipient:TSLAx",
      token2022Program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      mintTSLAx: "mint:TSLAx",
      potTSLAx: "pot:TSLAx",
    }),
  `the accounts added and their derivations: ${JSON.stringify(payout.derivedAccounts)}`,
);
check(
  payout.entryParams.map((param) => param.name).join() === "recipient,cash,shares",
  "the arguments are main's own parameters",
);
// USDC moves by SPL Token's transfer, TSLAx by the checked write with its decimals.
check(payout.source.includes("__sauce_transfer(USDC,"), "USDC moves by transfer");
check(
  /__sauce_transferChecked\(TSLAx,[^;]*, 8\);/.test(payout.source),
  "TSLAx moves by transferChecked, given its decimals",
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
// An owner's default Pot is its Pot under the zero salt, and `evm.pot` derives it: any owner
// serves, here the engine's address.
const owner = evm.engine.address as Hex;
check(
  DEFAULT_POT_SALT === `0x${"00".repeat(32)}` &&
    getCreate2Address({
      from: evm.kitchen.address,
      bytecodeHash: evm.pot.initCodeHash,
      salt: keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, DEFAULT_POT_SALT]),
      ),
    }) === v12PredictPot(owner),
  "deployments.json's evm.pot gives an owner's default Pot, under the zero salt",
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
