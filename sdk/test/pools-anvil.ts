/**
 * A local Base with a pair's pools at every venue `sauce pools` reads, for its suites
 * (`cli-pools.e2e.test.ts`, and the MCP server's `pools.e2e.test.ts`). Nothing is forked.
 *
 * The Uniswap V3 and PancakeSwap V3 pools are Uniswap's own `UniswapV3Factory` and `UniswapV3Pool`
 * bytecode from `@uniswap/v3-core`: a factory deployed here creates and initializes them, and its
 * code and storage are then replayed onto the registry's factory address, so the factory a program
 * names finds them; each pool's `factory` immutable is rewritten to that address too, so a pool
 * names the factory a pool of that venue on Base names. Liquidity comes through `fixtures/cli/Pools.sol`'s `PoolsLiquidity`, which also
 * swaps, to hold a reported depth to what the pool really takes. Slipstream's factory and Uniswap
 * V4's StateView cannot run here (they need their voter and PoolManager), so `SlipstreamFactoryStub`
 * (whose pool is a real V3 pool) and `StateViewStub` stand at their registry addresses. The pair's
 * tokens are `PoolsToken`s at Base's USDC (6 decimals) and SPCXc (a tokenized stock, 8) addresses:
 * USDC is token0. Two more stand where the registry knows no token, for an address whose decimals
 * and symbol are read from the token: `ACME` (8 decimals), and one calling itself `USDC`.
 *
 * Needs `anvil` on PATH; each suite gates on it. Uses no test runner's globals.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  maxUint256,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { addressOn, getDescriptor } from "../src/descriptors/query.js";
import { sqrtPriceX96FromPrice } from "../src/price.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { freePort, spawnAnvil } from "./anvil-process.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const fixture = (name: string) =>
  json<{ abi: Abi; creationCode: Hex }>(join(HERE, `fixtures/cli/${name}.json`));
const v3 = (name: string) =>
  json<{ abi: Abi; bytecode: Hex }>(
    createRequire(import.meta.url).resolve(
      `@uniswap/v3-core/artifacts/contracts/${name}.sol/${name}.json`,
    ),
  );
export const FACTORY = v3("UniswapV3Factory");
export const POOL = v3("UniswapV3Pool");
const TOKEN = fixture("PoolsToken");
export const LIQUIDITY = fixture("PoolsLiquidity");
const SLIPSTREAM = fixture("SlipstreamFactoryStub");
export const STATE_VIEW = fixture("StateViewStub");

/** Anvil's first development key: a local test account, funded at genesis. */
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const BASE = requireChain("base");
const registry = (protocol: string, contract: string): Address =>
  getAddress(addressOn(getDescriptor(protocol, contract)!, BASE)!);

const registered = (symbol: string): Address =>
  getAddress(`0x${registryTokenAddress(BASE, symbol)!.toString(16).padStart(40, "0")}`);
export const USDC = registered("USDC");
/** Base's SPCXc, a tokenized stock the registry records with 8 decimals. */
export const SPCX = registered("SPCXc");
/** Addresses the registry does not know: a token with 8 decimals, and one that calls itself USDC. */
export const ACME = getAddress("0xace0000000000000000000000000000000000008");
export const IMPOSTOR = getAddress("0x5eed000000000000000000000000000000000006");

/** Base's venue contracts, where the pools are found. */
export const VENUES = {
  uniswapV3: registry("uniswap-v3", "Factory"),
  pancakeV3: registry("pancakeswap-v3", "Factory"),
  slipstream: registry("aerodrome-slipstream", "CLFactoryGaugesV3"),
  stateView: registry("uniswap-v4", "StateView"),
} as const;

/** USDC per SPCXc, as a pool of the two (USDC token0, 6 decimals; SPCXc 8). */
export const sqrtAt = (usdcPerSpcx: string): bigint =>
  sqrtPriceX96FromPrice(usdcPerSpcx, { baseDecimals: 8, quoteDecimals: 6, baseIsToken0: false });

/** The tick of a sqrtPriceX96, by floating point: the pools set up here sit well inside a tick. */
export const tickOf = (sqrtPriceX96: bigint): number =>
  Math.floor(Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(Math.sqrt(1.0001)));

/** A hookless V4 pool's id over USDC and SPCXc. */
export const v4Id = (fee: number, tickSpacing: number): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [USDC, SPCX, fee, tickSpacing, zeroAddress],
    ),
  );

/** One V3-style pool set up here. */
export interface LocalPool {
  readonly address: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  /** USDC per SPCXc it was initialized at; none for one never initialized. */
  readonly price?: string;
  readonly liquidity: bigint;
}

