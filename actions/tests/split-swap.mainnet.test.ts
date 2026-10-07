/**
 * The split swap EXECUTED against mainnet Uniswap V3 (two fee tiers), Curve 3pool and Uniswap V2,
 * on a local anvil holding mainnet state captured at the pinned block (`mainnet.ts`) — no RPC.
 * Every leg is a `@sauce/router` call, and the Uniswap V3 legs are quoted by the Router that swaps
 * them.
 *
 * The property that matters: split across the four, a trade does at least as well as it would in
 * the best of them alone, which the venues' own quotes at the full amount say.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, pad, parseAbi, toHex, type Address, type Hex } from "viem";

import { compileSplitSwap, quoteAction } from "../src/index.js";
import type { QuoteOptions } from "../src/index.js";
import type { SwapAction } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
/** Uniswap V3's USDC/USDT pools at 0.01% and 0.05%. */
const UNIV3_USDC_USDT = {
  100: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6",
  500: "0x7858E59e0C01EA06Df3aF3D20aC7B0003275D4Bf",
} as const;
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
/** Uniswap V2's USDC/USDT pair. */
const UNIV2_USDC_USDT = "0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f";
const RECEIVER = "0x000000000000000000000000000000000000c0DE";
const USDC_UNIT = 1_000_000n;

const uniswapV3 = (fee: 100 | 500): SwapAction => ({
  type: "uniswapV3Swap",
  pool: UNIV3_USDC_USDT[fee],
  tokenIn: USDC,
  tokenOut: USDT,
  amountOutMin: "1",
  recipient: "self",
});
const CANDIDATES: SwapAction[] = [
  uniswapV3(100),
  uniswapV3(500),
  {
    type: "curveSwap",
    pool: CURVE_3POOL,
    tokenIn: USDC,
    tokenOut: USDT,
    i: 1,
    j: 2,
    indexType: "int128",
    amountOutMin: "1",
    recipient: "self",
  },
  {
    type: "uniswapV2Swap",
    pool: UNIV2_USDC_USDT,
    tokenIn: USDC,
    tokenOut: USDT,
    amountOutMin: "1",
    recipient: "self",
  },
];

/**
 * The quotes are read off the state before the transaction, and the swaps run inside it, so a
 * realized amount drifts from its quote by a unit or two. This slack absorbs that
 * while staying four orders of magnitude below the ~1.7e7-unit gap between the best venue and the
 * next, so a comparison still proves which venue the greedy loop picked.
 */
const DRIFT = 1_000n;

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

describe("split swap, on mainnet state", { skip: skipReason(), timeout: 600_000 }, () => {
  let env: Anvil;
  let snapshot: `0x${string}`;
  /** The Router the stack deployed quotes the Uniswap V3 legs. */
  let quoters: QuoteOptions;

  before(async () => {
    env = await startAnvil({ mainnet: "split-swap" });
    quoters = { router: env.quoteRouter };
  });
  after(async () => {
    await env?.stop();
  });
  beforeEach(async () => {
    snapshot = await env.testClient.snapshot();
    // The quotes cost Router quotes at million-USDC depth: more than a 60M-gas block holds. Set
    // after the snapshot, because reverting to one restores the block gas limit too.
    await env.testClient.setBlockGasLimit({ gasLimit: 1_000_000_000n });
  });
  afterEach(async () => {
    await env.testClient.revert({ id: snapshot });
  });

  const balance = (token: string, owner: string) =>
    env.publicClient.readContract({
      address: token as Address,
      abi: erc20,
      functionName: "balanceOf",
      args: [owner as Address],
    });

  /** Writes `amount` into the Pot's USDC balance (FiatToken's balances are at slot 9). */
  async function fundUsdc(amount: bigint): Promise<void> {
    const slot = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [env.pot, 9n]),
    );
    await env.testClient.setStorageAt({ address: USDC, index: slot, value: pad(toHex(amount)) });
  }

  /** What each candidate alone would pay for all of `amount`, from its own quoter. */
  async function bestSingle(amount: bigint): Promise<bigint> {
    const quotes = await Promise.all(
      CANDIDATES.map(async (candidate) => {
        const { to, data, decode } = quoteAction(
          { ...candidate, amount: `${amount}` } as SwapAction,
          quoters,
        );
        const { data: result } = await env.publicClient.call({ to, data });
        return decode(result as Hex);
      }),
    );

    return quotes.reduce((a, b) => (a > b ? a : b));
  }

  /** Splits `amount` into `buckets`, sweeping the USDT to the receiver; returns what it received. */
  async function split(amount: bigint, buckets: number): Promise<bigint> {
    await fundUsdc(amount);
    const { bytecode, parameters } = compileSplitSwap({
      candidates: CANDIDATES,
      amount: `${amount}`,
      buckets,
      // Waived: these tests compare the split with the best single venue, which a floor would not.
      amountOutMin: "0",
      sweep: { token: USDT, recipient: RECEIVER },
      quoters,
    });
    assert.deepEqual(parameters, []);
    const receipt = await env.cook(bytecode, 0n, 500_000_000n);
    assert.equal(receipt.status, "success");
    assert.equal(await balance(USDC, env.pot), 0n, "the split spends all of the amount");

    return balance(USDT, RECEIVER);
  }

  it("10M USDC split into 10 buckets across four venues does at least as well as the best one", async () => {
    const amount = 10_000_000n * USDC_UNIT;
    const best = await bestSingle(amount);
    const received = await split(amount, 10);
    console.log(`split ${received} USDT vs best single venue ${best} (${received - best} better)`);
    assert.ok(received + DRIFT >= best, `split ${received} < best single ${best}`);
  });

  it("one bucket reduces to the single best venue", async () => {
    const amount = 1_000_000n * USDC_UNIT;
    const best = await bestSingle(amount);
    const received = await split(amount, 1);
    const gap = received > best ? received - best : best - received;
    assert.ok(gap <= DRIFT, `one bucket received ${received}, the best venue quotes ${best}`);
  });

  it("one bucket per venue executes, and does at least as well as the best one", async () => {
    const amount = 4_000_000n * USDC_UNIT;
    const best = await bestSingle(amount);
    const received = await split(amount, CANDIDATES.length);
    assert.ok(received + DRIFT >= best, `split ${received} < best single ${best}`);
  });
});
