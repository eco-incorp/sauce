/**
 * The `sauce-distributed-swap` skill's program, EXECUTED: the file the skill teaches, compiled for
 * Base, cooked on the released gated engine (`gated-engine.ts`) against REAL Uniswap V3 and V4
 * pools, every one of its three venue branches trading.
 *
 * Nothing is forked. The V3 pools are Uniswap's own `UniswapV3Factory` and `UniswapV3Pool`
 * bytecode from `@uniswap/v3-core`: a factory deployed here creates and initializes them, and its
 * code and storage are then replayed onto Base's factory address, so `UniswapV3.Factory.getPool` in
 * the program finds them (as `descriptors-viem.e2e.test.ts` does). Liquidity is minted through
 * `fixtures/UniswapV3Minter.sol`, which answers the pool's mint callback. The V4 pools are
 * Uniswap's own `PoolManager` from `@uniswap/v4-core`, run at Base's PoolManager address (its one
 * immutable, the address it checks it runs at, set to that address), with liquidity added through
 * v4-core's own `PoolModifyLiquidityTest`, and read through `fixtures/StateView.sol` at Base's
 * StateView address: v4-periphery's `getSlot0`/`getLiquidity`, as `swap-on-base.e2e.test.ts` runs
 * them. The two tokens are `MockERC20` runtimes at Base's USDC and SPCXc addresses, so USDC is
 * token0, as on Base, and the program runs as it ships, naming both. On Base, SPCXc is a B20 token
 * built into the node, whose account holds the one byte `0xef` that anvil cannot run; CLAUDE.md
 * keeps every execution suite off it. That is about Base's own state, forked or live. This chain
 * forks nothing: SPCXc's address is an empty account here, as any other, and the mock etched at it
 * is an ordinary ERC-20, which is all the program asks of the token it buys.
 *
 * Slipstream's own contracts cannot run on a local chain (its factory needs its voter, registry and
 * pool implementation), so its venue is a Uniswap V3 pool behind `fixtures/TickSpacingPoolFactory.sol`
 * at `AerodromeSlipstream.CLFactoryGaugesV3`'s address, which answers Slipstream's
 * `getPool(tokenA, tokenB, tickSpacing)`. A Slipstream pool speaks the same swap and callback, and
 * `AerodromeSlipstream.Pool`'s ABI is pinned against deployed Slipstream pools by
 * `registry-abi.test.ts`; what this runs is the program's Slipstream branch: the lookup by tick
 * spacing, the reads through `AerodromeSlipstream.Pool`, the fee read from the pool (a 0.3% pool at
 * spacing 10, so a fee assumed from the spacing would be wrong), and the swap by `uniswapV3`.
 *
 * The pools, in USDC per SPCXc: Slipstream at spacing 10, 0.3% at 150.15; Uniswap V3 none at fees
 * 100, 200, 300 and 400, 0.05% at 150 and 0.3% at 150.25 with liquidity, 1% at a stale 147.25 with
 * none; Uniswap V4's standard hookless keys none at 0.3%, 0.01% at 152.25 with no liquidity, 0.05%
 * at 150.10 with liquidity and a protocol fee of 0.1% paying token0, USDC (0.02% paying token1),
 * 1% at 149.40 with liquidity, past its own limit both ways. The program buys SPCXc with USDC,
 * paying token0; the same program with the two symbols swapped sells SPCXc, paying token1, and
 * runs the other direction's branches. What the skill says the program does, and
 * this holds it to: a missing pool, an empty one and one past its own limit are skipped; each pool
 * stops at its own limit, `priceLimit` moved by √(1 − fee) with the fee read from the pool (for V4,
 * this direction's protocol fee composed with the LP fee), so every fill costs at most `priceLimit`
 * with its fee paid, on average and at its last unit, which costs `priceLimit`; the budget's unspent
 * rest goes to `recipient` and the Pot's other balance stays; `minTokens` at `budget × 1e18 ÷
 * priceLimit` buys all of the budget or reverts, and `maxAvgPrice` reverts; `main` returns
 * `{ spent, bought, unspent }`, the same three words `abi.encode` gave, and `sauce simulate` prints
 * them by name. What each guard is for, by taking it out. And what a lookup costs.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  maxUint256,
  pad,
  parseAbi,
  parseEventLogs,
} from "viem";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { nodeIo, runCli, type CliIo } from "../../src/cli/run.js";
import { sqrtPriceX96FromPrice } from "../../src/price.js";
import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { Base } from "../../src/index.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const require = createRequire(import.meta.url);
const v3 = (name: string) =>
  json<{ abi: Abi; bytecode: Hex }>(
    require.resolve(`@uniswap/v3-core/artifacts/contracts/${name}.sol/${name}.json`),
  );
const v4 = (name: string) => {
  const artifact = json<{
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: { immutableReferences: Record<string, { start: number; length: number }[]> };
  }>(require.resolve(`@uniswap/v4-core/out/${name}.sol/${name}.json`));
  return {
    abi: artifact.abi,
    creationCode: artifact.bytecode.object,
    immutables: Object.values(artifact.deployedBytecode.immutableReferences).flat(),
  };
};
const FACTORY = v3("UniswapV3Factory");
const POOL = v3("UniswapV3Pool");
const POOL_MANAGER = v4("PoolManager");
const MODIFY_LIQUIDITY = v4("PoolModifyLiquidityTest");
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
const MINTER = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/UniswapV3Minter.json"));
const STATE_VIEW = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/StateView.json"));
const BY_SPACING = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/TickSpacingPoolFactory.json"),
);
const PROGRAM_PATH = join(
  HERE,
  "../../../skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts",
);
const PROGRAM = readFileSync(PROGRAM_PATH, "utf8");

/** Anvil's first dev account: the Kitchen's owner, the Pot's owner, and the liquidity provider. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const RECIPIENT = getAddress("0x7777777777777777777777777777777777777777");
/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 15_000_000n;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

const USDC = getAddress(Base.USDC.address!);
const SPCXC = getAddress(Base.SPCXc.address!);
/** SPCXc, 8 decimals, priced in USDC, 6: SPCXc is token1, USDC's address being the lower. */
const PAIR = { baseDecimals: 8, quoteDecimals: 6, baseIsToken0: false };
const sqrtAt = (usdcPerShare: string): bigint => sqrtPriceX96FromPrice(usdcPerShare, PAIR);
const Q192 = 2n ** 192n;
const E18 = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";

