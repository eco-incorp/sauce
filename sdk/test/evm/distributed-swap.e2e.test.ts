/**
 * The `sauce-distributed-swap` skill's program, EXECUTED: the file the skill teaches, compiled for
 * Base, cooked on the released gated engine (`gated-engine.ts`) against REAL Uniswap V3 pools.
 *
 * Nothing is forked. The pools are Uniswap's own `UniswapV3Factory` and `UniswapV3Pool` bytecode
 * from `@uniswap/v3-core`: the factory is deployed here, creates and initializes the pools, and its
 * code and storage are then replayed onto Base's factory address, so `UniswapV3.Factory.getPool`
 * in the program finds them (as `descriptors-viem.e2e.test.ts` does). Liquidity is minted through
 * `fixtures/UniswapV3Minter.sol`, which answers the pool's mint callback. The two tokens are
 * `MockERC20` runtimes at Base's WETH and USDC addresses, so WETH is token0, as on Base, and the
 * skill's own numbers apply: 2,686.5 USDC per WETH is the floor its commands pass.
 *
 * The pools: none at fee 100; 0.05% at 2,700 and 0.3% at 2,705, each with liquidity; 1% at a stale
 * 3,000 with none. What the skill says the program does, and this holds it to: a missing pool and
 * an empty one are skipped; each pool stops at its own limit, the caller's moved by √(1 − fee), so
 * every fill's price after its fee is within the caller's limit, the last unit at it; a pool already
 * past its limit is skipped rather than reverting; only the unsold input goes back, to the Pot's
 * owner; `minOut` reverts a fill short of it. And the contrast: without the √(1 − fee), the 0.3%
 * pool's last unit costs past the limit.
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
const PROGRAM = readFileSync(
  join(HERE, "../../../skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts"),
  "utf8",
);

/** Anvil's first dev account: the Kitchen's owner, the Pot's owner, and the liquidity provider. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const RECIPIENT = getAddress("0x7777777777777777777777777777777777777777");
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
/** A price in USDC per WETH as an exact fraction of base units: [USDC units, WETH units]. */
const units = (tenths: bigint): [bigint, bigint] => [tenths * 10n ** 5n, 10n ** 18n];

/** The skill's two limits: selling WETH no lower than 2,686.5, buying it no higher than 2,713.5. */
const FLOOR = 26_865n; // tenths of a USDC per WETH
const CEILING = 27_135n;
const Q192 = 2n ** 192n;

interface Venue {
  fee: bigint;
  spacing: number;
  price: string;
  liquidity: bigint;
}
/** The pools the suite creates. Fee 100 has none, and the 1% pool holds no liquidity. */
const VENUES: Venue[] = [
  { fee: 500n, spacing: 10, price: "2700", liquidity: 15n * 10n ** 15n },
  { fee: 3000n, spacing: 60, price: "2705", liquidity: 20n * 10n ** 15n },
  { fee: 10000n, spacing: 200, price: "3000", liquidity: 0n },
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

let anvil: ChildProcess;
let sauce: GatedEngine;
const pools = new Map<bigint, Address>();

/** The program compiled for Base, as `sauce compile --chain base` compiles it; once per source. */
const programs = new Map<string, ReturnType<typeof compileSauceProgram>>();
const compiled = (source = PROGRAM) => {
  if (!programs.has(source)) programs.set(source, compileSauceProgram("base", source));
  return programs.get(source)!;
};

type Args = [Address, Address, bigint, bigint, bigint, Address];

/** The cook of the program with `main`'s arguments, as `sauce tx` builds it. */
const cookData = (args: Args, source = PROGRAM): Hex => {
  const program = compiled(source);
  const encoded = encodeEntryArguments(program, args);
  return sauce.cookData(concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]));
};

/** Sends that cook from the Pot's owner; the receipt, reverted or not. */
const cook = (args: Args, source = PROGRAM): Promise<TransactionReceipt> =>
  send(sauce.pot, cookData(args, source));

