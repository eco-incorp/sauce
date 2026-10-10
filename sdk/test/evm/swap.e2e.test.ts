/**
 * `@sauce/router`'s `uniswapV4`, EXECUTED through the released Router on a local anvil — the stack
 * deployed from creation code at its release addresses (`gated-engine.ts`), nothing forked.
 *
 * Generation 4 takes an unsigned exact input and negates it inside the Router for V4. Subtracting
 * a nonzero balance from zero in Sauce still reverts before reaching the Router.
 *
 * The PoolManager is `fixtures/MockPoolManager.sol`: the slice of V4's PoolManager the Router's V4
 * path drives (`unlock`/`swap`/`take`/`sync`/`settle`) over one fixed-rate pool. It refuses anything
 * but a negative `amountSpecified` and records the one it was given.
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

const mint = (token: Address, to: Address, amount: bigint) =>
  send(token, encodeFunctionData({ abi: erc20, args: [to, amount], functionName: "mint" }));

let anvil: ChildProcess;
let sauce: GatedEngine;
let token0: Address;
let token1: Address;

/** A funded PoolManager for the token0/token1 pool. */
const poolManager = async (): Promise<Address> => {
  const manager = await deploy(
    `${MOCK_POOL_MANAGER.creationCode}${encodeAbiParameters([{ type: "uint256" }], [RATE]).slice(2)}` as Hex,
  );
  await mint(token1, manager, 10n ** 24n);

  return manager;
};

/**
 * A program selling token0 for token1 at `manager`'s pool through `uniswapV4`, spending `amount` (a
 * SauceScript expression), with `minOut` as its floor on what the PoolManager paid.
 */
const v4Program = (manager: Address, amount: string, minOut = 0n): string =>
  [
    'import { uniswapV4 } from "@sauce/router";',
    'import { balanceOf } from "@sauce/token";',
    "function main() {",
    `  uniswapV4(${BigInt(manager)}n, ${BigInt(token0)}n, ${BigInt(token1)}n, ${amount}, ` +
      `3000n, 60n, 0n, 0n, ${minOut}n, ctx.self());`,
    "}",
  ].join("\n");

const cookCall = (source: string): Hex =>
  compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot }).calls[0]!.data;

const lastAmountSpecified = (manager: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: MOCK_POOL_MANAGER.abi,
    address: manager,
    functionName: "lastAmountSpecified",
  }) as Promise<bigint>;

describeEvm("@sauce/router's uniswapV4, executed through the released Router", () => {
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

  it("uniswapV4 with the Pot's balance as a run-time amount swaps all of it, exact input", async () => {
    const held = 12_345n;
    await mint(token0, sauce.pot, held);
    const manager = await poolManager();
    const before = await balance(token1, sauce.pot);
    const program = v4Program(manager, `balanceOf(${BigInt(token0)}n, ctx.self())`);

    expect((await send(sauce.pot, cookCall(program))).status).toBe("success");
    // The Router handed V4 the negated balance: exact input, the whole of it.
    expect(await lastAmountSpecified(manager)).toBe(-held);
    expect(await balance(token0, sauce.pot)).toBe(0n);
    expect(await balance(token0, manager)).toBe(held);
    expect(await balance(token1, sauce.pot)).toBe(before + (held * RATE) / 10n ** 18n);
  });

  it("the '0n - balance' spelling reverts before the Router is reached", async () => {
    await mint(token0, sauce.pot, 777n);
    const manager = await poolManager();
    // The Router's swapV4 called by hand, the amount negated by subtraction.
    const subtracted = [
      'import { ISauceRouter } from "./artifacts/ISauceRouter.json";',
      'import { balanceOf } from "@sauce/token";',
      "function main() {",
      `  const amount = balanceOf(${BigInt(token0)}n, ctx.self());`,
      `  ISauceRouter.at(ctx.self()).swapV4(${BigInt(manager)}n, ` +
        `{ currency0: ${BigInt(token0)}n, currency1: ${BigInt(token1)}n, fee: 3000n, tickSpacing: 60n, hooks: 0n }, ` +
        `${BigInt(token0)}n, true, 0n - amount, 0n, ctx.self());`,
      "}",
    ].join("\n");

    expect((await send(sauce.pot, cookCall(subtracted))).status).toBe("reverted");
    expect(await lastAmountSpecified(manager)).toBe(0n);
    expect(await balance(token0, sauce.pot)).toBe(777n);
  });

  it("uniswapV4 with a literal amount passes V4 the negative exact input, and returns the output", async () => {
    await mint(token0, sauce.pot, 500n);
    const manager = await poolManager();
    const out = (500n * RATE) / 10n ** 18n;
    expect((await send(sauce.pot, cookCall(v4Program(manager, "500n", out)))).status).toBe(
      "success",
    );
    expect(await lastAmountSpecified(manager)).toBe(-500n);
    expect(await balance(token0, manager)).toBe(500n);
  });

  it("uniswapV4's floor is what the PoolManager paid: one above it reverts the cook", async () => {
    await mint(token0, sauce.pot, 500n);
    const held = await balance(token0, sauce.pot);
    const manager = await poolManager();
    const out = (500n * RATE) / 10n ** 18n;
    expect((await send(sauce.pot, cookCall(v4Program(manager, "500n", out + 1n)))).status).toBe(
      "reverted",
    );
    expect(await balance(token0, sauce.pot)).toBe(held);
  });
});