/** `priceLimit` buying SPCXc with USDC, for a price in cents: USDC units per SPCXc unit, times 1e18,
 *  which for 6 and 8 decimals is the price times 1e16. */
const usdcPerShare = (cents: bigint): bigint => cents * 10n ** 14n;
/** `priceLimit` selling SPCXc for USDC, for a price in cents of USDC per SPCXc: SPCXc units per USDC
 *  unit, times 1e18, rounded down. */
const sharesPerUsdc = (cents: bigint): bigint => (10n ** 8n * E18 * 100n) / (cents * 10n ** 6n);
/** 150.75 USDC per SPCXc, 0.5% above 150: the `priceLimit` most tests buy at. */
const PRICE_LIMIT = usdcPerShare(15_075n);

interface Venue {
  kind: "v3" | "cl" | "v4";
  /** The pool's fee: a V3 pool's tier, a V4 key's LP fee. */
  fee: bigint;
  /** The pool's own tick spacing, for minting around its price. */
  spacing: number;
  /** USDC per SPCXc, or none: no pool at this key. */
  price?: string;
  liquidity: bigint;
  /** The Slipstream tick spacing the pool stands at, behind the Slipstream lookup. */
  slipstream?: bigint;
  /** A V4 pool's protocol fee: paying token0's in the low 12 bits, token1's in the next 12. */
  protocolFee?: number;
}
/** A pool's liquidity: about 5,200 USDC moves its price 1%, at 150 USDC per SPCXc. */
const DEEP = 848n * 10n ** 9n;
const VENUES: Venue[] = [
  {
    kind: "cl",
    fee: 3000n,
    spacing: 60,
    price: "150.15",
    liquidity: DEEP,
    slipstream: 10n,
  },
  { kind: "v3", fee: 500n, spacing: 10, price: "150", liquidity: (DEEP * 3n) / 4n },
  { kind: "v3", fee: 3000n, spacing: 60, price: "150.25", liquidity: DEEP },
  { kind: "v3", fee: 10000n, spacing: 200, price: "147.25", liquidity: 0n },
  { kind: "v4", fee: 100n, spacing: 1, price: "152.25", liquidity: 0n },
  {
    kind: "v4",
    fee: 500n,
    spacing: 10,
    price: "150.10",
    liquidity: DEEP,
    protocolFee: 1000 | (200 << 12),
  },
  { kind: "v4", fee: 3000n, spacing: 60, liquidity: 0n },
  { kind: "v4", fee: 10000n, spacing: 200, price: "149.40", liquidity: DEEP },
];
const venueName = (venue: Venue): string =>
  venue.kind === "cl" ? `cl:${venue.slipstream}` : `${venue.kind}:${venue.fee}`;

/** A hookless V4 key of the pair, and its id: what the program hashes. */
const keyOf = (venue: Venue) => ({
  currency0: USDC,
  currency1: SPCXC,
  fee: Number(venue.fee),
  tickSpacing: venue.spacing,
  hooks: ZERO as Address,
});
const idOf = (venue: Venue): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [USDC, SPCXC, Number(venue.fee), venue.spacing, ZERO],
    ),
  );

const send = async (to: Address | null, data: Hex): Promise<TransactionReceipt> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });
  return publicClient.waitForTransactionReceipt({ hash });
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const receipt = await send(null, creationCode);
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deploy failed");
  return receipt.contractAddress;
};

const deployWith = (creationCode: Hex, address: Address): Promise<Address> =>
  deploy(concatHex([creationCode, encodeAbiParameters([{ type: "address" }], [address])]));

