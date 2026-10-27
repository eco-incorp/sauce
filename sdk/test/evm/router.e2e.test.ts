/**
 * The generation-4 Router and the Pot's own Router, EXECUTED on a local anvil: the released stack
 * deployed from creation code at its release addresses (`gated-engine.ts`), nothing forked.
 *
 *   1. `potRouterUpdate` — a Pot left on an old Router gets the `setRouter` call back, only its owner
 *      can make it, and afterwards the Pot is current. The Kitchen cannot move an existing Pot.
 *   2. A Synthra-V3-style swap through `@sauce/router`'s `uniswapV3` — a pool that re-enters under
 *      `synthraV3SwapCallback` is paid by the generation-4 Router, a callback name the Router does
 *      not answer reverts (what a pre-generation-4 Router does with Synthra's), and a pool asking
 *      for more than the exact input is refused with `InputExceedsAuthorized`.
 *   3. The same pools through `tryUniswapV3`: the paid swap delivers exactly what `uniswapV3` does,
 *      and each refusal above — an unanswered callback, `InputExceedsAuthorized`, a codeless pool, a
 *      pool for another pair — returns 0 with the Pot and the pool untouched and the cook landed.
 *   4. `Router.flash(callback, swap)`, the one Router entry that runs a program as the Pot inside the
 *      callback of a pool it swaps with: the callback runs as the Pot and repays with a nested swap,
 *      a short repayment reverts the whole cook, the nested swap's floor is what keeps the Pot's own
 *      balance from paying a shortfall, and each refusal here (`CallbackNotRun`, `UnknownSwap`,
 *      `UnauthorizedCaller`) leaves every balance as it was.
 *
 * The pool is v12's own `test/mocks/MockV3Pool.sol` (copied into `fixtures/`, built by forge from
 * the same tree as the Router): Uniswap V3's `swap` selector, a settable callback selector, and a
 * knob that inflates what it asks to be paid.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  stringToHex,
  toFunctionSelector,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12DeployedAddresses } from "../../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { potRouterUpdate, v12KitchenAbi, v12PotAbi } from "../../src/evm/engine.js";
import { compileSauceRoute } from "../../src/routes/sauce-route.js";
import { POT_SALT, startGatedEngine } from "./gated-engine.js";
import { potFromReleasedBytecode } from "./pot-address.js";
import type { GatedEngine } from "./gated-engine.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const MOCK_ERC20 = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "../std/token/fixtures/MockERC20.json"),
);
const MOCK_V3_POOL = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/MockV3Pool.json"));
const ROUTER = json<{ abi: Abi; bytecode: Hex }>(join(HERE, "../../src/artifacts/Router.json"));
const ISAUCE_ROUTER = json<{ abi: Abi }>(join(HERE, "../../src/artifacts/ISauceRouter.json"));

/** Anvil's first dev account: the harness's deployer, the Kitchen's owner and the Pot's. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Anvil's second: anyone else. */
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** Sends from `from`, resolving to the receipt's status rather than throwing on a revert. */
const sendAs = async (
  from: typeof OWNER,
  to: Address,
  data: Hex,
): Promise<"success" | "reverted"> => {
  const hash = await walletClient.sendTransaction({
    account: from,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });

  return (await publicClient.waitForTransactionReceipt({ hash })).status;
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data: creationCode,
    gas: GAS_LIMIT,
  });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  if (!contractAddress) throw new Error("a deployment produced no contract address");

  return contractAddress;
};

/** The revert data an `eth_call` from `from` comes back with, or undefined when it succeeds. */
const revertOf = async (from: Address, to: Address, data: Hex): Promise<Hex | undefined> => {
  try {
    await publicClient.call({ account: from, data, gas: GAS_LIMIT, to });
    return undefined;
  } catch (error) {
    const found = (error as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => typeof (e as { data?: unknown }).data === "string",
    ) as { data?: Hex } | undefined;

    return found?.data ?? "0x";
  }
};

const potRouter = (pot: Address): Promise<Address> =>
  publicClient.readContract({ abi: v12PotAbi, address: pot, functionName: "router" });

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

let anvil: ChildProcess;
let sauce: GatedEngine;

