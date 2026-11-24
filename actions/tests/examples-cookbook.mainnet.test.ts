/**
 * The `sauce-examples` skill's own programs (`skills/sauce-examples/examples`), EXECUTED: each EVM
 * program run as its header says, through the `sauce` command itself (`runCli`): `simulate` for
 * what `main` returns, decoded as the type it declares, then `run` to send the cook, on Ethereum's
 * and Base's state captured at their pinned blocks (`mainnet.ts`), through the released engine,
 * Kitchen, Pot and Router. No RPC is reached.
 *
 * Every result is held to something the program did not compute: each swap to Uniswap's own
 * QuoterV2 at the same price limit, each price to the pools, pair and feed read directly, the
 * Aave V3 position to the pool's own account data, and each payment to the recipients' balances.
 * `skills:check` compiles the programs and holds their headers; this runs them.
 *
 * The Solana program, `pay-stock`, runs in `sdk/test/examples-cookbook-solana.e2e.test.ts`.
 * Gateway deposits and the fee-adjusted marginal venue selector run their exact files from
 * `skills/sauce-protocols/examples` and `skills/sauce-swaps/examples` on the same captured state.
 * Failure cases submit a real local transaction and check its reverted receipt and restored state.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { GatewayWalletABI } from "../../sdk/dist/protocols/circle-gateway/abis.js";
import {
  AerodromeSlipstreamPoolABI,
  SlipstreamCLFactoryABI,
} from "../../sdk/dist/protocols/aerodrome-slipstream/abis.js";
import { OWNER_KEY, REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import type { ChainName } from "./mainnet.js";
import { allowance, balanceOf, setBalance } from "./swap-venues.js";

const EXAMPLES = join(REPO_ROOT, "skills/sauce-examples/examples");
const example = (name: string): string => join(EXAMPLES, `${name}.sauce.ts`);
const GATEWAY_DEPOSIT = join(
  REPO_ROOT,
  "skills/sauce-protocols/examples",
  "gateway-deposit.sauce.ts",
);
const SWAP_GATEWAY = join(
  REPO_ROOT,
  "skills/sauce-protocols/examples",
  "swap-then-gateway.sauce.ts",
);
const BEST_VENUE = join(REPO_ROOT, "skills/sauce-swaps/examples", "best-venue-swap.sauce.ts");

/** The address a program compiled for `chain` names `name` by: the SDK's own define for it. */
function named(chain: ChainName, name: string): Address {
  const value = routes.chainDefines(requireChain(chain))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on ${chain}`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

/** Where USDC and WETH keep `balanceOf` on both chains. */
const BALANCE_SLOT = { USDC: { slot: 9n }, WETH: { slot: 3n } } as const;

/** Uniswap's own QuoterV2 on each chain: what every swap here is held to. */
const QUOTER: Record<"ethereum" | "base", Address> = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

const abi = {
  quoter: parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  ]),
  factory: parseAbi(["function getPool(address, address, uint24) view returns (address)"]),
  pool: parseAbi([
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
    "function liquidity() view returns (uint128)",
  ]),
  pair: parseAbi([
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  ]),
  v2Factory: parseAbi(["function getPair(address, address) view returns (address)"]),
  feed: parseAbi([
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ]),
  aave: parseAbi([
    "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
    "function getReserveAToken(address asset) view returns (address)",
  ]),
};

/** Recipients and refund addresses: anvil's dev accounts past the owner's. */
const PEOPLE: readonly Address[] = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e965cc0d6ec9c2f1ef8c",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
].map((address) => getAddress(address));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(argv: readonly string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

/** One chain's anvil, as each test starts it: from the same snapshot every time. */
interface Chain {
  readonly name: ChainName;
  env: Anvil;
  snapshot: Hex;
}

/** `sauce simulate` of an example on the owner's Pot: the JSON it prints, `returned` decoded. */
async function simulate(
  chain: Chain,
  name: string,
  args: readonly string[],
  flags: readonly string[] = [],
): Promise<{ ok: boolean; returned?: unknown; reason?: string }> {
  const { code, stdout, stderr } = await sauce([
    ...["simulate", name, "--chain", chain.name, "--rpc-url", chain.env.rpc],
    ...["--owner", chain.env.account.address, "--salt-hex", POT_SALT, "--json", ...flags],
    ...(args.length === 0 ? [] : ["--args", ...args]),
  ]);
  assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

  return JSON.parse(stdout) as { ok: boolean; returned?: unknown; reason?: string };
}

/** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
async function run(
  chain: Chain,
  name: string,
  args: readonly string[],
  flags: readonly string[] = [],
): Promise<void> {
  const { code, stdout, stderr } = await sauce([
    ...["run", name, "--chain", chain.name, "--rpc-url", chain.env.rpc],
    ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json", ...flags],
    ...(args.length === 0 ? [] : ["--args", ...args]),
  ]);
  assert.equal(code, 0, `${stderr}\n${stdout}`);
  assert.equal((JSON.parse(stdout) as { cook: { status: string } }).cook.status, "success");
}

/** Simulates, then runs: `main`'s return as the rehearsal decoded it, from the state it ran on. */
async function cook(chain: Chain, name: string, args: readonly string[]): Promise<unknown> {
  const rehearsal = await simulate(chain, name, args);
  assert.equal(rehearsal.ok, true, `the simulation reverts: ${rehearsal.reason}`);
  await run(chain, name, args);

  return rehearsal.returned;
}

/** Builds the exact file's unsigned cook, then submits it WITHOUT a successful preflight. */
async function revertedCook(chain: Chain, file: string, args: readonly string[]): Promise<void> {
  const { code, stdout, stderr } = await sauce([
    ...["tx", file, "--chain", chain.name, "--rpc-url", chain.env.rpc],
    ...["--owner", chain.env.account.address, "--salt-hex", POT_SALT],
    ...["--args", ...args],
  ]);
  assert.equal(code, 0, `${stderr}\n${stdout}`);
  const planned = JSON.parse(stdout) as {
    sendCalls: { calls: Array<{ to: Address; data: Hex; value: Hex }> };
  };
  assert.equal(planned.sendCalls.calls.length, 1, "the Pot already exists");
  const call = planned.sendCalls.calls[0]!;
  assert.equal(getAddress(call.to), getAddress(chain.env.pot));
  const receipt = await chain.env.send({ ...call, value: BigInt(call.value) });
  assert.equal(receipt.status, "reverted", "the failing floor must revert a mined transaction");
  assert.deepEqual(receipt.logs, [], "a reverted cook cannot leave transfer or deposit logs");
}

/** What Uniswap's QuoterV2 says `amountIn` buys at `pool`'s `fee` up to `sqrtPriceLimitX96`. */
async function quote(
  chain: Chain,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number,
  sqrtPriceLimitX96: bigint,
): Promise<bigint> {
  const { result } = await chain.env.publicClient.simulateContract({
    address: QUOTER[chain.name as "ethereum" | "base"],
    abi: abi.quoter,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96 }],
  });

  return result[0];
}

const v3Pool = (chain: Chain, a: Address, b: Address, fee: number): Promise<Address> =>
  chain.env.publicClient.readContract({
    address: named(chain.name, "UniswapV3_Factory"),
    abi: abi.factory,
    functionName: "getPool",
    args: [a, b, fee],
  });

const sqrtPriceOf = async (chain: Chain, pool: Address): Promise<bigint> =>
  (
    await chain.env.publicClient.readContract({
      address: pool,
      abi: abi.pool,
      functionName: "slot0",
    })
  )[0];

const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }

  return x;
};
/** USDC base units per whole `token` (of `decimals`) at a pool's sqrt price. */
function quotePrice(sqrtPriceX96: bigint, usdc: Address, token: Address, one: bigint): bigint {
  const ratio = (sqrtPriceX96 * sqrtPriceX96) / Q96;

  return BigInt(usdc) < BigInt(token) ? (one * Q96) / ratio : (ratio * one) / Q96;
}
/** The sqrt price at `price` USDC base units per whole `token`: the inverse of `quotePrice`. */
function sqrtPriceAt(price: bigint, usdc: Address, token: Address, one: bigint): bigint {
  return BigInt(usdc) < BigInt(token) ? isqrt((Q192 * one) / price) : isqrt((price * Q192) / one);
}

describe(
  "the sauce-examples cookbook, executed",
  { skip: skipReason(), timeout: 1_800_000 },
  () => {
    const ethereum = { name: "ethereum" } as Chain;
    const base = { name: "base" } as Chain;
    const ETH = {
      USDC: named("ethereum", "USDC"),
      WETH: named("ethereum", "WETH"),
      SPCXon: named("ethereum", "SPCXon"),
    };
    const BASE = { USDC: named("base", "USDC"), WETH: named("base", "WETH") };

    before(async () => {
      [ethereum.env, base.env] = await Promise.all([
        startAnvil({ mainnet: "cookbook-ethereum", chain: "ethereum" }),
        startAnvil({ mainnet: "cookbook-base", chain: "base" }),
      ]);
    });
    after(async () => {
      await Promise.all([ethereum.env?.stop(), base.env?.stop()]);
    });
    beforeEach(async () => {
      for (const chain of [ethereum, base]) chain.snapshot = await chain.env.testClient.snapshot();
    });
    afterEach(async () => {
      for (const chain of [ethereum, base]) {
        await chain.env.testClient.revert({ id: chain.snapshot });
      }
    });

    const fund = (chain: Chain, token: "USDC" | "WETH", holder: Address, amount: bigint) =>
      setBalance(chain.env, named(chain.name, token), BALANCE_SLOT[token], holder, amount);

    /** Independent Gateway accounting, including the wallet/Pot distinction and token custody. */
    async function gatewayState(chain: Chain, depositor: Address) {
      const usdc = named(chain.name, "USDC");
      const gateway = named(chain.name, "CircleGateway_GatewayWallet");
      const credit = (who: Address, functionName: "totalBalance" | "availableBalance") =>
        chain.env.publicClient.readContract({
          address: gateway,
          abi: GatewayWalletABI,
          functionName,
          args: [usdc, who],
        });
      return {
        wallet: await credit(depositor, "totalBalance"),
        available: await credit(depositor, "availableBalance"),
        pot: await credit(chain.env.pot, "totalBalance"),
        custody: await balanceOf(chain.env, usdc, gateway),
        held: await balanceOf(chain.env, usdc, chain.env.pot),
        walletUsdc: await balanceOf(chain.env, usdc, depositor),
        approval: await allowance(chain.env, usdc, chain.env.pot, gateway),
      };
    }

    for (const chain of [base, ethereum]) {
      describe(`gateway-deposit on ${chain.name}: the real Gateway credits the wallet, not the Pot`, () => {
        it("deposits exactly the budget twice, accumulating wallet credit and preserving other USDC", async () => {
          const depositor = PEOPLE[0]!;
          const amount = 5_000_000n;
          const other = 7_000_000n;
          const gateway = named(chain.name, "CircleGateway_GatewayWallet");
          assert.notEqual(await chain.env.publicClient.getCode({ address: gateway }), "0x");
          assert.equal(
            await chain.env.publicClient.readContract({
              address: gateway,
              abi: GatewayWalletABI,
              functionName: "isTokenSupported",
              args: [named(chain.name, "USDC")],
            }),
            true,
          );
          await fund(chain, "USDC", chain.env.pot, 2n * amount + other);
          const before = await gatewayState(chain, depositor);
          for (let count = 1n; count <= 2n; count++) {
            const returned = await cook(chain, GATEWAY_DEPOSIT, [String(amount), depositor]);
            assert.deepEqual(returned, {
              deposited: String(amount),
              total: String(before.wallet + count * amount),
            });
            assert.deepEqual(await gatewayState(chain, depositor), {
              ...before,
              wallet: before.wallet + count * amount,
              available: before.available + count * amount,
              custody: before.custody + count * amount,
              held: before.held - count * amount,
              approval: 0n,
            });
          }
          assert.equal(await balanceOf(chain.env, named(chain.name, "USDC"), chain.env.pot), other);
        });

        it("mines reverted zero/underfunded deposits without changing credit, custody or approval", async () => {
          const depositor = PEOPLE[0]!;
          await fund(chain, "USDC", chain.env.pot, 5_000_000n);
          const before = await gatewayState(chain, depositor);
          for (const amount of [0n, 5_000_001n]) {
            await revertedCook(chain, GATEWAY_DEPOSIT, [String(amount), depositor]);
            assert.deepEqual(await gatewayState(chain, depositor), before);
          }
        });
      });
    }

    describe("swap-then-gateway on Base: only the swap delta is deposited", () => {
      const budget = 10n ** 18n;
      const otherWeth = 3n * 10n ** 17n;
      const otherUsdc = 11_000_000n;
      const depositor = PEOPLE[0]!;

      async function setup() {
        await fund(base, "WETH", base.env.pot, budget + otherWeth);
        await fund(base, "USDC", base.env.pot, otherUsdc);
        const pool = await v3Pool(base, BASE.WETH, BASE.USDC, 500);
        const price = await sqrtPriceOf(base, pool);
        // WETH is token0: a very near floor forces a positive partial fill.
        assert.ok(BigInt(BASE.WETH) < BigInt(BASE.USDC));
        const limit = (price * 999_999n) / 1_000_000n;
        const quoted = await quote(base, BASE.WETH, BASE.USDC, budget, 500, limit);
        assert.ok(quoted > 0n);
        return { pool, limit, quoted };
      }

      it("returns unspent WETH, leaves old balances alone and credits only newly swapped USDC", async () => {
        const { pool, limit, quoted } = await setup();
        const before = await gatewayState(base, depositor);
        const walletWeth = await balanceOf(base.env, BASE.WETH, depositor);
        const poolWeth = await balanceOf(base.env, BASE.WETH, pool);
        const returned = await cook(base, SWAP_GATEWAY, [
          BASE.WETH,
          "500",
          String(budget),
          String(limit),
          String(quoted),
          depositor,
        ]);
        assert.deepEqual(returned, {
          deposited: String(quoted),
          total: String(before.wallet + quoted),
        });
        const spent = (await balanceOf(base.env, BASE.WETH, pool)) - poolWeth;
        assert.ok(spent > 0n && spent < budget, `expected partial input, got ${spent}`);
        assert.equal(await balanceOf(base.env, BASE.WETH, depositor), walletWeth + budget - spent);
        assert.equal(await balanceOf(base.env, BASE.WETH, base.env.pot), otherWeth);
        assert.equal(await sqrtPriceOf(base, pool), limit);
        assert.deepEqual(await gatewayState(base, depositor), {
          ...before,
          wallet: before.wallet + quoted,
          available: before.available + quoted,
          custody: before.custody + quoted,
          approval: 0n,
        });
      });

      it("minUsdc one above the real quote reverts the mined swap and every observed balance", async () => {
        const { pool, limit, quoted } = await setup();
        const state = async () => ({
          gateway: await gatewayState(base, depositor),
          price: await sqrtPriceOf(base, pool),
          balances: await Promise.all(
            [BASE.WETH, BASE.USDC].flatMap((token) =>
              [base.env.pot, depositor, pool].map((who) => balanceOf(base.env, token, who)),
            ),
          ),
          routerApproval: await allowance(base.env, BASE.WETH, base.env.pot, base.env.router),
        });
        const before = await state();
        await revertedCook(base, SWAP_GATEWAY, [
          BASE.WETH,
          "500",
          String(budget),
          String(limit),
          String(quoted + 1n),
          depositor,
        ]);
        assert.deepEqual(await state(), before);
      });
    });

    describe("best-venue-swap on Base: fee-adjusted marginal prices, not depth routing", () => {
      const recipient = PEOPLE[1]!;

      async function candidates(tokenIn: Address, tokenOut: Address, fee: number, spacing: number) {
        const uni = await v3Pool(base, tokenIn, tokenOut, fee);
        const cl = await base.env.publicClient.readContract({
          address: named("base", "AerodromeSlipstream_CLFactory"),
          abi: SlipstreamCLFactoryABI,
          functionName: "getPool",
          args: [tokenIn, tokenOut, spacing],
        });
        const pools = [];
        for (const [venue, pool] of [uni, cl].entries()) {
          let price = 0n;
          let gross = 0n;
          let ownFee = fee;
          if (BigInt(pool) !== 0n) {
            const liquidity = await base.env.publicClient.readContract({
              address: pool,
              abi: abi.pool,
              functionName: "liquidity",
            });
            if (liquidity > 0n) {
              price =
                venue === 0
                  ? await sqrtPriceOf(base, pool)
                  : (
                      await base.env.publicClient.readContract({
                        address: pool,
                        abi: AerodromeSlipstreamPoolABI,
                        functionName: "slot0",
                      })
                    )[0];
              if (venue === 1)
                ownFee = await base.env.publicClient.readContract({
                  address: pool,
                  abi: AerodromeSlipstreamPoolABI,
                  functionName: "fee",
                });
              const ratio = (price * price) / Q96;
              gross = BigInt(tokenIn) < BigInt(tokenOut) ? ratio : Q192 / ratio;
            }
          }
          pools.push({
            venue,
            pool,
            price,
            gross,
            fee: ownFee,
            score: (gross * BigInt(1_000_000 - ownFee)) / 1_000_000n,
          });
        }
        return pools;
      }

      it("executes the independently ranked winner in both directions, including a fee-blind reversal", async () => {
        let reversed = false;
        const winners = new Set<number>();
        for (const [tokenIn, tokenOut, amount] of [
          [BASE.WETH, BASE.USDC, 10n ** 12n],
          [BASE.USDC, BASE.WETH, 10_000n],
        ] as const) {
          for (const fee of [100, 500, 3000, 10000]) {
            const pools = await candidates(tokenIn, tokenOut, fee, 100);
            if (pools.every((pool) => pool.score === 0n)) continue;
            const [uni, cl] = pools;
            const winner = cl!.score > uni!.score ? cl! : uni!;
            const raw = cl!.gross > uni!.gross ? 1 : 0;
            if (raw !== winner.venue) reversed = true;
            winners.add(winner.venue);
            await fund(base, tokenIn === BASE.WETH ? "WETH" : "USDC", base.env.pot, amount + 123n);
            await fund(base, tokenOut === BASE.WETH ? "WETH" : "USDC", base.env.pot, 456n);
            const before = await balanceOf(base.env, tokenOut, recipient);
            const unchosen = pools[1 - winner.venue]!;
            const unchosenBefore = unchosen.price;
            const returned = (await cook(base, BEST_VENUE, [
              tokenIn,
              tokenOut,
              String(amount),
              String(fee),
              "100",
              "0",
              "1",
              recipient,
            ])) as { venue: string; spent: string; received: string };
            assert.equal(Number(returned.venue), winner.venue);
            assert.equal(BigInt(returned.spent), amount, "this trade is deliberately small");
            assert.equal(
              await balanceOf(base.env, tokenOut, recipient),
              before + BigInt(returned.received),
            );
            assert.equal(await balanceOf(base.env, tokenIn, base.env.pot), 123n);
            assert.equal(await balanceOf(base.env, tokenOut, base.env.pot), 456n);
            const after = await candidates(tokenIn, tokenOut, fee, 100);
            assert.notEqual(
              after[winner.venue]!.price,
              winner.price,
              "the chosen real pool swapped",
            );
            assert.equal(
              after[1 - winner.venue]!.price,
              unchosenBefore,
              "the other pool did not swap",
            );
          }
        }
        assert.deepEqual([...winners].sort(), [0, 1], "exercise both real venue implementations");
        assert.equal(reversed, true, "at least one winner must change when its fee is omitted");
      });

      it("returns partial-fill input and preserves both old Pot balances", async () => {
        const amount = 10n ** 18n;
        const pools = await candidates(BASE.WETH, BASE.USDC, 500, 100);
        const winner = pools[1]!.score > pools[0]!.score ? pools[1]! : pools[0]!;
        const limit = (winner.price * 999_999n) / 1_000_000n;
        await fund(base, "WETH", base.env.pot, amount + 123n);
        await fund(base, "USDC", base.env.pot, 456n);
        const inputBefore = await balanceOf(base.env, BASE.WETH, recipient);
        const outputBefore = await balanceOf(base.env, BASE.USDC, recipient);
        const poolBefore = await balanceOf(base.env, BASE.WETH, winner.pool);
        const returned = (await cook(base, BEST_VENUE, [
          BASE.WETH,
          BASE.USDC,
          String(amount),
          "500",
          "100",
          String(limit),
          "1",
          recipient,
        ])) as { venue: string; spent: string; received: string };
        const spent = BigInt(returned.spent);
        assert.equal(Number(returned.venue), winner.venue);
        assert.ok(spent > 0n && spent < amount);
        assert.equal(await balanceOf(base.env, BASE.WETH, winner.pool), poolBefore + spent);
        assert.equal(await balanceOf(base.env, BASE.WETH, recipient), inputBefore + amount - spent);
        assert.equal(
          await balanceOf(base.env, BASE.USDC, recipient),
          outputBefore + BigInt(returned.received),
        );
        assert.equal(await balanceOf(base.env, BASE.WETH, base.env.pot), 123n);
        assert.equal(await balanceOf(base.env, BASE.USDC, base.env.pot), 456n);
      });

      it("minOut above the successful rehearsal reverts the mined transaction and both pools' state", async () => {
        const amount = 10n ** 12n;
        await fund(base, "WETH", base.env.pot, amount + 123n);
        await fund(base, "USDC", base.env.pot, 456n);
        const args = [BASE.WETH, BASE.USDC, String(amount), "500", "100", "0", "1", recipient];
        const rehearsal = await simulate(base, BEST_VENUE, args);
        assert.equal(rehearsal.ok, true);
        const returned = rehearsal.returned;
        assert.ok(returned && typeof returned === "object" && "received" in returned);
        assert.equal(typeof returned.received, "string");
        const got = BigInt(returned.received as string);
        assert.ok(got > 0n);
        const state = async () => {
          const pools = await candidates(BASE.WETH, BASE.USDC, 500, 100);
          return {
            pools,
            balances: await Promise.all(
              [BASE.WETH, BASE.USDC].flatMap((token) =>
                [base.env.pot, recipient, ...pools.map((pool) => pool.pool)].map((who) =>
                  balanceOf(base.env, token, who),
                ),
              ),
            ),
            approval: await allowance(base.env, BASE.WETH, base.env.pot, base.env.router),
          };
        };
        const before = await state();
        args[6] = String(got + 1n);
        await revertedCook(base, BEST_VENUE, args);
        assert.deepEqual(await state(), before);
      });
    });

    describe("buy-stock: SpaceX shares on Ethereum, from the cheapest pool after its fee", () => {
      const ONE_SHARE = 10n ** 18n;
      const BUDGET = 1_000_000_000n; // 1,000 USDC
      const OTHER = 50_000_000n; // USDC the Pot holds for something else

      /** Each pool of the pair with liquidity, and what a share costs there with its fee. */
      async function pools(): Promise<Array<{ pool: Address; fee: number; paid: bigint }>> {
        const found = [];
        for (const fee of [100, 500, 3000, 10000]) {
          const pool = await v3Pool(ethereum, ETH.USDC, ETH.SPCXon, fee);
          if (BigInt(pool) === 0n) continue;
          const liquidity = await ethereum.env.publicClient.readContract({
            address: pool,
            abi: abi.pool,
            functionName: "liquidity",
          });
          if (liquidity === 0n) continue;
          const price = quotePrice(
            await sqrtPriceOf(ethereum, pool),
            ETH.USDC,
            ETH.SPCXon,
            ONE_SHARE,
          );
          found.push({ pool, fee, paid: (price * 1_000_000n) / (1_000_000n - BigInt(fee)) });
        }

        return found;
      }

      it("buys from the cheapest pool up to priceLimit, refunds the rest, keeps the Pot's other USDC", async () => {
        const [recipient, refundTo] = PEOPLE;
        const candidates = await pools();
        assert.ok(candidates.length > 0, "no SPCXon/USDC pool with liquidity at the pinned block");
        const cheapest = candidates.reduce((a, b) => (b.paid < a.paid ? b : a));
        // A cap 0.05% above what a share costs in the cheapest pool now: the pool fills only part
        // of the budget before its price reaches the cap, and the rest goes back.
        const priceLimit = (cheapest.paid * 10_005n) / 10_000n;
        await fund(ethereum, "USDC", ethereum.env.pot, BUDGET + OTHER);
        const limit = sqrtPriceAt(
          (priceLimit * BigInt(1_000_000 - cheapest.fee)) / 1_000_000n,
          ETH.USDC,
          ETH.SPCXon,
          ONE_SHARE,
        );
        const quoted = await quote(ethereum, ETH.USDC, ETH.SPCXon, BUDGET, cheapest.fee, limit);

        const returned = (await cook(ethereum, example("buy-stock"), [
          String(BUDGET),
          String(priceLimit),
          "1",
          recipient,
          refundTo,
        ])) as { fee: string; spent: string; shares: string };
        assert.equal(BigInt(returned.fee), BigInt(cheapest.fee), "it chose the cheapest pool");
        assert.equal(BigInt(returned.shares), quoted, "the shares are what the quoter quotes");
        assert.equal(await balanceOf(ethereum.env, ETH.SPCXon, recipient), quoted);
        const spent = BigInt(returned.spent);
        assert.ok(spent > 0n && spent < BUDGET, `a partial fill, not ${spent}`);
        assert.equal(await balanceOf(ethereum.env, ETH.USDC, refundTo), BUDGET - spent);
        assert.equal(await balanceOf(ethereum.env, ETH.USDC, ethereum.env.pot), OTHER);
        // No share cost more than priceLimit, the fee included.
        assert.ok(spent * ONE_SHARE <= quoted * priceLimit, "paid more than priceLimit on average");
      });

      it("refuses when every pool is above priceLimit, and when fewer than minShares arrive", async () => {
        const cheapest = (await pools()).reduce((a, b) => (b.paid < a.paid ? b : a));
        await fund(ethereum, "USDC", ethereum.env.pot, BUDGET);
        const [recipient, refundTo] = PEOPLE;
        const below = await simulate(ethereum, example("buy-stock"), [
          String(BUDGET),
          String((cheapest.paid * 99n) / 100n),
          "1",
          recipient,
          refundTo,
        ]);
        assert.equal(below.ok, false);
        assert.match(String(below.reason), /every pool is above priceLimit/);
        const short = await simulate(ethereum, example("buy-stock"), [
          String(BUDGET),
          String(cheapest.paid * 2n),
          String(ONE_SHARE * 1_000_000n),
          recipient,
          refundTo,
        ]);
        assert.equal(short.ok, false, "a million shares for 1,000 USDC");
      });
    });

    describe("stop-loss: the Pot's WETH against Chainlink's ETH/USD on Ethereum", () => {
      const HELD = 2n * 10n ** 18n;

      async function oracle(): Promise<{ answer: bigint; updatedAt: bigint }> {
        const round = await ethereum.env.publicClient.readContract({
          address: named("ethereum", "Chainlink_EthUsdFeed"),
          abi: abi.feed,
          functionName: "latestRoundData",
        });

        return { answer: round[1], updatedAt: round[3] };
      }

      it("sells all of it at or below the stop, each unit at the floor or better", async () => {
        const { answer } = await oracle();
        await fund(ethereum, "WETH", ethereum.env.pot, HELD);
        const slippage = 100n;
        const floor = (answer * (10_000n - slippage)) / 1_000_000n;
        const pool = await v3Pool(ethereum, ETH.WETH, ETH.USDC, 500);
        const root = isqrt((1_000_000n - 500n) * 10n ** 30n);
        const limit = (sqrtPriceAt(floor, ETH.USDC, ETH.WETH, 10n ** 18n) * root) / 10n ** 18n;
        const quoted = await quote(ethereum, ETH.WETH, ETH.USDC, HELD, 500, limit);
        assert.ok(BigInt(pool) !== 0n);

        const returned = (await cook(ethereum, example("stop-loss"), [
          String(answer + 1n), // the stop is just above the price: it triggers
          "0",
          String(slippage),
          "3600",
        ])) as { price: string; triggered: boolean; sold: string; received: string };
        assert.equal(BigInt(returned.price), answer);
        assert.equal(returned.triggered, true);
        assert.equal(BigInt(returned.sold), HELD, "a 0.05% pool takes 2 WETH within 1%");
        assert.equal(BigInt(returned.received), quoted);
        assert.equal(await balanceOf(ethereum.env, ETH.WETH, ethereum.env.pot), 0n);
        assert.equal(await balanceOf(ethereum.env, ETH.USDC, ethereum.env.pot), quoted);
        assert.ok(quoted * 10n ** 18n >= HELD * floor, "below the floor");
      });

      it("takes profit at or above takeProfit, and does nothing between the two", async () => {
        const { answer } = await oracle();
        await fund(ethereum, "WETH", ethereum.env.pot, HELD);
        const between = (await cook(ethereum, example("stop-loss"), [
          String(answer - 1n),
          String(answer + 1n),
          "100",
          "3600",
        ])) as { triggered: boolean; sold: string };
        assert.equal(between.triggered, false);
        assert.equal(BigInt(between.sold), 0n);
        assert.equal(await balanceOf(ethereum.env, ETH.WETH, ethereum.env.pot), HELD);

        const profit = (
          await simulate(ethereum, example("stop-loss"), ["0", String(answer), "100", "3600"])
        ).returned as { triggered: boolean; sold: string };
        assert.equal(profit.triggered, true);
        assert.equal(BigInt(profit.sold), HELD);
      });

      it("refuses a price older than maxAge, and sells nothing where the pool is past the floor", async () => {
        const { answer, updatedAt } = await oracle();
        await fund(ethereum, "WETH", ethereum.env.pot, HELD);
        const { timestamp } = await ethereum.env.publicClient.getBlock();
        const stale = await simulate(ethereum, example("stop-loss"), [
          String(answer + 1n),
          "0",
          "100",
          String(timestamp - updatedAt - 1n),
        ]);
        assert.equal(stale.ok, false);
        assert.match(String(stale.reason), /the price is stale/);
        // A floor at the oracle's own price with no slippage allowed is above what the pool pays once
        // its fee is taken: nothing sells, and the run still succeeds.
        const pool = await v3Pool(ethereum, ETH.WETH, ETH.USDC, 500);
        const poolPrice = quotePrice(
          await sqrtPriceOf(ethereum, pool),
          ETH.USDC,
          ETH.WETH,
          10n ** 18n,
        );
        assert.ok(
          (poolPrice * 9_995n) / 10_000n < answer / 100n,
          "the pool pays less than the oracle",
        );
        const none = (await cook(ethereum, example("stop-loss"), [
          String(answer + 1n),
          "0",
          "0",
          "3600",
        ])) as {
          triggered: boolean;
          sold: string;
        };
        assert.equal(none.triggered, true);
        assert.equal(BigInt(none.sold), 0n);
        assert.equal(await balanceOf(ethereum.env, ETH.WETH, ethereum.env.pot), HELD);
      });
    });

    describe("eth-prices: a read-only survey on Ethereum, through sauce simulate", () => {
      it("returns each venue's price, the spread and the oracle gap, as read directly", async () => {
        const ONE = 10n ** 18n;
        const read = async (fee: number) =>
          quotePrice(
            await sqrtPriceOf(ethereum, await v3Pool(ethereum, ETH.WETH, ETH.USDC, fee)),
            ETH.USDC,
            ETH.WETH,
            ONE,
          );
        const v3Fee500 = await read(500);
        const v3Fee3000 = await read(3000);
        const pair = await ethereum.env.publicClient.readContract({
          address: named("ethereum", "UniswapV2_Factory"),
          abi: abi.v2Factory,
          functionName: "getPair",
          args: [ETH.WETH, ETH.USDC],
        });
        const [r0, r1] = await ethereum.env.publicClient.readContract({
          address: pair,
          abi: abi.pair,
          functionName: "getReserves",
        });
        const usdcIs0 = BigInt(ETH.USDC) < BigInt(ETH.WETH);
        const [usdcReserve, wethReserve] = usdcIs0 ? [r0, r1] : [r1, r0];
        const afterFee = ONE * 997n;
        const v2 = (afterFee * usdcReserve) / (wethReserve * 1000n + afterFee); // for 1 WETH
        const round = await ethereum.env.publicClient.readContract({
          address: named("ethereum", "Chainlink_EthUsdFeed"),
          abi: abi.feed,
          functionName: "latestRoundData",
        });
        const oracle = round[1] / 100n;
        const gap = (a: bigint, b: bigint) =>
          a > b ? ((a - b) * 10_000n) / b : ((b - a) * 10_000n) / a;
        const prices = [v3Fee500, v3Fee3000, v2];
        const low = prices.reduce((a, b) => (b < a ? b : a));
        const high = prices.reduce((a, b) => (b > a ? b : a));

        const survey = await simulate(ethereum, example("eth-prices"), [String(ONE)]);
        assert.equal(survey.ok, true, survey.reason);
        assert.deepEqual(survey.returned, {
          oracle: String(oracle),
          updatedAt: String(round[3]),
          v3Fee500: String(v3Fee500),
          v3Fee3000: String(v3Fee3000),
          v2: String(v2),
          spreadBps: String(gap(low, high)),
          oracleGapBps: String(gap(v3Fee500, oracle)),
        });
        // Real prices for ETH, within a few percent of one another.
        for (const price of prices) {
          assert.ok(price > 1_000_000_000n && price < 10_000_000_000n, `price ${price}`);
        }
        assert.ok(gap(low, high) < 300n);
      });
    });

    describe("supply-idle: USDC above a reserve to Aave V3, and back below it, on Ethereum", () => {
      const RESERVE = 500_000_000n;
      const MIN_MOVE = 50_000_000n;

      const aToken = (): Promise<Address> =>
        ethereum.env.publicClient.readContract({
          address: named("ethereum", "AaveV3_Pool"),
          abi: abi.aave,
          functionName: "getReserveAToken",
          args: [ETH.USDC],
        });

      it("supplies the excess, withdraws a shortfall, and skips a move under minMove", async () => {
        const args = [String(RESERVE), String(MIN_MOVE)];
        const token = await aToken();
        await fund(ethereum, "USDC", ethereum.env.pot, 2_000_000_000n);
        const supplied = (await cook(ethereum, example("supply-idle"), args)) as Record<
          string,
          string
        >;
        assert.equal(BigInt(supplied.supplied!), 1_500_000_000n);
        assert.equal(BigInt(supplied.withdrawn!), 0n);
        assert.equal(BigInt(supplied.liquid!), RESERVE);
        assert.equal(await balanceOf(ethereum.env, ETH.USDC, ethereum.env.pot), RESERVE);
        // An aToken balance rounds to within a couple of units of what was supplied.
        const deposited = await balanceOf(ethereum.env, token, ethereum.env.pot);
        assert.ok(deposited >= 1_499_999_998n && deposited <= 1_500_000_002n, `${deposited}`);

        // The Pot spends down to 100 USDC: the next run withdraws the 400 it is short.
        await fund(ethereum, "USDC", ethereum.env.pot, 100_000_000n);
        const withdrawn = (await cook(ethereum, example("supply-idle"), args)) as Record<
          string,
          string
        >;
        assert.equal(BigInt(withdrawn.withdrawn!), 400_000_000n);
        assert.equal(await balanceOf(ethereum.env, ETH.USDC, ethereum.env.pot), RESERVE);

        // 30 USDC over the reserve is under minMove: nothing moves.
        await fund(ethereum, "USDC", ethereum.env.pot, RESERVE + 30_000_000n);
        const skipped = (await cook(ethereum, example("supply-idle"), args)) as Record<
          string,
          string
        >;
        assert.equal(BigInt(skipped.supplied!), 0n);
        assert.equal(BigInt(skipped.withdrawn!), 0n);
        assert.equal(
          await balanceOf(ethereum.env, ETH.USDC, ethereum.env.pot),
          RESERVE + 30_000_000n,
        );
      });
    });

    describe("dca: one tick of a WETH plan on Base", () => {
      const TRANCHE = 250_000_000n;

      async function price(): Promise<bigint> {
        const pool = await v3Pool(base, BASE.WETH, BASE.USDC, 500);

        return quotePrice(await sqrtPriceOf(base, pool), BASE.USDC, BASE.WETH, 10n ** 18n);
      }

      it("buys a tranche below priceLimit, as the quoter quotes, and leaves the rest in the Pot", async () => {
        const now = await price();
        const priceLimit = (now * 1_002n) / 1_000n;
        await fund(base, "USDC", base.env.pot, 1_000_000_000n);
        const limit = sqrtPriceAt(
          (priceLimit * 999_500n) / 1_000_000n,
          BASE.USDC,
          BASE.WETH,
          10n ** 18n,
        );
        const quoted = await quote(base, BASE.USDC, BASE.WETH, TRANCHE, 500, limit);

        const tick = (await cook(base, example("dca"), [
          String(TRANCHE),
          String(priceLimit),
        ])) as Record<string, string>;
        assert.equal(BigInt(tick.price!), now);
        assert.equal(BigInt(tick.bought!), quoted);
        assert.equal(await balanceOf(base.env, BASE.WETH, base.env.pot), quoted);
        assert.equal(
          await balanceOf(base.env, BASE.USDC, base.env.pot),
          1_000_000_000n - BigInt(tick.spent!),
        );
        assert.ok(BigInt(tick.spent!) * 10n ** 18n <= quoted * priceLimit, "paid above priceLimit");
      });

      it("waits, without failing, above priceLimit or short of a tranche", async () => {
        const now = await price();
        await fund(base, "USDC", base.env.pot, 1_000_000_000n);
        const above = (await cook(base, example("dca"), [
          String(TRANCHE),
          String(now / 2n),
        ])) as Record<string, string>;
        assert.equal(BigInt(above.spent!), 0n);
        await fund(base, "USDC", base.env.pot, TRANCHE - 1n);
        const short = (await cook(base, example("dca"), [
          String(TRANCHE),
          String(now * 2n),
        ])) as Record<string, string>;
        assert.equal(BigInt(short.spent!), 0n);
        assert.equal(await balanceOf(base.env, BASE.USDC, base.env.pot), TRANCHE - 1n);
        assert.equal(await balanceOf(base.env, BASE.WETH, base.env.pot), 0n);
      });
    });

    describe("aave-health: repaying USDC to restore the Pot's health factor on Base", () => {
      const TRIGGER = 1_300_000_000_000_000_000n;
      const TARGET = 1_500_000_000_000_000_000n;
      const work = mkdtempSync(join(tmpdir(), "sauce-cookbook-"));
      after(() => rmSync(work, { recursive: true, force: true }));

      const account = async () => {
        const data = await base.env.publicClient.readContract({
          address: named("base", "AaveV3_Pool"),
          abi: abi.aave,
          functionName: "getUserAccountData",
          args: [base.env.pot],
        });

        return { collateral: data[0], debt: data[1], threshold: data[3], healthFactor: data[5] };
      };

      /** The position the guard guards: the Pot supplies `supply` WETH, and borrows `borrow` USDC. */
      async function position(supply: bigint, borrow: bigint): Promise<void> {
        const setup = join(work, "position.sauce.ts");
        writeFileSync(
          setup,
          [
            "function main(supply: Uint256, borrow: Uint256) {",
            "  if (supply > 0n) {",
            "    WETH.approve(AaveV3.Pool, supply);",
            "    AaveV3.Pool.supply(WETH, supply, ctx.self(), 0n);",
            "  }",
            "  if (borrow > 0n) {",
            "    AaveV3.Pool.borrow(USDC, borrow, 2n, 0n, ctx.self());",
            "  }",
            "}",
            "",
          ].join("\n"),
        );
        if (supply > 0n) await fund(base, "WETH", base.env.pot, supply);
        const { code, stderr } = await sauce([
          ...["run", setup, "--chain", "base", "--rpc-url", base.env.rpc, "--private-key"],
          ...[OWNER_KEY, "--salt-hex", POT_SALT, "--args", String(supply), String(borrow)],
        ]);
        assert.equal(code, 0, stderr);
      }

      it("repays below the trigger until the health factor is the target, and not again", async () => {
        // 1 WETH supplied, then the USDC that puts the health factor near 1.2: the debt, in Aave's
        // base currency (USD, 8 decimals), is collateral × threshold ÷ 1.2, and USDC has 6 decimals.
        await position(10n ** 18n, 0n);
        const supplied = await account();
        const borrow =
          (supplied.collateral * supplied.threshold * 10n ** 18n) /
          (10_000n * 1_200_000_000_000_000_000n) /
          100n;
        await position(0n, borrow);
        const before = await account();
        assert.ok(before.healthFactor < TRIGGER, `health factor ${before.healthFactor}`);

        const guarded = (await cook(base, example("aave-health"), [
          String(TRIGGER),
          String(TARGET),
        ])) as Record<string, string>;
        const after = await account();
        // The rehearsal ran a block before the cook, so the two differ by that block's interest;
        // each is at the target.
        assert.equal(BigInt(guarded.before!), before.healthFactor);
        assert.ok(BigInt(guarded.after!) >= TARGET, `simulated only to ${guarded.after}`);
        assert.ok(after.healthFactor >= TARGET, `restored only to ${after.healthFactor}`);
        assert.ok(after.healthFactor < TARGET + 10n ** 15n, `overshot to ${after.healthFactor}`);
        // What the cook repaid: the rehearsal's amount, and the interest of the block between.
        const repaid = borrow - (await balanceOf(base.env, BASE.USDC, base.env.pot));
        assert.ok(repaid >= BigInt(guarded.repaid!) && repaid - BigInt(guarded.repaid!) < 100n);
        assert.ok(after.debt < before.debt, "the debt fell");

        const again = (await cook(base, example("aave-health"), [
          String(TRIGGER),
          String(TARGET),
        ])) as Record<string, string>;
        assert.equal(BigInt(again.repaid!), 0n, "at or above the trigger it does nothing");
      });
    });

    describe("payroll: USDC by weight on Base", () => {
      it("pays each recipient its share, the last the remainder, and keeps the Pot's other USDC", async () => {
        const [alice, bob, carol] = PEOPLE;
        await fund(base, "USDC", base.env.pot, 6_000_000_001n + 100_000_000n);
        const paid = await cook(base, example("payroll"), [
          JSON.stringify([alice, bob, carol]),
          "[3,2,1]",
          "6000000001",
        ]);
        assert.deepEqual(paid, ["3000000000", "2000000000", "1000000001"]);
        assert.equal(await balanceOf(base.env, BASE.USDC, alice), 3_000_000_000n);
        assert.equal(await balanceOf(base.env, BASE.USDC, bob), 2_000_000_000n);
        assert.equal(await balanceOf(base.env, BASE.USDC, carol), 1_000_000_001n);
        assert.equal(await balanceOf(base.env, BASE.USDC, base.env.pot), 100_000_000n);
      });

      it("refuses a repeated recipient, a missing weight and an unfunded budget, paying no one", async () => {
        const [alice, bob] = PEOPLE;
        await fund(base, "USDC", base.env.pot, 1_000_000n);
        for (const [args, reason] of [
          [[JSON.stringify([alice, alice]), "[1,1]", "1000"], /listed twice/],
          [[JSON.stringify([alice, bob]), "[1]", "1000"], /one weight per recipient/],
          [[JSON.stringify([alice, bob]), "[1,1]", "1000001"], /budget is not in the Pot/],
        ] as const) {
          const refused = await simulate(base, example("payroll"), args);
          assert.equal(refused.ok, false);
          assert.match(String(refused.reason), reason);
        }
      });
    });

    describe("rebalance: WETH and USDC to a target share on Base", () => {
      async function price(): Promise<bigint> {
        const pool = await v3Pool(base, BASE.WETH, BASE.USDC, 500);

        return quotePrice(await sqrtPriceOf(base, pool), BASE.USDC, BASE.WETH, 10n ** 18n);
      }

      it("sells the excess WETH toward half, as the quoter quotes, within the slippage", async () => {
        const now = await price();
        await fund(base, "WETH", base.env.pot, 10n ** 18n);
        await fund(base, "USDC", base.env.pot, 500_000_000n);
        const wethValue = now;
        const wanted = (wethValue + 500_000_000n) / 2n;
        const amountIn = ((wethValue - wanted) * 10n ** 18n) / now;
        const floor = (now * (10_000n - 30n)) / 10_000n;
        const quoted = await quote(
          base,
          BASE.WETH,
          BASE.USDC,
          amountIn,
          500,
          sqrtPriceAt(floor, BASE.USDC, BASE.WETH, 10n ** 18n),
        );

        const moved = (await cook(base, example("rebalance"), ["5000", "500", "30"])) as Record<
          string,
          string | boolean
        >;
        assert.equal(moved.soldWeth, true);
        assert.equal(BigInt(moved.amountIn as string), amountIn, "the whole excess sells");
        assert.equal(BigInt(moved.amountOut as string), quoted);
        assert.ok(BigInt(moved.before as string) > 8_000n);
        const after = BigInt(moved.after as string);
        assert.ok(after > 4_900n && after < 5_100n, `WETH is ${after} bps after`);
        assert.equal(await balanceOf(base.env, BASE.WETH, base.env.pot), 10n ** 18n - amountIn);
        assert.equal(await balanceOf(base.env, BASE.USDC, base.env.pot), 500_000_000n + quoted);
      });

      it("buys WETH when it is under, and trades nothing inside the band", async () => {
        await fund(base, "WETH", base.env.pot, 10n ** 17n);
        await fund(base, "USDC", base.env.pot, 2_000_000_000n);
        const bought = (await cook(base, example("rebalance"), ["5000", "500", "30"])) as Record<
          string,
          string | boolean
        >;
        assert.equal(bought.soldWeth, false);
        assert.ok(BigInt(bought.amountOut as string) > 0n);
        const after = BigInt(bought.after as string);
        assert.ok(after > 4_900n && after < 5_100n, `WETH is ${after} bps after`);

        const within = (await cook(base, example("rebalance"), ["5000", "500", "30"])) as Record<
          string,
          string | boolean
        >;
        assert.equal(BigInt(within.amountIn as string), 0n);
      });
    });
  },
);