const call = async (to: Address, abi: Abi, functionName: string, args: unknown[]) => {
  const receipt = await send(to, encodeFunctionData({ abi, functionName, args }));
  if (receipt.status !== "success") throw new Error(`${functionName} on ${to} reverted`);
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

/** The tick of a sqrtPriceX96, rounded down to the tick spacing. */
const tickOf = (sqrtPriceX96: bigint, spacing: number): number => {
  const ratio = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  return Math.floor(Math.log(ratio) / Math.log(1.0001) / spacing) * spacing;
};

/** Replays `from`'s storage onto `to`, and its code, or `code` in its place. */
const replay = async (from: Address, to: Address, code?: Hex) => {
  const dumped = JSON.parse(
    new TextDecoder().decode(gunzipSync(hexToBytes(await testClient.dumpState()))),
  ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
  const state = dumped.accounts[from.toLowerCase()] ?? dumped.accounts[from];
  await testClient.setCode({ address: to, bytecode: code ?? state!.code });
  for (const [index, value] of Object.entries(state!.storage))
    await testClient.setStorageAt({ address: to, index: index as Hex, value });
};

const snapshotNow = (): Promise<Hex> => testClient.snapshot();

let anvil: ChildProcess;
let sauce: GatedEngine;
const POOL_MANAGER_AT = getAddress(Base.UniswapV4.PoolManager.address!);
const STATE_VIEW_AT = getAddress(Base.UniswapV4.StateView.address!);
/** Each V3 pool (the Slipstream stand-in included) by its venue name. */
const v3Pools = new Map<string, Address>();

/** A V3 pool's price, or a V4 pool's as the StateView reads it. */
const priceOf = async (venue: Venue): Promise<bigint> => {
  const [sqrtPriceX96] =
    venue.kind === "v4"
      ? ((await publicClient.readContract({
          abi: STATE_VIEW.abi,
          address: STATE_VIEW_AT,
          args: [idOf(venue)],
          functionName: "getSlot0",
        })) as [bigint])
      : ((await publicClient.readContract({
          abi: POOL.abi,
          address: v3Pools.get(venueName(venue))!,
          functionName: "slot0",
        })) as [bigint]);
  return sqrtPriceX96;
};
const venue = (name: string): Venue => VENUES.find((v) => venueName(v) === name)!;

/** The program compiled for Base, as `sauce compile --chain base` compiles it; once per source. */
const programs = new Map<string, ReturnType<typeof compileSauceProgram>>();
const compiled = (source = PROGRAM) => {
  if (!programs.has(source)) programs.set(source, compileSauceProgram("base", source));
  return programs.get(source)!;
};

/** main(budget, priceLimit, minTokens, maxAvgPrice, recipient). */
type Args = [bigint, bigint, bigint, bigint, Address];
/** Buying SPCXc with `budget` USDC at most `priceLimit`, with no minimum and no average cap. */
const buying = (budget: bigint, priceLimit = PRICE_LIMIT): Args => [
  budget,
  priceLimit,
  0n,
  0n,
  RECIPIENT,
];
/** The same program selling SPCXc for USDC: its two symbols swapped, so it pays token1. */
const SELLING = PROGRAM.replaceAll("USDC", "\u0000")
  .replaceAll("SPCXc", "USDC")
  .replaceAll("\u0000", "SPCXc");

/** The cook of the program with `main`'s arguments, as `sauce tx` builds it. */
const cookData = (args: Args, source = PROGRAM): Hex => {
  const program = compiled(source);
  const encoded = encodeEntryArguments(program, args);
  return sauce.cookData(concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]));
};

/** What the cook returns, by an eth_call: `main`'s value as it comes back, with no ABI framing. */
const returnData = async (args: Args, source = PROGRAM): Promise<Hex> =>
  (await publicClient.call({ account: OWNER.address, data: cookData(args, source), to: sauce.pot }))
    .data!;

/** What `main` returns, `{ spent, bought, unspent }`: a record comes back as its fields, one word
 *  each. */
const returned = async (
  args: Args,
): Promise<{ spent: bigint; bought: bigint; unspent: bigint }> => {
  const [spent, bought, unspent] = decodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    await returnData(args),
  );
  return { spent, bought, unspent };
};

/** Sends that cook from the Pot's owner; the receipt, reverted or not. */
const cook = (args: Args, source = PROGRAM): Promise<TransactionReceipt> =>
  send(sauce.pot, cookData(args, source));

/** The cook's revert, simulated: rejects with the program's message. */
const rehearse = (args: Args, source = PROGRAM) =>
  publicClient.call({ account: OWNER.address, data: cookData(args, source), to: sauce.pot });

/** The program with one of its own pieces replaced, to show what that piece guards against. */
const replacing = (piece: string, instead = ""): string => {
  const edited = PROGRAM.replace(piece, instead);
  if (edited === PROGRAM) throw new Error(`the program has no ${piece}`);
  return edited;
};

