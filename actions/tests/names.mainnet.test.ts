/**
 * One action document — tokens by registry symbol, contracts by namespace, pools by key, and no
 * `chainId` — EXECUTED on more than one chain: Ethereum's and Base's state at their pinned blocks
 * (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. Each program reads its pool
 * from the factory while it runs; each is held to the same trade with the pool and tokens given by
 * address, from the same snapshot. Avalanche runs a Trader Joe pair found by its key, its tokens
 * read from the pair. No RPC is reached.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";

import { compileProgram } from "../src/index.js";
import type { ActionProgram } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import type { ChainName } from "./mainnet.js";
import { balanceOf, setBalance, type BalanceSlot } from "./swap-venues.js";

const doc = (...actions: object[]): ActionProgram =>
  JSON.parse(JSON.stringify({ version: 1, actions })) as ActionProgram;

/** USDC -> WETH through Uniswap V3's 0.05% pool, then the WETH back through the V2 pair: by key. */
const ROUND_TRIP = doc(
  {
    type: "uniswapV3Swap",
    amount: "1000000000",
    tokenIn: "USDC",
    tokenOut: "WETH",
    factory: "UniswapV3.Factory",
    fee: 500,
    amountOutMin: "1",
    recipient: "self",
    saveOutputAs: "weth",
  },
  {
    type: "uniswapV2Swap",
    amountRef: "weth",
    tokenIn: "WETH",
    tokenOut: "USDC",
    factory: "UniswapV2.Factory",
    amountOutMin: "1",
    recipient: "self",
  },
);

interface Venue {
  readonly chain: ChainName;
  readonly USDC: Hex;
  readonly WETH: Hex;
  readonly balance: Readonly<Record<string, BalanceSlot>>;
  /** The pools the round trip's keys name, as their factories record them at the pinned block. */
  readonly v3: Hex;
  readonly v2: Hex;
}

const VENUES: readonly Venue[] = [
  {
    chain: "ethereum",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    balance: { USDC: { slot: 9n }, WETH: { slot: 3n } },
    v3: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    v2: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
  },
  {
    chain: "base",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    balance: { USDC: { slot: 9n }, WETH: { slot: 3n } },
    v3: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    v2: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
  },
];

/** Aerodrome Slipstream's WETH/USDC pool at tick spacing 100, on Base. */
const SLIPSTREAM_WETH_USDC_100 = "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59";

/** One chain's suite: its anvil, and a snapshot every test starts from and returns to. */
function onChain(chain: ChainName, suite: (env: () => Anvil) => void): void {
  describe(`on ${chain} state`, { skip: skipReason(), timeout: 900_000 }, () => {
    let env: Anvil;
    let snapshot: Hex;
    before(async () => {
      env = await startAnvil({ mainnet: `names-${chain}`, chain });
    });
    after(async () => {
      await env?.stop();
    });
    beforeEach(async () => {
      snapshot = await env.testClient.snapshot();
    });
    afterEach(async () => {
      await env.testClient.revert({ id: snapshot });
    });
    suite(() => env);
  });
}

/** Runs each program from the same snapshot, returning what the Pot holds of `tokens` after it. */
async function runEach(
  env: Anvil,
  programs: readonly Uint8Array[],
  fund: () => Promise<void>,
  tokens: readonly Hex[],
): Promise<bigint[][]> {
  const results: bigint[][] = [];
  for (const program of programs) {
    const id = await env.testClient.snapshot();
    await fund();
    const receipt = await env.cook(program);
    assert.equal(receipt.status, "success");
    results.push(await Promise.all(tokens.map((token) => balanceOf(env, token, env.pot))));
    await env.testClient.revert({ id });
  }

  return results;
}

