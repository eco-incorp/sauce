/**
 * The `sauce-distributed-swap` skill's program, EXECUTED: the file the skill teaches, compiled for
 * Base, cooked on the released gated engine (`gated-engine.ts`) against REAL Uniswap V3 pools.
 *
 * Nothing is forked. The pools are Uniswap's own `UniswapV3Factory` and `UniswapV3Pool` bytecode
 * from `@uniswap/v3-core`: a factory deployed here creates and initializes them, and its code and
 * storage are then replayed onto Base's factory address, so `UniswapV3.Factory.getPool` in the
 * program finds them (as `descriptors-viem.e2e.test.ts` does). Liquidity is minted through
 * `fixtures/UniswapV3Minter.sol`, which answers the pool's mint callback. The two tokens are
 * `MockERC20` runtimes at Base's WETH and USDC addresses, so WETH is token0, as on Base.
 *
 * Slipstream's own contracts cannot run on a local chain (its factory needs its voter, registry and
 * pool implementation), so its venue is a Uniswap V3 pool behind `fixtures/TickSpacingPoolFactory.sol`
 * at `AerodromeSlipstream.CLFactoryGaugesV3`'s address, which answers Slipstream's
 * `getPool(tokenA, tokenB, tickSpacing)`. A Slipstream pool speaks the same swap and callback, and
 * `AerodromeSlipstream.Pool`'s ABI is pinned against deployed Slipstream pools by
 * `registry-abi.test.ts`; what this runs is the program's Slipstream loop: the lookup by tick
 * spacing, the fee read from the pool (a 0.3% pool at spacing 10, so a fee assumed from the spacing
 * would be wrong), and the swap.
 *
 * The pools: Uniswap V3 none at fee 100, 0.05% at 2,700 and 0.3% at 2,705 USDC per WETH with
 * liquidity, 1% at a stale 2,650 with none; Slipstream at spacing 10, 0.3% at 2,703. What the skill
 * says the program does, and this holds it to: a missing pool and an empty one are skipped; each pool
 * stops at its own limit, `maxPrice` moved by √(1 − fee), so every fill costs at most `maxPrice` with
 * its fee paid, on average and at its last unit, which costs `maxPrice`; a pool already past its
 * limit is skipped rather than reverting; the budget's unspent rest goes to `refundTo` and the Pot's
 * other balance stays; `minTokens` and `maxAvgPrice` revert; `main` returns (spent, bought, unspent).
 * And what each guard is for, by taking it out.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import { spawn } from "node:child_process";
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
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  maxUint256,
  parseAbi,
  parseEventLogs,
} from "viem";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { sqrtPriceX96FromPrice } from "../../src/price.js";
import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { Base } from "../../src/index.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

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
const v3 = (name: string) =>
  json<{ abi: Abi; bytecode: Hex }>(
    createRequire(import.meta.url).resolve(
      `@uniswap/v3-core/artifacts/contracts/${name}.sol/${name}.json`,
    ),
  );
const FACTORY = v3("UniswapV3Factory");
const POOL = v3("UniswapV3Pool");
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
const MINTER = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/UniswapV3Minter.json"));
const BY_SPACING = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/TickSpacingPoolFactory.json"),
);
const PROGRAM = readFileSync(
  join(HERE, "../../../skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts"),
  "utf8",
);

/** Anvil's first dev account: the Kitchen's owner, the Pot's owner, and the liquidity provider. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const RECIPIENT = getAddress("0x7777777777777777777777777777777777777777");
const REFUND_TO = getAddress("0x8888888888888888888888888888888888888888");
const PORT = 9800 + (Number(process.env.JEST_WORKER_ID ?? "1") % 50);
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

const WETH = getAddress(Base.WETH.address!);
const USDC = getAddress(Base.USDC.address!);
const PAIR = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };
const sqrtAt = (usdcPerWeth: string): bigint => sqrtPriceX96FromPrice(usdcPerWeth, PAIR);
const Q192 = 2n ** 192n;
const E18 = 10n ** 18n;

/** `maxPrice` buying WETH with USDC: USDC base units per WETH base unit, times 1e18. */
const usdcPerWeth = (tenths: bigint): bigint => (tenths * 10n ** 5n * E18) / E18;
/** `maxPrice` buying USDC with WETH, for a price in USDC per WETH: WETH units per USDC unit. */
const wethPerUsdc = (tenths: bigint): bigint => (E18 * E18 * 10n) / (tenths * 10n ** 6n);

