/**
 * `@sauce/router`'s `maverickV2` and `tryMaverickV2`, EXECUTED through the released Router on a
 * local anvil — the stack deployed from creation code at its release addresses
 * (`gated-engine.ts`), nothing forked.
 *
 * Both functions pass the Router's `swapMaverickV2` an `int32 tickLimit`: `2147483647` when the Pot
 * sells token A and `-2147483648` when it sells token B (the pool's full tick range in either
 * direction). The second is a NEGATIVE literal reaching an `intN` ABI argument, which the compiler
 * checks at the boundary, so a test that never reads the value the pool received cannot see it go
 * wrong. The pool here is `fixtures/MockMaverickPool.sol`: a fixed-rate Maverick V2 pool that pays
 * the output before calling `maverickV2SwapCallback`, requires its input to arrive, and records the
 * `tickLimit` (and the rest of the swap parameters) the Router called it with.
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
const MOCK_MAVERICK_POOL = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/MockMaverickPool.json"),
);

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;
const AMOUNT_IN = 1_000n;
const RATE = 3n; // output units per input unit, either way
const AMOUNT_OUT = AMOUNT_IN * RATE;

/** What `@sauce/router` hands the Router as `tickLimit` per direction: int32's two extremes. */
const MAX_TICK_LIMIT = 2147483647;
const MIN_TICK_LIMIT = -2147483648;

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

const mint = async (token: Address, to: Address, amount: bigint): Promise<void> => {
  const { status } = await send(
    token,
    encodeFunctionData({ abi: erc20, args: [to, amount], functionName: "mint" }),
  );
  if (status !== "success") throw new Error(`minting ${amount} of ${token} to ${to} reverted`);
};

let anvil: ChildProcess;
let sauce: GatedEngine;
/** The pool's two tokens: Maverick V2's token A is the lower address. */
let tokenA: Address;
let tokenB: Address;

const POOL_FUNDING = 10n ** 24n;

/** A Maverick V2 pool for tokenA/tokenB, funded with both tokens so it can pay either way. */
const maverickPool = async (): Promise<Address> => {
  const at = await deploy(
    `${MOCK_MAVERICK_POOL.creationCode}${encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [tokenA, tokenB, RATE],
    ).slice(2)}` as Hex,
  );
  await mint(tokenA, at, POOL_FUNDING);
  await mint(tokenB, at, POOL_FUNDING);

  return at;
};

/** The swap the pool last received from the Router, as it recorded it. */
const recorded = async (
  pool: Address,
): Promise<{
  amount: bigint;
  exactOutput: boolean;
  swapCount: bigint;
  tickLimit: number;
  tokenAIn: boolean;
}> => {
  const read = (functionName: string): Promise<unknown> =>
    publicClient.readContract({ abi: MOCK_MAVERICK_POOL.abi, address: pool, functionName });
  const [amount, exactOutput, swapCount, tickLimit, tokenAIn] = await Promise.all([
    read("lastAmount"),
    read("lastExactOutput"),
    read("swapCount"),
    read("lastTickLimit"),
    read("lastTokenAIn"),
  ]);

  return {
    amount: amount as bigint,
    exactOutput: exactOutput as boolean,
    swapCount: swapCount as bigint,
    tickLimit: tickLimit as number,
    tokenAIn: tokenAIn as boolean,
  };
};

type Venue = "maverickV2" | "tryMaverickV2";

/**
 * A program selling `AMOUNT_IN` of `tokenIn` for `tokenOut` at `pool` through `venue`, keeping the
 * output in the Pot, with `minOut` as the library's floor. It also requires the function to return
 * `AMOUNT_OUT`, so a cook that lands proves what the swap delivered (`tryMaverickV2` returns 0, and
 * the cook still lands, when it skips the swap).
 */
const program = (
  venue: Venue,
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  minOut: bigint,
): string =>
  [
    `import { ${venue} } from "@sauce/router";`,
    "function main() {",
    `  const got = ${venue}(${BigInt(pool)}n, ${BigInt(tokenIn)}n, ${BigInt(tokenOut)}n, ` +
      `${AMOUNT_IN}n, ${minOut}n, ctx.self());`,
    `  require(got == ${AMOUNT_OUT}n);`,
    "}",
  ].join("\n");

