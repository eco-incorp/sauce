// Compiles the two intent files the way `sauce run` and `sauce compile` do
// (`routes.compileSauceProgram` with the intent settings), and checks on which chain each name
// resolves: the body and its delivery on the destination, the reward on the source. Each child's
// Portal and prover come from the eco-routes registry; the deadline, the creator, the recipient and
// each destination Kitchen's fee are the developer's. Then builds what rehearsing the swap-on-base
// body on a fork of Base sends: the shared Pot's deploy, and the Portal's fulfill with the Kitchen
// fee as its value. Pins the funding by transfer (fund-by-transfer.sauce.ts) and the Portal
// reference (references/portal.md) to the registry's Portal ABI. Offline: nothing is sent.
//
//   node intents.mts --creator <address> --recipient <address> --arbitrum-fee <wei> --base-fee <wei>
//
// Each fee is that chain's Kitchen executionFee(), read there just before sending with
// destinationExecutionFee(); it is compiled into the child's cook.
import { readFileSync } from "node:fs";

import {
  contracts,
  destinationExecutionFee,
  destinationPot,
  routes,
  SAUCE_INTENT_POT_SALT,
  v12GateKitchen,
  v12PredictPot,
} from "@eco-incorp/sauce";
import {
  ecoRoutesExecutor,
  ecoRoutesPortal,
  ecoRoutesProver,
  PortalABI,
} from "@eco-incorp/sauce/protocols/eco-routes";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
  type Hex,
} from "viem";

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined) throw new Error(`pass --${name}`);
  return value;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const creator = getAddress(flag("creator")); // may reclaim an unearned reward; never a Pot
const recipient = BigInt(getAddress(flag("recipient")));
const fee = { arbitrum: BigInt(flag("arbitrum-fee")), base: BigInt(flag("base-fee")) };
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // filled within the hour or not at all
const feeRead = destinationExecutionFee(); // { to, data, decode }: eth_call it on each destination

const compileFor = (
  slug: string,
  source: string,
  defines: Record<string, bigint>,
  executionFee?: bigint,
) =>
  routes.compileSauceProgram(slug, source, {
    defines,
    intents: { deadline, creator, ...(executionFee === undefined ? {} : { executionFee }) },
  });
const word = (value: bigint | string) => BigInt(value).toString(16).padStart(40, "0");
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
/** The one intent a program opens: its route's tokens and calls, and its reward's tokens. */
function intentOf(program: ReturnType<typeof compileFor>) {
  check(program.intents.length === 1, "one intent");
  const { route, reward } = program.intents[0]!.intent;
  return {
    delivered: route.tokens.map((t) => t.token.slice(-40)),
    calls: route.calls.map((c) => `${c.target.slice(-40)}:${c.data.toLowerCase()}`).join(" "),
    rewarded: reward.tokens.map((t) => t.token.slice(-40)),
  };
}

// ---- cross-chain.sauce.ts: from Base, a program child on Arbitrum.
const forward = readFileSync(new URL("./cross-chain.sauce.ts", import.meta.url), "utf8");
check(!/function main\b/.test(forward), "an intent file is top-level statements");
let missingFee = "";
try {
  compileFor("base", forward, { BENEFICIARY: recipient });
} catch (error) {
  missingFee = (error as Error).message;
}
check(missingFee.includes("executionFee"), "a program child needs the destination's Kitchen fee");
const forwarded = intentOf(compileFor("base", forward, { BENEFICIARY: recipient }, fee.arbitrum));
check(
  forwarded.delivered.join() === word(token("arbitrum", "USDC")),
  "the solver delivers Arbitrum's USDC",
);
check(forwarded.calls.includes(word(contract("arbitrum", "AaveV3_Pool"))), "Arbitrum's Aave pool");
check(!forwarded.calls.includes(word(contract("base", "AaveV3_Pool"))), "and not Base's");
check(forwarded.rewarded.join() === word(token("base", "USDC")), "the reward is Base's USDC");

