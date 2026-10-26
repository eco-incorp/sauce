/**
 * `@sauce/router`'s Trader Joe Liquidity Book swap on Avalanche, EXECUTED on Avalanche C-Chain state
 * captured at its pinned block (`mainnet.ts`), through the released engine, Kitchen, Pot and Router.
 * No RPC is reached. The `traderJoeLBSwap` action, which only this suite can execute, runs here too,
 * and its quote is held to what the swap delivers.
 *
 * Two LB v2.2 WAVAX/USDC pairs (X is WAVAX): a deep one at bin step 10, for the Router comparison,
 * and a thin one at bin step 25 holding one unit of USDC, which cannot absorb a single WAVAX — so a
 * swap that pushes into it must revert the whole cook, and `tryTraderJoeLB` must not push at all.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Hex } from "viem";

import { quoteAction } from "../src/index.js";
import type { TraderJoeLBSwapAction } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import {
  actionProgram,
  assertReverts,
  assertSkips,
  balanceOf,
  call,
  compileSource,
  deployToken,
  libraryAbi,
  libraryCall,
  measure,
  printMeasurements,
  REVERTING_CODE,
  routerProgram,
  runtimeCall,
  setBalance,
  type Arg,
} from "./swap-venues.js";

const CHAIN = "avalanche";

const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const BALANCE = { [WAVAX]: { slot: 3n }, [USDC]: { slot: 9n } } as const;

/** LB v2.2 WAVAX/USDC pairs from the LBFactory: bin step 10 (deep) and bin step 25 (one unit of Y). */
const LB_DEEP = "0x864d4e5Ee7318e97483DB7EB0912E09F161516EA";
const LB_THIN = "0xE52BeDE8CFd7C5C8894c8616E49Fb25811c97367";
/** An address with no code. */
const CODELESS = "0x00000000000000000000000000000000DeaDBeef";

const ONE_AVAX = 10n ** 18n;
const USDC_100 = 100_000_000n;
const POT = "pot";

type Typed = { readonly type: "address" | "uint256" | "bool"; readonly value: Arg };
const addr = (value: string): Typed => ({ type: "address", value });
const uint = (value: bigint): Typed => ({ type: "uint256", value });
const pot: Typed = { type: "address", value: POT };
const values = (args: readonly Typed[]): Arg[] => args.map((a) => a.value);

/** `traderJoeLB`'s arguments: X is WAVAX, Y is USDC, unless a test names others. */
const lb = (
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  { pool = LB_DEEP, minOut = 0n, tokenX = WAVAX, tokenY = USDC } = {},
) => [
  addr(pool),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  addr(tokenX),
  addr(tokenY),
  uint(minOut),
  pot,
];
const lbAction = (tokenIn: Hex, tokenOut: Hex, amount: bigint): TraderJoeLBSwapAction => ({
  type: "traderJoeLBSwap",
  amount: `${amount}`,
  pool: LB_DEEP,
  tokenIn,
  tokenOut,
  tokenX: WAVAX,
  tokenY: USDC,
  amountOutMin: "1",
  recipient: "pot",
});