interface Fill {
  venue: string;
  /** The fee the swap was charged: a V3 pool's tier, the PoolManager's composed swap fee. */
  fee: bigint;
  /** What the pool took, its fee included, and what it paid out. */
  paid: bigint;
  got: bigint;
  /** The pool's price after the swap. */
  sqrtPriceX96: bigint;
}
/** Every swap in a cook, in order: a V3 pool's `Swap` (amounts the pool's), and the PoolManager's
 *  (amounts the swapper's, its fee the one charged, protocol fee included). */
const fills = (receipt: TransactionReceipt): Fill[] =>
  receipt.logs.flatMap((log): Fill[] => {
    if (getAddress(log.address) === POOL_MANAGER_AT) {
      return parseEventLogs({ abi: POOL_MANAGER.abi, eventName: "Swap", logs: [log] }).map(
        (event) => {
          const { amount0, amount1, fee, id, sqrtPriceX96 } = event.args as unknown as {
            amount0: bigint;
            amount1: bigint;
            fee: number;
            id: Hex;
            sqrtPriceX96: bigint;
          };
          const at = VENUES.find((v) => v.kind === "v4" && idOf(v) === id)!;
          const [paid, got] = amount0 < 0n ? [-amount0, amount1] : [-amount1, amount0];
          return { fee: BigInt(fee), got, paid, sqrtPriceX96, venue: venueName(at) };
        },
      );
    }
    const name = [...v3Pools].find(([, at]) => at === getAddress(log.address))?.[0];
    if (name === undefined) return [];
    return parseEventLogs({ abi: POOL.abi, eventName: "Swap", logs: [log] }).map((event) => {
      const { amount0, amount1, sqrtPriceX96 } = event.args as unknown as {
        amount0: bigint;
        amount1: bigint;
        sqrtPriceX96: bigint;
      };
      const [paid, got] = amount0 > 0n ? [amount0, -amount1] : [amount1, -amount0];
      return { fee: venue(name).fee, got, paid, sqrtPriceX96, venue: name };
    });
  });

/** A fill's last unit, against `priceLimit` with its fee paid: `[cost, bound]`, cost ≤ bound when it
 *  is within. Paying token1, a token0 costs price ÷ (1 − fee); paying token0, a token1 costs
 *  1 ÷ (price × (1 − fee)). Both as cost × (1 − fee) × 2^192 × 1e6 against priceLimit's side. */
const lastUnit = (fill: Fill, priceLimit: bigint, paysToken0: boolean): [bigint, bigint] => {
  const square = fill.sqrtPriceX96 * fill.sqrtPriceX96; // token1 per token0, times 2^192
  return paysToken0
    ? [Q192 * 1_000_000n * E18, priceLimit * square * (1_000_000n - fill.fee)]
    : [square * 1_000_000n * E18, priceLimit * Q192 * (1_000_000n - fill.fee)];
};

/**
 * A fill costs at most `priceLimit` (payToken units per buyToken unit, times 1e18) with its fee paid:
 * on average, and at its last unit, the pool's price after the swap. `atLimit`: and that last unit
 * costs `priceLimit` itself, to within 0.001%, as it does for a pool that stopped at its own limit.
 */
const expectWithin = (fill: Fill, priceLimit: bigint, paysToken0: boolean, atLimit = false) => {
  expect(fill.paid * E18).toBeLessThanOrEqual(priceLimit * fill.got);
  const [cost, bound] = lastUnit(fill, priceLimit, paysToken0);
  expect(cost).toBeLessThanOrEqual(bound);
  if (atLimit) expect(cost * 100_001n).toBeGreaterThanOrEqual(bound * 100_000n);
};

const sum = (xs: Fill[], field: "paid" | "got") => xs.reduce((total, x) => total + x[field], 0n);

