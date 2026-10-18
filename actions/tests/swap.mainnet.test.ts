/**
 * `@sauce/router` on Ethereum — Uniswap V2, Curve (3pool and tricrypto-ng), Balancer V2 and DODO V2
 * — EXECUTED on mainnet state captured at the pinned block (`mainnet.ts`), through the released
 * engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * Each venue runs from a Sauce program with literal arguments, from one with every argument a
 * run-time `main` argument, and through the action that lowers to it — from the same snapshot
 * and funding, so the outputs
 * must be equal; the gas and bytes of each are printed. Then the rules the library keeps: a
 * no-return token (USDT) is accepted and a `false`-returning one refused; an approval is exact and
 * ends at zero; a swap consumes its whole input or reverts the whole cook, with nothing left in the
 * pool; a direction stated against the pool's tokens reverts; a `try` form that cannot fill moves
 * nothing; a Pot whose Router has none of these venues still runs them; and one precompiled program
 * picks its venues at run time, in a loop over pools.
 *
 * The venues the Pot's Router pays — Uniswap V3 and V4, Maverick V2, on the pools the actions suite
 * swaps — run here beside their `try` forms. Every `try` form here returns exactly what its plain
 * function returns on the same state; each way it skips returns 0 with the Pot's and the pool's
 * balances untouched; and a swap that ran and took input for nothing reverts the whole cook.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  concat,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type { Action } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import {
  actionProgram,
  allowance,
  assertReverts,
  assertSkips,
  balanceOf,
  call,
  compileSource,
  compileStandalone,
  deployToken,
  libraryAbi,
  libraryCall,
  measure,
  NATIVE,
  printMeasurements,
  returning,
  REVERTING_CODE,
  routerProgram,
  runtimeCall,
  setAllowance,
  setBalance,
  type Arg,
} from "./swap-venues.js";

const CHAIN = "ethereum";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const BALANCE = {
  [WETH]: { slot: 3n },
  [USDC]: { slot: 9n },
  [USDT]: { slot: 2n },
} as const;
/** USDT's `allowed[owner][spender]` mapping. */
const USDT_ALLOWANCE_SLOT = 5n;

/** Uniswap V2 pairs: USDC/WETH (USDC is token0) and WETH/USDT (WETH is token0). */
const UNIV2_USDC_WETH = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const UNIV2_WETH_USDT = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
/** Curve 3pool (DAI, USDC, USDT; int128 indices, `exchange` returns nothing). */
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
/** Curve tricrypto-ng USDC/WBTC/WETH (uint256 indices). */
const CURVE_TRICRYPTO_USDC = "0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B";
const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
/** Balancer V2's 50/50 USDC/WETH weighted pool, whose address is its id's top 20 bytes. */
const BALANCER_USDC_WETH_ID =
  "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
/** A DODO V2 DVM, base WETH and quote USDC, and a DSP, base USDT and quote USDC. */
const DODO_DVM_WETH_USDC = "0x8B2F062d112aE1ac6Ccc6C358cc40C9518c847Dc";
const DODO_DSP_USDT_USDC = "0x201939F5c74f5Fd3beEf1cf03a9CFcc75bEBa9D9";
/** Uniswap V3's USDC/WETH 0.05% pool and USDC/USDT 0.01% pool (USDC is token0 of both). */
const UNIV3_USDC_WETH_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const UNIV3_USDC_USDT_100 = "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6";
/** Uniswap V4's PoolManager; its hookless USDC/USDT pool is fee 10, tick spacing 1. */
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
/** A Maverick V2 USDC/USDT pool; token A is USDC. */
const MAVERICK_USDC_USDT = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA";
/** An address with no code. */
const CODELESS = "0x00000000000000000000000000000000DeaDBeef";

const ONE_ETH = 10n ** 18n;
const USDC_100 = 100_000_000n;
const MAX_UINT112 = (1n << 112n) - 1n;
const SELF = "self";

const pair = parseAbi(["function getReserves() view returns (uint112, uint112, uint32)"]);
const poolManager = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
const dodo = parseAbi([
  "function getVaultReserve() view returns (uint256 baseReserve, uint256 quoteReserve)",
  "function querySellBase(address trader, uint256 payBaseAmount) view returns (uint256 receiveQuoteAmount, uint256 mtFee)",
  "function _BASE_TOKEN_() view returns (address)",
  "function _QUOTE_TOKEN_() view returns (address)",
]);

/** A library call's arguments, each with the ABI type a run-time `main` argument carries. */
type Typed = { readonly type: "address" | "uint256" | "bool"; readonly value: Arg };
const addr = (value: string): Typed => ({ type: "address", value });
const uint = (value: bigint): Typed => ({ type: "uint256", value });
const bool = (value: boolean): Typed => ({ type: "bool", value });
const self: Typed = { type: "address", value: SELF };

const v2 = (tokenIn: string, tokenOut: string, amount: bigint, minOut = 0n, recipient = SELF) => {
  const pool = tokenIn === USDT || tokenOut === USDT ? UNIV2_WETH_USDT : UNIV2_USDC_WETH;
  return [
    addr(pool),
    addr(tokenIn),
    addr(tokenOut),
    uint(amount),
    uint(0n),
    uint(minOut),
    recipient === SELF ? self : addr(recipient),
  ];
};
const curve3pool = (
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  minOut = 0n,
  recipient = SELF,
) => {
  const index: Record<string, bigint> = { [USDC]: 1n, [USDT]: 2n };
  return [
    addr(CURVE_3POOL),
    addr(tokenIn),
    addr(tokenOut),
    uint(amount),
    uint(index[tokenIn]!),
    uint(index[tokenOut]!),
    bool(false),
    uint(minOut),
    recipient === SELF ? self : addr(recipient),
  ];
};
const balancer = (amount: bigint, minOut = 0n, tokenIn = WETH) => [
  addr(BALANCER_V2_VAULT),
  addr(tokenIn),
  addr(USDC),
  uint(amount),
  uint(BigInt(BALANCER_USDC_WETH_ID)),
  uint(minOut),
  self,
];
const dodoV2 = (tokenIn: string, tokenOut: string, amount: bigint, minOut = 0n) => {
  const dsp = tokenIn === USDT || tokenOut === USDT;
  return [
    addr(dsp ? DODO_DSP_USDT_USDC : DODO_DVM_WETH_USDC),
    addr(tokenIn),
    addr(tokenOut),
    uint(amount),
    addr(dsp ? USDT : WETH),
    addr(USDC),
    uint(minOut),
    self,
  ];
};
const v3 = (
  pool: string,
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  minOut = 0n,
  limit = 0n,
) => [addr(pool), addr(tokenIn), addr(tokenOut), uint(amount), uint(limit), uint(minOut), self];
const v4 = (
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  { minOut = 0n, fee = 10n, poolManager = POOL_MANAGER, limit = 0n } = {},
) => [
  addr(poolManager),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  uint(fee),
  uint(1n),
  addr(NATIVE),
  uint(limit),
  uint(minOut),
  self,
];
const maverick = (pool: string, tokenIn: string, tokenOut: string, amount: bigint, minOut = 0n) => [
  addr(pool),
  addr(tokenIn),
  addr(tokenOut),
  uint(amount),
  uint(minOut),
  self,
];
const values = (args: readonly Typed[]): Arg[] => args.map((a) => a.value);