describe("@sauce/router on Avalanche state", { skip: skipReason(), timeout: 600_000 }, () => {
  let env: Anvil;
  let snapshot: Hex;

  before(async () => {
    env = await startAnvil({ mainnet: "swap-avalanche", chain: "avalanche" });
  });
  after(async () => {
    printMeasurements(CHAIN);
    await env?.stop();
  });
  beforeEach(async () => {
    snapshot = await env.testClient.snapshot();
  });
  afterEach(async () => {
    await env.testClient.revert({ id: snapshot });
  });

  const fund = (token: keyof typeof BALANCE, amount: bigint) =>
    setBalance(env, token, BALANCE[token], env.pot, amount);
  const fresh = async () => {
    await env.testClient.revert({ id: snapshot });
    snapshot = await env.testClient.snapshot();
  };
  const cook = (source: string) => env.cook(compileSource(env, CHAIN, source));
  const cookCall = (name: string, args: readonly Typed[]) =>
    cook(routerProgram([call(name, values(args))]));

  /** The library call, literal and run-time, and the action: one amount, all of it spent. */
  async function everyWay(
    venue: string,
    tokenIn: keyof typeof BALANCE,
    tokenOut: string,
    amountIn: bigint,
  ): Promise<bigint> {
    const delivered = () => balanceOf(env, tokenOut, env.pot);
    const args = lb(tokenIn, tokenOut, amountIn);
    const programs: Array<[Parameters<typeof measure>[2], Uint8Array]> = [
      ["library", libraryCall(env, CHAIN, "traderJoeLB", values(args))],
      ["runtime", runtimeCall("traderJoeLB", args)],
      ["action", actionProgram(43114, [lbAction(tokenIn as Hex, tokenOut as Hex, amountIn)])],
    ];
    const outs: bigint[] = [];
    for (const [path, program] of programs) {
      await fresh();
      await fund(tokenIn, amountIn);
      const { out } = await measure(env, venue, path, program, delivered);
      assert.equal(await balanceOf(env, tokenIn, env.pot), 0n, `${venue} ${path}: input left`);
      outs.push(out);
    }
    assert.ok(outs[0]! > 0n);
    for (const [i, out] of outs.entries()) {
      assert.equal(out, outs[0], `${venue}: ${programs[i]![0]} delivered a different amount`);
    }

    return outs[0]!;
  }

  /** The action's quote, sent as its `eth_call` on the snapshot's state. */
  async function quoted(tokenIn: string, tokenOut: string, amount: bigint): Promise<bigint> {
    const { to, data, decode } = quoteAction(lbAction(tokenIn as Hex, tokenOut as Hex, amount));
    const { data: result } = await env.publicClient.call({ to, data });

    return decode(result!);
  }

  it("WAVAX -> USDC (swapForY): every spelling delivers the action's quote", async () => {
    const quote = await quoted(WAVAX, USDC, ONE_AVAX);
    const out = await everyWay("TraderJoeLB WAVAX->USDC, 1 WAVAX", WAVAX, USDC, ONE_AVAX);
    assert.equal(out, quote);
  });

  it("USDC -> WAVAX (swapForX)", async () => {
    const quote = await quoted(USDC, WAVAX, USDC_100);
    const out = await everyWay("TraderJoeLB USDC->WAVAX, 100 USDC", USDC, WAVAX, USDC_100);
    assert.equal(out, quote);
  });

  it("the swap returns the lane it received: a floor one above it reverts the whole cook", async () => {
    await fund(WAVAX, ONE_AVAX);
    assert.equal((await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX))).status, "success");
    const out = await balanceOf(env, USDC, env.pot);
    await fresh();
    await fund(WAVAX, ONE_AVAX);
    assert.equal(
      (await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX, { minOut: out + 1n }))).status,
      "reverted",
    );
    assert.equal(await balanceOf(env, WAVAX, env.pot), ONE_AVAX);
    await fresh();
    await fund(WAVAX, ONE_AVAX);
    assert.equal(
      (await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX, { minOut: out }))).status,
      "success",
    );
    assert.equal(await balanceOf(env, USDC, env.pot), out);
  });

  it("an input the pair cannot absorb reverts the whole cook (LBPair__OutOfLiquidity), the Pot unchanged", async () => {
    const before = await balanceOf(env, WAVAX, LB_THIN);
    await fund(WAVAX, ONE_AVAX);
    assert.equal(
      (await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX, { pool: LB_THIN }))).status,
      "reverted",
    );
    assert.equal(await balanceOf(env, WAVAX, env.pot), ONE_AVAX, "nothing moved");
    assert.equal(await balanceOf(env, WAVAX, LB_THIN), before);
  });

  it("a trade that is not between the X and Y tokens it names reverts before anything moves", async () => {
    await fund(WAVAX, ONE_AVAX);
    // WAVAX for USDC, at a pair the call says holds WAVAX and some other token.
    const other = "0x0000000000000000000000000000000000000001";
    assert.equal(
      (await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX, { tokenY: other }))).status,
      "reverted",
    );
    assert.equal(await balanceOf(env, WAVAX, env.pot), ONE_AVAX, "nothing moved");
  });

  it("and the pair itself reverts the wrong swapForY (LBPair__InsufficientAmountIn), so it cannot donate", async () => {
    const wrong = [
      'import { transfer } from "@sauce/token";',
      "function main() {",
      `  transfer(${BigInt(WAVAX)}n, ${BigInt(LB_DEEP)}n, ${ONE_AVAX}n);`,
      `  LBPair.at(${BigInt(LB_DEEP)}n).swap(false, ctx.self());`,
      "}",
    ].join("\n");
    await fund(WAVAX, ONE_AVAX);
    const program = compileSource(env, CHAIN, wrong, { LBPair: libraryAbi("lb-pair.abi.json") });
    assert.equal((await env.cook(program)).status, "reverted");
    assert.equal(await balanceOf(env, WAVAX, env.pot), ONE_AVAX);
  });

  it("tryTraderJoeLB: getSwapOut says the thin pair would leave input over, so nothing is pushed and 0 returned; the deep one runs", async () => {
    await fund(WAVAX, 2n * ONE_AVAX);
    const receipt = await cook(
      routerProgram([
        `const skipped = ${call("tryTraderJoeLB", values(lb(WAVAX, USDC, ONE_AVAX, { pool: LB_THIN })))};`,
        "require(skipped == 0n);",
        `const ran = ${call("tryTraderJoeLB", values(lb(WAVAX, USDC, ONE_AVAX)))};`,
        "require(ran > 0n);",
      ]),
    );
    assert.equal(receipt.status, "success");
    assert.equal(await balanceOf(env, WAVAX, env.pot), ONE_AVAX, "the thin one was skipped");
    const out = await balanceOf(env, USDC, env.pot);
    assert.ok(out > 0n, "the deep one ran");
    await fresh();
    await fund(WAVAX, ONE_AVAX);
    assert.equal((await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX))).status, "success");
    assert.equal(await balanceOf(env, USDC, env.pot), out, "the same output as traderJoeLB");
  });

  it("tryTraderJoeLB skips a pair with no code, moving nothing; a contract that has code and is no pair still reverts", async () => {
    await fund(WAVAX, ONE_AVAX);
    // The Pot's and the address's WAVAX and USDC, which neither call may move.
    const watch = [WAVAX, USDC].flatMap((t) => [
      [t, env.pot] as const,
      [t, CODELESS] as const,
      [t, USDC] as const,
    ]);
    const args = values(lb(WAVAX, USDC, ONE_AVAX, { pool: CODELESS }));
    await assertSkips(env, CHAIN, "tryTraderJoeLB", args, watch);
    // The check is for code, not for a pair: USDC has code and answers no `getSwapOut`.
    const notPair = values(lb(WAVAX, USDC, ONE_AVAX, { pool: USDC }));
    await assertReverts(env, CHAIN, "tryTraderJoeLB", notPair, watch);
  });

  it("the action's quote of an input the pair cannot fully take is zero", async () => {
    const { to, data, decode } = quoteAction({
      ...lbAction(WAVAX, USDC, ONE_AVAX),
      pool: LB_THIN,
    } as TraderJoeLBSwapAction);
    const { data: result } = await env.publicClient.call({ to, data });
    assert.equal(decode(result!), 0n);
  });

  it("a false-returning token reverts the swap before the pair is touched", async () => {
    const liar = await deployToken(env, "FalseReturnERC20", env.pot, 10n ** 24n);
    assert.equal(
      (await cookCall("traderJoeLB", lb(liar, USDC, ONE_AVAX, { tokenX: liar }))).status,
      "reverted",
    );
    assert.equal(await balanceOf(env, liar, env.pot), 10n ** 24n);
  });

  it("a Pot whose Router has no LB venue still runs the swap: it calls no Router", async () => {
    await env.testClient.setCode({ address: env.router, bytecode: REVERTING_CODE });
    await fund(WAVAX, ONE_AVAX);
    assert.equal((await cookCall("traderJoeLB", lb(WAVAX, USDC, ONE_AVAX))).status, "success");
    assert.ok((await balanceOf(env, USDC, env.pot)) > 0n);
  });
});
