/**
 * A chain whose Kitchen has switched to a new Router, EXECUTED on a local anvil: the 1.4.0 stack
 * (engine E1, Router R1) with a dynamic, a fixed-Router and a Shared Pot minted on it, then switched
 * the way v12's rollout does it — the new engine and Router deployed, `Kitchen.setRouter` — and a new
 * fixed-Router and a new Shared Pot minted after. The engine compiles in one fixed Router, so:
 *
 *   - a dynamic Pot runs on either engine, whatever its Router;
 *   - a fixed-Router or Shared Pot minted before the switch (Router R1) runs on E1 alone, and one
 *     minted after it (the new Router) on the new engine alone: each engine refuses the other's with
 *     empty returndata;
 *   - `potEngine` names the engine that ran each of them, `potRouterUpdate` proposes `setRouter` for
 *     a dynamic Pot alone (and nothing for a fixed-Router or Shared one), and a HyperSwap V3 pool is
 *     paid by every Pot whose Router answers its callback, which no Pot on R1 does.
 *
 * The pool is v12's own `MockV3Pool` (`fixtures/`), with a settable callback selector.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and on the 1.4.0 release's artifacts, which
 * `sync-engine-artifacts` writes to `src/artifacts/legacy`: a hard failure without either in CI.
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
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  http,
  parseAbi,
  toFunctionSelector,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12ReleaseSet } from "../../src/deployments/index.js";
import { potRouterUpdate, potEngine, v12PotAbi } from "../../src/evm/engine.js";
import { compileSauceRoute } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { hasLegacyArtifacts } from "../release-arm.js";
import { startUpgradedChain, type UpgradedChain } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}
const READY = hasLegacyArtifacts("evm", "1.4.0");
if (!READY && process.env.CI) {
  throw new Error(
    "the 1.4.0 release's artifacts (src/artifacts/legacy) are missing in CI. This suite must " +
      'never skip here — see the "Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}
const describeSwitched = RUNTIME_HEX_PATH && READY ? describe : describe.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const MOCK_ERC20 = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "../std/token/fixtures/MockERC20.json"),
);
const MOCK_V3_POOL = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/MockV3Pool.json"));

/** Anvil's first dev account: the harness's deployer, the Kitchen's owner and the Pots' owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Anvil's second: anyone else, who may cook a Shared Pot. */
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

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
const HYPERSWAP = toFunctionSelector("hyperswapV3SwapCallback(int256,int256,bytes)");
const UNISWAP = toFunctionSelector("uniswapV3SwapCallback(int256,int256,bytes)");

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