describe("a chain-agnostic action document, executed", () => {
  for (const venue of VENUES) {
    onChain(venue.chain, (env) => {
      const fund = (token: "USDC" | "WETH", amount: bigint) => () =>
        setBalance(env(), venue[token], venue.balance[token]!, env().pot, amount);

      it("a round trip by symbol and pool key delivers what the same trip by address does", async () => {
        const byAddress = doc(
          {
            ...ROUND_TRIP.actions[0],
            factory: undefined,
            fee: undefined,
            pool: venue.v3,
            tokenIn: venue.USDC,
            tokenOut: venue.WETH,
          },
          {
            ...ROUND_TRIP.actions[1],
            factory: undefined,
            pool: venue.v2,
            tokenIn: venue.WETH,
            tokenOut: venue.USDC,
          },
        );
        const [named, addressed] = await runEach(
          env(),
          [
            compileProgram(ROUND_TRIP, { chain: venue.chain }).bytecode,
            compileProgram(byAddress, { chain: venue.chain }).bytecode,
          ],
          fund("USDC", 1_000_000_000n),
          [venue.USDC, venue.WETH],
        );
        assert.deepEqual(named, addressed);
        const [usdc, weth] = named!;
        assert.equal(weth, 0n, "the WETH the first swap bought was all spent by the second");
        assert.ok(usdc! > 900_000_000n && usdc! < 1_000_000_000n, `came back with ${usdc}`);
      });

      it("a key no pool is under reverts the program before anything moves", async () => {
        const program = compileProgram(
          doc({ ...ROUND_TRIP.actions[0], fee: 1234, saveOutputAs: undefined }),
          { chain: venue.chain },
        ).bytecode;
        await fund("USDC", 1_000_000_000n)();
        const receipt = await env().cook(program);
        assert.equal(receipt.status, "reverted");
        assert.equal(await balanceOf(env(), venue.USDC, env().pot), 1_000_000_000n);
      });

      if (venue.chain === "base") {
        it("an Aerodrome Slipstream pool by its factory and tick spacing, through the Router", async () => {
          const swap = {
            type: "uniswapV3Swap",
            amount: "100000000000000000",
            tokenIn: "WETH",
            tokenOut: "USDC",
            amountOutMin: "1",
            recipient: "self",
          };
          const [named, addressed] = await runEach(
            env(),
            [
              compileProgram(
                doc({ ...swap, factory: "AerodromeSlipstream.CLFactory", tickSpacing: 100 }),
                { chain: "base" },
              ).bytecode,
              compileProgram(doc({ ...swap, pool: SLIPSTREAM_WETH_USDC_100 }), { chain: "base" })
                .bytecode,
            ],
            fund("WETH", 10n ** 17n),
            [venue.USDC, venue.WETH],
          );
          assert.deepEqual(named, addressed);
          assert.equal(named![1], 0n, "all the WETH was sold");
          assert.ok(named![0]! > 0n);
        });
      }
    });
  }

  onChain("avalanche", (env) => {
    const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
    const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
    /** The LB v2.2 WAVAX/USDC pair the factory keys at bin step 10. */
    const LB_DEEP = "0x864d4e5Ee7318e97483DB7EB0912E09F161516EA";

    it("a Trader Joe pair by its factory and bin step, its X and Y read from the pair", async () => {
      const swap = {
        type: "traderJoeLBSwap",
        amount: "1000000000000000000",
        tokenIn: WAVAX,
        tokenOut: USDC,
        amountOutMin: "1",
        recipient: "self",
      };
      const [named, addressed] = await runEach(
        env(),
        [
          compileProgram(doc({ ...swap, factory: "TraderJoe.LBFactory", binStep: 10 }), {
            chain: "avalanche",
          }).bytecode,
          compileProgram(doc({ ...swap, pool: LB_DEEP, tokenX: WAVAX, tokenY: USDC }), {
            chain: "avalanche",
          }).bytecode,
        ],
        () => setBalance(env(), WAVAX, { slot: 3n }, env().pot, 10n ** 18n),
        [USDC, WAVAX],
      );
      assert.deepEqual(named, addressed);
      assert.equal(named![1], 0n);
      assert.ok(named![0]! > 0n);
    });
  });
});