export interface PoolsChain {
  readonly rpcUrl: string;
  readonly publicClient: PublicClient;
  readonly testClient: TestClient;
  readonly deployer: Address;
  /** The swap helper, which the deployer has approved for both tokens. */
  readonly liquidity: Address;
  /** The pools by venue: `v3:<fee>`, `pancake:<fee>`, `slipstream:<spacing>`. */
  readonly pools: ReadonlyMap<string, LocalPool>;
  /** The V4 pools set in StateView, by key `<fee>:<tickSpacing>`. */
  readonly v4: ReadonlyMap<
    string,
    {
      readonly price: string;
      readonly liquidity: bigint;
      readonly lpFee: number;
      readonly protocolFee: number;
    }
  >;
  stop(): Promise<void>;
}

/** Starts the pools' anvil, on a port the OS hands out (`anvil-process.ts`). */
export async function startPoolsChain(): Promise<PoolsChain> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = await spawnAnvil(port, ["--chain-id", String(BASE.id)]);
  const transport = http(rpcUrl, { fetchOptions: { headers: { connection: "close" } } });
  const publicClient = createPublicClient({ transport });
  const testClient = createTestClient({ mode: "anvil", transport });
  const wallet = createWalletClient({ account: DEPLOYER, transport });
  // Every transaction carries its own gas limit rather than an estimate. An estimate is made
  // against the pending block, and a mint mined a second later may need more than it — the likely
  // reason `PoolsLiquidity.mint` reverted here now and then, which a fixed limit stopped.
  const send = async (to: Address | null, data: Hex): Promise<Address | undefined> => {
    const hash = await wallet.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to,
      data,
      gas: 15_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`a transaction to ${to ?? "create"} reverted`);

    return receipt.contractAddress ?? undefined;
  };
  const deploy = async (creationCode: Hex): Promise<Address> => (await send(null, creationCode))!;
  /** `pools`' code with their `factory` immutable, `from`, rewritten to `to`: the factory replayed
   *  at the registry's address. A pool reads it only for its owner's fee switch. */
  const rehome = async (pools: readonly Address[], from: Address, to: Address) => {
    const word = (address: Address) => address.slice(2).toLowerCase().padStart(64, "0");
    for (const pool of pools) {
      const code = (await publicClient.getCode({ address: pool }))!;
      await testClient.setCode({
        address: pool,
        bytecode: code.toLowerCase().replaceAll(word(from), word(to)) as Hex,
      });
    }
  };
  const call = (to: Address, abi: Abi, functionName: string, args: readonly unknown[]) =>
    send(to, encodeFunctionData({ abi, functionName, args }));
  /** `from`'s code and storage onto `to`: a contract at the address the registry names. */
  const replay = async (from: Address, to: Address) => {
    const dumped = JSON.parse(
      new TextDecoder().decode(gunzipSync(hexToBytes(await testClient.dumpState()))),
    ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
    const state = dumped.accounts[from.toLowerCase()] ?? dumped.accounts[from];
    await testClient.setCode({ address: to, bytecode: state!.code });
    for (const [index, value] of Object.entries(state!.storage)) {
      await testClient.setStorageAt({ address: to, index: index as Hex, value });
    }
  };

  // The tokens, each deployed and then replayed where it stands, with its symbol and decimals.
  for (const [at, symbol, decimals] of [
    [USDC, "USDC", 6],
    [SPCX, "SPCXc", 8],
    [ACME, "ACME", 8],
    [IMPOSTOR, "USDC", 6],
  ] as const) {
    const token = await deploy(
      `${TOKEN.creationCode}${encodeAbiParameters(
        [{ type: "string" }, { type: "uint8" }],
        [symbol, decimals],
      ).slice(2)}` as Hex,
    );
    await replay(token, at);
    await call(at, TOKEN.abi, "mint", [DEPLOYER.address, 10n ** 30n]);
  }
  const liquidity = await deploy(LIQUIDITY.creationCode);
  for (const token of [USDC, SPCX]) {
    await call(token, TOKEN.abi, "approve", [liquidity, maxUint256]);
  }

  const pools = new Map<string, LocalPool>();
  const named = (prefix: string) =>
    [...pools].filter(([name]) => name.startsWith(prefix)).map(([, pool]) => pool.address);
  /** A pool by `factory` at `fee`, initialized at `price`, with liquidity in `ranges` (ticks). */
  const pool = async (
    factory: Address,
    name: string,
    fee: number,
    price: string | undefined,
    ranges: ReadonlyArray<readonly [number, number, bigint]>,
  ): Promise<Address> => {
    await call(factory, FACTORY.abi, "createPool", [USDC, SPCX, fee]);
    const address = getAddress(
      (await publicClient.readContract({
        address: factory,
        abi: FACTORY.abi,
        functionName: "getPool",
        args: [USDC, SPCX, fee],
      })) as Address,
    );
    const tickSpacing = Number(
      await publicClient.readContract({ address, abi: POOL.abi, functionName: "tickSpacing" }),
    );
    if (price !== undefined) await call(address, POOL.abi, "initialize", [sqrtAt(price)]);
    for (const [lower, upper, amount] of ranges) {
      await call(liquidity, LIQUIDITY.abi, "mint", [address, lower, upper, amount]);
    }
    pools.set(name, {
      address,
      fee,
      tickSpacing,
      ...(price === undefined ? {} : { price }),
      liquidity: ranges.reduce((sum, [, , amount]) => sum + amount, 0n),
    });

    return address;
  };
  /** A range of `spacing`-aligned ticks around `price`: `below` and `above` spacings from it. */
  const around = (price: string, spacing: number, below: number, above: number) => {
    const at = Math.floor(tickOf(sqrtAt(price)) / spacing) * spacing;

    return [at - below * spacing, at + above * spacing] as const;
  };

  // Uniswap V3: 0.05% and 0.3% with liquidity (the 0.3% one with a narrow position inside 1% of its
  // price both ways, so a 1% move crosses ticks), 0.02% (a tier Base adds), 1% initialized with
  // none, and 0.01% never initialized.
  const uniswap = await deploy(FACTORY.bytecode);
  await call(uniswap, FACTORY.abi, "enableFeeAmount", [100, 1]);
  await call(uniswap, FACTORY.abi, "enableFeeAmount", [200, 4]);
  await pool(uniswap, "v3:500", 500, "400", [[...around("400", 10, 600, 600), 10n ** 12n]]);
  await pool(uniswap, "v3:3000", 3000, "401", [
    [...around("401", 60, 100, 100), 4n * 10n ** 11n],
    [...around("401", 60, 0, 1), 7n * 10n ** 11n],
  ]);
  await pool(uniswap, "v3:200", 200, "402", [[...around("402", 4, 1000, 1000), 10n ** 10n]]);
  await pool(uniswap, "v3:10000", 10_000, "390", []);
  await pool(uniswap, "v3:100", 100, undefined, []);
  await replay(uniswap, VENUES.uniswapV3);
  await rehome(named("v3:"), uniswap, VENUES.uniswapV3);

  // PancakeSwap V3: its 0.25% tier.
  const pancake = await deploy(FACTORY.bytecode);
  await call(pancake, FACTORY.abi, "enableFeeAmount", [2500, 50]);
  await pool(pancake, "pancake:2500", 2500, "399", [[...around("399", 50, 100, 100), 10n ** 11n]]);
  await replay(pancake, VENUES.pancakeV3);
  await rehome(named("pancake:"), pancake, VENUES.pancakeV3);

  // Aerodrome Slipstream: a real V3 pool behind the lookup, found at tick spacing 10, the deepest.
  const behind = await deploy(FACTORY.bytecode);
  const slipstreamPool = await pool(behind, "slipstream:10", 500, "400.5", [
    [...around("400.5", 10, 3000, 3000), 5n * 10n ** 12n],
  ]);
  const stub = await deploy(SLIPSTREAM.creationCode);
  await call(stub, SLIPSTREAM.abi, "setTickSpacings", [[1, 10, 50]]);
  await call(stub, SLIPSTREAM.abi, "setPool", [USDC, SPCX, 10, slipstreamPool]);
  await replay(stub, VENUES.slipstream);
  await rehome([slipstreamPool], behind, VENUES.slipstream);

  // Uniswap V4: 0.05% at spacing 10 with a protocol fee each way and a tick within 1% of its
  // price, and 0.005% at spacing 1, a key only --v4-key names. 0.3% at 60 has no pool.
  const v4 = new Map<
    string,
    { price: string; liquidity: bigint; lpFee: number; protocolFee: number }
  >([
    [
      "500:10",
      { price: "400.2", liquidity: 3n * 10n ** 11n, lpFee: 500, protocolFee: 300 | (100 << 12) },
    ],
    ["50:1", { price: "400.1", liquidity: 2n * 10n ** 9n, lpFee: 50, protocolFee: 0 }],
  ]);
  const stateView = await deploy(STATE_VIEW.creationCode);
  for (const [key, set] of v4) {
    const [fee, spacing] = key.split(":").map(Number) as [number, number];
    const sqrt = sqrtAt(set.price);
    await call(stateView, STATE_VIEW.abi, "setPool", [
      v4Id(fee, spacing),
      sqrt,
      tickOf(sqrt),
      set.protocolFee,
      set.lpFee,
      set.liquidity,
    ]);
  }
  // Above 500:10's price by 30 ticks, its liquidity doubles.
  {
    const tick = (Math.floor(tickOf(sqrtAt("400.2")) / 10) + 3) * 10;
    const compressed = tick / 10;
    await call(stateView, STATE_VIEW.abi, "setTick", [
      v4Id(500, 10),
      compressed >> 8,
      1n << BigInt(((compressed % 256) + 256) % 256),
      tick,
      3n * 10n ** 11n,
    ]);
  }
  await replay(stateView, VENUES.stateView);

  return {
    rpcUrl,
    publicClient,
    testClient,
    deployer: DEPLOYER.address,
    liquidity,
    pools,
    v4,
    stop: async () => {
      if (anvil.exitCode !== null) return;
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    },
  };
}
