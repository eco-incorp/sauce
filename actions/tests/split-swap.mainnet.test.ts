/**
 * The split swap EXECUTED against mainnet Uniswap V3 (two fee tiers), Curve 3pool and Uniswap V2,
 * on a local anvil holding mainnet state captured at the pinned block (`mainnet.ts`) — no RPC.
 * Every leg is a `@sauce/router` call, and the Uniswap V3 legs are quoted by the Router that swaps
 * them.
 *
 * The property that matters: split across the four, a trade does at least as well as it would in
 * the best of them alone, which the venues' own quotes at the full amount say.
 *
 * And each cook spends its own amount. The program keeps its counters in the Pot's transient
 * storage, which lasts the whole transaction, so two split cooks on one Pot in one transaction — a
 * contract wallet's batch, or an owner's two signed cooks that someone else submits together — must
 * do what the same cooks do one transaction at a time, however much more the Pot holds.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import {
  encodeCookSigned,
  signedCookTypedData,
  v12Kitchen,
  v12Pot,
} from "../../sdk/dist/evm/engine.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { compileSplitSwap, quoteAction } from "../src/index.js";
import type { QuoteOptions } from "../src/index.js";
import type { SwapAction } from "../src/types.js";
import { REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";

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
  recipient: "pot",
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
    recipient: "pot",
  },
  {
    type: "uniswapV2Swap",
    pool: UNIV2_USDC_USDT,
    tokenIn: USDC,
    tokenOut: USDT,
    amountOutMin: "1",
    recipient: "pot",
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

/** `sdk/test/evm/fixtures/BatchWallet.sol`: a contract wallet that runs its owner's calls in one
 *  transaction, all of them or none. */
const batchWallet = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "sdk/test/evm/fixtures/BatchWallet.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };

/** Anvil's second dev account: someone other than the owner, who submits the owner's signed cooks. */
const RELAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
/** Each batched split's amount, and the floor on its output, both 1:1-ish stablecoin units. */
const X = 1_000n * USDC_UNIT;
const FLOOR = (X * 99n) / 100n;
/** The sweep recipients of the two batched splits, A and B. */
const RECIPIENT_A = "0x000000000000000000000000000000000000aaaa";
const RECIPIENT_B = "0x000000000000000000000000000000000000bbbb";

