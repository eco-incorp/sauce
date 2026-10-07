/**
 * `@sauce/router` on Base — Uniswap V2, Curve's 4pool (a StableSwap-NG pool), WOOFi's WooPPV2 and
 * PancakeSwap Infinity's CL and bin pools — EXECUTED on Base state captured at its pinned block
 * (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * The same checks as the Ethereum suite, on the venues Base has, and the `woofiSwap` action, which
 * only this suite can execute. `woofi` pushes to WooPPV2 itself, and the swap is held to the pool's
 * own `query`, which is `quoteAction`'s. Infinity is reached through the Pot's Router, which locks
 * the Infinity Vault; its pools are hookless ones the Vault holds real liquidity for: USDC/USDT CL
 * and bin pools, and the native ETH/USDC CL pool, which the Pot pays and is paid in ETH.
 *
 * Every `try` form here — `tryWoofi`, `tryInfinityCL`, `tryInfinityBin` — returns exactly what its
 * plain function returns on the same state, and each way it skips returns 0 with the Pot's and the
 * pool's balances untouched.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, pad, parseAbi, toHex, type Address, type Hex } from "viem";

import { quoteAction } from "../src/index.js";
import type { WoofiSwapAction } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import {
  actionProgram,
  allowance,
  assertReverts,
  assertSkips,
  balanceOf,
  call,
  compileSource,
  deployToken,
  held,
  libraryAbi,
  libraryCall,
  measure,
  NATIVE,
  printMeasurements,
  returning,
  REVERTING_CODE,
  routerProgram,
  runtimeCall,
  setBalance,
  type Arg,
} from "./swap-venues.js";

const CHAIN = "base";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CRVUSD = "0x417Ac0e078398C154EdFadD9Ef675d30Be60Af93";
/** Bridged Tether on Base (6 decimals). */
const USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
const BALANCE = { [WETH]: { slot: 3n }, [USDC]: { slot: 9n }, [USDT]: { slot: 0n } } as const;

/** Uniswap V2's WETH/USDC pair on Base (WETH is token0). */
const UNIV2_WETH_USDC = "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C";
/** Curve's 4pool: USDC, USDbC, axlUSDC, crvUSD — StableSwap-NG, int128 indices. */
const CURVE_4POOL = "0xf6C5F01C7F3148891ad0e19DF78743D31E390D1f";
/** WOOFi's WooPPV2 (quote token USDC). */
const WOO_PP = "0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4";
/** PancakeSwap Infinity: the Vault, and the CL and bin pool managers a key names. */
const INFINITY_VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4";
const CL_MANAGER = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
const BIN_MANAGER = "0xC697d2898e0D09264376196696c51D7aBbbAA4a9";
/**
 * Hookless Infinity pools, by their keys less the two currencies (found by their swaps, the keys read
 * back with each manager's `poolIdToPoolKey`). `parameters` packs the CL tick spacing or the bin
 * step at bit 16.
 */
const CL_USDC_USDT = { manager: CL_MANAGER, fee: 5n, parameters: 2n << 16n };
const CL_ETH_USDC = { manager: CL_MANAGER, fee: 47n, parameters: 1n << 16n };
const BIN_USDC_USDT = { manager: BIN_MANAGER, fee: 7n, parameters: 10n << 16n };
/** A USDC/USDT CL pool that is initialized and holds no liquidity at all. */
const CL_USDC_USDT_EMPTY = { ...CL_USDC_USDT, fee: 6n };
/** An address with no code. */
const CODELESS = "0x00000000000000000000000000000000DeaDBeef";

const WETH_IN = 10n ** 17n;
const USDC_IN = 1_000_000_000n;
const USDC_1 = 1_000_000n;
const SELF = "self";

