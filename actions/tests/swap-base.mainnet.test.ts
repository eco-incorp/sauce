/**
 * `@sauce/router` on Base — Uniswap V2, Curve's 4pool (a StableSwap-NG pool) and WOOFi's WooPPV2 —
 * EXECUTED on Base state captured at its pinned block (`mainnet.ts`), through the released engine,
 * Kitchen, Pot and Router. No RPC is reached.
 *
 * The same checks as the Ethereum suite, on the venues Base has, and the `woofiSwap` action, which
 * only this suite can execute. `woofi` pushes to the WooPPV2 itself; the Router's WOOFi handler
 * only approves, which drives WooRouterV2 but not the pool, so the Router comparison here is the
 * WooRouterV2 one, and the swap is also held to the pool's own `query` — which is `quoteAction`'s.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAbi, type Address, type Hex } from "viem";

import { quoteAction } from "../src/index.js";
import type { WoofiSwapAction } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import {
  actionProgram,
  allowance,
  balanceOf,
  call,
  compileSource,
  deployToken,
  libraryCall,
  measure,
  printMeasurements,
  REVERTING_CODE,
  routerProgram,
  routerSource,
  runtimeCall,
  setBalance,
  type Arg,
  type RouterLeg,
} from "./swap-venues.js";

const CHAIN = "base";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CRVUSD = "0x417Ac0e078398C154EdFadD9Ef675d30Be60Af93";
const BALANCE = { [WETH]: { slot: 3n }, [USDC]: { slot: 9n } } as const;

/** Uniswap V2's WETH/USDC pair on Base (WETH is token0). */
const UNIV2_WETH_USDC = "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C";
/** Curve's 4pool: USDC, USDbC, axlUSDC, crvUSD — StableSwap-NG, int128 indices. */
const CURVE_4POOL = "0xf6C5F01C7F3148891ad0e19DF78743D31E390D1f";
/** WOOFi's WooPPV2 (quote token USDC), and the WooRouterV2 in front of it. */
const WOO_PP = "0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4";
const WOO_ROUTER = "0x4c4AF8DBc524681930a27b2F1Af5bcC8062E6fB7";

const WETH_IN = 10n ** 17n;
const USDC_IN = 1_000_000_000n;
const SELF = "self";

const wooPP = parseAbi([
  "function query(address fromToken, address toToken, uint256 fromAmount) view returns (uint256)",
  "function tokenInfos(address) view returns (uint192 reserve, uint16 feeRate, uint128 maxGamma, uint128 maxNotionalSwap)",
]);

type Typed = { readonly type: "address" | "uint256" | "bool"; readonly value: Arg };
const addr = (value: string): Typed => ({ type: "address", value });
const uint = (value: bigint): Typed => ({ type: "uint256", value });
const self: Typed = { type: "address", value: SELF };
const values = (args: readonly Typed[]): Arg[] => args.map((a) => a.value);

const v2 = (tokenIn: string, tokenOut: string, amount: bigint) => [
  addr(UNIV2_WETH_USDC),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  uint(0n),
  uint(0n),
  self,
];
const curve4pool = (amount: bigint, tokenIn = USDC) => [
  addr(CURVE_4POOL),
  addr(tokenIn),
  addr(CRVUSD),
  uint(amount),
  uint(0n),
  uint(3n),
  { type: "bool", value: false } as Typed,
  uint(0n),
  self,
];
const woofi = (tokenIn: string, tokenOut: string, amount: bigint, minOut: bigint) => [
  addr(WOO_PP),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  uint(minOut),
  self,
];
const woofiAction = (amount: bigint, minOut: bigint): WoofiSwapAction => ({
  type: "woofiSwap",
  amount: `${amount}`,
  pool: WOO_PP,
  tokenIn: WETH,
  tokenOut: USDC,
  amountOutMin: `${minOut}`,
  recipient: "self",
});