// ---- swap-on-base.sauce.ts: from Arbitrum, the distributed swap as a program child on Base.
const swap = readFileSync(new URL("./swap-on-base.sauce.ts", import.meta.url), "utf8");
check(!/function main\b/.test(swap), "an intent file is top-level statements");
const swapped = intentOf(
  compileFor(
    "arbitrum",
    swap,
    {
      AMOUNT_IN: 10n ** 18n,
      REWARD: 10n ** 18n + 10n ** 15n,
      SQRT_PRICE_LIMIT_X96: 3068493539683605256287027n, // 1,500 USDC per WETH on Base
      MIN_OUT: 0n,
      MIN_AVG_PRICE: 1_500_000_000n,
      RECIPIENT: recipient,
      REFUND_TO: recipient,
    },
    fee.base,
  ),
);
check(swapped.delivered.join() === word(token("base", "WETH")), "the solver delivers Base's WETH");
for (const [what, value] of [
  ["Base's USDC", token("base", "USDC")],
  ["Base's Uniswap V3 factory", contract("base", "UniswapV3_Factory")],
  ["Base's Uniswap V4 PoolManager", contract("base", "UniswapV4_PoolManager")],
] as const) {
  check(swapped.calls.includes(word(value)), `the child uses ${what}`);
}
check(swapped.rewarded.join() === word(token("arbitrum", "WETH")), "the reward is Arbitrum's WETH");
// An intent file imports nothing, so the body reaches every contract without a namespace by
// selector, with evm.static and evm.call. These are the selectors sauce-intents tabulates.
for (const [signature, selector] of [
  ["getPool(address,address,uint24)", "1698ee82"],
  ["getPool(address,address,int24)", "28af8d0b"],
  ["slot0()", "3850c7bd"],
  ["liquidity()", "1a686502"],
  ["fee()", "ddca3f43"],
  ["extsload(bytes32)", "1e2eaeaf"],
  ["swapV3(address,address,address,int256,uint160,address,address)", "a5e2989d"],
  [
    "swapV4(address,(address,address,uint24,int24,address),bool,int256,uint160,address,address)",
    "7c9e9da3",
  ],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
}
for (const selector of ["3850c7bd", "1a686502", "ddca3f43", "1e2eaeaf", "a5e2989d", "7c9e9da3"])
  check(swap.includes(`hex\`${selector}\``), `the body uses 0x${selector}`);

// ---- A token-only child is plain route calls for the destination's Executor: no Pot, no fee.
const direct = intentOf(
  compileFor(
    "base",
    "Arbitrum(() => { Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n).transfer(RECIPIENT, AMOUNT); }).reward({ tokens: [{ token: USDC, amount: AMOUNT }] });",
    { RECIPIENT: recipient, AMOUNT: 1_000_000n },
  ),
);
check(direct.calls.startsWith(word(token("arbitrum", "USDC"))), "one transfer, called directly");
check(!direct.calls.includes(" "), "and nothing else: no cook");

// ---- Inside a body, a bare token symbol names the token of the chain the file is compiled for,
// which is why the examples name the destination's tokens by address.
const bare = intentOf(
  compileFor(
    "base",
    "Arbitrum(() => { USDC.transfer(RECIPIENT, AMOUNT); }).reward({ tokens: [{ token: USDC, amount: AMOUNT }] });",
    { RECIPIENT: recipient, AMOUNT: 1_000_000n },
  ),
);
check(
  bare.calls.startsWith(word(token("base", "USDC"))),
  "a bare symbol in a body is the source's",
);
check(contracts.on("arbitrum").AaveV3.Pool.available, "Arbitrum has AaveV3.Pool");

// ---- Inside a body, a decoded result is read by position: destructuring is refused there, though
// it compiles at top level. When this changes, the skill's note goes with it.
const decodeIn = (statement: string) =>
  `Base(() => { const d = hex\`3850c7bd\`; ${statement} require(x != 0n); }, { tokens: [{ token: 0x4200000000000000000000000000000000000006n, amount: 1n }] }).reward({ tokens: [{ token: WETH, amount: 1n }] });`;
const refused = (source: string) => {
  try {
    compileFor("arbitrum", source, { RECIPIENT: recipient }, fee.base);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};
check(
  refused(decodeIn('const x = abi.decode(evm.static(RECIPIENT, d), ["Uint256"])[0n];')) === "",
  "a body reads a decoded result by position",
);
check(
  /Identifier 'x' has already been declared/.test(
    refused(decodeIn('const [x] = abi.decode(evm.static(RECIPIENT, d), ["Uint256"]);')),
  ),
  "a body cannot destructure one",
);

// ---- Rehearsing the swap-on-base body on a fork of Base: what the solver sends there.
const swapDefines = {
  AMOUNT_IN: 10n ** 18n,
  REWARD: 10n ** 18n + 10n ** 15n,
  SQRT_PRICE_LIMIT_X96: 3068493539683605256287027n,
  MIN_OUT: 0n,
  MIN_AVG_PRICE: 1_500_000_000n,
  RECIPIENT: recipient,
  REFUND_TO: recipient,
};
const { intent } = compileFor("arbitrum", swap, swapDefines, fee.base).intents[0]!;
// The Kitchen fee is the route's native amount: the solver pays it, in Base's native coin, as the
// value of fulfill. Nothing in the reward pays it back.
check(intent.route.nativeAmount === fee.base, "route.nativeAmount is Base's Kitchen fee");
// 1. The shared Pot: the Executor's at salt zero. Anyone may deploy it; no solver can fill first.
const executor = ecoRoutesExecutor("base");
const pot = destinationPot("base");
check(pot === v12PredictPot(executor, SAUCE_INTENT_POT_SALT), "the shared Pot is the Executor's");
const deployPot = routes.sauceEvmDeployPotCall({
  kitchen: v12GateKitchen(),
  owner: executor,
  salt: SAUCE_INTENT_POT_SALT,
});
check(
  getAddress(`0x${deployPot.target.slice(-40)}`) === getAddress(v12GateKitchen()),
  "the Pot's deploy is a call to the Kitchen",
);
// 2. The route's tokens: what the solver holds and approves to the Portal, which pulls them.
check(
  intent.route.tokens.length === 1 && intent.route.tokens[0]!.amount === 10n ** 18n,
  "the route's tokens are the delivered WETH",
);
// 3. fulfill(intentHash, route, rewardHash, claimant), the hashes as the Portal computes them
//    (its getIntentHash gives the same three).
const { intentHash, rewardHash } = routes.hashIntent(intent);
const [route] = decodeAbiParameters([routes.EVM_ROUTE_PARAM], routes.encodeRouteEvm(intent.route));
const solver = creator; // offline, any address stands in for the solver's
const claimant = `0x${"00".repeat(12)}${solver.slice(2)}` as Hex; // who the reward goes to
const fulfill = {
  to: ecoRoutesPortal("base"),
  value: intent.route.nativeAmount,
  data: encodeFunctionData({
    abi: PortalABI,
    functionName: "fulfill",
    args: [intentHash, route, rewardHash, claimant],
  }),
};
const decoded = decodeFunctionData({ abi: PortalABI, data: fulfill.data });
check(decoded.functionName === "fulfill" && decoded.args[0] === intentHash, "fulfill's calldata");
// The deadline and the fee are in the route, so either changes the intent and its hash: rebuild
// every transaction (and any unsigned one printed earlier) after changing one.
const rehashed = (deadlineShift: bigint, executionFee: bigint) =>
  routes.hashIntent(
    routes.compileSauceProgram("arbitrum", swap, {
      defines: swapDefines,
      intents: { deadline: deadline + deadlineShift, creator, executionFee },
    }).intents[0]!.intent,
  ).intentHash;
check(rehashed(0n, fee.base) === intentHash, "the same inputs give the same intent");
check(rehashed(1n, fee.base) !== intentHash, "a new deadline is a new intent");
check(rehashed(0n, fee.base + 1n) !== intentHash, "a new Kitchen fee is a new intent");

// Funding by transfer: the program reads the vault and publishes by the registry's selectors,
// with the same three arguments, and compiles for a source chain.
const byHand = readFileSync(new URL("./fund-by-transfer.sauce.ts", import.meta.url), "utf8");
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
    byHand.includes(`hex\`${selector.slice(2)}\``),
    `fund-by-transfer calls ${name}, ${selector}`,
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
const byHandProgram = routes.compileSauceProgram("base", byHand);
check(
  byHandProgram.entryParams.map((param) => param.name).join() === "portal,destination,route,reward",
  "fund-by-transfer takes the intent as publish's arguments",
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

// The one-pool swap body compiles as an intent to Base, with the delivery the solver brings.
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const onePool =
  /```sauce chain=arbitrum define=AMOUNT_IN,REWARD,SQRT_PRICE_LIMIT_X96,MIN_OUT,RECIPIENT,REFUND_TO\n([\s\S]*?)```/.exec(
    skill,
  );
check(onePool !== null, "the skill gives the one-pool body");
const onePoolIntent = routes.compileSauceProgram("arbitrum", onePool[1]!, {
  defines: { ...swapDefines, MIN_OUT: 1n },
  intents: { deadline, creator, executionFee: fee.base },
}).intents[0]!.intent;
check(
  onePoolIntent.route.nativeAmount === fee.base && onePoolIntent.route.tokens.length === 1,
  "the one-pool body is a program body: the Kitchen fee as nativeAmount, WETH delivered",
);

console.log(
  `rehearsal on a fork of Base: deploy the Pot ${pot} if it has no code, approve the Portal for ` +
    `the WETH, then fulfill ${intentHash.slice(0, 10)}… with value ${fulfill.value}`,
);
console.log(
  `cross-chain.sauce.ts on Base -> Arbitrum Portal ${ecoRoutesPortal("arbitrum")}, ` +
    `prover ${ecoRoutesProver("base", "arbitrum")}`,
);
console.log(
  `swap-on-base.sauce.ts on Arbitrum -> Base Portal ${ecoRoutesPortal("base")}, ` +
    `prover ${ecoRoutesProver("arbitrum", "base")}`,
);
console.log(`each destination fee is read at ${feeRead.to}`);
