// Compiles the two intent files the way `sauce run` and `sauce intent publish` do
// (`routes.compileSauceProgram` with the intent settings) and checks on which chain each name
// resolves: the body and its delivery on the destination, the reward on the source. Each body is a
// program for its destination, compiled with the file; the refund address and each destination
// Kitchen's fee are given here. Pins the defaults the skill states, each the program
// its field writes; that every hop names its refundee; that every body is a program, whose
// cook pays the fee; and the fields example. Then the destination side of a rehearsal: the
// shared Pot's deploy. Pins the funding by transfer (fund-by-transfer.sauce.ts) and the Portal
// reference (references/portal.md) to the registry's Portal ABI. Offline: nothing is sent, so no
// intent is published, and an intent's route and reward, which the program encodes as it runs,
// are read from the Portal's log by `sauce intent publish --dry-run`, not here.
//
//   node intents.mts --refundee <address> --ethereum-fee <wei> --base-fee <wei>
//
// Each fee is that chain's Kitchen executionFee(), read there just before sending with
// destinationExecutionFee(); it is compiled into the body's cook.
import { readFileSync } from "node:fs";

import {
  contracts,
  destinationExecutionFee,
  destinationPot,
  routes,
  SAUCE_INTENT_POT_SALT,
  v12PredictPot,
} from "@eco-incorp/sauce";
import { v12KitchenAddress } from "@eco-incorp/sauce/deployments";
import {
  ecoRoutesExecutor,
  ecoRoutesPortal,
  ecoRoutesProver,
  PortalABI,
} from "@eco-incorp/sauce/protocols/eco-routes";
import { bytesToHex, getAddress, toEventSelector, toFunctionSelector, type AbiEvent } from "viem";

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined) throw new Error(`pass --${name}`);
  return value;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const refundee = getAddress(flag("refundee")); // the refund address: may reclaim an unearned reward
const salt = `0x${"5a".repeat(32)}` as const; // random unless given, as the command picks it
const fee = { ethereum: BigInt(flag("ethereum-fee")), base: BigInt(flag("base-fee")) };
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // filled within the hour or not at all
const feeRead = destinationExecutionFee(); // { to, data, decode }: eth_call it on each destination

type Intents = NonNullable<Parameters<typeof routes.compileSauceProgram>[2]>["intents"];
/** `source` compiled for `slug`, with the intent settings the command gives. */
const compileFor = (slug: string, source: string, intents: Intents = {}) =>
  routes.compileSauceProgram(slug, source, { intents: { deadline, salt, ...intents } });
const hex = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);
/** Whether `bytes` carry `address`. */
const carries = (bytes: Uint8Array, address: bigint) =>
  hex(bytes).includes(address.toString(16).padStart(40, "0"));