const cookCall = (source: string): Hex =>
  compileSauceRoute("base", source, { engine: sauce.engine, pot: sauce.pot }).calls[0]!.data;

const VENUES: readonly Venue[] = ["maverickV2", "tryMaverickV2"];

describeEvm("@sauce/router's maverickV2, executed through the released Router", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );
    const [a, b] = [await deploy(MOCK_ERC20.creationCode), await deploy(MOCK_ERC20.creationCode)];
    [tokenA, tokenB] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  for (const venue of VENUES) {
    describe(venue, () => {
      it(`selling token A, the Router receives tickLimit ${MAX_TICK_LIMIT} and the pool pays ${AMOUNT_OUT}`, async () => {
        await mint(tokenA, sauce.pot, AMOUNT_IN);
        const pool = await maverickPool();
        const [potA, potB] = [await balance(tokenA, sauce.pot), await balance(tokenB, sauce.pot)];
        expect((await recorded(pool)).swapCount).toBe(0n);

        const cook = await send(
          sauce.pot,
          cookCall(program(venue, pool, tokenA, tokenB, AMOUNT_OUT)),
        );

        expect(cook.status).toBe("success");
        expect(await recorded(pool)).toEqual({
          amount: AMOUNT_IN,
          exactOutput: false,
          swapCount: 1n,
          tickLimit: MAX_TICK_LIMIT,
          tokenAIn: true,
        });
        expect(await balance(tokenA, sauce.pot)).toBe(potA - AMOUNT_IN);
        expect(await balance(tokenA, pool)).toBe(POOL_FUNDING + AMOUNT_IN);
        expect(await balance(tokenB, sauce.pot)).toBe(potB + AMOUNT_OUT);
        expect(await balance(tokenB, pool)).toBe(POOL_FUNDING - AMOUNT_OUT);
      });

      it(`selling token B, the Router receives tickLimit ${MIN_TICK_LIMIT} and the pool pays ${AMOUNT_OUT}`, async () => {
        await mint(tokenB, sauce.pot, AMOUNT_IN);
        const pool = await maverickPool();
        const [potA, potB] = [await balance(tokenA, sauce.pot), await balance(tokenB, sauce.pot)];
        expect((await recorded(pool)).swapCount).toBe(0n);

        const cook = await send(
          sauce.pot,
          cookCall(program(venue, pool, tokenB, tokenA, AMOUNT_OUT)),
        );

        expect(cook.status).toBe("success");
        expect(await recorded(pool)).toEqual({
          amount: AMOUNT_IN,
          exactOutput: false,
          swapCount: 1n,
          tickLimit: MIN_TICK_LIMIT,
          tokenAIn: false,
        });
        expect(await balance(tokenB, sauce.pot)).toBe(potB - AMOUNT_IN);
        expect(await balance(tokenB, pool)).toBe(POOL_FUNDING + AMOUNT_IN);
        expect(await balance(tokenA, sauce.pot)).toBe(potA + AMOUNT_OUT);
        expect(await balance(tokenA, pool)).toBe(POOL_FUNDING - AMOUNT_OUT);
      });

      it("one above what the pool pays is below the floor: the cook reverts and no swap lands", async () => {
        await mint(tokenB, sauce.pot, AMOUNT_IN);
        const pool = await maverickPool();
        const [potA, potB] = [await balance(tokenA, sauce.pot), await balance(tokenB, sauce.pot)];

        // The same program as the passing one above, its floor one unit higher: only the floor can
        // make this cook revert, since the swap itself delivers exactly AMOUNT_OUT.
        const cook = await send(
          sauce.pot,
          cookCall(program(venue, pool, tokenB, tokenA, AMOUNT_OUT + 1n)),
        );

        expect(cook.status).toBe("reverted");
        expect((await recorded(pool)).swapCount).toBe(0n);
        expect(await balance(tokenB, sauce.pot)).toBe(potB);
        expect(await balance(tokenA, sauce.pot)).toBe(potA);
        expect(await balance(tokenB, pool)).toBe(POOL_FUNDING);
        expect(await balance(tokenA, pool)).toBe(POOL_FUNDING);
      });
    });
  }
});