describeEvm("the sauce-distributed-swap program, on real Uniswap V3 and V4 pools", () => {
  let snapshot: Hex;

  beforeAll(async () => {
    anvil = await spawnAnvil(PORT, ["--chain-id", "8453"]);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );

    // The tokens, at Base's USDC and SPCXc addresses: an empty account here, SPCXc's included, so
    // each takes the mock's code as any address would (no B20 runs on a chain that forks nothing).
    const token = await deploy(MOCK_ERC20.creationCode);
    const tokenCode = (await publicClient.getCode({ address: token }))!;
    for (const at of [USDC, SPCXC]) {
      await testClient.setCode({ address: at, bytecode: tokenCode });
      await call(at, erc20, "mint", [OWNER.address, 10n ** 30n]);
    }

    // Uniswap V4: the PoolManager at Base's address, its immutable record of the address it was
    // deployed at, which it requires to run at, set to Base's; its storage (the owner) replayed.
    const manager = await deployWith(POOL_MANAGER.creationCode, OWNER.address);
    let code = (await publicClient.getCode({ address: manager }))!.slice(2);
    const word = (address: Address) => pad(address, { size: 32 }).slice(2).toLowerCase();
    for (const { start, length } of POOL_MANAGER.immutables) {
      const [from, to] = [start * 2, (start + length) * 2];
      expect(code.slice(from, to)).toBe(word(manager));
      code = code.slice(0, from) + word(POOL_MANAGER_AT) + code.slice(to);
    }
    await replay(manager, POOL_MANAGER_AT, `0x${code}`);
    const stateView = await deployWith(STATE_VIEW.creationCode, POOL_MANAGER_AT);
    await testClient.setCode({
      address: STATE_VIEW_AT,
      bytecode: (await publicClient.getCode({ address: stateView }))!,
    });
    const liquidityRouter = await deployWith(MODIFY_LIQUIDITY.creationCode, POOL_MANAGER_AT);
    await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "setProtocolFeeController", [OWNER.address]);

    // Uniswap V3: the pools created by Uniswap's own factory, one for the Uniswap V3 venue and
    // another for the pool behind the Slipstream lookup.
    const factory = await deploy(FACTORY.bytecode);
    const other = await deploy(FACTORY.bytecode);
    const minter = await deploy(MINTER.creationCode);
    const slipstream = getAddress(Base.AerodromeSlipstream.CLFactoryGaugesV3.address!);
    await testClient.setCode({
      address: slipstream,
      bytecode: (await publicClient.getCode({ address: await deploy(BY_SPACING.creationCode) }))!,
    });
    for (const at of [USDC, SPCXC]) {
      await call(at, erc20, "approve", [minter, maxUint256]);
      await call(at, erc20, "approve", [liquidityRouter, maxUint256]);
    }

    for (const venue of VENUES) {
      if (venue.price === undefined) continue;
      const start = sqrtAt(venue.price);
      const tick = tickOf(start, venue.spacing);
      const [tickLower, tickUpper] = [tick - 200 * venue.spacing, tick + 200 * venue.spacing];
      if (venue.kind === "v4") {
        const key = keyOf(venue);
        await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "initialize", [key, start]);
        if (venue.liquidity > 0n)
          await call(liquidityRouter, MODIFY_LIQUIDITY.abi, "modifyLiquidity", [
            key,
            { liquidityDelta: venue.liquidity, salt: pad("0x00"), tickLower, tickUpper },
            "0x",
            false, // paid by transfer, not by burning claims
            false, // taken as tokens, not as claims
          ]);
        if (venue.protocolFee !== undefined)
          await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "setProtocolFee", [key, venue.protocolFee]);
        continue;
      }
      const by = venue.kind === "cl" ? other : factory;
      await call(by, FACTORY.abi, "createPool", [USDC, SPCXC, venue.fee]);
      const pool = getAddress(
        (await publicClient.readContract({
          abi: FACTORY.abi,
          address: by,
          args: [USDC, SPCXC, venue.fee],
          functionName: "getPool",
        })) as Address,
      );
      v3Pools.set(venueName(venue), pool);
      if (venue.kind === "cl")
        await call(slipstream, BY_SPACING.abi, "setPool", [USDC, SPCXC, venue.slipstream, pool]);
      await call(pool, POOL.abi, "initialize", [start]);
      if (venue.liquidity > 0n)
        await call(minter, MINTER.abi, "mint", [pool, tickLower, tickUpper, venue.liquidity]);
    }
    // The Uniswap V3 factory's code and state onto Base's factory address, where the program looks.
    await replay(factory, getAddress(Base.UniswapV3.Factory.address!));

    snapshot = await testClient.snapshot();
  }, 180_000);

  beforeEach(async () => {
    await testClient.revert({ id: snapshot });
    snapshot = await testClient.snapshot();
  });

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("finds the pools at Base's addresses: none at V3 fee 100, and V4's by key in the StateView", async () => {
    const lookup = (fee: bigint) =>
      publicClient.readContract({
        abi: FACTORY.abi,
        address: getAddress(Base.UniswapV3.Factory.address!),
        args: [USDC, SPCXC, fee],
        functionName: "getPool",
      });
    expect(await lookup(100n)).toBe(ZERO);
    for (const fee of [500n, 3000n, 10000n])
      expect(getAddress((await lookup(fee)) as Address)).toBe(v3Pools.get(`v3:${fee}`));
    for (const at of VENUES.filter((v) => v.kind === "v4")) {
      const [sqrtPriceX96, , protocolFee, lpFee] = (await publicClient.readContract({
        abi: STATE_VIEW.abi,
        address: STATE_VIEW_AT,
        args: [idOf(at)],
        functionName: "getSlot0",
      })) as [bigint, number, number, number];
      const liquidity = await publicClient.readContract({
        abi: STATE_VIEW.abi,
        address: STATE_VIEW_AT,
        args: [idOf(at)],
        functionName: "getLiquidity",
      });
      // A key with no pool reads as all zeros: no price, no liquidity, no fee.
      expect([sqrtPriceX96, liquidity, protocolFee, lpFee]).toEqual([
        at.price === undefined ? 0n : sqrtAt(at.price),
        at.liquidity,
        at.protocolFee ?? 0,
        at.price === undefined ? 0 : Number(at.fee),
      ]);
      // An id is a 256-bit hash: as an address, its top 12 bytes would be gone.
      expect(BigInt(idOf(at)) >> 160n).not.toBe(0n);
    }
  });

  it("buys with all of the budget across two pools, each fill within priceLimit", async () => {
    const budget = 2_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const empty = await priceOf(venue("v3:10000"));
    const { spent, bought, unspent } = await returned(buying(budget));

    const receipt = await cook(buying(budget));
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    // Slipstream first, to its own limit, then the 0.05% Uniswap V3 pool with the rest.
    expect(swapped.map((fill) => fill.venue)).toEqual(["cl:10", "v3:500"]);
    swapped.forEach((fill, i) => expectWithin(fill, PRICE_LIMIT, true, i < 1));
    expect([spent, unspent]).toEqual([budget, 0n]);
    expect(sum(swapped, "paid")).toBe(budget);
    expect(bought).toBe(sum(swapped, "got"));
    expect(await balance(SPCXC, RECIPIENT)).toBe(bought);
    expect(await balance(USDC, sauce.pot)).toBe(0n);
    expect(await balance(USDC, RECIPIENT)).toBe(0n);
    // The empty 1% pool, priced inside its limit, was not touched.
    expect(await priceOf(venue("v3:10000"))).toBe(empty);
    console.log(
      `full fill: gas ${receipt.gasUsed}, ${bought} SPCXc units for ${budget} USDC units`,
    );
  });

  it("returns { spent, bought, unspent }: the three words abi.encode gave, and simulate names them", async () => {
    const budget = 2_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const record = await returnData(buying(budget));
    const encoded = await returnData(
      buying(budget),
      replacing("): { spent: Uint256; bought: Uint256; unspent: Uint256 } {", "): bytes {").replace(
        "return { spent, bought, unspent };",
        "return abi.encode(spent, bought, unspent);",
      ),
    );
    expect(record).toBe(encoded);
    expect(hexToBytes(record)).toHaveLength(96);
    const { spent, bought, unspent } = await returned(buying(budget));

    // The skill's rehearsal, through the command: `main`'s value by name, and what the cook moved.
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(
      [
        "simulate",
        PROGRAM_PATH,
        "--chain",
        "base",
        "--owner",
        OWNER.address,
        "--rpc-url",
        RPC_URL,
        "--assume-balance",
        "USDC:2000",
        "--args",
        String(budget),
        String(PRICE_LIMIT),
        "0",
        "0",
        RECIPIENT,
      ],
      io,
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    // The cook's gas: after the Pot's deploy, when the rehearsal deploys it first.
    expect(stdout).toMatch(
      /^The cook succeeds from 0x[0-9a-fA-F]{40}: gas used \d+( for the cook, after the Pot's deploy \(1\. below\))?, returns 0x/,
    );
    expect(stdout).toContain(
      `main returns { spent: Uint256; bought: Uint256; unspent: Uint256 }: ` +
        `{ spent: ${spent}, bought: ${bought}, unspent: ${unspent} }`,
    );
    console.log(stdout);
  });

  it("spends only what priceLimit allows: every pool with liquidity, V4's too, stops at its own limit", async () => {
    const budget = 5_000n * 10n ** 6n;
    const kept = 123n * 10n ** 6n; // the Pot's own USDC, not part of the budget
    await call(USDC, erc20, "mint", [sauce.pot, budget + kept]);
    const untouched = ["v3:10000", "v4:100", "v4:10000"].map(venue);
    const before = await Promise.all(untouched.map(priceOf));
    const { spent, bought, unspent } = await returned(buying(budget));

    const receipt = await cook(buying(budget));
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    // In the program's order: Slipstream, Uniswap V3 by fee tier, then Uniswap V4. The 0.05% V4
    // pool's fee is its LP fee and the 0.1% protocol fee for paying token0, composed.
    expect(swapped.map((fill) => fill.venue)).toEqual(["cl:10", "v3:500", "v3:3000", "v4:500"]);
    expect(swapped[3]!.fee).toBe(1500n);
    // Every pool stopped at its own limit: every unit within priceLimit, the last at it.
    for (const fill of swapped) expectWithin(fill, PRICE_LIMIT, true, true);
    expect(spent).toBe(sum(swapped, "paid"));
    expect(spent + unspent).toBe(budget);
    expect(unspent).toBeGreaterThan(0n);
    // What the limits left of the budget goes to the recipient; the Pot's own stays.
    expect(await balance(USDC, RECIPIENT)).toBe(unspent);
    expect(await balance(USDC, sauce.pot)).toBe(kept);
    expect(await balance(SPCXC, RECIPIENT)).toBe(bought);
    // The empty V3 pool, the empty V4 pool and the V4 pool past its own limit were not touched.
    expect(await Promise.all(untouched.map(priceOf))).toEqual(before);
    console.log(`partial fill: gas ${receipt.gasUsed}, spent ${spent} of ${budget}`);
  });

  it("sells SPCXc for USDC the same way, its symbols swapped: paying token1, each pool up to its own limit", async () => {
    const budget = 70n * 10n ** 8n; // 70 SPCXc
    const priceLimit = sharesPerUsdc(14_925n); // at least 149.25 USDC for each SPCXc
    await call(SPCXC, erc20, "mint", [sauce.pot, budget]);

    const receipt = await cook([budget, priceLimit, 0n, 0n, RECIPIENT], SELLING);
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.venue)).toEqual(["cl:10", "v3:500", "v3:3000", "v4:500"]);
    // Paying token1, the V4 pool's protocol fee is the next 12 bits': 0.02%.
    expect(swapped[3]!.fee).toBe(700n);
    for (const fill of swapped) expectWithin(fill, priceLimit, false, true);
    const spent = sum(swapped, "paid");
    expect(await balance(SPCXC, RECIPIENT)).toBe(budget - spent);
    expect(await balance(USDC, RECIPIENT)).toBe(sum(swapped, "got"));
  });

  it("skips every pool already past its own limit, and sends the whole budget to the recipient", async () => {
    const budget = 1_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    // At most 150: each pool's own limit is below its price (the 0.05% V3 pool's is 149.925, the
    // V4 pool's at 0.15% 149.775); handed such a limit, a pool reverts.
    const args = buying(budget, usdcPerShare(15_000n));
    expect(await returned(args)).toEqual({ spent: 0n, bought: 0n, unspent: budget });
    const receipt = await cook(args);
    expect(receipt.status).toBe("success");
    expect(fills(receipt)).toEqual([]);
    expect(await balance(USDC, RECIPIENT)).toBe(budget);
  });

  it("minTokens at budget × 1e18 ÷ priceLimit, rounded up: all of the budget, or the cook reverts", async () => {
    const allOrNothing = (budget: bigint): Args => {
      const args = buying(budget);
      args[2] = (budget * E18 + PRICE_LIMIT - 1n) / PRICE_LIMIT;
      return args;
    };
    // 2,000 USDC fits within priceLimit: it is all spent, and buys more than the minimum.
    await call(USDC, erc20, "mint", [sauce.pot, 7_000n * 10n ** 6n]);
    const fits = allOrNothing(2_000n * 10n ** 6n);
    const { spent, bought } = await returned(fits);
    expect(spent).toBe(fits[0]);
    expect(bought).toBeGreaterThanOrEqual(fits[2]);
    // 5,000 does not: the pools take about 3,700 within priceLimit, so the cook reverts.
    await expect(rehearse(allOrNothing(5_000n * 10n ** 6n))).rejects.toThrow(
      /bought below minTokens/,
    );
  });

  it("reverts the whole cook below minTokens, and above maxAvgPrice", async () => {
    const budget = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const { bought } = await returned(buying(budget));

    const short = buying(budget);
    short[2] = bought + 1n;
    expect((await cook(short)).status).toBe("reverted");
    await expect(rehearse(short)).rejects.toThrow(/bought below minTokens/);
    // Every unit cost under 150.75 and the first ones about 150: an average cap of 150 is below what
    // was paid.
    const dear = buying(budget);
    dear[3] = usdcPerShare(15_000n);
    await expect(rehearse(dear)).rejects.toThrow(/average too high/);
    expect(await balance(USDC, sauce.pot)).toBe(budget);
    expect(await balance(SPCXC, RECIPIENT)).toBe(0n);
  });

  it("maxAvgPrice halfway from the rehearsal's average to priceLimit: lands as rehearsed, reverts once the market moves", async () => {
    const budget = 2_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const { spent, bought } = await returned(buying(budget));
    const average = (spent * E18) / bought; // priceLimit's units
    const capped = buying(budget);
    capped[3] = (average + PRICE_LIMIT + 1n) / 2n;
    expect(capped[3]).toBeLessThan(PRICE_LIMIT);
    const rehearsal = await snapshotNow();
    expect((await cook(capped)).status).toBe("success");

    // Another buyer takes most of what the pools hold within priceLimit first: the same cook would
    // now average close to priceLimit, past the cap, and reverts.
    await testClient.revert({ id: rehearsal });
    await call(USDC, erc20, "mint", [sauce.pot, 3_500n * 10n ** 6n]);
    expect((await cook(buying(3_500n * 10n ** 6n))).status).toBe("success");
    await expect(rehearse(capped)).rejects.toThrow(/average too high/);
    const { spent: later, bought: fewer } = await returned(buying(budget));
    expect(later * E18).toBeGreaterThan(capped[3] * fewer);
  });

  it("refuses a budget that is not in the Pot", async () => {
    await expect(rehearse(buying(1n))).rejects.toThrow(/budget is not in the Pot/);
  });

  it("without the √(1 − fee), a 0.3% pool's last unit costs more than priceLimit", async () => {
    // Enough for every pool to reach the looser limits, the V4 pools' included.
    const budget = 10_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const unadjusted = replacing("Math.sqrt((1000000 - fee) * 10 ** 30)", "10 ** 18");

    const receipt = await cook(buying(budget), unadjusted);
    expect(receipt.status).toBe("success");
    for (const name of ["v3:3000", "v4:500"]) {
      const pricier = fills(receipt).find((fill) => fill.venue === name)!;
      const [cost, bound] = lastUnit(pricier, PRICE_LIMIT, true);
      expect(cost).toBeGreaterThan(bound);
    }
  });

  it("with the other direction's protocol fee, the V4 pool's last unit costs more than priceLimit", async () => {
    const budget = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const swapped = replacing(
      "(paysToken0 ? protocolFees : protocolFees >> 12)",
      "(paysToken0 ? protocolFees >> 12 : protocolFees)",
    );

    const receipt = await cook(buying(budget), swapped);
    expect(receipt.status).toBe("success");
    const v4 = fills(receipt).find((fill) => fill.venue === "v4:500")!;
    expect(v4.fee).toBe(1500n);
    const [cost, bound] = lastUnit(v4, PRICE_LIMIT, true);
    expect(cost).toBeGreaterThan(bound);
  });

  it("without the check for a missing pool, reading it reverts the cook", async () => {
    await call(USDC, erc20, "mint", [sauce.pot, 10n ** 9n]);
    const receipt = await cook(buying(10n ** 9n), replacing("pool == 0 || "));
    expect(receipt.status).toBe("reverted");
  });

  it("without the liquidity check, an empty V3 pool is swapped for nothing, and a missing V4 key reverts", async () => {
    const budget = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    // A V4 key with no pool reads as empty, at price 0. Paying token1, as the program selling SPCXc
    // does, price 0 is past nothing, so the liquidity check is what keeps the swap from reaching a
    // pool that does not exist. (Paying token0, price 0 is past every limit as well.)
    const shares = 70n * 10n ** 8n;
    await call(SPCXC, erc20, "mint", [sauce.pot, shares]);
    const unchecked = await cook(
      [shares, sharesPerUsdc(14_925n), 0n, 0n, RECIPIENT],
      SELLING.replace("liquidity == 0 || ", ""),
    );
    expect(unchecked.status).toBe("reverted");
    // Taken out for the other venues only, the empty 1% V3 pool, priced inside its limit, is swapped.
    const empty = await priceOf(venue("v3:10000"));
    const receipt = await cook(
      buying(budget),
      replacing("liquidity == 0 || ", "(venue == 2 && liquidity == 0) || "),
    );
    expect(receipt.status).toBe("success");
    const wasted = fills(receipt).find((fill) => fill.venue === "v3:10000")!;
    // A call that bought nothing and moved the stale pool's price to its limit.
    expect([wasted.paid, wasted.got]).toEqual([0n, 0n]);
    expect(await priceOf(venue("v3:10000"))).not.toBe(empty);
  });

  it("without the price check, the V4 pool past its own limit reverts the whole cook", async () => {
    const budget = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const receipt = await cook(buying(budget), replacing(" || !better"));
    expect(receipt.status).toBe("reverted");
    expect(await balance(USDC, sauce.pot)).toBe(budget);
  });

  it("what a lookup costs: one more tick spacing, fee tier or V4 key with no pool", async () => {
    const budget = 1_000n * 10n ** 6n;
    // Every pool past its own limit, so the cook swaps nothing and costs what it looks at.
    const args = buying(budget, usdcPerShare(15_000n));
    const gasOf = async (source: string): Promise<bigint> => {
      const at = await snapshotNow();
      await call(USDC, erc20, "mint", [sauce.pot, budget]);
      const receipt = await cook(args, source);
      expect(receipt.status).toBe("success");
      await testClient.revert({ id: at });
      return receipt.gasUsed;
    };
    const base = await gasOf(PROGRAM);
    const more = {
      spacing: await gasOf(replacing("[1, 10, 50,", "[1, 3, 10, 50,")),
      tier: await gasOf(replacing("[100, 200, 300,", "[100, 150, 200, 300,")),
      key: await gasOf(
        replacing(
          "{ fee: 100, spacing: 1 },",
          "{ fee: 100, spacing: 1 },\n{ fee: 50, spacing: 1 },",
        ),
      ),
    };
    const each = Object.fromEntries(Object.entries(more).map(([what, gas]) => [what, gas - base]));
    console.log(`the cook, every pool skipped: gas ${base}; one more lookup:`, each);
    // What the skill states: about 19,000 gas a Slipstream spacing or a V3 tier, whose lookup is
    // one call, and about 42,000 a V4 key, whose lookup is a hash and two StateView reads.
    for (const gas of [each.spacing!, each.tier!]) {
      expect(gas).toBeGreaterThan(15_000n);
      expect(gas).toBeLessThan(25_000n);
    }
    expect(each.key!).toBeGreaterThan(35_000n);
    expect(each.key!).toBeLessThan(50_000n);
  });
});