interface Venue {
  fee: bigint;
  spacing: number;
  price: string;
  liquidity: bigint;
  /** Slipstream's tick spacing it stands at, for the pool behind the Slipstream lookup. */
  slipstream?: bigint;
}
/** The pools the suite creates. Uniswap V3 has none at fee 100, and its 1% pool no liquidity. */
const VENUES: Venue[] = [
  { fee: 500n, spacing: 10, price: "2700", liquidity: 15n * 10n ** 15n },
  { fee: 3000n, spacing: 60, price: "2705", liquidity: 20n * 10n ** 15n },
  { fee: 10000n, spacing: 200, price: "2650", liquidity: 0n },
  { fee: 3000n, spacing: 60, price: "2703", liquidity: 20n * 10n ** 15n, slipstream: 10n },
];

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

const slot0Price = async (pool: Address): Promise<bigint> =>
  (
    (await publicClient.readContract({ abi: POOL.abi, address: pool, functionName: "slot0" })) as [
      bigint,
    ]
  )[0];

/** The tick of a sqrtPriceX96, rounded down to the tick spacing. */
const tickOf = (sqrtPriceX96: bigint, spacing: number): number => {
  const ratio = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  return Math.floor(Math.log(ratio) / Math.log(1.0001) / spacing) * spacing;
};

/** Replays `from`'s code and storage onto `to`: a factory at the address the program names. */
const replay = async (from: Address, to: Address) => {
  const dumped = JSON.parse(
    new TextDecoder().decode(gunzipSync(hexToBytes(await testClient.dumpState()))),
  ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
  const state = dumped.accounts[from.toLowerCase()] ?? dumped.accounts[from];
  await testClient.setCode({ address: to, bytecode: state!.code });
  for (const [index, value] of Object.entries(state!.storage))
    await testClient.setStorageAt({ address: to, index: index as Hex, value });
};

let anvil: ChildProcess;
let sauce: GatedEngine;
/** Each pool, by the venue it stands for: `v3:<fee>` or `cl:<spacing>`, with its fee. */
const pools = new Map<string, { at: Address; fee: bigint }>();
const poolAt = (venue: string): Address => pools.get(venue)!.at;

/** The program compiled for Base, as `sauce compile --chain base` compiles it; once per source. */
const programs = new Map<string, ReturnType<typeof compileSauceProgram>>();
const compiled = (source = PROGRAM) => {
  if (!programs.has(source)) programs.set(source, compileSauceProgram("base", source));
  return programs.get(source)!;
};

/** main(payToken, buyToken, budget, maxPrice, minTokens, maxAvgPrice, recipient, refundTo). */
type Args = [Address, Address, bigint, bigint, bigint, bigint, Address, Address];

/** The cook of the program with `main`'s arguments, as `sauce tx` builds it. */
const cookData = (args: Args, source = PROGRAM): Hex => {
  const program = compiled(source);
  const encoded = encodeEntryArguments(program, args);
  return sauce.cookData(concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]));
};

/** What `main` returns, read with an eth_call of the cook, which returns `main`'s bytes as they
 *  are: three words, (spent, bought, unspent). */
const returned = async (args: Args): Promise<readonly [bigint, bigint, bigint]> => {
  const { data } = await publicClient.call({
    account: OWNER.address,
    data: cookData(args),
    to: sauce.pot,
  });
  return decodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    data!,
  );
};

/** Sends that cook from the Pot's owner; the receipt, reverted or not. */
const cook = (args: Args, source = PROGRAM): Promise<TransactionReceipt> =>
  send(sauce.pot, cookData(args, source));

/** The program with one of its own pieces taken out, to show what that piece guards against. */
const without = (piece: string, instead = ""): string => {
  const edited = PROGRAM.replace(piece, instead);
  if (edited === PROGRAM) throw new Error(`the program has no ${piece}`);
  return edited;
};