/** What an `eth_call` of `data` to `to` from `from` comes back with: its output, or its revert data. */
const called = async (
  from: Address,
  to: Address,
  data: Hex,
): Promise<{ readonly output: Hex } | { readonly reverted: Hex }> => {
  try {
    const { data: output } = await publicClient.call({ account: from, data, gas: GAS_LIMIT, to });

    return { output: output ?? "0x" };
  } catch (error) {
    const found = (error as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => typeof (e as { data?: unknown }).data === "string",
    ) as { data?: Hex } | undefined;

    return { reverted: found?.data ?? "0x" };
  }
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

describeSwitched(
  "a chain switched to the new Router cooks each Pot on the engine its Router needs",
  () => {
    let chain: UpgradedChain;
    let anvil: ChildProcess;
    /** The engines: the 1.4.0 release's, and the installed one built for the new Router. */
    let E1: Address;
    let E2: Address;
    let R1: Address;
    let R2: Address;

    /** The five Pots, the engine each runs on, and who cooks them. */
    interface Row {
      readonly name: string;
      readonly pot: Address;
      readonly runsOn: "E1" | "E2" | "either";
      readonly from: Address;
    }
    let rows: Row[];

    const engineOf = (which: "E1" | "E2"): Address => (which === "E1" ? E1 : E2);
    /** The route call a program with `source` compiles to for `pot` on `engine`. */
    const cookOf = (source: string, pot: Address, engine: Address): Hex => {
      const { calls } = compileSauceRoute("base", source, { engine, pot });

      return calls[0]!.data;
    };
    const SEVEN = "function main(): Uint256 { return 7; }";

    beforeAll(async () => {
      anvil = await spawnAnvil(PORT);
      const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
      chain = await startUpgradedChain(
        { publicClient, testClient, walletClient },
        OWNER.address,
        creationCode,
        { from: "1.4.0" },
      );
      E1 = getAddress(chain.legacy.engine);
      E2 = getAddress(chain.engine);
      R1 = getAddress(chain.legacy.router);
      R2 = getAddress(chain.router);
      rows = [
        { name: "legacy dynamic", pot: chain.legacy.pot, runsOn: "either", from: OWNER.address },
        { name: "legacy fixed", pot: chain.legacy.fixedPot!, runsOn: "E1", from: OWNER.address },
        {
          name: "legacy shared",
          pot: chain.legacy.sharedPot!,
          runsOn: "E1",
          from: STRANGER.address,
        },
        { name: "new fixed", pot: chain.fixedPot!, runsOn: "E2", from: OWNER.address },
        { name: "new shared", pot: chain.sharedPot!, runsOn: "E2", from: STRANGER.address },
      ];
    }, 180_000);

    afterAll(async () => {
      if (anvil && anvil.exitCode === null) {
        const exited = once(anvil, "exit");
        anvil.kill();
        await exited;
      }
    });

    it("the stack is the two releases, each Pot on the Router it was minted with", async () => {
      expect([E1, E2]).toEqual([
        getAddress(v12ReleaseSet("2.6.3")["v12-evm"].engine!),
        getAddress(v12ReleaseSet()["v12-evm"].engine!),
      ]);
      expect(E1).not.toBe(E2);
      expect(R1).not.toBe(R2);
      const routerOf = (pot: Address) =>
        publicClient.readContract({ abi: v12PotAbi, address: pot, functionName: "router" });
      for (const row of rows) {
        expect([row.name, await routerOf(row.pot)]).toEqual([
          row.name,
          row.name.startsWith("legacy") ? R1 : R2,
        ]);
      }
      // The Kitchen's own Router moved with the switch: a Pot minted from now on starts on the new one.
      expect(await routerOf(chain.pot)).toBe(R2);
    });

    it("the engine matrix: each engine refuses a fixed-Router or Shared Pot built for another Router", async () => {
      for (const row of rows) {
        for (const which of ["E1", "E2"] as const) {
          const result = await called(row.from, row.pot, cookOf(SEVEN, row.pot, engineOf(which)));
          const runs = row.runsOn === "either" || row.runsOn === which;
          // A cook on the engine that accepts the Pot returns the program's 7; the other engine's
          // Pot gate rejects it, and the cook reverts whole with no data at all.
          expect([row.name, which, result]).toEqual([
            row.name,
            which,
            runs ? { output: `0x${"00".repeat(31)}07` } : { reverted: "0x" },
          ]);
        }
      }
    }, 120_000);

    it("potEngine names exactly the engine that ran each Pot", async () => {
      for (const row of rows) {
        const named = await potEngine(publicClient, row.pot);
        // A dynamic Pot runs on both: the installed engine is the one named for it.
        expect([row.name, named]).toEqual([row.name, row.runsOn === "E1" ? E1 : E2]);
        const result = await called(row.from, row.pot, cookOf(SEVEN, row.pot, named));
        expect([row.name, "output" in result]).toEqual([row.name, true]);
      }
    }, 120_000);

    it("potRouterUpdate proposes setRouter for the dynamic Pot alone, and the owner's call moves it", async () => {
      const [dynamic, ...others] = rows;
      const update = await potRouterUpdate(publicClient, dynamic!.pot);
      expect(update?.to).toBe(dynamic!.pot);
      const call = decodeFunctionData({ abi: v12PotAbi, data: update!.data });
      expect([call.functionName, call.args]).toEqual(["setRouter", [R2]]);
      for (const row of others) {
        expect([row.name, await potRouterUpdate(publicClient, row.pot)]).toEqual([
          row.name,
          undefined,
        ]);
      }
      // Only the owner's call moves it; nothing in the SDK sends it.
      expect(await sendAs(STRANGER, update!.to, update!.data)).toBe("reverted");
      expect(await sendAs(OWNER, update!.to, update!.data)).toBe("success");
      expect(
        await publicClient.readContract({
          abi: v12PotAbi,
          address: dynamic!.pot,
          functionName: "router",
        }),
      ).toBe(R2);
      expect(await potRouterUpdate(publicClient, dynamic!.pot)).toBeUndefined();
    });

    describe("a HyperSwap V3 pool, which calls back `hyperswapV3SwapCallback`", () => {
      const AMOUNT_IN = 1_000n;
      const RATE = 2n * 10n ** 18n; // token0 -> token1 at 2x
      let token0: Address;
      let token1: Address;

      /** A funded pool for token0 -> token1 that calls back under `selector`. */
      const pool = async (selector: Hex): Promise<Address> => {
        const at = await deploy(
          `${MOCK_V3_POOL.creationCode}${encodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "uint256" }],
            [token0, token1, 3000, RATE],
          ).slice(2)}` as Hex,
        );
        expect(
          await sendAs(
            OWNER,
            at,
            encodeFunctionData({
              abi: MOCK_V3_POOL.abi,
              functionName: "setCallbackSelector",
              args: [selector],
            }),
          ),
        ).toBe("success");
        await sendAs(
          OWNER,
          token1,
          encodeFunctionData({ abi: erc20, args: [at, 10n ** 24n], functionName: "mint" }),
        );

        return at;
      };

      /** The call a swap of `AMOUNT_IN` at `at` compiles to for `pot` on `engine`: `try` or plain. */
      const swapOf = (at: Address, pot: Address, engine: Address, tryForm: boolean): Hex => {
        const swap = tryForm ? "tryUniswapV3" : "uniswapV3";
        const source = [
          `import { ${swap} } from "@sauce/router";`,
          "function main() {",
          tryForm
            ? `  const got = ${swap}(${BigInt(at)}n, ${BigInt(token0)}n, ${BigInt(token1)}n, ${AMOUNT_IN}n, 0n, 0n, ctx.self());\n  require(got == 0n);`
            : `  ${swap}(${BigInt(at)}n, ${BigInt(token0)}n, ${BigInt(token1)}n, ${AMOUNT_IN}n, 0n, 0n, ctx.self());`,
          "}",
        ].join("\n");

        return cookOf(source, pot, engine);
      };

      beforeAll(async () => {
        const [a, b] = [
          await deploy(MOCK_ERC20.creationCode),
          await deploy(MOCK_ERC20.creationCode),
        ];
        [token0, token1] = hexToBigInt(a) < hexToBigInt(b) ? [a, b] : [b, a];
        for (const row of rows) {
          await sendAs(
            OWNER,
            token0,
            encodeFunctionData({ abi: erc20, args: [row.pot, 10n ** 24n], functionName: "mint" }),
          );
        }
      });

      /** Cooks the swap on each of `which`, and returns the status, the pool's and the Pot's changes. */
      const swapOn = async (
        row: Row,
        at: Address,
        engine: Address,
        tryForm = false,
      ): Promise<{ status: string; pool: bigint; potIn: bigint; potOut: bigint }> => {
        const [poolIn, potIn, potOut] = [
          await balance(token0, at),
          await balance(token0, row.pot),
          await balance(token1, row.pot),
        ];
        const status = await sendAs(
          row.from === OWNER.address ? OWNER : STRANGER,
          row.pot,
          swapOf(at, row.pot, engine, tryForm),
        );

        return {
          status,
          pool: (await balance(token0, at)) - poolIn,
          potIn: (await balance(token0, row.pot)) - potIn,
          potOut: (await balance(token1, row.pot)) - potOut,
        };
      };
      const PAID = {
        status: "success",
        pool: AMOUNT_IN,
        potIn: -AMOUNT_IN,
        potOut: 2n * AMOUNT_IN,
      };
      const UNTOUCHED = { status: "reverted", pool: 0n, potIn: 0n, potOut: 0n };

      it("is the alias that is missing from the old Router: R1 does not answer it, the new Router does", async () => {
        // The control for everything below: a call no swap is in flight for reverts
        // UnauthorizedCallback() where the Router has the name, and with no data where it has not.
        const probe = (router: Address, selector: Hex) =>
          called(
            "0x000000000000000000000000000000000000dEaD",
            router,
            `${selector}${"00".repeat(31)}01${"00".repeat(32)}${"00".repeat(31)}60${"00".repeat(32)}`,
          );
        expect(await probe(R2, HYPERSWAP)).toEqual({ reverted: "0xf5c6c81a" });
        expect(await probe(R1, HYPERSWAP)).toEqual({ reverted: "0x" });
        expect(await probe(R1, UNISWAP)).toEqual({ reverted: "0xf5c6c81a" });
        expect(await probe(R2, UNISWAP)).toEqual({ reverted: "0xf5c6c81a" });
      });

      it("pays the pool from every Pot on the new Router, and from none on the old", async () => {
        const at = await pool(HYPERSWAP);
        const [dynamic, legacyFixed, legacyShared, newFixed, newShared] = rows as [
          Row,
          Row,
          Row,
          Row,
          Row,
        ];
        // The Pots minted after the switch, on the engine built for their Router.
        expect(await swapOn(newFixed, at, E2)).toEqual(PAID);
        expect(await swapOn(newShared, at, E2)).toEqual(PAID);
        // The legacy dynamic Pot, moved onto the new Router by its owner above.
        expect(await swapOn(dynamic, at, E2)).toEqual(PAID);
        // The Pots minted before it keep R1 for good, which does not answer the pool's callback: the
        // swap reverts and nothing moves, on the only engine that runs them.
        expect(await swapOn(legacyFixed, at, E1)).toEqual(UNTOUCHED);
        expect(await swapOn(legacyShared, at, E1)).toEqual(UNTOUCHED);
      }, 180_000);

      it("tryUniswapV3 returns 0 for the same pool, and moves nothing, on a Pot of the old Router", async () => {
        const at = await pool(HYPERSWAP);
        const [, legacyFixed, legacyShared] = rows as [Row, Row, Row, Row, Row];
        for (const row of [legacyFixed, legacyShared]) {
          expect(await swapOn(row, at, E1, true)).toEqual({ ...UNTOUCHED, status: "success" });
        }
      }, 120_000);

      it("a pool that calls back uniswapV3SwapCallback pays every Pot: the failure above is the missing alias", async () => {
        const at = await pool(UNISWAP);
        for (const row of rows) {
          const engine = row.runsOn === "E1" ? E1 : E2;
          expect([row.name, await swapOn(row, at, engine)]).toEqual([row.name, PAID]);
        }
      }, 180_000);
    });
  },
);