describe("@sauce/router on Base state", { skip: skipReason(), timeout: 600_000 }, () => {
  let env: Anvil;
  let snapshot: Hex;

  before(async () => {
    env = await startAnvil({ mainnet: "swap-base", chain: "base" });
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
  const query = (tokenIn: string, tokenOut: string, amount: bigint) =>
    env.publicClient.readContract({
      address: WOO_PP,
      abi: wooPP,
      functionName: "query",
      args: [tokenIn as Address, tokenOut as Address, amount],
    });
  const tokenInfo = (token: string) =>
    env.publicClient.readContract({
      address: WOO_PP,
      abi: wooPP,
      functionName: "tokenInfos",
      args: [token as Address],
    });

  /** The library call, literal and run-time, the action and the Router: one amount, all of it spent. */
  async function everyWay(
    venue: string,
    name: string,
    args: readonly Typed[],
    funding: [keyof typeof BALANCE, bigint],
    tokenOut: string,
    action?: Parameters<typeof actionProgram>[1][number],
    router?: RouterLeg,
  ): Promise<bigint> {
    const delivered = () => balanceOf(env, tokenOut, env.pot);
    const programs: Array<[Parameters<typeof measure>[2], Uint8Array]> = [
      ["library", libraryCall(env, CHAIN, name, values(args))],
      ["runtime", runtimeCall(name, args)],
    ];
    if (action) programs.push(["action", actionProgram(8453, [action])]);
    if (router) programs.push(["router", compileSource(env, CHAIN, routerSource(router))]);

    const outs: bigint[] = [];
    for (const [path, program] of programs) {
      await fresh();
      await fund(...funding);
      const { out } = await measure(env, venue, path, program, delivered);
      assert.equal(await balanceOf(env, funding[0], env.pot), 0n, `${venue} ${path}: input left`);
      outs.push(out);
    }
    assert.ok(outs[0]! > 0n);
    for (const [i, out] of outs.entries()) {
      assert.equal(out, outs[0], `${venue}: ${programs[i]![0]} delivered a different amount`);
    }

    return outs[0]!;
  }

  // WOOFi first: its oracle goes stale 120 seconds after its last post, and every test mines blocks.
  describe("WOOFi (WooPPV2)", () => {
    it("WETH -> USDC delivers the pool's own quote, the action's, and what WooRouterV2 delivers", async () => {
      const quoted = await query(WETH, USDC, WETH_IN);
      // quoteAction prices the action with the pool's own query.
      const { to, data, decode } = quoteAction(woofiAction(WETH_IN, 1n));
      const { data: result } = await env.publicClient.call({ to, data });
      assert.equal(decode(result!), quoted);
      const out = await everyWay(
        "WOOFi WETH->USDC, 0.1 WETH (Router via WooRouterV2)",
        "woofi",
        woofi(WETH, USDC, WETH_IN, 1n),
        [WETH, WETH_IN],
        USDC,
        woofiAction(WETH_IN, 1n),
        { poolType: 8, pool: WOO_ROUTER, tokenIn: WETH, tokenOut: USDC, amountIn: WETH_IN },
      );
      assert.equal(out, quoted);
    });

    it("USDC -> WETH (selling the quote token) delivers the pool's own quote", async () => {
      const quoted = await query(USDC, WETH, USDC_IN);
      await fund(USDC, USDC_IN);
      const { out } = await measure(
        env,
        "WOOFi USDC->WETH, 1000 USDC",
        "library",
        libraryCall(env, CHAIN, "woofi", values(woofi(USDC, WETH, USDC_IN, 1n))),
        () => balanceOf(env, WETH, env.pot),
      );
      assert.equal(out, quoted);
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
    });

    it("the Router's WOOFi handler cannot drive the WooPPV2: it approves, and the pool wants a push", async () => {
      await fund(WETH, WETH_IN);
      const router = routerSource({
        poolType: 8,
        pool: WOO_PP,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: WETH_IN,
      });
      assert.equal((await cook(router)).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), WETH_IN);
    });

    it("the pool books exactly what was pushed: nothing is left beside its reserve", async () => {
      const [balance, [reserve]] = [await balanceOf(env, WETH, WOO_PP), await tokenInfo(WETH)];
      await fund(WETH, WETH_IN);
      assert.equal((await cookCall("woofi", woofi(WETH, USDC, WETH_IN, 1n))).status, "success");
      assert.equal(await balanceOf(env, WETH, WOO_PP), balance + WETH_IN);
      assert.equal((await tokenInfo(WETH))[0], reserve + WETH_IN, "booked exactly the push");
    });

    it("an input past the pool's reserve and notional cap reverts the whole cook, the Pot unchanged", async () => {
      const amount = 100n * 10n ** 18n;
      const before = await balanceOf(env, WETH, WOO_PP);
      await fund(WETH, amount);
      assert.equal((await cookCall("woofi", woofi(WETH, USDC, amount, 1n))).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), amount, "nothing moved");
      assert.equal(await balanceOf(env, WETH, WOO_PP), before);
    });

    it("a floor above the pool's quote reverts the whole cook: the pool enforces it", async () => {
      const quoted = await query(WETH, USDC, WETH_IN);
      await fund(WETH, WETH_IN);
      assert.equal(
        (await cookCall("woofi", woofi(WETH, USDC, WETH_IN, quoted + 1n))).status,
        "reverted",
      );
      assert.equal(await balanceOf(env, WETH, env.pot), WETH_IN);
      await fresh();
      await fund(WETH, WETH_IN);
      assert.equal((await cookCall("woofi", woofi(WETH, USDC, WETH_IN, quoted))).status, "success");
    });

    it("a floor of zero is refused: the pool prices from an oracle", async () => {
      await fund(WETH, WETH_IN);
      assert.equal((await cookCall("woofi", woofi(WETH, USDC, WETH_IN, 0n))).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), WETH_IN, "nothing moved");
    });
  });

  describe("Uniswap V2", () => {
    it("WETH -> USDC (WETH is token0): every spelling, and the Router, deliver the same", async () => {
      await everyWay(
        "UniV2 WETH->USDC, 0.1 WETH",
        "uniswapV2",
        v2(WETH, USDC, WETH_IN),
        [WETH, WETH_IN],
        USDC,
        undefined,
        { poolType: 0, pool: UNIV2_WETH_USDC, tokenIn: WETH, tokenOut: USDC, amountIn: WETH_IN },
      );
    });

    it("USDC -> WETH", async () => {
      await everyWay(
        "UniV2 USDC->WETH, 1000 USDC",
        "uniswapV2",
        v2(USDC, WETH, USDC_IN),
        [USDC, USDC_IN],
        WETH,
        undefined,
        { poolType: 0, pool: UNIV2_WETH_USDC, tokenIn: USDC, tokenOut: WETH, amountIn: USDC_IN },
      );
    });
  });

  describe("Curve 4pool (StableSwap-NG)", () => {
    it("USDC -> crvUSD: every spelling, and the Router, deliver the same, approval ending at zero", async () => {
      await everyWay(
        "Curve 4pool USDC->crvUSD, 1000 USDC",
        "curve",
        curve4pool(USDC_IN),
        [USDC, USDC_IN],
        CRVUSD,
        undefined,
        { poolType: 3, pool: CURVE_4POOL, tokenIn: USDC, tokenOut: CRVUSD, amountIn: USDC_IN },
      );
      assert.equal(await allowance(env, USDC, env.pot, CURVE_4POOL), 0n);
    });
  });

  it("a false-returning token reverts every venue's swap before its pool is touched", async () => {
    const liar = await deployToken(env, "FalseReturnERC20", env.pot, 10n ** 24n);
    const calls: Array<[string, Typed[]]> = [
      ["uniswapV2", v2(liar, USDC, WETH_IN)],
      ["curve", curve4pool(USDC_IN, liar)],
      ["woofi", woofi(liar, USDC, WETH_IN, 1n)],
    ];
    for (const [name, args] of calls) {
      assert.equal((await cookCall(name, args)).status, "reverted", name);
      assert.equal(await balanceOf(env, liar, env.pot), 10n ** 24n);
    }
  });

  it("a Pot whose Router has none of these venues still runs them: none calls the Router", async () => {
    await env.testClient.setCode({ address: env.router, bytecode: REVERTING_CODE });
    await fund(WETH, 2n * WETH_IN);
    await fund(USDC, USDC_IN);
    const receipt = await cook(
      routerProgram([
        call("woofi", values(woofi(WETH, USDC, WETH_IN, 1n))),
        call("uniswapV2", values(v2(WETH, USDC, WETH_IN))),
        call("curve", values(curve4pool(USDC_IN))),
      ]),
    );
    assert.equal(receipt.status, "success");
    assert.ok((await balanceOf(env, CRVUSD, env.pot)) > 0n);
    assert.equal(await balanceOf(env, WETH, env.pot), 0n);
  });
});