describeEvm("the Pot's Router, and swaps a generation-4 Router pays", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("the live Kitchen predicts the Pot the SDK derives for an owner", async () => {
    // Any owner: a Pot's address is the Kitchen's CREATE2 of (owner, salt), deployed or not.
    const owner = STRANGER.address;
    const predicted = await publicClient.readContract({
      abi: v12KitchenAbi,
      address: sauce.kitchen,
      args: [owner, DEFAULT_POT_SALT],
      functionName: "predictPot",
    });
    expect(predicted).toBe(v12PredictPot(owner));
    expect(predicted).toBe(potFromReleasedBytecode(owner));
  });

  describe("potRouterUpdate", () => {
    it("returns nothing for a Pot already on its Kitchen's Router", async () => {
      expect(await potRouter(sauce.pot)).toBe(sauce.router);
      expect(await potRouterUpdate(publicClient, sauce.pot)).toBeUndefined();
    });

    it("hands back the switch for a Pot the Kitchen moved past, which only its owner can sign", async () => {
      // A new Router on the Kitchen: what a Router rollout is. The Kitchen's own switch is its
      // owner's alone…
      const next = await deploy(ROUTER.bytecode);
      const kitchenSwitch = encodeFunctionData({
        abi: v12KitchenAbi,
        args: [next],
        functionName: "setRouter",
      });
      expect(await sendAs(STRANGER, sauce.kitchen, kitchenSwitch)).toBe("reverted");
      expect(await sendAs(OWNER, sauce.kitchen, kitchenSwitch)).toBe("success");

      // …and it moves no existing Pot: the harness Pot is still on the Router it was minted with.
      expect(await potRouter(sauce.pot)).toBe(sauce.router);

      const update = await potRouterUpdate(publicClient, sauce.pot);
      expect(update).toEqual({
        to: sauce.pot,
        data: encodeFunctionData({ abi: v12PotAbi, args: [next], functionName: "setRouter" }),
      });

      // Anyone but the owner is refused with NotOwner().
      const refusal = await revertOf(STRANGER.address, update!.to, update!.data);
      expect(decodeErrorResult({ abi: v12PotAbi, data: refusal! }).errorName).toBe("NotOwner");
      expect(await sendAs(STRANGER, update!.to, update!.data)).toBe("reverted");
      expect(await potRouter(sauce.pot)).toBe(sauce.router);

      // The owner signs it; the Pot is current, and says so.
      expect(await sendAs(OWNER, update!.to, update!.data)).toBe("success");
      expect(await potRouter(sauce.pot)).toBe(getAddress(next));
      expect(await potRouterUpdate(publicClient, sauce.pot)).toBeUndefined();

      // A Pot minted after the Kitchen's switch starts on the new Router.
      const salt = `0x${"00".repeat(31)}08` as Hex;
      expect(
        await sendAs(
          OWNER,
          sauce.kitchen,
          encodeFunctionData({
            abi: v12KitchenAbi,
            args: [STRANGER.address, salt],
            functionName: "deployPot",
          }),
        ),
      ).toBe("success");
      const fresh = await publicClient.readContract({
        abi: v12KitchenAbi,
        address: sauce.kitchen,
        args: [STRANGER.address, salt],
        functionName: "predictPot",
      });
      expect(await potRouter(fresh)).toBe(getAddress(next));
      expect(await potRouterUpdate(publicClient, fresh)).toBeUndefined();

      // Back to the release's Router, for the swaps below — the same owner-only path.
      expect(
        await sendAs(
          OWNER,
          sauce.pot,
          encodeFunctionData({ abi: v12PotAbi, args: [sauce.router], functionName: "setRouter" }),
        ),
      ).toBe("success");
      expect(POT_SALT).not.toBe(salt);
    });

    it("refuses a switch to an address with no code", async () => {
      const refusal = await revertOf(
        OWNER.address,
        sauce.pot,
        encodeFunctionData({
          abi: v12PotAbi,
          args: ["0x000000000000000000000000000000000000dEaD"],
          functionName: "setRouter",
        }),
      );
      expect(decodeErrorResult({ abi: v12PotAbi, data: refusal! }).errorName).toBe(
        "RouterHasNoCode",
      );
    });
  });

  describe("a Synthra V3 pool through the generation-4 Router", () => {
    const AMOUNT_IN = 1_000n;
    const RATE = 2n * 10n ** 18n; // token0 -> token1 at 2x
    let token0: Address;
    let token1: Address;

    /** A funded pool for token0 -> token1 that calls back under `callback`. */
    const pool = async (callback: string, inputAdjustment = 0n): Promise<Address> => {
      const at = await deploy(
        `${MOCK_V3_POOL.creationCode}${encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "uint256" }],
          [token0, token1, 3000, RATE],
        ).slice(2)}` as Hex,
      );
      const set = (functionName: string, args: readonly unknown[]) =>
        sendAs(OWNER, at, encodeFunctionData({ abi: MOCK_V3_POOL.abi, functionName, args }));
      expect(await set("setCallbackSelector", [toFunctionSelector(callback)])).toBe("success");
      if (inputAdjustment !== 0n) {
        expect(await set("setInputAdjustment", [inputAdjustment])).toBe("success");
      }
      await sendAs(
        OWNER,
        token1,
        encodeFunctionData({ abi: erc20, args: [at, 10n ** 24n], functionName: "mint" }),
      );

      return at;
    };

    /** The route call a program calling `@sauce/router`'s `uniswapV3` on the pool compiles to. */
    const swapCall = (at: Address): { to: Address; data: Hex } => {
      const source = [
        'import { uniswapV3 } from "@sauce/router";',
        "function main() {",
        `  uniswapV3(${BigInt(at)}n, ${BigInt(token0)}n, ${BigInt(token1)}n, ${AMOUNT_IN}n, 0n, 0n, ctx.self());`,
        "}",
      ].join("\n");
      const { calls } = compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot });

      return { data: calls[0]!.data, to: sauce.pot };
    };

    beforeAll(async () => {
      const [a, b] = [await deploy(MOCK_ERC20.creationCode), await deploy(MOCK_ERC20.creationCode)];
      [token0, token1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      await sendAs(
        OWNER,
        token0,
        encodeFunctionData({ abi: erc20, args: [sauce.pot, 10n ** 24n], functionName: "mint" }),
      );
    });

    it("is the release's content-addressed Router, and it answers both renamed callbacks", () => {
      expect(v12DeployedAddresses().evm.contracts.router.addressing).toBe("content");
      const answered = ISAUCE_ROUTER.abi
        .filter((item) => item.type === "function")
        .map((item) => (item as { name: string }).name);
      expect(answered).toEqual(
        expect.arrayContaining(["synthraV3SwapCallback", "unitFlowV3SwapCallback"]),
      );
      // The selector Synthra's own pools call back (see the synthra-v3 skill document).
      expect(toFunctionSelector("synthraV3SwapCallback(int256,int256,bytes)")).toBe("0x13abb0ca");
    });

    it("pays the pool the exact input from the Pot and delivers the output to it", async () => {
      const at = await pool("synthraV3SwapCallback(int256,int256,bytes)");
      const { to, data } = swapCall(at);
      const [potIn, potOut] = [await balance(token0, sauce.pot), await balance(token1, sauce.pot)];

      expect(await sendAs(OWNER, to, data)).toBe("success");
      expect(await balance(token0, at)).toBe(AMOUNT_IN);
      expect(await balance(token0, sauce.pot)).toBe(potIn - AMOUNT_IN);
      expect(await balance(token1, sauce.pot)).toBe(potOut + (AMOUNT_IN * RATE) / 10n ** 18n);
    });

    it("reverts when the pool calls back under a name the Router does not answer", async () => {
      // What a Router older than generation 3 does with `synthraV3SwapCallback`: the Pot's fallback
      // delegatecalls a Router with no such function, and the swap dies.
      const at = await pool("someOtherV3SwapCallback(int256,int256,bytes)");
      const { to, data } = swapCall(at);
      expect(await sendAs(OWNER, to, data)).toBe("reverted");
      expect(await balance(token0, at)).toBe(0n);
    });

    it("refuses a pool asking for more than the exact input: InputExceedsAuthorized", async () => {
      const at = await pool("synthraV3SwapCallback(int256,int256,bytes)", 1n);
      const { to, data } = swapCall(at);
      const refusal = await revertOf(OWNER.address, to, data);
      expect(refusal).toBeDefined();
      expect(
        refusal!.includes(toFunctionSelector("InputExceedsAuthorized(uint256,uint256)").slice(2)),
      ).toBe(true);
      expect(getAddress(to)).toBe(sauce.pot);
      expect(await sendAs(OWNER, to, data)).toBe("reverted");
      expect(await balance(token0, at)).toBe(0n);
    });

    /**
     * The route call a program calling `@sauce/router`'s `tryUniswapV3` compiles to: it requires
     * the function to return `expected`, so a cook that lands proves the skip-or-swap verdict too.
     */
    const trySwapCall = (
      at: Address,
      expected: bigint,
      tokenOut: Address = token1,
    ): { to: Address; data: Hex } => {
      const source = [
        'import { tryUniswapV3 } from "@sauce/router";',
        "function main() {",
        `  const got = tryUniswapV3(${BigInt(at)}n, ${BigInt(token0)}n, ${BigInt(tokenOut)}n, ${AMOUNT_IN}n, 0n, 0n, ctx.self());`,
        `  require(got == ${expected}n);`,
        "}",
      ].join("\n");
      const { calls } = compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot });

      return { data: calls[0]!.data, to: sauce.pot };
    };

    describe("tryUniswapV3: the same swap, or nothing", () => {
      it("swaps exactly as uniswapV3 does when the pool is paid, returning what it delivered", async () => {
        const at = await pool("synthraV3SwapCallback(int256,int256,bytes)");
        const out = (AMOUNT_IN * RATE) / 10n ** 18n;
        const { to, data } = trySwapCall(at, out);
        const [potIn, potOut] = [
          await balance(token0, sauce.pot),
          await balance(token1, sauce.pot),
        ];

        expect(await sendAs(OWNER, to, data)).toBe("success");
        expect(await balance(token0, at)).toBe(AMOUNT_IN);
        expect(await balance(token0, sauce.pot)).toBe(potIn - AMOUNT_IN);
        expect(await balance(token1, sauce.pot)).toBe(potOut + out);
      });

      it("returns 0 having moved nothing when the pool calls back under a name the Router does not answer", async () => {
        const at = await pool("someOtherV3SwapCallback(int256,int256,bytes)");
        const { to, data } = trySwapCall(at, 0n);
        const [potIn, potOut] = [
          await balance(token0, sauce.pot),
          await balance(token1, sauce.pot),
        ];

        // `uniswapV3` reverts the whole program here (above); the try form lands it.
        expect(await sendAs(OWNER, to, data)).toBe("success");
        expect(await balance(token0, at)).toBe(0n);
        expect(await balance(token0, sauce.pot)).toBe(potIn);
        expect(await balance(token1, sauce.pot)).toBe(potOut);
      });

      it("returns 0 having moved nothing when the Router refuses the pool's ask (InputExceedsAuthorized)", async () => {
        const at = await pool("synthraV3SwapCallback(int256,int256,bytes)", 1n);
        const { to, data } = trySwapCall(at, 0n);
        const potIn = await balance(token0, sauce.pot);

        expect(await sendAs(OWNER, to, data)).toBe("success");
        expect(await balance(token0, at)).toBe(0n);
        expect(await balance(token0, sauce.pot)).toBe(potIn);
      });

      it("returns 0 for an address with no code and for a pool that is not this pair's", async () => {
        const codeless = trySwapCall("0x000000000000000000000000000000000000dEaD", 0n);
        expect(await sendAs(OWNER, codeless.to, codeless.data)).toBe("success");

        const at = await pool("synthraV3SwapCallback(int256,int256,bytes)");
        const potIn = await balance(token0, sauce.pot);
        const elsewhere = trySwapCall(at, 0n, "0x000000000000000000000000000000000000bEEF");
        expect(await sendAs(OWNER, elsewhere.to, elsewhere.data)).toBe("success");
        expect(await balance(token0, at)).toBe(0n);
        expect(await balance(token0, sauce.pot)).toBe(potIn);
      });

      it("PLANTED: requiring a different return makes the same cook revert, so each cell's verdict is real", async () => {
        const at = await pool("someOtherV3SwapCallback(int256,int256,bytes)");
        const { to, data } = trySwapCall(at, 1n);
        expect(await sendAs(OWNER, to, data)).toBe("reverted");
      });
    });
  });

  describe("Router.flash: a program the Pot runs inside the callback of the pool it borrows from", () => {
    const ONE = 10n ** 18n;
    /** Above the lowest price a V3 pool takes: a bound for selling token0 that never binds. */
    const PRICE_BOUND = 4_295_128_740n;
    /** The borrow pool pays 2 token1 for each token0 the Pot owes it. */
    const BORROW_RATE = 2n * ONE;
    /** What the Pot owes the borrow pool, and the token1 that pool sends it first. */
    const OWED = 3_000n;
    const BORROWED = (OWED * BORROW_RATE) / ONE;
    /** A resale pool paying 1 token0 for 1.5 token1 turns BORROWED into more than OWED… */
    const KIND_RATE = (3n * ONE) / 2n;
    const PROFIT = (BORROWED * ONE) / KIND_RATE - OWED;
    /** …and one paying 1 token0 for 3 token1 turns it into less. */
    const HARSH_RATE = 3n * ONE;
    const SHORTFALL = OWED - (BORROWED * ONE) / HARSH_RATE;
    /** What the Pot holds before the cook: token0 enough to cover SHORTFALL, or not. */
    const HELD0 = 5_000n;
    const SCANT0 = 400n;
    const HELD1 = 777n;
    const POOL_FUNDS = 10n ** 12n;

    interface Flash {
      token0: Address;
      token1: Address;
      /** The pool `flash` sells token0 into: it sends the Pot token1 before it is paid. */
      borrow: Address;
      /** The pool the callback sells that token1 into, for token0. */
      resale: Address;
    }

    const mint = (token: Address, to: Address, amount: bigint) =>
      sendAs(
        OWNER,
        token,
        encodeFunctionData({ abi: erc20, args: [to, amount], functionName: "mint" }),
      );

    /** Two fresh tokens, a borrow pool and a resale pool of them, and the Pot's holdings. */
    const scenario = async (resaleRate: bigint, held0: bigint): Promise<Flash> => {
      const [a, b] = [await deploy(MOCK_ERC20.creationCode), await deploy(MOCK_ERC20.creationCode)];
      const [token0, token1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      const pools: Address[] = [];
      for (const rate of [BORROW_RATE, resaleRate]) {
        pools.push(
          await deploy(
            `${MOCK_V3_POOL.creationCode}${encodeAbiParameters(
              [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "uint256" }],
              [token0, token1, 3000, rate],
            ).slice(2)}` as Hex,
          ),
        );
      }
      const [borrow, resale] = pools as [Address, Address];
      expect(await mint(token1, borrow, POOL_FUNDS)).toBe("success");
      expect(await mint(token0, resale, POOL_FUNDS)).toBe("success");
      expect(await mint(token0, sauce.pot, held0)).toBe("success");
      expect(await mint(token1, sauce.pot, HELD1)).toBe("success");

      return { token0, token1, borrow, resale };
    };

    /** Every balance the flash can move: the Pot's and the two pools', token0 then token1. */
    const ledger = async (s: Flash) => ({
      pot: [await balance(s.token0, sauce.pot), await balance(s.token1, sauce.pot)],
      borrow: [await balance(s.token0, s.borrow), await balance(s.token1, s.borrow)],
      resale: [await balance(s.token0, s.resale), await balance(s.token1, s.resale)],
    });

    /** The Router's `swapV3` calldata `flash` runs: OWED token0 into the borrow pool, to the Pot. */
    const borrowSwap = (s: Flash): Hex =>
      encodeFunctionData({
        abi: ISAUCE_ROUTER.abi,
        args: [s.borrow, s.token0, true, OWED, PRICE_BOUND, sauce.pot],
        functionName: "swapV3",
      });

    interface Program {
      /** The token1 the callback requires the Pot to hold on entry: the pool paid out first. */
      entry1: bigint;
      /** The token0 `main` requires the Pot to hold once `flash` returns. */
      after0: bigint;
      /** Who the callback requires it runs as: the Pot `main` read, unless planted. */
      identity?: Address;
      /** The `minOut` of the callback's sale of what the borrow pool sent; 0 sets no floor. */
      floor?: bigint;
      /** The swap `flash` runs, the borrow pool's `swapV3` unless given. */
      swap?: Hex;
    }

    /**
     * A program that borrows through `flash`, called on `pot` through the Router ABI. Its callback
     * is a `program(() => …)` closure over `self`, which `main` read before the flash: it requires
     * that it runs as that Pot, logs who it ran as, requires the pool's output to be there already,
     * and sells that output in the resale pool to repay.
     */
    const flashSource = (s: Flash, p: Program): string => {
      const identity = p.identity === undefined ? "self" : `${BigInt(p.identity)}n`;
      const swap = (p.swap ?? borrowSwap(s)).slice(2);

      return [
        'import { uniswapV3 } from "@sauce/router";',
        'import { balanceOf } from "@sauce/token";',
        'import { ISauceRouter } from "./artifacts/ISauceRouter.json";',
        "function main() {",
        "  const self = ctx.self();",
        "  const callback = program(() => {",
        `    require(ctx.self() == ${identity}, "callback: not the Pot");`,
        `    require(pot == ${identity}, "callback: pot is not the Pot");`,
        "    log(abi.encode(ctx.self(), pot, self));",
        `    require(balanceOf(${BigInt(s.token1)}n, pot) == ${p.entry1}n, "callback: no output yet");`,
        `    uniswapV3(${BigInt(s.resale)}n, ${BigInt(s.token1)}n, ${BigInt(s.token0)}n, ${BORROWED}n, 0n, ${p.floor ?? 0n}n, pot);`,
        "  });",
        `  ISauceRouter.at(pot).flash(callback.code.concat(callback.args), hex\`${swap}\`);`,
        `  require(balanceOf(${BigInt(s.token0)}n, pot) == ${p.after0}n, "after: token0 held");`,
        "}",
      ].join("\n");
    };

    const cookOf = (s: Flash, p: Program): Hex =>
      compileSauceRoute("base", flashSource(s, p), { engine: sauce.engine, pot: sauce.pot })
        .calls[0]!.data;

    /** `data` from `from` to `to` is refused, with `error` in its revert data, and moves nothing. */
    const refuses = async (
      s: Flash,
      [from, to, data]: readonly [typeof OWNER, Address, Hex],
      error?: Hex,
    ): Promise<void> => {
      const before = await ledger(s);
      const refusal = await revertOf(from.address, to, data);
      expect(refusal).toBeDefined();
      if (error !== undefined) expect(refusal).toContain(error.slice(2));
      expect(await sendAs(from, to, data)).toBe("reverted");
      expect(await ledger(s)).toEqual(before);
    };

    /** The resale repays OWED and leaves PROFIT; the Pot's own holdings are not touched. */
    const PROFITABLE: Program = { entry1: HELD1 + BORROWED, after0: HELD0 + PROFIT };

    it("runs the callback as the Pot, repays the pool with a nested swap and keeps the profit", async () => {
      const s = await scenario(KIND_RATE, HELD0);
      const hash = await walletClient.sendTransaction({
        account: OWNER,
        chain: null,
        data: cookOf(s, PROFITABLE),
        gas: GAS_LIMIT,
        to: sauce.pot,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      expect(receipt.status).toBe("success");
      // The callback's log: `ctx.self()`, `pot` and the `self` main read before the flash, all the Pot.
      const pot = BigInt(sauce.pot);
      expect(receipt.logs.map((log) => log.data)).toContain(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
          [pot, pot, pot],
        ),
      );
      expect(await ledger(s)).toEqual({
        pot: [HELD0 + PROFIT, HELD1],
        borrow: [OWED, POOL_FUNDS - BORROWED],
        resale: [POOL_FUNDS - OWED - PROFIT, BORROWED],
      });
    });

    it("reverts the whole cook when the callback leaves the Pot short of what it owes", async () => {
      // The resale returns OWED - SHORTFALL, and the Pot's SCANT0 does not make up SHORTFALL.
      const s = await scenario(HARSH_RATE, SCANT0);
      await refuses(
        s,
        [OWNER, sauce.pot, cookOf(s, { entry1: HELD1 + BORROWED, after0: 0n })],
        encodeErrorResult({
          abi: MOCK_ERC20.abi,
          args: [sauce.pot, SCANT0 + OWED - SHORTFALL, OWED],
          errorName: "ERC20InsufficientBalance",
        }),
      );
    });

    it("pays a shortfall out of the Pot's own balance unless the nested swap sets a floor", async () => {
      const s = await scenario(HARSH_RATE, HELD0);
      const unfloored: Program = { entry1: HELD1 + BORROWED, after0: HELD0 - SHORTFALL };
      // A floor at what the Pot owes refuses the resale's OWED - SHORTFALL, and nothing moves…
      await refuses(s, [OWNER, sauce.pot, cookOf(s, { ...unfloored, floor: OWED })]);
      // …and without one the same cook lands, the Pot's own token0 paying the difference.
      expect(await sendAs(OWNER, sauce.pot, cookOf(s, unfloored))).toBe("success");
      expect(await ledger(s)).toEqual({
        pot: [HELD0 - SHORTFALL, HELD1],
        borrow: [OWED, POOL_FUNDS - BORROWED],
        resale: [POOL_FUNDS - OWED + SHORTFALL, BORROWED],
      });
    });

    it("refuses a borrow pool that never calls back: CallbackNotRun", async () => {
      const s = await scenario(KIND_RATE, HELD0);
      const skip = encodeFunctionData({
        abi: MOCK_V3_POOL.abi,
        args: [true],
        functionName: "setSkipCallback",
      });
      expect(await sendAs(OWNER, s.borrow, skip)).toBe("success");
      await refuses(
        s,
        [OWNER, sauce.pot, cookOf(s, PROFITABLE)],
        encodeErrorResult({ abi: ROUTER.abi, errorName: "CallbackNotRun" }),
      );
    });

    it("refuses a swap that is none of its own entry points: UnknownSwap", async () => {
      const s = await scenario(KIND_RATE, HELD0);
      // The pool's own `swap`, rather than the Router's `swapV3` on it.
      const swap = encodeFunctionData({
        abi: MOCK_V3_POOL.abi,
        args: [sauce.pot, true, OWED, PRICE_BOUND, "0x"],
        functionName: "swap",
      });
      await refuses(
        s,
        [OWNER, sauce.pot, cookOf(s, { ...PROFITABLE, swap })],
        encodeErrorResult({ abi: ROUTER.abi, args: [swap.slice(0, 10)], errorName: "UnknownSwap" }),
      );
    });

    it("refuses flash called on the Pot or the Router by anyone, the owner too: UnauthorizedCaller", async () => {
      const s = await scenario(KIND_RATE, HELD0);
      // A program that would hand them the Pot's token0 if it ran as the Pot. It never runs: each
      // call is refused before `flash` arms it.
      const drain = compileSauceRoute(
        "base",
        [
          'import { transfer } from "@sauce/token";',
          "function main() {",
          `  transfer(${BigInt(s.token0)}n, ${BigInt(STRANGER.address)}n, ${HELD0}n);`,
          "}",
        ].join("\n"),
        { engine: sauce.engine, pot: sauce.pot },
      ).compiled.bytecode[0]!;
      const data = encodeFunctionData({
        abi: ISAUCE_ROUTER.abi,
        args: [bytesToHex(drain), borrowSwap(s)],
        functionName: "flash",
      });
      const unauthorized = encodeErrorResult({ abi: ROUTER.abi, errorName: "UnauthorizedCaller" });

      await refuses(s, [STRANGER, sauce.pot, data], unauthorized);
      await refuses(s, [OWNER, sauce.pot, data], unauthorized);
      await refuses(s, [STRANGER, sauce.router, data], unauthorized);
    });

    it("PLANTED: a wrong expectation in the callback or after the flash reverts the same cook", async () => {
      const s = await scenario(KIND_RATE, HELD0);
      const planted = (program: Program, reason: string) =>
        refuses(s, [OWNER, sauce.pot, cookOf(s, program)], stringToHex(reason));
      // The Router's own address is who a callback run as the Router, not the Pot, would see.
      await planted({ ...PROFITABLE, identity: sauce.router }, "callback: not the Pot");
      await planted({ ...PROFITABLE, entry1: HELD1 }, "callback: no output yet");
      await planted({ ...PROFITABLE, after0: HELD0 + PROFIT + 1n }, "after: token0 held");
      // Unplanted, the same cook on the same pools lands.
      expect(await sendAs(OWNER, sauce.pot, cookOf(s, PROFITABLE))).toBe("success");
    });
  });
});