describe("@sauce/router on Ethereum state", { skip: skipReason(), timeout: 1_800_000 }, () => {
  let env: Anvil;
  let snapshot: Hex;

  before(async () => {
    env = await startAnvil({ mainnet: "swap" });
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
  /** Back to the snapshot, and a fresh one to return to. */
  const fresh = async () => {
    await env.testClient.revert({ id: snapshot });
    snapshot = await env.testClient.snapshot();
  };
  const cook = (source: string) => env.cook(compileSource(env, CHAIN, source));
  const cookCall = (name: string, args: readonly Typed[]) =>
    cook(routerProgram([call(name, values(args))]));
  const reserves = (at: string) =>
    env.publicClient.readContract({
      address: at as Address,
      abi: pair,
      functionName: "getReserves",
    });

  /**
   * One swap, every way it can be spelled, from the same state and funding: the library call with
   * literal arguments, with run-time arguments, and the action that lowers to it. Every one must deliver the same amount and spend the
   * whole input. Returns that amount.
   */
  async function everyWay(
    venue: string,
    name: string,
    args: readonly Typed[],
    funding: [keyof typeof BALANCE, bigint],
    tokenOut: string,
    action?: Action,
  ): Promise<bigint> {
    const delivered = () => balanceOf(env, tokenOut, env.pot);
    const programs: Array<[Parameters<typeof measure>[2], Uint8Array]> = [
      ["library", libraryCall(env, CHAIN, name, values(args))],
      ["runtime", runtimeCall(name, args)],
    ];
    if (action) programs.push(["action", actionProgram(1, [action])]);

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

  /**
   * `name` and its `try` form, every way each is spelled, from the same state and funding: the try
   * form delivers exactly what the plain one does, and returns it. Returns that amount.
   */
  async function tryMatches(
    venue: string,
    name: string,
    args: readonly Typed[],
    funding: [keyof typeof BALANCE, bigint],
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

  /** The Pot's and `pool`'s balances of each token, which a skip must leave as they were. */
  const watching = (pool: string, ...tokens: string[]) =>
    tokens.flatMap((t) => [[t, env.pot] as const, [t, pool] as const]);

  /**
   * The Router's own entry point `method(args)` — a Sauce expression — in a program that requires it
   * to return `paid` and `out`.
   */
  const routerReturns = async (method: string, paid: bigint, out: bigint) => {
    const source = [
      "function main() {",
      `  const [paid, out] = SauceRouter.at(ctx.self()).${method};`,
      `  require(paid == ${paid}n);`,
      `  require(out == ${out}n);`,
      "}",
    ].join("\n");
    const contracts = { SauceRouter: libraryAbi("sauce-router.abi.json") };
    return (await env.cook(compileSource(env, CHAIN, source, contracts))).status;
  };

  it("the address the skips call codeless has no code", async () => {
    assert.equal(await env.publicClient.getCode({ address: CODELESS }), undefined);
  });

  describe("Uniswap V2", () => {
    it("WETH -> USDC (WETH is token1): every spelling delivers the same", async () => {
      const out = await everyWay(
        "UniV2 WETH->USDC, 1 WETH",
        "uniswapV2",
        v2(WETH, USDC, ONE_ETH),
        [WETH, ONE_ETH],
        USDC,
        {
          type: "uniswapV2Swap",
          amount: `${ONE_ETH}`,
          pool: UNIV2_USDC_WETH,
          tokenIn: WETH,
          tokenOut: USDC,
          amountOutMin: "1",
          recipient: "self",
        },
      );
      assert.equal(out, 2_683_509_365n);
    });

    it("USDC -> WETH, the other sort order", async () => {
      await everyWay(
        "UniV2 USDC->WETH, 100 USDC",
        "uniswapV2",
        v2(USDC, WETH, USDC_100),
        [USDC, USDC_100],
        WETH,
        undefined,
      );
    });

    it("USDT -> WETH pushes a token whose transfer returns nothing", async () => {
      await everyWay(
        "UniV2 USDT->WETH, 100 USDT",
        "uniswapV2",
        v2(USDT, WETH, USDC_100),
        [USDT, USDC_100],
        WETH,
        undefined,
      );
    });

    it("the direction a hand-written program could get backwards donates; the library takes it from the sort order", async () => {
      await fund(WETH, ONE_ETH);
      assert.equal((await cookCall("uniswapV2", v2(WETH, USDC, ONE_ETH))).status, "success");
      assert.equal(await balanceOf(env, USDC, env.pot), 2_683_509_365n);
      await fresh();

      // The same amount on the other lane: the pair pays that many wei of WETH, the K check passes,
      // and the Pot's 1 WETH stays in the pair. Nothing reverts.
      const reversed = [
        'import { transfer } from "@sauce/token";',
        "function main() {",
        `  transfer(${BigInt(WETH)}n, ${BigInt(UNIV2_USDC_WETH)}n, ${ONE_ETH}n);`,
        "  const data = hex``;",
        `  IUniswapV2Pair.at(${BigInt(UNIV2_USDC_WETH)}n).swap(0n, 2683509365n, ctx.self(), data);`,
        "}",
      ].join("\n");
      await fund(WETH, ONE_ETH);
      const pairAbi = { IUniswapV2Pair: libraryAbi("uniswap-v2-pair.abi.json") };
      assert.equal(
        (await env.cook(compileSource(env, CHAIN, reversed, pairAbi))).status,
        "success",
      );
      assert.equal(await balanceOf(env, WETH, env.pot), 2_683_509_365n, "1 WETH donated");
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
    });

    it("an input past what the pair's reserve can hold reverts the whole cook, the Pot unchanged", async () => {
      const [, reserveWeth] = await reserves(UNIV2_USDC_WETH);
      const amount = MAX_UINT112 - reserveWeth + 1n;
      await fund(WETH, amount);
      assert.equal((await cookCall("uniswapV2", v2(WETH, USDC, amount))).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), amount, "nothing moved");
    });

    it("an input the pair can hold is consumed whole: nothing is left beside its reserve", async () => {
      const amount = 1_000_000n * ONE_ETH;
      await fund(WETH, amount);
      assert.equal((await cookCall("uniswapV2", v2(WETH, USDC, amount))).status, "success");
      const [reserveUsdc, reserveWeth] = await reserves(UNIV2_USDC_WETH);
      assert.equal(await balanceOf(env, WETH, UNIV2_USDC_WETH), reserveWeth);
      assert.equal(await balanceOf(env, USDC, UNIV2_USDC_WETH), reserveUsdc);
      assert.equal(await balanceOf(env, WETH, env.pot), 0n);
    });

    it("a floor above what the pair pays reverts the whole cook before anything moves", async () => {
      await fund(WETH, ONE_ETH);
      assert.equal(
        (await cookCall("uniswapV2", v2(WETH, USDC, ONE_ETH, 2_683_509_366n))).status,
        "reverted",
      );
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH);
      await fresh();
      await fund(WETH, ONE_ETH);
      assert.equal(
        (await cookCall("uniswapV2", v2(WETH, USDC, ONE_ETH, 2_683_509_365n))).status,
        "success",
      );
    });

    it("a fee of 100% or more is refused", async () => {
      await fund(WETH, ONE_ETH);
      const args = v2(WETH, USDC, ONE_ETH);
      args[4] = uint(1_000_000n);
      assert.equal((await cookCall("uniswapV2", args)).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH);
    });

    it("tryUniswapV2: a swap the pair cannot fill at the floor returns 0 and moves nothing; the program goes on", async () => {
      await fund(WETH, 2n * ONE_ETH);
      const receipt = await cook(
        routerProgram([
          `const skipped = ${call("tryUniswapV2", values(v2(WETH, USDC, ONE_ETH, 10n ** 12n)))};`,
          "require(skipped == 0n);",
          `const ran = ${call("tryUniswapV2", values(v2(WETH, USDC, ONE_ETH)))};`,
          "require(ran == 2683509365n);",
        ]),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH, "the first was skipped");
      assert.equal(await balanceOf(env, USDC, env.pot), 2_683_509_365n, "the second ran");
    });

    it("tryUniswapV2: an input past the reserve's width is skipped, not pushed", async () => {
      await fund(WETH, MAX_UINT112);
      assert.equal((await cookCall("tryUniswapV2", v2(WETH, USDC, MAX_UINT112))).status, "success");
      assert.equal(await balanceOf(env, WETH, env.pot), MAX_UINT112);
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
    });
  });

  describe("Curve", () => {
    it("3pool USDC -> USDT, a pool whose exchange returns nothing", async () => {
      const out = await everyWay(
        "Curve 3pool USDC->USDT, 100 USDC",
        "curve",
        curve3pool(USDC, USDT, USDC_100),
        [USDC, USDC_100],
        USDT,
        {
          type: "curveSwap",
          amount: `${USDC_100}`,
          pool: CURVE_3POOL,
          tokenIn: USDC,
          tokenOut: USDT,
          i: 1,
          j: 2,
          indexType: "int128",
          amountOutMin: "1",
          recipient: "self",
        },
      );
      assert.equal(out, 100_007_483n);
      assert.equal(await allowance(env, USDC, env.pot, CURVE_3POOL), 0n, "the approval was exact");
    });

    it("3pool USDT -> USDC approves a token whose approve returns nothing, and ends at zero", async () => {
      await fund(USDT, USDC_100);
      assert.equal((await cookCall("curve", curve3pool(USDT, USDC, USDC_100))).status, "success");
      assert.ok((await balanceOf(env, USDC, env.pot)) > 99_000_000n);
      assert.equal(await allowance(env, USDT, env.pot, CURVE_3POOL), 0n);
    });

    it("resets a stale USDT allowance first — USDT refuses a non-zero to non-zero approve", async () => {
      await fund(USDT, USDC_100);
      await setAllowance(env, USDT, USDT_ALLOWANCE_SLOT, env.pot, CURVE_3POOL, 12_345n);
      assert.equal((await cookCall("curve", curve3pool(USDT, USDC, USDC_100))).status, "success");
      assert.equal(await allowance(env, USDT, env.pot, CURVE_3POOL), 0n);
      assert.equal(await balanceOf(env, USDT, env.pot), 0n);
    });

    it("forwards the delivered balance delta to another recipient, and returns it", async () => {
      const recipient = "0x000000000000000000000000000000000000c0DE";
      await fund(USDC, USDC_100);
      const receipt = await cook(
        routerProgram([
          `const out = ${call("curve", values(curve3pool(USDC, USDT, USDC_100, 0n, recipient)))};`,
          "require(out == 100007483n);",
        ]),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await balanceOf(env, USDT, recipient), 100_007_483n);
      assert.equal(await balanceOf(env, USDT, env.pot), 0n);
    });

    it("tricrypto-ng USDC -> WETH with uint256 indices", async () => {
      const out = await everyWay(
        "Curve tricrypto-ng USDC->WETH, 100 USDC",
        "curve",
        [
          addr(CURVE_TRICRYPTO_USDC),
          addr(USDC),
          addr(WETH),
          uint(USDC_100),
          uint(0n),
          uint(2n),
          bool(true),
          uint(0n),
          self,
        ],
        [USDC, USDC_100],
        WETH,
      );
      assert.equal(out, 37_047_491_033_596_735n);
      assert.equal(await allowance(env, USDC, env.pot, CURVE_TRICRYPTO_USDC), 0n);
    });

    it("a floor above what the pool pays reverts the whole cook; the pool enforces it", async () => {
      await fund(USDC, USDC_100);
      assert.equal(
        (await cookCall("curve", curve3pool(USDC, USDT, USDC_100, 100_007_484n))).status,
        "reverted",
      );
      assert.equal(await balanceOf(env, USDC, env.pot), USDC_100);
    });

    it("tryCurve: a failed exchange is caught, its approval reset to zero, 0 returned and nothing moved", async () => {
      await fund(USDC, 2n * USDC_100);
      const receipt = await cook(
        routerProgram([
          `const skipped = ${call("tryCurve", values(curve3pool(USDC, USDT, USDC_100, 100_007_484n)))};`,
          "require(skipped == 0n);",
          `const ran = ${call("tryCurve", values(curve3pool(USDC, USDT, USDC_100)))};`,
          "require(ran == 100007483n);",
        ]),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await allowance(env, USDC, env.pot, CURVE_3POOL), 0n);
      assert.equal(await balanceOf(env, USDC, env.pot), USDC_100, "the first moved nothing");
      assert.equal(await balanceOf(env, USDT, env.pot), 100_007_483n, "the second ran");
    });
  });

  describe("Balancer V2", () => {
    it("WETH -> USDC through the Vault: every spelling delivers the same", async () => {
      await everyWay(
        "BalancerV2 WETH->USDC, 1 WETH",
        "balancerV2",
        balancer(ONE_ETH),
        [WETH, ONE_ETH],
        USDC,
        {
          type: "balancerV2Swap",
          amount: `${ONE_ETH}`,
          vault: BALANCER_V2_VAULT,
          poolId: BALANCER_USDC_WETH_ID,
          tokenIn: WETH,
          tokenOut: USDC,
          amountOutMin: "1",
          recipient: "self",
        },
      );
      assert.equal(await allowance(env, WETH, env.pot, BALANCER_V2_VAULT), 0n);
    });

    it("a floor above what the Vault pays reverts the whole cook; the Vault enforces it as its limit", async () => {
      await fund(WETH, ONE_ETH);
      assert.equal(
        (await cookCall("balancerV2", balancer(ONE_ETH, 10n ** 12n))).status,
        "reverted",
      );
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH);
    });

    it("tryBalancerV2: a Vault revert is caught, the approval reset to zero, 0 returned and nothing moved", async () => {
      await fund(WETH, ONE_ETH);
      const receipt = await cook(
        routerProgram([
          `const skipped = ${call("tryBalancerV2", values(balancer(ONE_ETH, 10n ** 12n)))};`,
          "require(skipped == 0n);",
        ]),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await allowance(env, WETH, env.pot, BALANCER_V2_VAULT), 0n);
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH);
    });
  });

  describe("DODO V2", () => {
    it("reads the pools' base and quote tokens the calls name", async () => {
      for (const [pool, base, quote] of [
        [DODO_DVM_WETH_USDC, WETH, USDC],
        [DODO_DSP_USDT_USDC, USDT, USDC],
      ] as const) {
        const read = (functionName: "_BASE_TOKEN_" | "_QUOTE_TOKEN_") =>
          env.publicClient.readContract({ address: pool, abi: dodo, functionName });
        assert.deepEqual([await read("_BASE_TOKEN_"), await read("_QUOTE_TOKEN_")], [base, quote]);
      }
    });

    it("sellBase (WETH -> USDC): every spelling delivers the same", async () => {
      const amount = ONE_ETH / 100n;
      await everyWay(
        "DODOV2 WETH->USDC (sellBase), 0.01 WETH",
        "dodoV2",
        dodoV2(WETH, USDC, amount),
        [WETH, amount],
        USDC,
        {
          type: "dodoV2Swap",
          amount: `${amount}`,
          pool: DODO_DVM_WETH_USDC,
          tokenIn: WETH,
          tokenOut: USDC,
          baseToken: WETH,
          quoteToken: USDC,
          amountOutMin: "1",
          recipient: "self",
        },
      );
    });

    it("sellQuote (USDC -> WETH)", async () => {
      await everyWay(
        "DODOV2 USDC->WETH (sellQuote), 0.1 USDC",
        "dodoV2",
        dodoV2(USDC, WETH, 100_000n),
        [USDC, 100_000n],
        WETH,
        undefined,
      );
    });

    it("a DSP pool, pushing USDT (no return value) and selling it as base", async () => {
      await everyWay(
        "DODOV2 DSP USDT->USDC, 1 USDT",
        "dodoV2",
        dodoV2(USDT, USDC, 1_000_000n),
        [USDT, 1_000_000n],
        USDC,
        undefined,
      );
    });

    it("a trade that is not between the base and quote tokens it names reverts before anything moves", async () => {
      await fund(WETH, ONE_ETH / 100n);
      // WETH for USDT at the WETH/USDC pool: tokenOut is neither its base nor its quote.
      const args = dodoV2(WETH, USDC, ONE_ETH / 100n);
      args[2] = addr(USDT);
      assert.equal((await cookCall("dodoV2", args)).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH / 100n, "nothing moved");
    });

    it("the wrong side donates the input without reverting — the trap the call's check is for", async () => {
      // Push base, then sell quote: the pool prices a zero quote input at zero and books the base.
      const trap = [
        'import { transfer } from "@sauce/token";',
        "function main() {",
        `  transfer(${BigInt(WETH)}n, ${BigInt(DODO_DVM_WETH_USDC)}n, ${ONE_ETH / 100n}n);`,
        `  DODOV2Pool.at(${BigInt(DODO_DVM_WETH_USDC)}n).sellQuote(ctx.self());`,
        "}",
      ].join("\n");
      await fund(WETH, ONE_ETH / 100n);
      const poolAbi = { DODOV2Pool: libraryAbi("dodo-v2-pool.abi.json") };
      assert.equal((await env.cook(compileSource(env, CHAIN, trap, poolAbi))).status, "success");
      assert.equal(await balanceOf(env, WETH, env.pot), 0n, "the input is gone");
      assert.equal(await balanceOf(env, USDC, env.pot), 0n, "and nothing came back");
    });

    it("an input past what the pool's reserve can hold reverts the whole cook", async () => {
      const [baseReserve] = await env.publicClient.readContract({
        address: DODO_DVM_WETH_USDC,
        abi: dodo,
        functionName: "getVaultReserve",
      });
      const amount = MAX_UINT112 - baseReserve + 1n;
      await fund(WETH, amount);
      assert.equal((await cookCall("dodoV2", dodoV2(WETH, USDC, amount))).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), amount, "nothing moved");
    });

    // This DVM holds 0.00022 WETH and 0.59 USDC. Pushed far more than that, it either books all of
    // it and pays out (nearly) its whole quote reserve, or — past what its PMM curve can price, about
    // 11.35 WETH here — reverts TARGET_IS_ZERO. It never keeps part of an input and returns the rest.
    it("an input 46,000 times the pool's base is consumed whole: booked in full, paid from its quote", async () => {
      const amount = 10n * ONE_ETH;
      await fund(WETH, amount);
      assert.equal((await cookCall("dodoV2", dodoV2(WETH, USDC, amount))).status, "success");
      const [baseReserve, quoteReserve] = await env.publicClient.readContract({
        address: DODO_DVM_WETH_USDC,
        abi: dodo,
        functionName: "getVaultReserve",
      });
      assert.equal(await balanceOf(env, WETH, DODO_DVM_WETH_USDC), baseReserve, "nothing stranded");
      assert.equal(await balanceOf(env, USDC, DODO_DVM_WETH_USDC), quoteReserve);
      assert.equal(await balanceOf(env, WETH, env.pot), 0n);
      assert.equal(
        await balanceOf(env, USDC, env.pot),
        588_686n,
        "all but fees and dust of 590,459",
      );
      await fresh();
      // With a floor, the same push reverts the whole cook instead.
      await fund(WETH, amount);
      assert.equal(
        (await cookCall("dodoV2", dodoV2(WETH, USDC, amount, 1_000_000n))).status,
        "reverted",
      );
      assert.equal(await balanceOf(env, WETH, env.pot), amount);
    });

    it("an input past what the pool's curve can price reverts the whole cook", async () => {
      const amount = 1_000n * ONE_ETH;
      await fund(WETH, amount);
      assert.equal((await cookCall("dodoV2", dodoV2(WETH, USDC, amount))).status, "reverted");
      assert.equal(await balanceOf(env, WETH, env.pot), amount, "nothing moved");
    });

    it("tryDodoV2 delivers and returns what dodoV2 does: sellBase, sellQuote, and a DSP selling USDT", async () => {
      const amount = ONE_ETH / 100n;
      await tryMatches(
        "DODOV2 WETH->USDC (sellBase), 0.01 WETH",
        "dodoV2",
        dodoV2(WETH, USDC, amount),
        [WETH, amount],
        USDC,
      );
      await tryMatches(
        "DODOV2 USDC->WETH (sellQuote), 0.1 USDC",
        "dodoV2",
        dodoV2(USDC, WETH, 100_000n),
        [USDC, 100_000n],
        WETH,
      );
      await tryMatches(
        "DODOV2 DSP USDT->USDC, 1 USDT",
        "dodoV2",
        dodoV2(USDT, USDC, 1_000_000n),
        [USDT, 1_000_000n],
        USDC,
      );
    });

    it("tryDodoV2 skips, moving nothing, a trade its view refuses: a floor above the quote, an input past what the curve can price", async () => {
      const watch = watching(DODO_DVM_WETH_USDC, WETH, USDC);
      const amount = ONE_ETH / 100n;
      const [quoted] = await env.publicClient.readContract({
        address: DODO_DVM_WETH_USDC,
        abi: dodo,
        functionName: "querySellBase",
        args: [env.pot, amount],
      });
      await fund(WETH, amount);
      await assertSkips(
        env,
        CHAIN,
        "tryDodoV2",
        values(dodoV2(WETH, USDC, amount, quoted + 1n)),
        watch,
      );
      // The same floor the quote meets lands the swap.
      assert.equal(
        (await cook(returning("tryDodoV2", values(dodoV2(WETH, USDC, amount, quoted)), quoted)))
          .status,
        "success",
      );
      await fresh();
      // 1000 WETH: the view reverts TARGET_IS_ZERO, as the swap would.
      const past = 1_000n * ONE_ETH;
      await fund(WETH, past);
      await assertSkips(env, CHAIN, "tryDodoV2", values(dodoV2(WETH, USDC, past)), watch);
    });

    it("tryDodoV2 skips a pool with no code and a contract that is no pool, moving nothing", async () => {
      const amount = ONE_ETH / 100n;
      await fund(WETH, amount);
      for (const pool of [CODELESS, USDC]) {
        const args = dodoV2(WETH, USDC, amount);
        args[0] = addr(pool);
        await assertSkips(env, CHAIN, "tryDodoV2", values(args), watching(pool, WETH, USDC));
      }
    });

    it("tryDodoV2 still reverts a trade that is not between the base and quote tokens it names", async () => {
      const amount = ONE_ETH / 100n;
      await fund(WETH, amount);
      const args = dodoV2(WETH, USDC, amount);
      args[2] = addr(USDT);
      await assertReverts(
        env,
        CHAIN,
        "tryDodoV2",
        values(args),
        watching(DODO_DVM_WETH_USDC, WETH),
      );
    });
  });

  describe("Through the Pot's Router: Uniswap V3", () => {
    it("WETH -> USDC at 0.05%: every spelling delivers the same, and tryUniswapV3 returns it", async () => {
      await tryMatches(
        "UniV3 WETH->USDC 0.05%, 1 WETH",
        "uniswapV3",
        v3(UNIV3_USDC_WETH_500, WETH, USDC, ONE_ETH),
        [WETH, ONE_ETH],
        USDC,
      );
    });

    it("USDC -> USDT at 0.01%, the other direction", async () => {
      await tryMatches(
        "UniV3 USDC->USDT 0.01%, 100 USDC",
        "uniswapV3",
        v3(UNIV3_USDC_USDT_100, USDC, USDT, USDC_100),
        [USDC, USDC_100],
        USDT,
      );
    });

    it("tryUniswapV3 skips, moving nothing: no code, a pool for another pair, a contract that is no pool, a price limit the pool refuses", async () => {
      await fund(WETH, ONE_ETH);
      const watch = watching(UNIV3_USDC_WETH_500, WETH, USDC);
      for (const pool of [CODELESS, UNIV3_USDC_USDT_100, USDC]) {
        await assertSkips(env, CHAIN, "tryUniswapV3", values(v3(pool, WETH, USDC, ONE_ETH)), watch);
      }
      // WETH is token1, so selling it raises the price: a limit of 1 is behind it, and the pool
      // reverts the swap (SPL), which uniswapV3 passes on.
      const behind = values(v3(UNIV3_USDC_WETH_500, WETH, USDC, ONE_ETH, 0n, 1n));
      await assertSkips(env, CHAIN, "tryUniswapV3", behind, watch);
      await assertReverts(env, CHAIN, "uniswapV3", behind, watch);
    });

    it("a swap that ran and took 1 wei of WETH for nothing reverts tryUniswapV3: 0 would say nothing moved", async () => {
      await fund(WETH, 1n);
      // The Router lands it: the pool keeps the wei as its fee and pays nothing.
      const swap = `swapV3(${BigInt(UNIV3_USDC_WETH_500)}n, ${BigInt(WETH)}n, false, 1n, 0n, ctx.self())`;
      assert.equal(await routerReturns(swap, 1n, 0n), "success");
      assert.equal(await balanceOf(env, WETH, env.pot), 0n);
      await fresh();
      await fund(WETH, 1n);
      const watch = watching(UNIV3_USDC_WETH_500, WETH, USDC);
      await assertReverts(
        env,
        CHAIN,
        "tryUniswapV3",
        values(v3(UNIV3_USDC_WETH_500, WETH, USDC, 1n)),
        watch,
      );
    });

    it("a floor above what the swap delivers reverts the whole cook, uniswapV3 and tryUniswapV3 alike", async () => {
      await fund(WETH, ONE_ETH);
      assert.equal(
        (await cookCall("uniswapV3", v3(UNIV3_USDC_WETH_500, WETH, USDC, ONE_ETH))).status,
        "success",
      );
      const out = await balanceOf(env, USDC, env.pot);
      await fresh();
      await fund(WETH, ONE_ETH);
      const args = values(v3(UNIV3_USDC_WETH_500, WETH, USDC, ONE_ETH, out + 1n));
      const watch = watching(UNIV3_USDC_WETH_500, WETH, USDC);
      for (const name of ["uniswapV3", "tryUniswapV3"]) {
        await assertReverts(env, CHAIN, name, args, watch);
      }
    });
  });

  describe("Through the Pot's Router: Uniswap V4", () => {
    it("USDC -> USDT: every spelling delivers the same, and tryUniswapV4 returns it", async () => {
      await tryMatches(
        "UniV4 USDC->USDT 0.001%, 100 USDC",
        "uniswapV4",
        v4(USDC, USDT, USDC_100),
        [USDC, USDC_100],
        USDT,
      );
    });

    it("USDT -> USDC", async () => {
      await tryMatches(
        "UniV4 USDT->USDC 0.001%, 100 USDT",
        "uniswapV4",
        v4(USDT, USDC, USDC_100),
        [USDT, USDC_100],
        USDC,
      );
    });

    it("tryUniswapV4 skips, moving nothing, a PoolManager with no code and a key no pool has; uniswapV4 reverts on that key", async () => {
      await fund(USDC, USDC_100);
      const watch = watching(POOL_MANAGER, USDC, USDT);
      await assertSkips(
        env,
        CHAIN,
        "tryUniswapV4",
        values(v4(USDC, USDT, USDC_100, { poolManager: CODELESS })),
        watch,
      );
      const nowhere = values(v4(USDC, USDT, USDC_100, { fee: 13n }));
      await assertSkips(env, CHAIN, "tryUniswapV4", nowhere, watch);
      await assertReverts(env, CHAIN, "uniswapV4", nowhere, watch);
    });

    it("tryUniswapV4 skips a pool with no liquidity at its price: the swap runs to a limit inside the gap and moves nothing", async () => {
      // USDC/USDT at fee 11, tick spacing 1: initialized, with no liquidity in range. The pool's
      // state is `_pools[id]` (slot 6 of the PoolManager): slot0 first, the liquidity three slots on.
      const id = keccak256(
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint24" },
            { type: "int24" },
            { type: "address" },
          ],
          [USDC, USDT, 11, 1, NATIVE as Address],
        ),
      );
      const state = BigInt(
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])),
      );
      const word = async (offset: bigint) =>
        BigInt(
          await env.publicClient.readContract({
            address: POOL_MANAGER,
            abi: poolManager,
            functionName: "extsload",
            args: [toHex(state + offset, { size: 32 })],
          }),
        );
      const sqrtPriceX96 = (await word(0n)) & ((1n << 160n) - 1n);
      assert.ok(sqrtPriceX96 > 0n, "the pool is initialized");
      assert.equal(await word(3n), 0n, "and has no liquidity in range");
      // USDC is currency0: selling it lowers the price, so a limit just below it stays in the gap.
      const limit = sqrtPriceX96 - sqrtPriceX96 / 2000n;
      await fund(USDC, USDC_100);
      const key = `{ currency0: ${BigInt(USDC)}n, currency1: ${BigInt(USDT)}n, fee: 11n, tickSpacing: 1n, hooks: 0n }`;
      const swap = `swapV4(${BigInt(POOL_MANAGER)}n, ${key}, ${BigInt(USDC)}n, true, ${USDC_100}n, ${limit}n, ctx.self())`;
      assert.equal(await routerReturns(swap, 0n, 0n), "success", "the swap ran and moved nothing");
      await fresh();
      await fund(USDC, USDC_100);
      const receipt = await assertSkips(
        env,
        CHAIN,
        "tryUniswapV4",
        values(v4(USDC, USDT, USDC_100, { fee: 11n, limit, minOut: 1n })),
        watching(POOL_MANAGER, USDC, USDT),
      );
      assert.ok(receipt.gasUsed < 500_000n, `${receipt.gasUsed}`);
    });

    it("a swap that ran and took one unit of USDC for nothing reverts tryUniswapV4", async () => {
      await fund(USDC, 1n);
      const key = `{ currency0: ${BigInt(USDC)}n, currency1: ${BigInt(USDT)}n, fee: 10n, tickSpacing: 1n, hooks: 0n }`;
      const swap = `swapV4(${BigInt(POOL_MANAGER)}n, ${key}, ${BigInt(USDC)}n, true, 1n, 0n, ctx.self())`;
      assert.equal(await routerReturns(swap, 1n, 0n), "success");
      await fresh();
      await fund(USDC, 1n);
      await assertReverts(
        env,
        CHAIN,
        "tryUniswapV4",
        values(v4(USDC, USDT, 1n)),
        watching(POOL_MANAGER, USDC, USDT),
      );
    });

    it("a floor above what the swap delivers reverts the whole cook, uniswapV4 and tryUniswapV4 alike", async () => {
      await fund(USDC, USDC_100);
      assert.equal((await cookCall("uniswapV4", v4(USDC, USDT, USDC_100))).status, "success");
      const out = await balanceOf(env, USDT, env.pot);
      await fresh();
      await fund(USDC, USDC_100);
      const args = values(v4(USDC, USDT, USDC_100, { minOut: out + 1n }));
      for (const name of ["uniswapV4", "tryUniswapV4"]) {
        await assertReverts(env, CHAIN, name, args, watching(POOL_MANAGER, USDC, USDT));
      }
    });
  });

  describe("Through the Pot's Router: Maverick V2", () => {
    it("the tokens a pool names are tokens, called on as the registry records them", async () => {
      // `tokenA()` and `tokenB()` return the registry's ERC-20: each one's balance of the pool, read
      // through the call, is the explicit `Erc20.ERC20(...)` read's and the token's own.
      const pool = `${BigInt(MAVERICK_USDC_USDT)}`;
      const read = async (expression: string): Promise<bigint> =>
        BigInt(
          await env.returned(
            compileSource(env, CHAIN, `function main(): Uint256 { return ${expression}; }`),
          ),
        );
      for (const [method, token] of [
        ["tokenA", USDC],
        ["tokenB", USDT],
      ] as const) {
        const chained = await read(`Maverick.V2Pool(${pool}).${method}().balanceOf(${pool})`);
        const explicit = await read(
          `Erc20.ERC20(Maverick.V2Pool(${pool}).${method}()).balanceOf(${pool})`,
        );
        assert.equal(chained, explicit);
        assert.equal(chained, await balanceOf(env, token, MAVERICK_USDC_USDT));
        assert.ok(chained > 0n, `the pool holds no ${method}`);
      }
    });

    it("USDC -> USDT: every spelling delivers the same, and tryMaverickV2 returns it", async () => {
      await tryMatches(
        "MaverickV2 USDC->USDT, 10 USDC",
        "maverickV2",
        maverick(MAVERICK_USDC_USDT, USDC, USDT, 10_000_000n),
        [USDC, 10_000_000n],
        USDT,
      );
    });

    it("USDT -> USDC (token B in)", async () => {
      await tryMatches(
        "MaverickV2 USDT->USDC, 10 USDT",
        "maverickV2",
        maverick(MAVERICK_USDC_USDT, USDT, USDC, 10_000_000n),
        [USDT, 10_000_000n],
        USDC,
      );
    });

    it("tryMaverickV2 skips, moving nothing: no code, a pool for another pair, a contract that is no pool", async () => {
      await fund(USDC, USDC_100);
      const watch = watching(MAVERICK_USDC_USDT, USDC, USDT);
      await assertSkips(
        env,
        CHAIN,
        "tryMaverickV2",
        values(maverick(CODELESS, USDC, USDT, USDC_100)),
        watch,
      );
      const elsewhere = values(maverick(MAVERICK_USDC_USDT, USDC, WETH, USDC_100));
      await assertSkips(env, CHAIN, "tryMaverickV2", elsewhere, watch);
      await assertReverts(env, CHAIN, "maverickV2", elsewhere, watch);
      await assertSkips(
        env,
        CHAIN,
        "tryMaverickV2",
        values(maverick(USDC, USDC, USDT, USDC_100)),
        watch,
      );
    });

    it("a floor above what the swap delivers reverts the whole cook, maverickV2 and tryMaverickV2 alike", async () => {
      await fund(USDC, USDC_100);
      assert.equal(
        (await cookCall("maverickV2", maverick(MAVERICK_USDC_USDT, USDC, USDT, 10_000_000n)))
          .status,
        "success",
      );
      const out = await balanceOf(env, USDT, env.pot);
      await fresh();
      await fund(USDC, USDC_100);
      const args = values(maverick(MAVERICK_USDC_USDT, USDC, USDT, 10_000_000n, out + 1n));
      for (const name of ["maverickV2", "tryMaverickV2"]) {
        await assertReverts(env, CHAIN, name, args, watching(MAVERICK_USDC_USDT, USDC, USDT));
      }
    });

    it("one unit of USDC is a real swap here: the pool pays one unit of USDT, which tryMaverickV2 returns", async () => {
      // So a Maverick swap that takes input for nothing cannot be shown on this pool; the rule that
      // reverts one is the V3 and V4 forms' above.
      await fund(USDC, 1n);
      const swap = `swapMaverickV2(${BigInt(MAVERICK_USDC_USDT)}n, ${BigInt(USDC)}n, true, 1n, 2147483647n, ctx.self())`;
      assert.equal(await routerReturns(swap, 1n, 1n), "success");
      await fresh();
      await fund(USDC, 1n);
      const args = values(maverick(MAVERICK_USDC_USDT, USDC, USDT, 1n));
      assert.equal((await cook(returning("tryMaverickV2", args, 1n))).status, "success");
      assert.equal(await balanceOf(env, USDC, env.pot), 0n);
      assert.equal(await balanceOf(env, USDT, env.pot), 1n);
    });
  });

  it("a false-returning token reverts every venue's swap before its pool is touched", async () => {
    const liar = await deployToken(env, "FalseReturnERC20", env.pot, 10n ** 24n);
    const calls: Array<[string, Typed[]]> = [
      [
        "uniswapV2",
        [addr(UNIV2_USDC_WETH), addr(liar), addr(USDC), uint(ONE_ETH), uint(0n), uint(0n), self],
      ],
      [
        "curve",
        [
          addr(CURVE_3POOL),
          addr(liar),
          addr(USDT),
          uint(ONE_ETH),
          uint(1n),
          uint(2n),
          bool(false),
          uint(0n),
          self,
        ],
      ],
      ["balancerV2", balancer(ONE_ETH, 0n, liar)],
      [
        "dodoV2",
        [
          addr(DODO_DVM_WETH_USDC),
          addr(liar),
          addr(USDC),
          uint(ONE_ETH),
          addr(liar),
          addr(USDC),
          uint(0n),
          self,
        ],
      ],
    ];
    for (const [name, args] of calls) {
      assert.equal((await cookCall(name, args)).status, "reverted", name);
      assert.equal(await balanceOf(env, liar, env.pot), 10n ** 24n);
    }
  });

  it("a Pot whose Router has none of these venues still runs them: none calls the Router", async () => {
    await env.testClient.setCode({ address: env.router, bytecode: REVERTING_CODE });
    await fund(WETH, 3n * ONE_ETH);
    await fund(USDC, USDC_100);
    const receipt = await cook(
      routerProgram([
        call("uniswapV2", values(v2(WETH, USDC, ONE_ETH))),
        call("balancerV2", values(balancer(ONE_ETH))),
        call("dodoV2", values(dodoV2(WETH, USDC, ONE_ETH / 100n))),
        call("curve", values(curve3pool(USDC, USDT, USDC_100))),
      ]),
    );
    assert.equal(receipt.status, "success");
    assert.ok((await balanceOf(env, USDT, env.pot)) > 99_000_000n);
  });

  it("one precompiled program picks each venue at run time, in a loop over pools, chaining the amounts", async () => {
    // WETH -> USDC at Uniswap V2, USDC -> USDT in 3pool, USDT -> WETH at another V2 pair, and that
    // WETH -> USDC through Balancer V2: the venue, pool, tokens and amount are all `main` arguments,
    // so the same bytecode serves any route over these venues.
    const program = compileStandalone(
      [
        'import { uniswapV2, curve, balancerV2 } from "@sauce/router";',
        "",
        "interface Leg { venue: Uint256, pool: Address, tokenIn: Address, tokenOut: Address, i: Uint256, j: Uint256, id: Uint256 }",
        "",
        "function main(legs: Leg[], amount: Uint256, minOut: Uint256): Uint256 {",
        "  let out = amount;",
        "  for (let k = 0; k < legs.length; k = k + 1) {",
        "    const leg = legs[k];",
        "    if (leg.venue == 0n) {",
        "      out = uniswapV2(leg.pool, leg.tokenIn, leg.tokenOut, out, 0n, 0n, ctx.self());",
        "    } else if (leg.venue == 3n) {",
        "      out = curve(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.i, leg.j, false, 0n, ctx.self());",
        "    } else {",
        "      out = balancerV2(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.id, 0n, ctx.self());",
        "    }",
        "  }",
        "  require(out >= minOut);",
        "  return out;",
        "}",
      ].join("\n"),
    );
    const legs = [
      { venue: 0n, pool: UNIV2_USDC_WETH, tokenIn: WETH, tokenOut: USDC, i: 0n, j: 0n, id: 0n },
      { venue: 3n, pool: CURVE_3POOL, tokenIn: USDC, tokenOut: USDT, i: 1n, j: 2n, id: 0n },
      { venue: 0n, pool: UNIV2_WETH_USDT, tokenIn: USDT, tokenOut: WETH, i: 0n, j: 0n, id: 0n },
      {
        venue: 4n,
        pool: BALANCER_V2_VAULT,
        tokenIn: WETH,
        tokenOut: USDC,
        i: 0n,
        j: 0n,
        id: BigInt(BALANCER_USDC_WETH_ID),
      },
    ];
    const payload = (minOut: bigint) =>
      toBytes(
        concat([
          toHex(program),
          encodeAbiParameters(
            [
              {
                type: "tuple[]",
                components: [
                  { name: "venue", type: "uint256" },
                  { name: "pool", type: "address" },
                  { name: "tokenIn", type: "address" },
                  { name: "tokenOut", type: "address" },
                  { name: "i", type: "uint256" },
                  { name: "j", type: "uint256" },
                  { name: "id", type: "uint256" },
                ],
              },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [
              legs.map((l) => ({
                ...l,
                pool: l.pool as Address,
                tokenIn: l.tokenIn as Address,
                tokenOut: l.tokenOut as Address,
              })),
              ONE_ETH,
              minOut,
            ],
          ),
        ]),
      );

    // The same four swaps, one after another, written out: what the loop must deliver.
    await fund(WETH, ONE_ETH);
    const written = await cook(
      routerProgram([
        `const a = ${call("uniswapV2", values(v2(WETH, USDC, ONE_ETH)))};`,
        `const b = curve(${BigInt(CURVE_3POOL)}n, ${BigInt(USDC)}n, ${BigInt(USDT)}n, a, 1n, 2n, false, 0n, ctx.self());`,
        `const c = uniswapV2(${BigInt(UNIV2_WETH_USDT)}n, ${BigInt(USDT)}n, ${BigInt(WETH)}n, b, 0n, 0n, ctx.self());`,
        `balancerV2(${BigInt(BALANCER_V2_VAULT)}n, ${BigInt(WETH)}n, ${BigInt(USDC)}n, c, ${BigInt(BALANCER_USDC_WETH_ID)}n, 0n, ctx.self());`,
      ]),
    );
    assert.equal(written.status, "success");
    const expected = await balanceOf(env, USDC, env.pot);
    assert.ok(expected > 2_500_000_000n, `${expected}`);
    await fresh();

    await fund(WETH, ONE_ETH);
    const looped = await env.cook(payload(expected));
    assert.equal(looped.status, "success");
    assert.equal(await balanceOf(env, USDC, env.pot), expected);
    for (const token of [WETH, USDT] as const) {
      assert.equal(await balanceOf(env, token, env.pot), 0n, `${token} left over`);
    }
    await fresh();

    // Its own floor, over what the last leg returned, reverts the whole route.
    await fund(WETH, ONE_ETH);
    assert.equal((await env.cook(payload(expected + 1n))).status, "reverted");
    assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH);
  });
});
