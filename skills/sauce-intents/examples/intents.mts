// Compiles the two intent files the way `sauce run` and `sauce intent publish --args` do
// (`routes.compileSauceProgram` with the intent settings, and main's arguments bound into the
// intents where a wallet publishes them), and checks on which chain each name
// resolves: the body and its delivery on the destination, the reward on the source. Each child's
// Portal and prover come from the eco-routes registry; the refund address, the recipient and each
// destination Kitchen's fee are given here, and a salt fixed so each compile builds one intent. Pins
// the defaults the skill states, that every intent a program opens names its refundee, and its
// modifiers example. Then builds what rehearsing the swap-on-base body on a
// fork of Base sends: the shared Pot's deploy, and the Portal's fulfill with the Kitchen fee as its
// value. Pins the funding by transfer (fund-by-transfer.sauce.ts) and the Portal
// reference (references/portal.md) to the registry's Portal ABI. Offline: nothing is sent.
//
//   node intents.mts --refundee <address> --recipient <address> --ethereum-fee <wei> --base-fee <wei>
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
  v12PredictPot,
} from "@eco-incorp/sauce";
import { v12KitchenAddress } from "@eco-incorp/sauce/deployments";
import {
  ecoRoutesExecutor,
  ecoRoutesPortal,
  ecoRoutesProver,
  PortalABI,
} from "@eco-incorp/sauce/protocols/eco-routes";
import {
  bytesToHex,
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

const creator = getAddress(flag("refundee")); // the refund address: may reclaim an unearned reward
const salt = `0x${"5a".repeat(32)}` as const; // random unless given, as the command picks it
const recipient = getAddress(flag("recipient"));
const fee = { ethereum: BigInt(flag("ethereum-fee")), base: BigInt(flag("base-fee")) };
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // filled within the hour or not at all
const feeRead = destinationExecutionFee(); // { to, data, decode }: eth_call it on each destination

/** `source` compiled for `slug`: with `args`, main's arguments bound into the intents it opens, as
 *  `sauce intent publish --args` binds them, the wallet publishing them; without, main takes them as
 *  it runs, on a Pot. */
const compileFor = (
  slug: string,
  source: string,
  args?: readonly (bigint | string)[],
  executionFee?: bigint,
) =>
  routes.compileSauceProgram(slug, source, {
    ...(args === undefined ? {} : { args }),
    intents: {
      deadline,
      salt,
      ...(args === undefined ? {} : { publisher: creator }),
      ...(executionFee === undefined ? {} : { executionFee }),
    },
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

// ---- cross-chain.sauce.ts: from Base, a program child on Ethereum, run on a Pot.
const forward = readFileSync(new URL("./cross-chain.sauce.ts", import.meta.url), "utf8");
check(
  /function main\(beneficiary: Address, refundTo: Address\)/.test(forward),
  "its inputs are main's parameters",
);
let missingFee = "";
try {
  compileFor("base", forward);
} catch (error) {
  missingFee = (error as Error).message;
}
check(missingFee.includes(".fee("), "a program child needs the destination's Kitchen fee");
const forwardedProgram = compileFor("base", forward, undefined, fee.ethereum);
check(
  forwardedProgram.entryParams.map((param) => param.name).join() === "beneficiary,refundTo",
  "run on a Pot, main takes the beneficiary and the refund address as it runs",
);
check(
  forwardedProgram.intents[0]!.captures.includes("beneficiary"),
  "and the program writes it into the intent it opens",
);
const forwarded = intentOf(forwardedProgram);
check(
  forwarded.delivered.join() === word(token("ethereum", "USDC")),
  "the solver delivers Ethereum's USDC",
);
check(forwarded.calls.includes(word(contract("ethereum", "AaveV3_Pool"))), "Ethereum's Aave pool");
check(!forwarded.calls.includes(word(contract("base", "AaveV3_Pool"))), "and not Base's");
check(forwarded.rewarded.join() === word(token("base", "USDC")), "the reward is Base's USDC");

// ---- The defaults the skill states, for an intent that sets none: the fill deadline 5 minutes
// after it opens (when the command builds it: `openedAt`), the reward's 7 days after that, a random
// salt and the registry's prover. The refundee has none: the file names `refundTo`.
const openedAt = BigInt(Math.floor(Date.now() / 1000));
const opened = () =>
  routes.compileSauceProgram("base", forward, {
    intents: { openedAt, executionFee: fee.ethereum },
  }).intents[0]!;
const defaulted = opened().intent;
const addressOf = (word32: string) => getAddress(`0x${word32.slice(-40)}`);
check(
  defaulted.route.deadline === openedAt + 300n,
  "the fill deadline is 5 minutes after it opens",
);
check(
  defaulted.reward.deadline === defaulted.route.deadline + 7n * 86400n,
  "the reward's deadline is 7 days after the fill deadline",
);
check(/^0x[0-9a-f]{64}$/.test(defaulted.route.salt), "the salt is 32 bytes");
check(opened().intent.route.salt !== defaulted.route.salt, "picked at random for each build");
check(
  addressOf(defaulted.reward.prover) === getAddress(ecoRoutesProver("base", "ethereum")),
  "the prover is the registry's",
);
check(opened().captures.includes("refundTo"), "the refundee is `refundTo`, main's argument");
let unnamed = "";
try {
  routes.compileSauceProgram("base", forward.replace("    .refundee(refundTo)\n", ""), {
    intents: { openedAt, executionFee: fee.ethereum },
  });
} catch (error) {
  unnamed = (error as Error).message;
}
check(
  unnamed.includes("needs `.refundee(<address>)`") && unnamed.includes("may be shared"),
  "an intent a program opens with no refundee is refused",
);

// ---- swap-on-base.sauce.ts: from Ethereum, the distributed swap as a program child on Base,
// published from a wallet: main's arguments bound into it.
const swap = readFileSync(new URL("./swap-on-base.sauce.ts", import.meta.url), "utf8");
const swapArgs = [
  10n ** 18n, // amountIn
  10n ** 18n + 10n ** 15n, // reward
  3068493539683605256287027n, // sqrtPriceLimitX96: 1,500 USDC per WETH on Base
  0n, // minOut
  1_500_000_000n, // minAvgPrice
  recipient,
  recipient, // refundTo
];
const swapProgram = compileFor("ethereum", swap, swapArgs, fee.base);
check(swapProgram.entryParams.length === 0, "bound, main takes nothing more");
check(
  swapProgram.intents[0]!.captures.length === 0,
  "and the intent is fixed: a wallet publishes it",
);
const swapped = intentOf(swapProgram);
check(swapped.delivered.join() === word(token("base", "WETH")), "the solver delivers Base's WETH");
for (const [what, value] of [
  ["Base's USDC", token("base", "USDC")],
  ["Base's Uniswap V3 factory", contract("base", "UniswapV3_Factory")],
  ["Base's Uniswap V4 PoolManager", contract("base", "UniswapV4_PoolManager")],
  ["Base's Uniswap V4 StateView", contract("base", "UniswapV4_StateView")],
] as const) {
  check(swapped.calls.includes(word(value)), `the child uses ${what}`);
}
check(swapped.rewarded.join() === word(token("ethereum", "WETH")), "the reward is Ethereum's WETH");
// The body swaps through @sauce/router and reads each V3 pool through the `UniswapV3.Pool`
// namespace, whose ABI is the registry's: three view functions the pool dispatches, by these
// selectors, which the child carries, and no raw selector of its own.
for (const [signature, selector] of [
  ["slot0()", "3850c7bd"],
  ["liquidity()", "1a686502"],
  ["fee()", "ddca3f43"],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
  check(swapped.calls.includes(selector), `the child calls ${signature} on a pool`);
}
check(/UniswapV3\.Pool\(pool\)/.test(swap), "the body reads a pool through UniswapV3.Pool");
check(!/hex`[0-9a-f]{8}`/.test(swap), "and calls no raw selector");
check(
  /import \{ uniswapV3, uniswapV4 \} from "@sauce\/router"/.test(swap),
  "the body swaps through @sauce/router",
);

// ---- A token-only child is plain route calls for the destination's Executor: no Pot, no fee.
// Inside the body, and in the delivery, a token symbol is the destination's: `USDC` here is
// Ethereum's, while the one in `.send(...)` is Base's, which the program escrows.
const direct = intentOf(
  compileFor(
    "base",
    "function main(to: Address, amount: Uint256) { Ethereum.Portal.send({ token: USDC, amount }).refundee(to).receive({ token: USDC, amount }).then(() => { USDC.transfer(to, amount); }); }",
    [recipient, 1_000_000n],
  ),
);
check(direct.calls.startsWith(word(token("ethereum", "USDC"))), "Ethereum's USDC, called directly");
check(!direct.calls.includes(" "), "and nothing else: no cook");
check(direct.rewarded.join() === word(token("base", "USDC")), "the reward is Base's USDC");
check(contracts.on("ethereum").AaveV3.Pool.available, "Ethereum has AaveV3.Pool");

// ---- Inside a body, a decoded result is read by position or destructured, as anywhere else.
const decodeIn = (statement: string) =>
  `function main(pool: Address) { Base.Portal.send({ token: WETH, amount: 1 }).refundee(${creator}).receive({ token: 0x4200000000000000000000000000000000000006, amount: 1 }).then(() => { const d = hex\`3850c7bd\`; ${statement} require(x != 0); }); }`;
const refused = (source: string) => {
  try {
    compileFor("ethereum", source, [recipient], fee.base);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};
check(
  refused(decodeIn('const x = abi.decode(evm.static(pool, d), ["Uint256"])[0];')) === "",
  "a body reads a decoded result by position",
);
check(
  refused(decodeIn('const [x] = abi.decode(evm.static(pool, d), ["Uint256"]);')) === "",
  "and destructures one, as anywhere else",
);

// ---- Rehearsing the swap-on-base body on a fork of Base: what the solver sends there.
const { intent } = swapProgram.intents[0]!;
// The Kitchen fee is the route's native amount: the solver pays it, in Base's native coin, as the
// value of fulfill. Nothing in the reward pays it back.
check(intent.route.nativeAmount === fee.base, "route.nativeAmount is Base's Kitchen fee");
// 1. The shared Pot: the Executor's at salt zero. Anyone may deploy it; no solver can fill first.
const executor = ecoRoutesExecutor("base");
const pot = destinationPot("base");
check(pot === v12PredictPot(executor, SAUCE_INTENT_POT_SALT), "the shared Pot is the Executor's");
const deployPot = routes.sauceEvmDeployPotCall({ owner: executor, salt: SAUCE_INTENT_POT_SALT });
check(
  getAddress(`0x${deployPot.target.slice(-40)}`) === getAddress(v12KitchenAddress()),
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
    routes.compileSauceProgram("ethereum", swap, {
      args: swapArgs,
      intents: { deadline: deadline + deadlineShift, salt, executionFee },
    }).intents[0]!.intent,
  ).intentHash;
check(rehashed(0n, fee.base) === intentHash, "the same inputs give the same intent");
check(rehashed(1n, fee.base) !== intentHash, "a new deadline is a new intent");
check(rehashed(0n, fee.base + 1n) !== intentHash, "a new Kitchen fee is a new intent");

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

// The one-pool swap body compiles as an intent to Base, with the delivery the solver brings.
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const onePool = /```sauce chain=ethereum\n(import \{ uniswapV3 \}[\s\S]*?)```/.exec(skill);
check(onePool !== null, "the skill gives the one-pool body");
const onePoolIntent = routes.compileSauceProgram("ethereum", onePool[1]!, {
  // amountIn, reward, sqrtPriceLimitX96, minOut, recipient, refundTo
  args: [10n ** 18n, 10n ** 18n + 10n ** 15n, 3068493539683605256287027n, 1n, recipient, recipient],
  intents: { deadline, salt, executionFee: fee.base },
}).intents[0]!.intent;
check(
  onePoolIntent.route.nativeAmount === fee.base && onePoolIntent.route.tokens.length === 1,
  "the one-pool body is a program body: the Kitchen fee as nativeAmount, WETH delivered",
);

// The modifiers example: its refundee is main's argument, bound like the amounts, but its deadlines
// are read as the program runs, so the intent is not fixed and no wallet publishes it.
const modifiers =
  /```sauce chain=base\n(function main\([^`]*?\.deadline\(ctx\.timestamp\(\) \+ 1800\)[^`]*)```/.exec(
    skill,
  );
check(modifiers !== null, "the skill gives the modifiers example");
const [modified] = routes.compileSauceProgram("base", modifiers[1]!, {
  args: [recipient, 1_000_000n, 1_100_000n, creator],
}).intents;
check(
  addressOf(modified!.intent.reward.creator) === creator,
  "`.refundee(refundTo)` is the reward's creator",
);
check(
  modified!.captures.join() === "the route's `.deadline(...)`,the reward's `.deadline(...)`",
  "both deadlines are computed as the program runs",
);

console.log(
  `rehearsal on a fork of Base: deploy the Pot ${pot} if it has no code, approve the Portal for ` +
    `the WETH, then fulfill ${intentHash.slice(0, 10)}… with value ${fulfill.value}`,
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
