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
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  toFunctionSelector,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12RouterGeneration } from "../../src/deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { potRouterUpdate, v12KitchenAbi, v12PotAbi } from "../../src/evm/engine.js";
import { ecoRoutesExecutor } from "../../src/protocols/eco-routes/lookup.js";
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
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
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

  it("the live Kitchen predicts the Pots the SDK derives — the shared intent Pot included", async () => {
    // The registry Portal's Executor: the owner of the Pot every intent cooks on by default.
    const executor = ecoRoutesExecutor("base");
    const predicted = await publicClient.readContract({
      abi: v12KitchenAbi,
      address: sauce.kitchen,
      args: [executor, SAUCE_INTENT_POT_SALT],
      functionName: "predictPot",
    });
    expect(predicted).toBe(v12PredictPot(executor));
    expect(predicted).toBe(potFromReleasedBytecode(executor));
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

    const balance = (token: Address, holder: Address): Promise<bigint> =>
      publicClient.readContract({
        abi: erc20,
        address: token,
        args: [holder],
        functionName: "balanceOf",
      });

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

    it("is the release's generation-4 Router, and it answers both renamed callbacks", () => {
      expect(v12RouterGeneration()).toBe(4);
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
});