interface Fill {
  venue: string;
  fee: bigint;
  /** What the pool took, its fee included, and what it paid out. */
  paid: bigint;
  got: bigint;
  /** The pool's price after the swap. */
  sqrtPriceX96: bigint;
}
const fills = (receipt: TransactionReceipt): Fill[] =>
  parseEventLogs({ abi: POOL.abi, eventName: "Swap", logs: receipt.logs }).map((log) => {
    const { amount0, amount1, sqrtPriceX96 } = log.args as unknown as {
      amount0: bigint;
      amount1: bigint;
      sqrtPriceX96: bigint;
    };
    const [venue, { fee }] = [...pools].find(([, pool]) => pool.at === getAddress(log.address))!;
    const [paid, got] = amount0 > 0n ? [amount0, -amount1] : [amount1, -amount0];
    return { fee, got, paid, sqrtPriceX96, venue };
  });

/**
 * A fill costs at most `maxPrice` (payToken units per buyToken unit, times 1e18) with its fee paid:
 * on average, and at its last unit, the pool's price after the swap. `atLimit`: and that last unit
 * costs `maxPrice` itself, to within 0.001%, as it does for a pool that stopped at its own limit.
 */
const expectWithin = (fill: Fill, maxPrice: bigint, paysToken0: boolean, atLimit = false) => {
  expect(fill.paid * E18).toBeLessThanOrEqual(maxPrice * fill.got);
  const square = fill.sqrtPriceX96 * fill.sqrtPriceX96; // token1 per token0, times 2^192
  // Paying token1, a token0 costs price ÷ (1 − fee); paying token0, a token1 costs 1 ÷ (price ×
  // (1 − fee)). Both as cost × (1 − fee) × 2^192 × 1e6 against maxPrice's side.
  const [cost, bound] = paysToken0
    ? [Q192 * 1_000_000n * E18, maxPrice * square * (1_000_000n - fill.fee)]
    : [square * 1_000_000n * E18, maxPrice * Q192 * (1_000_000n - fill.fee)];
  expect(cost).toBeLessThanOrEqual(bound);
  if (atLimit) expect(cost * 100_001n).toBeGreaterThanOrEqual(bound * 100_000n);
};

