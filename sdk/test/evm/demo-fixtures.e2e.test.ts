/**
 * The demo program `fixtures/sauce-script/demo/usdc-to-weth.sauce.ts`, EXECUTED through the
 * released Router on a local anvil (`gated-engine.ts`), because a green typecheck proves nothing
 * about it: its `swapOnV4` builds a Uniswap V4 pool key from run-time `Uint256` values and hands it
 * to the Router's `swapV4`, whose `tickSpacing` is an `int24`, so the program converts it with
 * `Int256(...)`. The helper is cut out of the file and run against `fixtures/MockPoolManager.sol`.
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
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { compileSauceRoute } from "../../src/routes/sauce-route.js";
import { startGatedEngine } from "./gated-engine.js";
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
const MOCK_POOL_MANAGER = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/MockPoolManager.json"),
);
const DEMO = join(HERE, "../fixtures/sauce-script/demo");
const STANDALONE = readFileSync(join(DEMO, "usdc-to-weth.sauce.ts"), "utf8");

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;
const RATE = 2n * 10n ** 18n; // currency1 per currency0

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

const send = async (to: Address | null, data: Hex): Promise<{ status: string; at?: Address }> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { status: receipt.status, at: receipt.contractAddress ?? undefined };
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const { at } = await send(null, creationCode);
  if (!at) throw new Error("a deployment produced no contract address");

  return at;
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

let anvil: ChildProcess;
let sauce: GatedEngine;
let token0: Address;
let token1: Address;

const cookCall = (source: string): Hex =>
  compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot }).calls[0]!.data;

/**
 * The demo's own `swapOnV4` (and what it names), cut out of the file, driven by a `main`. The names
 * the chain supplies are replaced by the mocks' addresses in the text: a chain's `USDC`, `WETH` and
 * `UniswapV4_PoolManager` are the real ones, which a define or a token override does not displace.
 */
const standaloneV4 = (manager: Address, tickSpacing: bigint, amount: bigint): string => {
  const header = STANDALONE.slice(0, STANDALONE.indexOf("// amountIn: the USDC to sell"));

  return [
    'import { balanceOf } from "@sauce/token";',
    header
      .replace("const UniswapV4_PoolManager = 0n;\n", "")
      .replaceAll("UniswapV4_PoolManager", `${BigInt(manager)}`)
      .replaceAll("USDC.balanceOf(self)", "balanceOf(USDC, self)")
      .replaceAll(/\bUSDC\b/g, `${BigInt(token0)}`)
      .replaceAll(/\bWETH\b/g, `${BigInt(token1)}`),
    // The demo's main passes a limit it has checked to lie inside V4's bounds: the lowest allowed.
    `function main() { swapOnV4(3000, ${tickSpacing}, ${amount}, 4295128740); }`,
  ].join("\n");
};

describeEvm("the demo program's V4 pool key, executed", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );
    const [a, b] = [await deploy(MOCK_ERC20.creationCode), await deploy(MOCK_ERC20.creationCode)];
    [token0, token1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("usdc-to-weth.sauce.ts: a V4 pool key built from run-time values", () => {
    const run = async (tickSpacing: bigint) => {
      const manager = await deploy(
        `${MOCK_POOL_MANAGER.creationCode}${encodeAbiParameters([{ type: "uint256" }], [RATE]).slice(2)}` as Hex,
      );
      await send(
        token1,
        encodeFunctionData({ abi: erc20, args: [manager, 10n ** 24n], functionName: "mint" }),
      );
      await send(
        token0,
        encodeFunctionData({ abi: erc20, args: [sauce.pot, 500n], functionName: "mint" }),
      );
      const source = standaloneV4(manager, tickSpacing, 500n);
      const sold = await balance(token0, sauce.pot);
      const status = (await send(sauce.pot, cookCall(source))).status;

      return { manager, status, sold, left: await balance(token0, sauce.pot) };
    };

    it("swaps through the Router with the pool key's int24 tick spacing, exact input", async () => {
      const { manager, status, sold, left } = await run(60n);

      expect(status).toBe("success");
      expect(sold - left).toBe(500n);
      expect(await balance(token0, manager)).toBe(500n);
      expect(
        (await publicClient.readContract({
          abi: MOCK_POOL_MANAGER.abi,
          address: manager,
          functionName: "lastAmountSpecified",
        })) as bigint,
      ).toBe(-500n);
    });

    it("takes the int24 maximum as a tick spacing", async () => {
      expect((await run(8_388_607n)).status).toBe("success");
    });
  });
});
