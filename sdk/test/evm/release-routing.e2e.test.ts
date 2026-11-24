/**
 * An upgraded chain cooks each Pot on its own engine.
 *
 * `startUpgradedChain` is the chain as the live ones are after kitchen-evm 1.4.0's rollout: the
 * earlier release's stack with `owner`'s Pot minted on it (kitchen-evm 1.3.0, engine v12-evm 1.3.0),
 * the stack upgraded in place to the release this SDK pins, and a new Pot minted under it
 * (kitchen-evm 1.4.0, engine v12-evm 1.4.0).
 *
 * Engines are not interchangeable across Pot families: each refuses the other's Pots, with empty
 * returndata. So the two cooks that name the wrong engine are the negative controls for the two that
 * name the right one — they show the engine choice is what makes a cook run. Compiler output of
 * the installed compiler runs on both engines (`alsoRunsOn`), and a swap through the release Router
 * (`@sauce/router`'s `uniswapV3`) lands on both Pots, each on its own release's Router.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and on the earlier release's artifacts, which
 * `sync-engine-artifacts` writes to `src/artifacts/legacy`: a hard failure without either in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBigInt,
  http,
  parseAbi,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12Pot, v12PotAbi } from "../../src/evm/engine.js";
import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram, compileSauceRoute } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { hasLegacyArtifacts, startUpgradedChain } from "./gated-engine.js";
import type { UpgradedChain } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const ready = RUNTIME_HEX_PATH !== undefined && hasLegacyArtifacts();
const describeEvm = ready ? describe : describe.skip;
if (!ready && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX or the earlier release's artifacts (src/artifacts/legacy) " +
      'are missing in CI. This suite must never skip here — see the "Sync engine artifacts" step ' +
      "in .github/workflows/ci.yml.",
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const MOCK_ERC20 = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "../std/token/fixtures/MockERC20.json"),
);
const MOCK_V3_POOL = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/MockV3Pool.json"));

/** Anvil's first dev account: the harness's deployer, the Kitchen's owner and both Pots'. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const GAS_LIMIT = 10_000_000n;

const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** Sends from the owner, resolving to the receipt's status rather than throwing on a revert. */
const send = async (to: Address, data: Hex): Promise<"success" | "reverted"> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
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

/** Whether `e` is a viem error that carries revert data. */
const carriesData = (e: unknown): e is { data: Hex } =>
  typeof e === "object" && e !== null && "data" in e && typeof e.data === "string";