describeEvm("the sauce-distributed-swap program, on real Uniswap V3 pools", () => {
  let snapshot: Hex;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "8453", "--silent"], {
      stdio: "ignore",
    });
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await publicClient.getChainId();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`anvil did not come up on ${RPC_URL}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );

    // The tokens, at Base's WETH and USDC addresses.
    const token = await deploy(MOCK_ERC20.creationCode);
    const tokenCode = (await publicClient.getCode({ address: token }))!;
    for (const at of [WETH, USDC]) {
      await testClient.setCode({ address: at, bytecode: tokenCode });
      await call(at, erc20, "mint", [OWNER.address, 10n ** 30n]);
    }

    // The pools, created by Uniswap's own factory: one for the Uniswap V3 venue, another for the
    // pool behind the Slipstream lookup. Liquidity in each but the 1% pool.
    const factory = await deploy(FACTORY.bytecode);
    const other = await deploy(FACTORY.bytecode);
    const minter = await deploy(MINTER.creationCode);
    const slipstream = getAddress(Base.AerodromeSlipstream.CLFactoryGaugesV3.address!);
    await testClient.setCode({
      address: slipstream,
      bytecode: (await publicClient.getCode({ address: await deploy(BY_SPACING.creationCode) }))!,
    });
    for (const at of [WETH, USDC]) await call(at, erc20, "approve", [minter, maxUint256]);
    for (const venue of VENUES) {
      const by = venue.slipstream === undefined ? factory : other;
      await call(by, FACTORY.abi, "createPool", [WETH, USDC, venue.fee]);
      const pool = getAddress(
        (await publicClient.readContract({
          abi: FACTORY.abi,
          address: by,
          args: [WETH, USDC, venue.fee],
          functionName: "getPool",
        })) as Address,
      );
      if (venue.slipstream === undefined)
        pools.set(`v3:${venue.fee}`, { at: pool, fee: venue.fee });
      else {
        pools.set(`cl:${venue.slipstream}`, { at: pool, fee: venue.fee });
        await call(slipstream, BY_SPACING.abi, "setPool", [WETH, USDC, venue.slipstream, pool]);
      }
      const start = sqrtAt(venue.price);
      await call(pool, POOL.abi, "initialize", [start]);
      if (venue.liquidity > 0n) {
        const tick = tickOf(start, venue.spacing);
        await call(minter, MINTER.abi, "mint", [
          pool,
          tick - 200 * venue.spacing,
          tick + 200 * venue.spacing,
          venue.liquidity,
        ]);
      }
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

  it("finds the pools the factories have: none at fee 100", async () => {
    const lookup = (fee: bigint) =>
      publicClient.readContract({
        abi: FACTORY.abi,
        address: getAddress(Base.UniswapV3.Factory.address!),
        args: [WETH, USDC, fee],
        functionName: "getPool",
      });
    expect(await lookup(100n)).toBe("0x0000000000000000000000000000000000000000");
    for (const fee of [500n, 3000n, 10000n])
      expect(getAddress((await lookup(fee)) as Address)).toBe(poolAt(`v3:${fee}`));
  });

  it("buys with all of the budget across three pools, each fill within maxPrice", async () => {
    const budget = 2_000n * 10n ** 6n;
    const maxPrice = usdcPerWeth(27_135n); // 2,713.5 USDC per WETH
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const empty = await slot0Price(poolAt("v3:10000"));
    const args: Args = [USDC, WETH, budget, maxPrice, 0n, 0n, RECIPIENT, REFUND_TO];
    const [spent, bought, unspent] = await returned(args);

    const receipt = await cook(args);
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    // Uniswap V3 first, each tier to its own limit, then Slipstream with the rest.
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500", "v3:3000", "cl:10"]);
    swapped.forEach((fill, i) => expectWithin(fill, maxPrice, false, i < 2));
    expect([spent, unspent]).toEqual([budget, 0n]);
    expect(swapped.reduce((sum, fill) => sum + fill.paid, 0n)).toBe(budget);
    expect(bought).toBe(swapped.reduce((sum, fill) => sum + fill.got, 0n));
    expect(await balance(WETH, RECIPIENT)).toBe(bought);
    expect(await balance(USDC, sauce.pot)).toBe(0n);
    expect(await balance(USDC, REFUND_TO)).toBe(0n);
    // The empty 1% pool, priced inside its limit, was not touched.
    expect(await slot0Price(poolAt("v3:10000"))).toBe(empty);
    console.log(`full fill: gas ${receipt.gasUsed}, ${bought} WETH units for ${budget} USDC units`);
  });

  it("spends only what maxPrice allows, refunds the rest and leaves the Pot's own tokens", async () => {
    const budget = 5_000n * 10n ** 6n;
    const kept = 123n * 10n ** 6n; // the Pot's own USDC, not part of the budget
    const maxPrice = usdcPerWeth(27_135n);
    await call(USDC, erc20, "mint", [sauce.pot, budget + kept]);
    const args: Args = [USDC, WETH, budget, maxPrice, 0n, 0n, RECIPIENT, REFUND_TO];
    const [spent, bought, unspent] = await returned(args);

    const receipt = await cook(args);
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500", "v3:3000", "cl:10"]);
    // Every pool stopped at its own limit: every unit within maxPrice, the last at it.
    for (const fill of swapped) expectWithin(fill, maxPrice, false, true);
    expect(spent).toBe(swapped.reduce((sum, fill) => sum + fill.paid, 0n));
    expect(spent + unspent).toBe(budget);
    expect(unspent).toBeGreaterThan(0n);
    expect(await balance(USDC, REFUND_TO)).toBe(unspent);
    expect(await balance(USDC, sauce.pot)).toBe(kept);
    expect(await balance(WETH, RECIPIENT)).toBe(bought);
    console.log(`partial fill: gas ${receipt.gasUsed}, spent ${spent} of ${budget}`);
  });

  it("buys USDC with WETH the same way: paying token0, each pool down to its own limit", async () => {
    const budget = 3n * 10n ** 18n;
    const maxPrice = wethPerUsdc(26_865n); // at least 2,686.5 USDC for each WETH
    await call(WETH, erc20, "mint", [sauce.pot, budget]);

    const receipt = await cook([WETH, USDC, budget, maxPrice, 0n, 0n, RECIPIENT, REFUND_TO]);
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500", "v3:3000", "cl:10"]);
    for (const fill of swapped) expectWithin(fill, maxPrice, true, true);
    const spent = swapped.reduce((sum, fill) => sum + fill.paid, 0n);
    expect(await balance(WETH, REFUND_TO)).toBe(budget - spent);
    expect(await balance(USDC, RECIPIENT)).toBe(swapped.reduce((sum, fill) => sum + fill.got, 0n));
  });

  it("skips every pool already past its own limit, and refunds the whole budget", async () => {
    const budget = 1_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    // At most 2,700: the 0.05% pool's own limit is 2,698.65 and the 0.3% pools' 2,691.9, below each
    // one's price; handed such a limit, a pool reverts `SPL`.
    const args: Args = [USDC, WETH, budget, usdcPerWeth(27_000n), 0n, 0n, RECIPIENT, REFUND_TO];
    expect(await returned(args)).toEqual([0n, 0n, budget]);
    const receipt = await cook(args);
    expect(receipt.status).toBe("success");
    expect(fills(receipt)).toEqual([]);
    expect(await balance(USDC, REFUND_TO)).toBe(budget);
  });

  it("reverts the whole cook below minTokens, and above maxAvgPrice", async () => {
    const budget = 5_000n * 10n ** 6n;
    const maxPrice = usdcPerWeth(27_135n);
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const [, bought] = await returned([USDC, WETH, budget, maxPrice, 0n, 0n, RECIPIENT, REFUND_TO]);

    const short: Args = [USDC, WETH, budget, maxPrice, bought + 1n, 0n, RECIPIENT, REFUND_TO];
    expect((await cook(short)).status).toBe("reverted");
    await expect(
      publicClient.call({ account: OWNER.address, data: cookData(short), to: sauce.pot }),
    ).rejects.toThrow(/bought below minTokens/);
    // Every unit cost under 2,713.5 and the first ones about 2,700: an average cap of 2,700 is
    // below what was paid.
    const dear: Args = [
      USDC,
      WETH,
      budget,
      maxPrice,
      0n,
      usdcPerWeth(27_000n),
      RECIPIENT,
      REFUND_TO,
    ];
    await expect(
      publicClient.call({ account: OWNER.address, data: cookData(dear), to: sauce.pot }),
    ).rejects.toThrow(/average too high/);
    expect(await balance(USDC, sauce.pot)).toBe(budget);
    expect(await balance(WETH, RECIPIENT)).toBe(0n);
  });

  it("refuses a budget that is not in the Pot", async () => {
    const data = cookData([USDC, WETH, 1n, usdcPerWeth(27_135n), 0n, 0n, RECIPIENT, REFUND_TO]);
    await expect(
      publicClient.call({ account: OWNER.address, data, to: sauce.pot }),
    ).rejects.toThrow(/budget is not in the Pot/);
  });

  it("without the √(1 − fee), a 0.3% pool's last unit costs more than maxPrice", async () => {
    const budget = 5_000n * 10n ** 6n;
    const maxPrice = usdcPerWeth(27_135n);
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const unadjusted = without("Math.sqrt((1000000n - fee) * 10n ** 30n)", "10n ** 18n");

    const receipt = await cook(
      [USDC, WETH, budget, maxPrice, 0n, 0n, RECIPIENT, REFUND_TO],
      unadjusted,
    );
    expect(receipt.status).toBe("success");
    const pricier = fills(receipt).find((fill) => fill.venue === "v3:3000")!;
    const square = pricier.sqrtPriceX96 * pricier.sqrtPriceX96;
    expect(square * 1_000_000n * E18).toBeGreaterThan(maxPrice * Q192 * (1_000_000n - 3000n));
  });

  it("without the check for a missing pool, the lookup at fee 100 reverts the cook", async () => {
    await call(USDC, erc20, "mint", [sauce.pot, 10n ** 9n]);
    const receipt = await cook(
      [USDC, WETH, 10n ** 9n, usdcPerWeth(27_135n), 0n, 0n, RECIPIENT, REFUND_TO],
      without("pool != 0n && "),
    );
    expect(receipt.status).toBe("reverted");
  });

  it("without the liquidity check, the empty 1% pool is swapped for nothing", async () => {
    const budget = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, budget]);
    const empty = await slot0Price(poolAt("v3:10000"));
    const receipt = await cook(
      [USDC, WETH, budget, usdcPerWeth(27_135n), 0n, 0n, RECIPIENT, REFUND_TO],
      without(" && UniswapV3.Pool.at(pool).liquidity() > 0n"),
    );
    expect(receipt.status).toBe("success");
    const wasted = fills(receipt).find((fill) => fill.venue === "v3:10000")!;
    // A call that bought nothing and moved the stale pool's price to its limit.
    expect([wasted.paid, wasted.got]).toEqual([0n, 0n]);
    expect(await slot0Price(poolAt("v3:10000"))).not.toBe(empty);
  });
});
