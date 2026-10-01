// Compiles the two intent files the way `sauce run` and `sauce compile` do
// (`routes.compileSauceProgram` with the intent settings), and checks on which chain each name
// resolves: the body and its delivery on the destination, the reward on the source. Each child's
// Portal and prover come from the eco-routes registry; the deadline, the creator, the recipient and
// each destination Kitchen's fee are the developer's. Offline: nothing is sent.
//
//   node intents.mts --creator <address> --recipient <address> --arbitrum-fee <wei> --base-fee <wei>
//
// Each fee is that chain's Kitchen executionFee(), read there just before sending with
// destinationExecutionFee(); it is compiled into the child's cook.
import { readFileSync } from "node:fs";

import { contracts, destinationExecutionFee, routes } from "@eco-incorp/sauce";
import { ecoRoutesPortal, ecoRoutesProver } from "@eco-incorp/sauce/protocols/eco-routes";
import { getAddress } from "viem";

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

// ---- A token-only child is plain route calls for the destination's Executor: no Pot, no fee.
// Inside the body, and in the delivery, a token symbol is the destination's: `USDC` here is
// Arbitrum's, while the one in `.reward(...)` is Base's, which the program escrows.
const direct = intentOf(
  compileFor(
    "base",
    "Arbitrum(() => { USDC.transfer(RECIPIENT, AMOUNT); }).reward({ tokens: [{ token: USDC, amount: AMOUNT }] });",
    { RECIPIENT: recipient, AMOUNT: 1_000_000n },
  ),
);
check(direct.calls.startsWith(word(token("arbitrum", "USDC"))), "Arbitrum's USDC, called directly");
check(!direct.calls.includes(" "), "and nothing else: no cook");
check(direct.rewarded.join() === word(token("base", "USDC")), "the reward is Base's USDC");
check(contracts.on("arbitrum").AaveV3.Pool.available, "Arbitrum has AaveV3.Pool");

console.log(
  `cross-chain.sauce.ts on Base -> Arbitrum Portal ${ecoRoutesPortal("arbitrum")}, ` +
    `prover ${ecoRoutesProver("base", "arbitrum")}`,
);
console.log(
  `swap-on-base.sauce.ts on Arbitrum -> Base Portal ${ecoRoutesPortal("base")}, ` +
    `prover ${ecoRoutesProver("arbitrum", "base")}`,
);
console.log(`each destination fee is read at ${feeRead.to}`);