/** The program with one of its own lines taken out, to show what that line guards against. */
const without = (line: string): string => {
  const edited = PROGRAM.replace(line, "");
  if (edited === PROGRAM) throw new Error(`the program has no ${line}`);
  return edited;
};

interface Fill {
  pool: Address;
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
    const fee = [...pools].find(([, at]) => at === getAddress(log.address))![0];
    const [paid, got] = amount0 > 0n ? [amount0, -amount1] : [amount1, -amount0];
    return { fee, got, paid, pool: getAddress(log.address), sqrtPriceX96 };
  });

/** Every fill selling WETH, fee included, at the floor or better: on average and at its last unit. */
const expectWithinFloor = (fill: Fill) => {
  const [usdc, weth] = units(FLOOR);
  // Average: USDC out per WETH in, fee included.
  expect(fill.got * weth).toBeGreaterThanOrEqual(usdc * fill.paid);
  // Last unit: the pool's price after the swap, less its fee.
  const marginal = fill.sqrtPriceX96 * fill.sqrtPriceX96 * (1_000_000n - fill.fee) * weth;
  expect(marginal).toBeGreaterThanOrEqual(usdc * Q192 * 1_000_000n);
};

/** A pool that stopped at its own limit: its last unit costs the floor, to within 0.001%. */
const expectAtFloor = (fill: Fill) => {
  const [usdc, weth] = units(FLOOR);
  const marginal = fill.sqrtPriceX96 * fill.sqrtPriceX96 * (1_000_000n - fill.fee) * weth;
  expect(marginal * 100_000n).toBeLessThanOrEqual(usdc * Q192 * 1_000_000n * 100_001n);
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

    // The pools, created by Uniswap's own factory, and liquidity in each but the 1% pool.
    const factory = await deploy(FACTORY.bytecode);
    const minter = await deploy(MINTER.creationCode);
    for (const at of [WETH, USDC]) await call(at, erc20, "approve", [minter, maxUint256]);
    for (const venue of VENUES) {
      await call(factory, FACTORY.abi, "createPool", [WETH, USDC, venue.fee]);
      const pool = (await publicClient.readContract({
        abi: FACTORY.abi,
        address: factory,
        args: [WETH, USDC, venue.fee],
        functionName: "getPool",
      })) as Address;
      pools.set(venue.fee, getAddress(pool));
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

    // The factory's code and state onto Base's factory address, where the program looks.
    const registry = getAddress(Base.UniswapV3.Factory.address!);
    const dumped = JSON.parse(
      new TextDecoder().decode(gunzipSync(hexToBytes(await testClient.dumpState()))),
    ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
    const state = dumped.accounts[factory.toLowerCase()] ?? dumped.accounts[factory];
    await testClient.setCode({ address: registry, bytecode: state!.code });
    for (const [index, value] of Object.entries(state!.storage))
      await testClient.setStorageAt({ address: registry, index: index as Hex, value });

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

  it("finds the pools the factory has: none at fee 100", async () => {
    const registry = getAddress(Base.UniswapV3.Factory.address!);
    const lookup = (fee: bigint) =>
      publicClient.readContract({
        abi: FACTORY.abi,
        address: registry,
        args: [WETH, USDC, fee],
        functionName: "getPool",
      });
    expect(await lookup(100n)).toBe("0x0000000000000000000000000000000000000000");
    for (const [fee, pool] of pools) expect(getAddress((await lookup(fee)) as Address)).toBe(pool);
  });

  it("sells all of 1 WETH across two pools, each fill within the floor after its fee", async () => {
    const amountIn = 10n ** 18n;
    const minOut = 2_686_500_000n; // amountIn at the floor: all or nothing
    await call(WETH, erc20, "mint", [sauce.pot, amountIn]);
    const ownerBefore = await balance(WETH, OWNER.address);
    const empty = await slot0Price(pools.get(10000n)!);

    const receipt = await cook([WETH, USDC, amountIn, sqrtAt("2686.5"), minOut, RECIPIENT]);
    expect(receipt.status).toBe("success");

    const swapped = fills(receipt);
    // Lowest fee first: the 0.05% pool to its own limit, then the 0.3% pool with what was left.
    expect(swapped.map((fill) => fill.fee)).toEqual([500n, 3000n]);
    for (const fill of swapped) expectWithinFloor(fill);
    expectAtFloor(swapped[0]!);
    expect(swapped[0]!.paid + swapped[1]!.paid).toBe(amountIn);
    const bought = swapped[0]!.got + swapped[1]!.got;
    expect(bought).toBeGreaterThanOrEqual(minOut);
    expect(await balance(USDC, RECIPIENT)).toBe(bought);
    // All of it sold: nothing left in the Pot, nothing refunded.
    expect(await balance(WETH, sauce.pot)).toBe(0n);
    expect(await balance(WETH, OWNER.address)).toBe(ownerBefore);
    // The empty 1% pool was not touched.
    expect(await slot0Price(pools.get(10000n)!)).toBe(empty);
    console.log(`full fill: gas ${receipt.gasUsed}, ${bought} USDC units for 1 WETH`);
  });

  it("fills only what the floor allows and returns the rest to the Pot's owner", async () => {
    const amountIn = 2n * 10n ** 18n;
    const kept = 5n * 10n ** 17n; // the Pot's own WETH, not part of the trade
    await call(WETH, erc20, "mint", [sauce.pot, amountIn + kept]);
    const ownerBefore = await balance(WETH, OWNER.address);
    const empty = await slot0Price(pools.get(10000n)!);

    const receipt = await cook([WETH, USDC, amountIn, sqrtAt("2686.5"), 0n, RECIPIENT]);
    expect(receipt.status).toBe("success");

    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.fee)).toEqual([500n, 3000n]);
    // Both pools stopped at their own limits, every unit within the floor, the last at it.
    for (const fill of swapped) {
      expectWithinFloor(fill);
      expectAtFloor(fill);
    }
    const sold = swapped[0]!.paid + swapped[1]!.paid;
    expect(sold).toBeLessThan(amountIn);
    // The unsold rest of amountIn went to the owner, who sent the cook; the Pot's own WETH stayed.
    expect(await balance(WETH, OWNER.address)).toBe(ownerBefore + amountIn - sold);
    expect(await balance(WETH, sauce.pot)).toBe(kept);
    expect(await balance(USDC, RECIPIENT)).toBe(swapped[0]!.got + swapped[1]!.got);
    // Input was left when the loop reached the empty 1% pool, and it was skipped.
    expect(await slot0Price(pools.get(10000n)!)).toBe(empty);
    console.log(`partial fill: gas ${receipt.gasUsed}, sold ${sold} of ${amountIn}`);
  });

  it("reverts the whole cook when the fill falls short of minOut", async () => {
    const amountIn = 2n * 10n ** 18n;
    await call(WETH, erc20, "mint", [sauce.pot, amountIn]);
    const minOut = 5_373_000_000n; // all of 2 WETH at the floor, which the pools cannot fill

    const receipt = await cook([WETH, USDC, amountIn, sqrtAt("2686.5"), minOut, RECIPIENT]);
    expect(receipt.status).toBe("reverted");
    expect(await balance(WETH, sauce.pot)).toBe(amountIn);
    expect(await balance(USDC, RECIPIENT)).toBe(0n);
    const data = cookData([WETH, USDC, amountIn, sqrtAt("2686.5"), minOut, RECIPIENT]);
    await expect(
      publicClient.call({ account: OWNER.address, data, to: sauce.pot }),
    ).rejects.toThrow(/output below minOut/);
  });

  it("skips a pool already past its own limit, and refunds everything when none trades", async () => {
    const amountIn = 10n ** 18n;
    await call(WETH, erc20, "mint", [sauce.pot, amountIn]);
    const ownerBefore = await balance(WETH, OWNER.address);

    // At a floor of 2,700, the 0.05% pool's own limit is 2,701.35 and the 0.3% pool's 2,708.1:
    // both pools are already past theirs, and handed such a limit a pool reverts `SPL`.
    const receipt = await cook([WETH, USDC, amountIn, sqrtAt("2700"), 0n, RECIPIENT]);
    expect(receipt.status).toBe("success");
    expect(fills(receipt)).toEqual([]);
    expect(await balance(WETH, OWNER.address)).toBe(ownerBefore + amountIn);
    expect(await balance(WETH, sauce.pot)).toBe(0n);
  });

  it("buys WETH with USDC, each pool stopping at its own ceiling", async () => {
    const amountIn = 5_000n * 10n ** 6n;
    await call(USDC, erc20, "mint", [sauce.pot, amountIn]);
    const ownerBefore = await balance(USDC, OWNER.address);

    const receipt = await cook([USDC, WETH, amountIn, sqrtAt("2713.5"), 0n, RECIPIENT]);
    expect(receipt.status).toBe("success");

    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.fee)).toEqual([500n, 3000n]);
    const [usdc, weth] = units(CEILING);
    for (const fill of swapped) {
      // Average: USDC in per WETH out, fee included, at the ceiling or better.
      expect(fill.paid * weth).toBeLessThanOrEqual(usdc * fill.got);
      // Last unit: the pool's price after the swap, plus its fee, at the ceiling or better, and at
      // it to within 0.001%.
      const marginal = fill.sqrtPriceX96 * fill.sqrtPriceX96 * 1_000_000n * weth;
      const bound = usdc * Q192 * (1_000_000n - fill.fee);
      expect(marginal).toBeLessThanOrEqual(bound);
      expect(marginal * 100_001n).toBeGreaterThanOrEqual(bound * 100_000n);
    }
    const spent = swapped[0]!.paid + swapped[1]!.paid;
    expect(await balance(USDC, OWNER.address)).toBe(ownerBefore + amountIn - spent);
    expect(await balance(WETH, RECIPIENT)).toBe(swapped[0]!.got + swapped[1]!.got);
  });

  it("without the √(1 − fee), the 0.3% pool's last unit costs more than the floor", async () => {
    const unadjusted = PROGRAM.replace("Math.sqrt((1000000n - fee) * 1000000n)", "1000000n");
    expect(unadjusted).not.toBe(PROGRAM);
    const amountIn = 3n * 10n ** 18n;
    await call(WETH, erc20, "mint", [sauce.pot, amountIn]);

    const receipt = await cook([WETH, USDC, amountIn, sqrtAt("2686.5"), 0n, RECIPIENT], unadjusted);
    expect(receipt.status).toBe("success");
    const pricier = fills(receipt).find((fill) => fill.fee === 3000n)!;
    const [usdc, weth] = units(FLOOR);
    const marginal = pricier.sqrtPriceX96 * pricier.sqrtPriceX96 * (1_000_000n - 3000n) * weth;
    expect(marginal).toBeLessThan(usdc * Q192 * 1_000_000n);
  });

  it("without the check for a missing pool, the lookup at fee 100 reverts the cook", async () => {
    await call(WETH, erc20, "mint", [sauce.pot, 10n ** 18n]);
    const receipt = await cook(
      [WETH, USDC, 10n ** 18n, sqrtAt("2686.5"), 0n, RECIPIENT],
      without(" && pool != 0n"),
    );
    expect(receipt.status).toBe("reverted");
  });

  it("without the liquidity check, the empty 1% pool is swapped for nothing", async () => {
    const amountIn = 2n * 10n ** 18n;
    await call(WETH, erc20, "mint", [sauce.pot, amountIn]);
    const empty = await slot0Price(pools.get(10000n)!);
    const receipt = await cook(
      [WETH, USDC, amountIn, sqrtAt("2686.5"), 0n, RECIPIENT],
      without("inRange > 0n && "),
    );
    expect(receipt.status).toBe("success");
    const wasted = fills(receipt).find((fill) => fill.fee === 10000n)!;
    // A call that filled nothing and left the stale pool's price moved to its limit.
    expect([wasted.paid, wasted.got]).toEqual([0n, 0n]);
    expect(await slot0Price(pools.get(10000n)!)).not.toBe(empty);
  });
});
