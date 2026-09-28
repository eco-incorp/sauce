/**
 * Uniswap V4 actions EXECUTED against the deployed mainnet Universal Router and PoolManager, on an
 * anvil fork of Ethereum.
 *
 * Anvil, not the hardhat node `to-sauce.test.ts` uses: that fork cannot run V4 (its transient
 * storage support is the reason those V4 cases are skipped), so until this suite V4 had never
 * executed. It found both V4 actions broken — the swap parameters were encoded flat, without the
 * struct's head offset the router's decoder reads, and TAKE's `OPEN_DELTA` was the all-ones word
 * rather than 0, which overflows the router's `uint128` cast.
 *
 * The pool is USDC/USDT at 0.001% (fee 10, tick spacing 1), which also makes USDT the output —
 * a no-return token, so the chained transfer here is the USDT case end to end.
 *
 * Needs `FORK_URL` (an Ethereum mainnet archive RPC), like the other fork suites.
 */
import { after, before, beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, pad, parseAbi, toHex, type Address } from "viem";

import { actionsToSauce } from "../src/to-sauce.js";
import type { RoutingAction } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";

const FORK_URL = process.env.FORK_URL;
if (!FORK_URL) throw new Error("FORK_URL env var is required.");

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;
const UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const RECIPIENT = "0x000000000000000000000000000000000000bEEF" as Address;
const POOL_KEY = { currency0: USDC, currency1: USDT, fee: 10, tickSpacing: 1, hooks: ZERO };
const AMOUNT = 1_000_000n; // 1 USDC

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const v4Single = (extra: Partial<RoutingAction> = {}): RoutingAction =>
  ({
    type: "uniswapV4ExactInput",
    chainId: 1,
    router: UNIVERSAL_ROUTER,
    poolKey: POOL_KEY,
    zeroForOne: true,
    amountIn: `${AMOUNT}`,
    amountOutMin: "990000",
    recipient: RECIPIENT,
    ...extra,
  }) as RoutingAction;

const v4Multi = (extra: Partial<RoutingAction> = {}): RoutingAction =>
  ({
    type: "uniswapV4ExactInputMultiHop",
    chainId: 1,
    router: UNIVERSAL_ROUTER,
    currencyIn: USDC,
    path: [{ intermediateCurrency: USDT, fee: 10, tickSpacing: 1, hooks: ZERO }],
    amountIn: `${AMOUNT}`,
    amountOutMin: "990000",
    recipient: RECIPIENT,
    ...extra,
  }) as RoutingAction;

describe(
  "Uniswap V4 actions — mainnet fork (anvil)",
  { skip: skipReason(), timeout: 300_000 },
  () => {
    let env: Anvil;
    let snapshot: `0x${string}`;

    before(async () => {
      env = await startAnvil({ forkUrl: FORK_URL });
      if (env.chain.id !== 1)
        throw new Error(`FORK_URL is chain ${env.chain.id}; this suite needs Ethereum mainnet`);
      // 10 USDC to the Pot. FiatToken keeps balances in the mapping at slot 9.
      const slot = keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [env.pot, 9n]),
      );
      await env.testClient.setStorageAt({
        address: USDC,
        index: slot,
        value: pad(toHex(10n * AMOUNT)),
      });
    });

    after(() => env?.stop());
    beforeEach(async () => {
      snapshot = await env.testClient.snapshot();
    });
    afterEach(async () => {
      await env.testClient.revert({ id: snapshot });
    });

    const balance = (token: Address, owner: Address) =>
      env.publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: "balanceOf",
        args: [owner],
      });

    it("uniswapV4ExactInput swaps USDC for USDT, paid to the recipient", async () => {
      const receipt = await env.cook(actionsToSauce([v4Single()]));
      assert.equal(receipt.status, "success");
      assert.equal(await balance(USDC, env.pot), 9n * AMOUNT);
      assert.ok((await balance(USDT, RECIPIENT)) >= 990_000n);
    });

    it("uniswapV4ExactInputMultiHop swaps along its path, paid to the recipient", async () => {
      const receipt = await env.cook(actionsToSauce([v4Multi()]));
      assert.equal(receipt.status, "success");
      assert.ok((await balance(USDT, RECIPIENT)) >= 990_000n);
    });

    it("a chained V4 output lands in the Pot and is spent by the next action", async () => {
      const receipt = await env.cook(
        actionsToSauce([
          v4Single({ saveOutputAs: "usdt" }),
          { type: "transfer", chainId: 1, token: USDT, to: RECIPIENT, amountRef: "usdt" },
        ]),
      );
      assert.equal(receipt.status, "success");
      const received = await balance(USDT, RECIPIENT);
      assert.ok(received >= 990_000n);
      assert.equal(
        await balance(USDT, env.pot),
        0n,
        "the transfer should spend exactly the swap's output",
      );
    });

    it("a V4 swap spends a runtime amount: the Pot's whole balance, read by a balanceOf action", async () => {
      const receipt = await env.cook(
        actionsToSauce([
          { type: "balanceOf", chainId: 1, token: USDC },
          v4Multi({ amountIn: undefined, recipient: "self" }),
        ]),
      );
      assert.equal(receipt.status, "success");
      assert.equal(await balance(USDC, env.pot), 0n);
      assert.ok((await balance(USDT, env.pot)) >= 9_900_000n);
    });
  },
);
