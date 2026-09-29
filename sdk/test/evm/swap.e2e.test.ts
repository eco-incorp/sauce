/**
 * The swap builders' programs, EXECUTED through the released Router on a local anvil — the stack
 * deployed from creation code at its release addresses (`gated-engine.ts`), nothing forked.
 *
 * A Uniswap V4 leg reads a NEGATIVE `amountSpecified` as exact input. With `amountIn: "balance"` the
 * builder computes it at run time from the Pot's balance, and that negation has to be unary `-`
 * (two's-complement NEG): subtraction is checked unsigned, so the `0n - balance` this used to emit
 * reverted inside the engine for every non-zero balance and the swap never reached the Router.
 * Compiling that path proved nothing; this runs it.
 *
 * The PoolManager is `fixtures/MockPoolManager.sol`: the slice of V4's PoolManager the Router's V4
 * path drives (`unlock`/`swap`/`take`/`sync`/`settle`) over one fixed-rate pool. It refuses anything
 * but a negative `amountSpecified` and records the one it was given.
 */
import { spawn } from "node:child_process";
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
import { swapSource } from "../../src/swap/source.js";
import { SwapPoolType, type SwapSourceSpec } from "../../src/swap/types.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

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

const PORT = 8900 + (Number(process.env.JEST_WORKER_ID ?? "1") % 100);
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

const waitForRpc = async (deadline: number): Promise<void> => {
  for (;;) {
    try {
      await publicClient.getChainId();
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`anvil did not come up on ${RPC_URL}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

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

/** A funded PoolManager for the token0/token1 pool, and the V4 spec that swaps through it. */
const v4Leg = async (
  amountIn: SwapSourceSpec["amountIn"],
): Promise<{ manager: Address; spec: SwapSourceSpec }> => {
  const manager = await deploy(
    `${MOCK_POOL_MANAGER.creationCode}${encodeAbiParameters([{ type: "uint256" }], [RATE]).slice(2)}` as Hex,
  );
  await mint(token1, manager, 10n ** 24n);

  return {
    manager,
    spec: {
      amountIn,
      pool: manager,
      poolKey: { currency0: token0, currency1: token1, fee: 3000n, tickSpacing: 60n, hooks: 0n },
      poolType: SwapPoolType.UniV4,
      tokenIn: token0,
      tokenOut: token1,
    } as SwapSourceSpec,
  };
};

const cookCall = (source: string): Hex =>
  compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot }).calls[0]!.data;

const lastAmountSpecified = (manager: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: MOCK_POOL_MANAGER.abi,
    address: manager,
    functionName: "lastAmountSpecified",
  }) as Promise<bigint>;

describeEvm("swap builders, executed through the released Router", () => {
  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await waitForRpc(Date.now() + 20_000);
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

  it("a UniV4 leg with amountIn 'balance' swaps the Pot's whole balance, exact input", async () => {
    const held = 12_345n;
    await mint(token0, sauce.pot, held);
    const { manager, spec } = await v4Leg("balance");
    const before = await balance(token1, sauce.pot);

    expect((await send(sauce.pot, cookCall(swapSource(spec)))).status).toBe("success");
    // The Router handed V4 the negated balance: exact input, the whole of it.
    expect(await lastAmountSpecified(manager)).toBe(-held);
    expect(await balance(token0, sauce.pot)).toBe(0n);
    expect(await balance(token0, manager)).toBe(held);
    expect(await balance(token1, sauce.pot)).toBe(before + (held * RATE) / 10n ** 18n);
  });

  it("the '0n - balance' spelling it replaces reverts before the Router is reached", async () => {
    await mint(token0, sauce.pot, 777n);
    const { manager, spec } = await v4Leg("balance");
    const source = swapSource(spec);
    const replaced = source.replace(
      /amountSpecified: -\((IERC20\.at\([^)]*\)\.balanceOf\(ctx\.self\(\)\))\),/,
      "amountSpecified: (0n - ($1)),",
    );
    expect(replaced).not.toBe(source);

    expect((await send(sauce.pot, cookCall(replaced))).status).toBe("reverted");
    expect(await lastAmountSpecified(manager)).toBe(0n);
    expect(await balance(token0, sauce.pot)).toBe(777n);
  });

  it("a UniV4 leg with a literal amount passes V4 the negative exact input", async () => {
    const { manager, spec } = await v4Leg(500n);
    expect((await send(sauce.pot, cookCall(swapSource(spec)))).status).toBe("success");
    expect(await lastAmountSpecified(manager)).toBe(-500n);
    expect(await balance(token0, manager)).toBe(500n);
  });
});