/** What a run of batched splits did: the Pot's USDC spent, and each recipient's USDT received. */
interface Outcome {
  readonly spent: bigint;
  readonly toA: bigint;
  readonly toB: bigint;
}

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

  /** Writes `amount` into `pot`'s USDC balance (FiatToken's balances are at slot 9). */
  async function fundUsdc(amount: bigint, pot: Address = env.pot): Promise<void> {
    const slot = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [pot, 9n]),
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

  /** Deploys a BatchWallet that `owner` calls. */
  async function deployBatchWallet(owner: Address): Promise<Address> {
    const owned = encodeAbiParameters([{ type: "address" }], [owner]);
    const receipt = await env.send({
      to: undefined as unknown as Address,
      data: `${batchWallet.creationCode}${owned.slice(2)}`,
    });
    assert.equal(receipt.status, "success");
    assert.ok(receipt.contractAddress, "the BatchWallet has an address");

    return receipt.contractAddress;
  }

  /** Has the Kitchen mint a Pot that `owner` owns; returns the Pot. */
  async function mintPot(owner: Address): Promise<Address> {
    const kitchen = v12KitchenAddress() as Address;
    const receipt = await env.send({
      to: kitchen,
      data: v12Kitchen.encodeDeployPot(owner, POT_SALT),
    });
    assert.equal(receipt.status, "success");

    return env.publicClient.readContract({
      address: kitchen,
      abi: v12Kitchen.abi,
      functionName: "predictPot",
      args: [owner, POT_SALT],
    });
  }

  /** One split of `X` across the four venues in two buckets, its USDT swept to `recipient`. */
  const splitOf = (recipient: Address): Hex =>
    toHex(
      compileSplitSwap({
        candidates: CANDIDATES,
        amount: `${X}`,
        buckets: 2,
        amountOutMin: `${FLOOR}`,
        sweep: { token: USDT, recipient },
        quoters,
      }).bytecode,
    );

  /** `account` has `wallet` make `calls`, in order, in one transaction. */
  async function batch(
    wallet: Address,
    account: LocalAccount,
    calls: readonly { to: Address; data: Hex }[],
  ): Promise<TransactionReceipt> {
    const hash = await env.walletClient.sendTransaction({
      account,
      chain: env.chain,
      to: wallet,
      data: encodeFunctionData({
        abi: batchWallet.abi,
        functionName: "executeBatch",
        args: [calls.map(({ to, data }) => ({ target: to, value: 0n, data }))],
      }),
      gas: 400_000_000n,
    });

    return env.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Gives `pot` 3X of USDC — X more than two splits declare — and runs `submit`: what the Pot
   * spent, and what each recipient received.
   */
  async function outcome(
    pot: Address,
    submit: () => Promise<TransactionReceipt[]>,
  ): Promise<Outcome> {
    await fundUsdc(3n * X, pot);
    const usdc = await balance(USDC, pot);
    const toA = await balance(USDT, RECIPIENT_A);
    const toB = await balance(USDT, RECIPIENT_B);
    for (const receipt of await submit()) assert.equal(receipt.status, "success");

    return {
      spent: usdc - (await balance(USDC, pot)),
      toA: (await balance(USDT, RECIPIENT_A)) - toA,
      toB: (await balance(USDT, RECIPIENT_B)) - toB,
    };
  }

  /** Runs `run`, then puts the chain back as it was before. */
  async function isolated<T>(run: () => Promise<T>): Promise<T> {
    const id = await env.testClient.snapshot();
    try {
      return await run();
    } finally {
      await env.testClient.revert({ id });
    }
  }

  /** Two runs of the same cooks, one transaction each and all in one, did the same. */
  function sameAsApart(together: Outcome, apart: Outcome): void {
    assert.equal(apart.spent, 2n * X, "one transaction at a time, the cooks spend 2X");
    assert.equal(together.spent, 2n * X, "in one transaction, the cooks spend 2X, not more");
    for (const recipient of ["toA", "toB"] as const) {
      const [got, want] = [together[recipient], apart[recipient]];
      const gap = got > want ? got - want : want - got;
      assert.ok(gap <= DRIFT, `${recipient}: ${got} in one transaction, ${want} apart`);
    }
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

  it("two split cooks on one Pot in one transaction each spend their own amount", async () => {
    const wallet = await deployBatchWallet(env.account.address);
    const pot = await mintPot(wallet);
    const cookA = { to: pot, data: v12Pot.encodeCook(env.engine, splitOf(RECIPIENT_A)) };
    const cookB = { to: pot, data: v12Pot.encodeCook(env.engine, splitOf(RECIPIENT_B)) };

    const apart = await isolated(() =>
      outcome(pot, async () => [
        await batch(wallet, env.account, [cookA]),
        await batch(wallet, env.account, [cookB]),
      ]),
    );
    const together = await outcome(pot, async () => [
      await batch(wallet, env.account, [cookA, cookB]),
    ]);
    sameAsApart(together, apart);
  });

  it("the same split cooked twice in one transaction spends twice its amount", async () => {
    const wallet = await deployBatchWallet(env.account.address);
    const pot = await mintPot(wallet);
    const cookB = { to: pot, data: v12Pot.encodeCook(env.engine, splitOf(RECIPIENT_B)) };

    const apart = await isolated(() =>
      outcome(pot, async () => [
        await batch(wallet, env.account, [cookB]),
        await batch(wallet, env.account, [cookB]),
      ]),
    );
    const together = await outcome(pot, async () => [
      await batch(wallet, env.account, [cookB, cookB]),
    ]);
    sameAsApart(together, apart);
  });

  it("an owner's two signed split cooks, submitted together by someone else, each spend their own amount", async () => {
    const relayer = privateKeyToAccount(RELAYER_KEY);
    await env.testClient.setBalance({ address: relayer.address, value: 10n ** 18n });
    const wallet = await deployBatchWallet(relayer.address);
    const { timestamp } = await env.publicClient.getBlock();
    const signed = async (program: Hex, nonce: bigint) => {
      const execution = {
        chainId: env.chain.id,
        pot: env.pot,
        engine: env.engine,
        program,
        maxExecutionFee: 0n,
        nonce,
        deadline: timestamp + 3600n,
      };
      const signature = await env.walletClient.signTypedData({
        account: env.account,
        ...signedCookTypedData(execution),
      });
      const { to, data } = encodeCookSigned({ ...execution, signature });

      return { to, data };
    };
    const cookA = await signed(splitOf(RECIPIENT_A), 1n);
    const cookB = await signed(splitOf(RECIPIENT_B), 2n);

    const apart = await isolated(() =>
      outcome(env.pot, async () => [
        await batch(wallet, relayer, [cookA]),
        await batch(wallet, relayer, [cookB]),
      ]),
    );
    const together = await outcome(env.pot, async () => [
      await batch(wallet, relayer, [cookA, cookB]),
    ]);
    sameAsApart(together, apart);
  });
});