/** The revert data an `eth_call` from the owner comes back with, or undefined when it succeeds. */
const revertOf = async (to: Address, data: Hex): Promise<Hex | undefined> => {
  try {
    await publicClient.call({ account: OWNER.address, data, gas: GAS_LIMIT, to });
    return undefined;
  } catch (error) {
    if (!(error instanceof BaseError)) throw error;
    const found = error.walk(carriesData);

    return carriesData(found) ? found.data : "0x";
  }
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

const potRouter = (pot: Address): Promise<Address> =>
  publicClient.readContract({ abi: v12PotAbi, address: pot, functionName: "router" });

/** The cook of `source` on `pot` through `engine`: the call a program compiles to. */
const cookOf = (source: string, engine: Address, pot: Address): Hex =>
  compileSauceRoute("base", source, { engine, pot }).calls[0]!.data;

const BEEF = 0xbeefn;
/** `0xbeef` with bit 160 set: an address word with a bit above its low 160. */
const DIRTY = (1n << 160n) | BEEF;

const words = (...values: bigint[]): Hex =>
  encodeAbiParameters(
    values.map(() => ({ type: "uint256" })),
    values,
  );

/** The cook as an eth_call by the Pot's owner: the first word it returns, or "reverted". */
const firstWord = async (pot: Address, data: Hex): Promise<bigint | "reverted"> => {
  try {
    const { data: out } = await publicClient.call({ account: OWNER.address, data, to: pot });
    return hexToBigInt(out!.slice(0, 66) as Hex);
  } catch (error) {
    if (/revert/i.test(String((error as Error).message))) return "reverted";
    throw error;
  }
};

let anvil: ChildProcess;
let chain: UpgradedChain;

describeEvm("an upgraded chain cooks each Pot on its own engine", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    chain = await startUpgradedChain(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
  }, 180_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("a program that returns 7", () => {
    // The Pots hold no native coin, so `ctx.selfBalance() + 7` is 7 wherever it runs.
    const SEVEN = "function main(): Uint256 { return ctx.selfBalance() + 7; }";

    /** What the cook returns when it runs, from the owner. */
    const returned = async (engine: Address, pot: Address): Promise<bigint> => {
      const { data } = await publicClient.call({
        account: OWNER.address,
        data: cookOf(SEVEN, engine, pot),
        gas: GAS_LIMIT,
        to: pot,
      });

      return hexToBigInt(data!);
    };

    it("runs on the earlier Pot through the earlier engine", async () => {
      expect(await returned(chain.legacy.engine, chain.legacy.pot)).toBe(7n);
    });

    it("runs on the new Pot through the release engine", async () => {
      expect(await returned(chain.engine, chain.pot)).toBe(7n);
    });

    it("is refused, with empty data, when the earlier Pot names the release engine", async () => {
      expect(await revertOf(chain.legacy.pot, cookOf(SEVEN, chain.engine, chain.legacy.pot))).toBe(
        "0x",
      );
    });

    it("is refused, with empty data, when the new Pot names the earlier engine", async () => {
      expect(await revertOf(chain.pot, cookOf(SEVEN, chain.legacy.engine, chain.pot))).toBe("0x");
    });
  });

  describe("a V3 swap through the Router of each Pot's own release", () => {
    const AMOUNT_IN = 1_000n;
    const RATE = 2n * 10n ** 18n; // tokenIn -> tokenOut at 2x
    let tokenIn: Address;
    let tokenOut: Address;
    let pool: Address;

    beforeAll(async () => {
      const [a, b] = [await deploy(MOCK_ERC20.creationCode), await deploy(MOCK_ERC20.creationCode)];
      [tokenIn, tokenOut] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      pool = await deploy(
        `${MOCK_V3_POOL.creationCode}${encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "uint256" }],
          [tokenIn, tokenOut, 3000, RATE],
        ).slice(2)}` as Hex,
      );
      for (const [token, holder, amount] of [
        [tokenIn, chain.legacy.pot, 10_000n],
        [tokenIn, chain.pot, 10_000n],
        [tokenOut, pool, 20_000n],
      ] as const) {
        expect(
          await send(
            token,
            encodeFunctionData({ abi: erc20, args: [holder, amount], functionName: "mint" }),
          ),
        ).toBe("success");
      }
    });

    const swap = (engine: Address, pot: Address): Hex =>
      cookOf(
        [
          'import { uniswapV3 } from "@sauce/router";',
          "function main() {",
          `  uniswapV3(${BigInt(pool)}n, ${BigInt(tokenIn)}n, ${BigInt(tokenOut)}n, ${AMOUNT_IN}n, 0n, 0n, ctx.self());`,
          "}",
        ].join("\n"),
        engine,
        pot,
      );

    it("lands on both Pots, each through its own engine and Router", async () => {
      // Each Pot starts on the Router of the release that minted it.
      expect(await potRouter(chain.legacy.pot)).toBe(chain.legacy.router);
      expect(await potRouter(chain.pot)).toBe(chain.router);
      expect(chain.legacy.router).not.toBe(chain.router);

      expect(await send(chain.legacy.pot, swap(chain.legacy.engine, chain.legacy.pot))).toBe(
        "success",
      );
      expect(await balance(tokenIn, pool)).toBe(AMOUNT_IN);
      expect(await balance(tokenOut, chain.legacy.pot)).toBe(2n * AMOUNT_IN);

      expect(await send(chain.pot, swap(chain.engine, chain.pot))).toBe("success");
      expect(await balance(tokenIn, pool)).toBe(2n * AMOUNT_IN);
      expect(await balance(tokenOut, chain.pot)).toBe(2n * AMOUNT_IN);
      // The Pots gave 1,000 tokenIn each and kept what they did not trade.
      expect(await balance(tokenIn, chain.legacy.pot)).toBe(10_000n - AMOUNT_IN);
      expect(await balance(tokenIn, chain.pot)).toBe(10_000n - AMOUNT_IN);
    });
  });

  it("the installed compiler's abi.decode reads alike on both engines", async () => {
    const length = `function main(data: bytes): Uint256 { const [xs] = abi.decode(data, ["Address[]"]); return xs.length; }`;
    const cases: ReadonlyArray<readonly [string, Hex, bigint | "reverted"]> = [
      [
        `function main(data: bytes): Uint256 { const [a] = abi.decode(data, ["Address"]); return a; }`,
        words(DIRTY),
        BEEF,
      ],
      [
        `function main(data: bytes): Uint256 { const [x, y] = abi.decode(data, ["bool", "bool"]); return x == y ? 1 : 0; }`,
        words(1n, 2n),
        1n,
      ],
      [length, words(32n, 1n, BEEF), 1n],
      [length, words(32n, 1n, DIRTY), "reverted"],
    ];
    for (const [engine, pot] of [
      [chain.legacy.engine, chain.legacy.pot],
      [chain.engine, chain.pot],
    ] as const)
      for (const [source, data, expected] of cases) {
        const program = compileSauceProgram("base", source, {});
        const args = bytesToHex(encodeEntryArguments(program, [data]));
        const cook = v12Pot.encodeCook(engine, concatHex([bytesToHex(program.bytecode), args]));
        expect([engine, source, await firstWord(pot, cook)]).toEqual([engine, source, expected]);
      }
  }, 120_000);
});