const clManager = parseAbi([
  "function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 id) view returns (uint128)",
]);
const wooPP = parseAbi([
  "function query(address fromToken, address toToken, uint256 fromAmount) view returns (uint256)",
  "function tryQuery(address fromToken, address toToken, uint256 fromAmount) view returns (uint256)",
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
type InfinityKey = { readonly manager: string; readonly fee: bigint; readonly parameters: bigint };
const infinityCL = (
  key: InfinityKey,
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  { minOut = 0n, vault = INFINITY_VAULT, limit = 0n } = {},
) => [
  addr(vault),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  addr(key.manager),
  uint(key.fee),
  uint(key.parameters),
  addr(NATIVE),
  uint(limit),
  uint(minOut),
  self,
];
/** An Infinity pool's id: the hash of its key, the currencies sorted. */
const infinityPoolId = (key: InfinityKey, currency0: string, currency1: string) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "bytes32" },
      ],
      [
        currency0 as Address,
        currency1 as Address,
        NATIVE as Address,
        key.manager as Address,
        Number(key.fee),
        pad(toHex(key.parameters)),
      ],
    ),
  );
const infinityBin = (
  key: InfinityKey,
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  { minOut = 0n, vault = INFINITY_VAULT } = {},
) => [
  addr(vault),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  addr(key.manager),
  uint(key.fee),
  uint(key.parameters),
  addr(NATIVE),
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

describe("@sauce/router on Base state", { skip: skipReason(), timeout: 1_800_000 }, () => {
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

  /** Sets the Pot's balance of `token`, or of native ETH for the zero address. */
  const fund = (token: string, amount: bigint) =>
    token === NATIVE
      ? env.testClient.setBalance({ address: env.pot, value: amount })
      : setBalance(env, token, BALANCE[token as keyof typeof BALANCE], env.pot, amount);
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

  /** The library call, literal and run-time, and the action: one amount, all of it spent. */
  async function everyWay(
    venue: string,
    name: string,
    args: readonly Typed[],
    funding: [string, bigint],
    tokenOut: string,
    action?: Parameters<typeof actionProgram>[1][number],
  ): Promise<bigint> {
    const delivered = () => held(env, tokenOut, env.pot);
    const programs: Array<[Parameters<typeof measure>[2], Uint8Array]> = [
      ["library", libraryCall(env, CHAIN, name, values(args))],
      ["runtime", runtimeCall(name, args)],
    ];
    if (action) programs.push(["action", actionProgram(8453, [action])]);

    const outs: bigint[] = [];
    for (const [path, program] of programs) {
      await fresh();
      await fund(...funding);
      const { out } = await measure(env, venue, path, program, delivered);
      assert.equal(await held(env, funding[0], env.pot), 0n, `${venue} ${path}: input left`);
      outs.push(out);
    }
    assert.ok(outs[0]! > 0n);
    for (const [i, out] of outs.entries()) {
      assert.equal(out, outs[0], `${venue}: ${programs[i]![0]} delivered a different amount`);
    }

    return outs[0]!;
  }

  /**
   * `name` and its `try` form, every way each is spelled, from the same state and funding: the try
   * form delivers exactly what the plain one does, and returns it. Returns that amount.
   */
  async function tryMatches(
    venue: string,
    name: string,
    args: readonly Typed[],
    funding: [string, bigint],
    tokenOut: string,
  ): Promise<bigint> {
    const out = await everyWay(venue, name, args, funding, tokenOut);
    const tryName = `try${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    assert.equal(await everyWay(`${venue}, ${tryName}`, tryName, args, funding, tokenOut), out);
    await fresh();
    await fund(...funding);
    const receipt = await cook(returning(tryName, values(args), out));
    assert.equal(receipt.status, "success", `${tryName} did not return ${out}`);

    return out;
  }

  // WOOFi first: its oracle goes stale 120 seconds after its last post, and every test mines blocks.
  describe("WOOFi (WooPPV2)", () => {
    it("WETH -> USDC delivers the pool's own quote, the action's, and the library's", async () => {
      const quoted = await query(WETH, USDC, WETH_IN);
      // quoteAction prices the action with the pool's own query.
      const { to, data, decode } = quoteAction(woofiAction(WETH_IN, 1n));
      const { data: result } = await env.publicClient.call({ to, data });
      assert.equal(decode(result!), quoted);
      const out = await everyWay(
        "WOOFi WETH->USDC, 0.1 WETH (pool query)",
        "woofi",
        woofi(WETH, USDC, WETH_IN, 1n),
        [WETH, WETH_IN],
        USDC,
        woofiAction(WETH_IN, 1n),
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

    it("tryWoofi delivers and returns what woofi does, and reads a floor of 0 as 1", async () => {
      const quoted = await query(WETH, USDC, WETH_IN);
      const out = await tryMatches(
        "WOOFi WETH->USDC, 0.1 WETH",
        "woofi",
        woofi(WETH, USDC, WETH_IN, 1n),
        [WETH, WETH_IN],
        USDC,
      );
      assert.equal(out, quoted);
      await fresh();
      await fund(WETH, WETH_IN);
      const receipt = await cook(
        returning("tryWoofi", values(woofi(WETH, USDC, WETH_IN, 0n)), out),
      );
      assert.equal(receipt.status, "success");
    });

    it("tryWoofi skips, moving nothing, a trade its query refuses: a floor above the quote, an output past the reserve, a trade past its caps", async () => {
      const watch = [WETH, USDC].flatMap((t) => [[t, env.pot] as const, [t, WOO_PP] as const]);
      const quoted = await query(WETH, USDC, WETH_IN);
      await fund(WETH, WETH_IN);
      await assertSkips(
        env,
        CHAIN,
        "tryWoofi",
        values(woofi(WETH, USDC, WETH_IN, quoted + 1n)),
        watch,
      );

      // 55 WETH buys more USDC than the pool holds. `query` refuses it; WooPPV2's `tryQuery` prices
      // it anyway, which is why the library does not read it: the push would revert the whole cook.
      const past = 55n * 10n ** 18n;
      const [reserve] = await tokenInfo(USDC);
      const priced = await env.publicClient.readContract({
        address: WOO_PP,
        abi: wooPP,
        functionName: "tryQuery",
        args: [WETH, USDC, past],
      });
      assert.ok(priced > reserve, "tryQuery prices past the reserve");
      await assert.rejects(query(WETH, USDC, past));
      await fund(WETH, past);
      await assertSkips(env, CHAIN, "tryWoofi", values(woofi(WETH, USDC, past, 1n)), watch);
      assert.equal(
        (await cookCall("woofi", woofi(WETH, USDC, past, 1n))).status,
        "reverted",
        "and woofi would revert there",
      );

      // 100 WETH is past the notional cap and the gamma bound: `query` itself reverts.
      const capped = 100n * 10n ** 18n;
      await fund(WETH, capped);
      await assertSkips(env, CHAIN, "tryWoofi", values(woofi(WETH, USDC, capped, 1n)), watch);
    });

    it("tryWoofi skips a pool with no code and a contract that is no pool, moving nothing", async () => {
      await fund(WETH, WETH_IN);
      const watch = [
        [WETH, env.pot],
        [USDC, env.pot],
      ] as const;
      for (const pool of [CODELESS, USDC]) {
        const args = woofi(WETH, USDC, WETH_IN, 1n);
        args[0] = addr(pool);
        await assertSkips(env, CHAIN, "tryWoofi", values(args), watch);
      }
    });
  });

  describe("Uniswap V2", () => {
    it("WETH -> USDC (WETH is token0): every spelling delivers the same", async () => {
      await everyWay(
        "UniV2 WETH->USDC, 0.1 WETH",
        "uniswapV2",
        v2(WETH, USDC, WETH_IN),
        [WETH, WETH_IN],
        USDC,
        undefined,
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
      );
    });
  });

  describe("Curve 4pool (StableSwap-NG)", () => {
    it("USDC -> crvUSD: every spelling delivers the same, approval ending at zero", async () => {
      await everyWay(
        "Curve 4pool USDC->crvUSD, 1000 USDC",
        "curve",
        curve4pool(USDC_IN),
        [USDC, USDC_IN],
        CRVUSD,
        undefined,
      );
      assert.equal(await allowance(env, USDC, env.pot, CURVE_4POOL), 0n);
    });
  });

  describe("PancakeSwap Infinity, through the Pot's Router", () => {
    /** The Pot's and the Vault's balances of each token, which a skip must leave as they were. */
    const watching = (...tokens: string[]) =>
      tokens.flatMap((t) => [[t, env.pot] as const, [t, INFINITY_VAULT] as const]);

    it("infinityCL USDC -> USDT: every spelling delivers the same, and tryInfinityCL returns it", async () => {
      const out = await tryMatches(
        "Infinity CL USDC->USDT, 1000 USDC",
        "infinityCL",
        infinityCL(CL_USDC_USDT, USDC, USDT, USDC_IN),
        [USDC, USDC_IN],
        USDT,
      );
      assert.ok(out > 990_000_000n && out < 1_010_000_000n, `${out}`);
    });

    it("infinityCL USDT -> USDC, the other sort order", async () => {
      await tryMatches(
        "Infinity CL USDT->USDC, 1000 USDT",
        "infinityCL",
        infinityCL(CL_USDC_USDT, USDT, USDC, USDC_IN),
        [USDT, USDC_IN],
        USDC,
      );
    });

    it("infinityCL ETH -> USDC: the zero address is native ETH, which the Pot pays", async () => {
      await tryMatches(
        "Infinity CL ETH->USDC, 0.1 ETH",
        "infinityCL",
        infinityCL(CL_ETH_USDC, NATIVE, USDC, WETH_IN),
        [NATIVE, WETH_IN],
        USDC,
      );
    });

    it("infinityCL USDC -> ETH: the Pot is paid native ETH, which tryInfinityCL measures", async () => {
      const out = await tryMatches(
        "Infinity CL USDC->ETH, 100 USDC",
        "infinityCL",
        infinityCL(CL_ETH_USDC, USDC, NATIVE, USDC_IN / 10n),
        [USDC, USDC_IN / 10n],
        NATIVE,
      );
      assert.ok(out > 10n ** 16n, `${out}`);
    });

    it("infinityBin USDC -> USDT: every spelling delivers the same, and tryInfinityBin returns it", async () => {
      await tryMatches(
        "Infinity bin USDC->USDT, 1 USDC",
        "infinityBin",
        infinityBin(BIN_USDC_USDT, USDC, USDT, USDC_1),
        [USDC, USDC_1],
        USDT,
      );
    });

    it("infinityBin USDT -> USDC", async () => {
      await tryMatches(
        "Infinity bin USDT->USDC, 1 USDT",
        "infinityBin",
        infinityBin(BIN_USDC_USDT, USDT, USDC, USDC_1),
        [USDT, USDC_1],
        USDC,
      );
    });

    it("a floor above what the swap delivers reverts the whole cook, the plain function and the try form alike", async () => {
      await fund(USDC, USDC_IN);
      assert.equal(
        (await cookCall("infinityCL", infinityCL(CL_USDC_USDT, USDC, USDT, USDC_IN))).status,
        "success",
      );
      const out = await balanceOf(env, USDT, env.pot);
      await fresh();
      await fund(USDC, USDC_IN);
      for (const name of ["infinityCL", "tryInfinityCL"]) {
        const args = infinityCL(CL_USDC_USDT, USDC, USDT, USDC_IN, { minOut: out + 1n });
        await assertReverts(env, CHAIN, name, values(args), watching(USDC, USDT));
      }
      await fresh();
      await fund(USDC, USDC_1);
      assert.equal(
        (await cookCall("infinityBin", infinityBin(BIN_USDC_USDT, USDC, USDT, USDC_1))).status,
        "success",
      );
      const binOut = await balanceOf(env, USDT, env.pot);
      await fresh();
      await fund(USDC, USDC_1);
      for (const name of ["infinityBin", "tryInfinityBin"]) {
        const args = infinityBin(BIN_USDC_USDT, USDC, USDT, USDC_1, { minOut: binOut + 1n });
        await assertReverts(env, CHAIN, name, values(args), watching(USDC, USDT));
      }
    });

    it("the try forms skip a Vault with no code, a key no pool has and a key naming the other pool type's manager, moving nothing", async () => {
      await fund(USDC, USDC_IN);
      const watch = watching(USDC, USDT);
      const cl = (key: InfinityKey, vault = INFINITY_VAULT) =>
        values(infinityCL(key, USDC, USDT, USDC_IN, { vault }));
      const bin = (key: InfinityKey, vault = INFINITY_VAULT) =>
        values(infinityBin(key, USDC, USDT, USDC_1, { vault }));
      await assertSkips(env, CHAIN, "tryInfinityCL", cl(CL_USDC_USDT, CODELESS), watch);
      await assertSkips(env, CHAIN, "tryInfinityCL", cl({ ...CL_USDC_USDT, fee: 9n }), watch);
      await assertSkips(
        env,
        CHAIN,
        "tryInfinityCL",
        cl({ ...CL_USDC_USDT, manager: BIN_MANAGER }),
        watch,
      );
      await assertSkips(env, CHAIN, "tryInfinityBin", bin(BIN_USDC_USDT, CODELESS), watch);
      await assertSkips(env, CHAIN, "tryInfinityBin", bin({ ...BIN_USDC_USDT, fee: 8n }), watch);
      await assertSkips(
        env,
        CHAIN,
        "tryInfinityBin",
        bin({ ...BIN_USDC_USDT, manager: CL_MANAGER }),
        watch,
      );
      // The plain functions revert there instead.
      await assertReverts(env, CHAIN, "infinityCL", cl({ ...CL_USDC_USDT, fee: 9n }), watch);
      await assertReverts(env, CHAIN, "infinityBin", bin({ ...BIN_USDC_USDT, fee: 8n }), watch);
    });

    it("a swap that ran in a pool with no liquidity moved nothing either way: tryInfinityCL skips it, after a tick walk a price limit bounds", async () => {
      const watch = watching(USDC, USDT);
      const pool = CL_USDC_USDT_EMPTY;
      const id = infinityPoolId(pool, USDC, USDT);
      const read = <T>(functionName: "getSlot0" | "getLiquidity") =>
        env.publicClient.readContract({
          address: CL_MANAGER,
          abi: clManager,
          functionName,
          args: [id],
        }) as Promise<T>;
      const [sqrtPriceX96] = await read<readonly [bigint, number, number, number]>("getSlot0");
      assert.ok(sqrtPriceX96 > 0n, "the pool is initialized");
      assert.equal(await read<bigint>("getLiquidity"), 0n, "and holds no liquidity");
      // USDC is currency0, so selling it lowers the price: 2^96, a price of 1 (tick 0), is a limit just
      // past the pool's, inside the empty range.
      const limit = 2n ** 96n;
      assert.ok(limit < sqrtPriceX96, "the limit is past the pool's price, inside the empty range");
      await fund(USDC, USDC_IN);
      // The Router's own entry point lands the swap, having paid and received nothing: the manager
      // walks the empty range to the limit.
      const direct = [
        "function main() {",
        `  const [paid, out] = SauceRouter.at(ctx.self()).swapInfinityCL(${BigInt(INFINITY_VAULT)}n, { currency0: ${BigInt(USDC)}n, currency1: ${BigInt(USDT)}n, hooks: 0n, poolManager: ${BigInt(CL_MANAGER)}n, fee: ${pool.fee}n, parameters: ${pool.parameters}n }, ${BigInt(USDC)}n, true, ${USDC_IN}n, ${limit}n, ctx.self());`,
        "  require(paid == 0n);",
        "  require(out == 0n);",
        "}",
      ].join("\n");
      const receipt = await env.cook(
        compileSource(env, CHAIN, direct, { SauceRouter: libraryAbi("sauce-router.abi.json") }),
      );
      assert.equal(receipt.status, "success", "the swap ran and moved nothing");

      // So the try form skips it, at the cost of the few ticks to the limit...
      await fresh();
      await fund(USDC, USDC_IN);
      const bounded = await assertSkips(
        env,
        CHAIN,
        "tryInfinityCL",
        values(infinityCL(pool, USDC, USDT, USDC_IN, { minOut: 1n, limit })),
        watch,
      );
      // ...and with no limit, at the cost of the walk to the end of the tick range.
      await fresh();
      await fund(USDC, USDC_IN);
      const walked = await assertSkips(
        env,
        CHAIN,
        "tryInfinityCL",
        values(infinityCL(pool, USDC, USDT, USDC_IN, { minOut: 1n })),
        watch,
      );
      console.log(
        `tryInfinityCL skipping an empty pool: ${walked.gasUsed} gas with no price limit, ` +
          `${bounded.gasUsed} with one`,
      );
      assert.ok(walked.gasUsed > 5_000_000n, `${walked.gasUsed}`);
      assert.ok(bounded.gasUsed < 500_000n, `${bounded.gasUsed}`);
    });

    it("a CL swap that ran and delivered nothing reverts tryInfinityCL: it took one unit of USDC, so 0 would lie", async () => {
      await fund(USDC, 1n);
      // The Router's own entry point lands it: the pool keeps the unit as its fee and pays nothing.
      const direct = [
        "function main() {",
        `  const [paid, out] = SauceRouter.at(ctx.self()).swapInfinityCL(${BigInt(INFINITY_VAULT)}n, { currency0: ${BigInt(USDC)}n, currency1: ${BigInt(USDT)}n, hooks: 0n, poolManager: ${BigInt(CL_MANAGER)}n, fee: 5n, parameters: ${CL_USDC_USDT.parameters}n }, ${BigInt(USDC)}n, true, 1n, 0n, ctx.self());`,
        "  require(paid == 1n);",
        "  require(out == 0n);",
        "}",
      ].join("\n");
      const receipt = await env.cook(
        compileSource(env, CHAIN, direct, { SauceRouter: libraryAbi("sauce-router.abi.json") }),
      );
      assert.equal(receipt.status, "success", "the Router took 1 and paid 0");
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
      await fresh();
      await fund(USDC, 1n);
      await assertReverts(
        env,
        CHAIN,
        "tryInfinityCL",
        values(infinityCL(CL_USDC_USDT, USDC, USDT, 1n)),
        watching(USDC, USDT),
      );
    });

    it("one unit of USDC at the bin pool: the pool refuses a swap that would pay nothing, so tryInfinityBin skips it; two units pay one", async () => {
      const watch = watching(USDC, USDT);
      await fund(USDC, 1n);
      await assertSkips(
        env,
        CHAIN,
        "tryInfinityBin",
        values(infinityBin(BIN_USDC_USDT, USDC, USDT, 1n)),
        watch,
      );
      await assertReverts(
        env,
        CHAIN,
        "infinityBin",
        values(infinityBin(BIN_USDC_USDT, USDC, USDT, 1n)),
        watch,
      );
      await fund(USDC, 2n);
      const receipt = await cook(
        returning("tryInfinityBin", values(infinityBin(BIN_USDC_USDT, USDC, USDT, 2n)), 1n),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
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