const token = (slug: string, symbol: string) => {
  const found = routes.registryTokenAddress(routes.chain(slug).chain, symbol);
  if (found === undefined) throw new Error(`no ${symbol} on ${slug}`);
  return found;
};
const contract = (slug: string, name: string) => {
  const found = routes.chainDefines(routes.chain(slug).chain)[name];
  if (typeof found !== "bigint") throw new Error(`no ${name} on ${slug}`);
  return found;
};
/** The message compiling `source` for `slug` is refused with, or "" when it compiles. */
const refusal = (slug: string, source: string, intents: Intents = {}) => {
  try {
    compileFor(slug, source, intents);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

// ---- cross-chain.sauce.ts: from Base, a program body on Ethereum.
const forward = readFileSync(new URL("./cross-chain.sauce.ts", import.meta.url), "utf8");
check(
  /function main\(beneficiary: Address, refundTo: Address\)/.test(forward),
  "its inputs are main's parameters",
);
check(
  refusal("base", forward).includes("give the hop a `fee`"),
  "a body is a program: its cook needs the destination's Kitchen fee",
);
const forwarded = compileFor("base", forward, { executionFee: fee.ethereum });
check(
  forwarded.entryParams.map((param) => param.name).join() === "beneficiary,refundTo",
  "main takes the beneficiary and the refund address as it runs",
);
const [forwardBody] = forwarded.bodies;
check(forwardBody?.destination.slug === "ethereum", "the body is a program for Ethereum");
check(
  forwardBody.captures.includes("beneficiary"),
  "and the program gives it the beneficiary as it runs",
);
check(carries(forwardBody.bytecode, contract("ethereum", "AaveV3_Pool")), "Ethereum's Aave pool");
check(!carries(forwardBody.bytecode, contract("base", "AaveV3_Pool")), "and not Base's");
check(carries(forwardBody.bytecode, token("ethereum", "USDC")), "the body moves Ethereum's USDC");
check(
  carries(forwarded.bytecode, token("ethereum", "USDC")),
  "the solver delivers Ethereum's USDC",
);
check(carries(forwarded.bytecode, token("base", "USDC")), "the reward is Base's USDC");

// ---- The defaults the skill states, for an intent that sets none: each is the program its
// field writes. The fill deadline 5 minutes after the intent opens (when the command builds
// it: `openedAt`), the reward's 7 days after that, the registry's prover, a random salt. The
// refundee has none: the file names `refundTo`.
const openedAt = BigInt(Math.floor(Date.now() / 1000));
const fixed = (source: string, intents: Intents) =>
  hex(
    routes.compileSauceProgram("base", source, {
      intents: { openedAt, executionFee: fee.ethereum, ...intents },
    }).bytecode,
  );
const modified = forward.replace(
  "    refundee: refundTo,\n",
  `    refundee: refundTo,\n    deadline: ${openedAt + 300n},\n` +
    `    rewardDeadline: ${openedAt + 300n + 604800n},\n` +
    `    prover: ${ecoRoutesProver("base", "ethereum")},\n`,
);
check(modified !== forward, "the fields are written in");
check(
  fixed(forward, { salt }) === fixed(modified, { salt }),
  "the deadlines default to 5 minutes and 7 days on, the prover to the registry's",
);
check(fixed(forward, {}) !== fixed(forward, {}), "the salt is picked at random for each build");
check(
  refusal("base", forward.replace("    refundee: refundTo,\n", ""), {
    executionFee: fee.ethereum,
  }).includes("a hop needs a `refundee`"),
  "a hop with no refundee is refused",
);

// ---- swap-on-base.sauce.ts: from Ethereum, the distributed swap as a program body on Base.
const swap = readFileSync(new URL("./swap-on-base.sauce.ts", import.meta.url), "utf8");
const swapProgram = compileFor("ethereum", swap, { executionFee: fee.base });
check(
  swapProgram.entryParams.map((param) => param.name).join() ===
    "amountIn,reward,sqrtPriceLimitX96,minOut,minAvgPrice,recipient,refundTo",
  "its amounts are main's arguments",
);
const [swapBody] = swapProgram.bodies;
check(swapBody?.destination.slug === "base", "the body is a program for Base");
for (const [what, value] of [
  ["Base's USDC", token("base", "USDC")],
  ["Base's WETH", token("base", "WETH")],
  ["Base's Uniswap V3 factory", contract("base", "UniswapV3_Factory")],
  ["Base's Uniswap V4 PoolManager", contract("base", "UniswapV4_PoolManager")],
  ["Base's Uniswap V4 StateView", contract("base", "UniswapV4_StateView")],
] as const) {
  check(carries(swapBody.bytecode, value), `the body uses ${what}`);
}
check(carries(swapProgram.bytecode, token("base", "WETH")), "the solver delivers Base's WETH");
check(carries(swapProgram.bytecode, token("ethereum", "WETH")), "the reward is Ethereum's WETH");
// The body swaps through @sauce/router and reads each V3 pool through the `UniswapV3.Pool`
// namespace, whose ABI is the registry's: three view functions the pool dispatches, by these
// selectors, which the body carries, and no raw selector of its own.
for (const [signature, selector] of [
  ["slot0()", "3850c7bd"],
  ["liquidity()", "1a686502"],
  ["fee()", "ddca3f43"],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
  check(hex(swapBody.bytecode).includes(selector), `the body calls ${signature} on a pool`);
}
check(/UniswapV3\.Pool\(pool\)/.test(swap), "the body reads a pool through UniswapV3.Pool");
check(!/hex`[0-9a-f]{8}`/.test(swap), "and calls no raw selector");
check(
  /import \{ uniswapV3, uniswapV4 \} from "@sauce\/router"/.test(swap),
  "the body swaps through @sauce/router",
);
// The deadline and the fee are in the route, so either changes the intent and its hash: rebuild
// every transaction (and any unsigned one printed earlier) after changing one.
const swapBytes = (shift: bigint, executionFee: bigint) =>
  hex(
    routes.compileSauceProgram("ethereum", swap, {
      intents: { deadline: deadline + shift, salt, executionFee },
    }).bytecode,
  );
check(
  swapBytes(0n, fee.base) === hex(swapProgram.bytecode),
  "the same inputs give the same intent",
);
check(swapBytes(1n, fee.base) !== hex(swapProgram.bytecode), "a new deadline is a new intent");
check(
  swapBytes(0n, fee.base + 1n) !== hex(swapProgram.bytecode),
  "a new Kitchen fee is a new intent",
);

// ---- A body of one transfer is a program too: it cooks on the shared Pot and pays the fee.
// Inside the body, and in the delivery, a token symbol is the destination's: `USDC` here is
// Ethereum's, while the one in `reward` is Base's, which the program escrows.
const oneTransfer =
  "function main(to: Address, amount: Uint256) { Ethereum.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: to }).then(() => { USDC.transfer(to, amount); }); }";
check(
  refusal("base", oneTransfer).includes("give the hop a `fee`"),
  "a one-transfer body pays the fee too",
);
const direct = compileFor("base", oneTransfer, { executionFee: fee.ethereum });
check(
  direct.bodies.length === 1 && carries(direct.bodies[0]!.bytecode, token("ethereum", "USDC")),
  "its body is a program moving Ethereum's USDC",
);
check(carries(direct.bytecode, token("base", "USDC")), "the reward is Base's USDC");
check(contracts.on("ethereum").AaveV3.Pool.available, "Ethereum has AaveV3.Pool");

// ---- Inside a body, a decoded result is read by position or destructured, as anywhere else.
const decodeIn = (statement: string) =>
  `function main(pool: Address) { Base.hop({ send: { token: WETH, amount: 1 }, receive: { token: WETH, amount: 1 }, refundee: ${refundee} }).then(() => { const d = hex\`3850c7bd\`; ${statement} require(x != 0); }); }`;
check(
  refusal("ethereum", decodeIn('const x = abi.decode(evm.static(pool, d), ["Uint256"])[0];'), {
    executionFee: fee.base,
  }) === "",
  "a body reads a decoded result by position",
);
check(
  refusal("ethereum", decodeIn('const [x] = abi.decode(evm.static(pool, d), ["Uint256"]);'), {
    executionFee: fee.base,
  }) === "",
  "and destructures one, as anywhere else",
);

// ---- The destination side of a rehearsal: what a solver needs there before it fills.
// The shared Pot: the Executor's at salt zero. Anyone may deploy it; no solver can fill first.
const executor = ecoRoutesExecutor("base");
const pot = destinationPot("base");
check(pot === v12PredictPot(executor, SAUCE_INTENT_POT_SALT), "the shared Pot is the Executor's");
const deployPot = routes.sauceEvmDeployPotCall({ owner: executor, salt: SAUCE_INTENT_POT_SALT });
check(
  getAddress(`0x${deployPot.target.slice(-40)}`) === getAddress(v12KitchenAddress()),
  "the Pot's deploy is a call to the Kitchen",
);
check(carries(swapProgram.bytecode, BigInt(pot)), "the route cooks the body on that Pot");

// Funding by transfer: the program reads the vault and publishes through the registry's Portal
// namespace, with the same three arguments, and compiles for a source chain to those functions.
const byHand = readFileSync(new URL("./fund-by-transfer.sauce.ts", import.meta.url), "utf8");
const byHandProgram = routes.compileSauceProgram("base", byHand);
const byHandBytes = bytesToHex(byHandProgram.bytecode);
// A function's or error's selector is the hash of its bare signature, `name(types)`.
type Param = { type: string; components?: readonly Param[] };
type Entry = { name: string; inputs: readonly Param[] };
const typeOf = (param: Param): string =>
  param.type.startsWith("tuple")
    ? `(${(param.components ?? []).map(typeOf).join(",")})${param.type.slice(5)}`
    : param.type;
const signature = (item: Entry) => `${item.name}(${item.inputs.map(typeOf).join(",")})`;
const portalFunction = (name: string): Entry =>
  PortalABI.find((item) => item.type === "function" && item.name === name) as Entry;
for (const name of ["intentVaultAddress", "publish"]) {
  const selector = toFunctionSelector(signature(portalFunction(name)));
  check(
    byHand.includes(`EcoRoutes.Portal.${name}(destination, route, reward)`) &&
      byHandBytes.includes(selector.slice(2)) &&
      !byHand.includes(selector.slice(2)),
    `fund-by-transfer calls EcoRoutes.Portal.${name}, ${selector}, by name`,
  );
}
check(
  JSON.stringify(portalFunction("publish").inputs) ===
    JSON.stringify(portalFunction("intentVaultAddress").inputs),
  "publish and intentVaultAddress take the same (destination, route, reward)",
);
check(
  JSON.stringify(portalFunction("publishAndFund").inputs.slice(0, 3)) ===
    JSON.stringify(portalFunction("publish").inputs),
  "publish's arguments are publishAndFund's first three",
);
check(
  byHandProgram.entryParams.map((param) => param.name).join() === "destination,route,reward",
  "fund-by-transfer takes the intent as publish's arguments, and no Portal",
);

// The Portal reference: every selector and topic it gives for something the registry declares is
// the registry's.
const reference = readFileSync(new URL("../references/portal.md", import.meta.url), "utf8");
let pinned = 0;
for (const item of PortalABI) {
  if (item.type !== "function" && item.type !== "event" && item.type !== "error") continue;
  // Each entry naming it, to the next list item, table row or paragraph; the one that gives a
  // selector or topic must give the registry's.
  const entries: string[] = [];
  for (let at = reference.indexOf(`\`${item.name}(`); at !== -1;) {
    const ends = ["\n- ", "\n|", "\n\n"]
      .map((end) => reference.indexOf(end, at + 1))
      .filter((i) => i > 0);
    entries.push(reference.slice(at, Math.min(...ends)));
    at = reference.indexOf(`\`${item.name}(`, at + 1);
  }
  const given = entries.filter((entry) => /`0x[0-9a-f]{8}(?:[0-9a-f]{56})?`/.test(entry));
  if (given.length === 0) continue;
  const expected =
    item.type === "event"
      ? toEventSelector(item as AbiEvent)
      : toFunctionSelector(signature(item as Entry));
  check(
    given.every((entry) => entry.includes(expected)),
    `references/portal.md gives ${item.name} as ${expected}`,
  );
  pinned++;
}
check(pinned >= 15, `the reference pins ${pinned} of the Portal's selectors and topics`);

// The one-pool swap body compiles as an intent to Base, a program its cook runs.
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const onePool = /```sauce chain=ethereum\n(import \{ uniswapV3 \}[\s\S]*?)```/.exec(skill);
check(onePool !== null, "the skill gives the one-pool body");
const onePoolProgram = compileFor("ethereum", onePool[1]!, { executionFee: fee.base });
check(
  onePoolProgram.bodies.map((body) => body.destination.slug).join() === "base",
  "the one-pool body is a program for Base",
);

// The fields example: its refundee is main's argument, and its deadlines are read as the
// program runs, from ctx.timestamp(), as `modified` above writes them in.
const fields =
  /```sauce chain=base\n(function main\(recipient: Address, amount: Uint256, reward: Uint256, refundTo: Address\)[^`]*?deadline: ctx\.timestamp\(\) \+ 1800,[^`]*)```/.exec(
    skill,
  );
check(fields !== null, "the skill gives the fields example");
check(
  /refundee: refundTo,/.test(fields[1]!) &&
    /rewardDeadline: ctx\.timestamp\(\) \+ 86400 \* 14,/.test(fields[1]!),
  "its refundee is main's argument, and its reward's deadline is read as it runs",
);

console.log(
  `rehearsal on a fork of Base: deploy the Pot ${pot} if it has no code, approve the Portal for ` +
    "the WETH, then fulfill the intent the source's rehearsal read from the Portal's log",
);
console.log(
  `cross-chain.sauce.ts on Base -> Ethereum Portal ${ecoRoutesPortal("ethereum")}, ` +
    `prover ${ecoRoutesProver("base", "ethereum")}`,
);
console.log(
  `swap-on-base.sauce.ts on Ethereum -> Base Portal ${ecoRoutesPortal("base")}, ` +
    `prover ${ecoRoutesProver("ethereum", "base")}`,
);
console.log(`each destination fee is read at ${feeRead.to}`);
