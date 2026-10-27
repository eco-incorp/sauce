/**
 * The Uniswap V3 examples of the `sauce-swaps` and `sauce-protocols` skills, EXECUTED: each program
 * run as its header says, through the `sauce` command itself (`runCli`): `simulate` for what `main`
 * returns, then `run` to send the cook, on Ethereum's state captured at its pinned block
 * (`official-ethereum`, `mainnet.ts`), through the released engine, Kitchen and Pot. No RPC is
 * reached.
 *
 * - `sauce-swaps/examples/exact-output.sauce.ts`: an exact-output swap through the SwapRouter,
 *   held to QuoterV2's `quoteExactOutputSingle`, with no allowance left behind.
 * - `sauce-swaps/examples/swap-path.sauce.ts`: DAI → USDC (0.01%) → WETH (0.3%) along a path the
 *   program encodes, both ways, held to QuoterV2's `quoteExactInput` and `quoteExactOutput`.
 * - `sauce-protocols/examples/v3-position-{open,manage}.sauce.ts`: a full-range DAI/USDC 0.3%
 *   position minted to the Pot, added to, its fees collected, half its liquidity removed and
 *   collected, and the NFT handed over, each held to the position manager's own reads and to the
 *   same calls replayed from the Pot with `eth_call`.
 *
 * A group, not a suite of its own: `examples.mainnet.test.ts` registers it on the one anvil every
 * group reading `official-ethereum` shares, and a capture there writes all of their state.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { OWNER_KEY, REPO_ROOT, type Anvil } from "./anvil.js";
import { allowance, balanceOf, setBalance } from "./swap-venues.js";

const SWAPS = join(REPO_ROOT, "skills/sauce-swaps/examples");
const PROTOCOLS = join(REPO_ROOT, "skills/sauce-protocols/examples");

/** The address a program compiled for Ethereum names `name` by: the SDK's own define for it. */
function named(name: string): Address {
  const value = routes.chainDefines(requireChain("ethereum"))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on Ethereum`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

const DAI = named("Maker_Dai");
const USDC = named("USDC");
const WETH = named("WETH");
const ROUTER = named("UniswapV3_SwapRouter");
const QUOTER = named("UniswapV3_QuoterV2");
const MANAGER = named("UniswapV3_NonfungiblePositionManager");
const FACTORY = named("UniswapV3_Factory");

/** Where each token keeps `balanceOf`. */
const BALANCE = { DAI: { slot: 2n }, USDC: { slot: 9n }, WETH: { slot: 3n } } as const;
const DAI_UNIT = 10n ** 18n;
const USDC_UNIT = 10n ** 6n;
const WETH_UNIT = 10n ** 18n;
const UINT128_MAX = 2n ** 128n - 1n;

const abi = {
  erc20: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
  quoter: parseAbi([
    "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
    "function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
  ]),
  router: parseAbi([
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut)",
  ]),
  pool: parseAbi([
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function fee() view returns (uint24)",
    "function tickSpacing() view returns (int24)",
  ]),
  manager: parseAbi([
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint256 amount0, uint256 amount1)",
    "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)",
    "function multicall(bytes[] data) returns (bytes[] results)",
  ]),
};

/** Recipients: anvil's dev accounts past the owner's. */
const PEOPLE: readonly Address[] = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
].map((address) => getAddress(address));

/** A router path: each token's 20 bytes with the 3-byte fee of the pool between each two. */
const path = (...hops: Array<Address | number>): Hex =>
  `0x${hops
    .map((hop) => (typeof hop === "number" ? hop.toString(16).padStart(6, "0") : hop.slice(2)))
    .join("")}`;

interface Rehearsal {
  ok: boolean;
  returned?: unknown;
  reason?: string;
}

async function sauce(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

/** Registers the group's tests on `anvil()`, which the entry starts before they run. */
export function register(anvil: () => Anvil): void {
  describe("the Uniswap V3 examples of sauce-swaps and sauce-protocols, executed", () => {
    let env: Anvil;
    let group: Hex;
    let snapshot: Hex;

    before(async () => {
      env = anvil();
      group = await env.testClient.snapshot();
    });
    after(async () => {
      await env.testClient.revert({ id: group });
    });
    beforeEach(async () => {
      snapshot = await env.testClient.snapshot();
    });
    afterEach(async () => {
      await env.testClient.revert({ id: snapshot });
    });

    /** `sauce simulate` of an example on the owner's Pot: the JSON it prints. */
    async function simulate(file: string, args: readonly string[]): Promise<Rehearsal> {
      const { code, stdout, stderr } = await sauce([
        ...["simulate", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--owner", env.account.address, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

      return JSON.parse(stdout) as Rehearsal;
    }

    /** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
    async function run(file: string, args: readonly string[]): Promise<void> {
      const { code, stdout, stderr } = await sauce([
        ...["run", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.equal(code, 0, `${stderr}\n${stdout}`);
      const printed = JSON.parse(stdout) as { cook: { status: string } };
      assert.equal(printed.cook.status, "success");
    }

    /** Simulates, then runs: `main`'s return as the rehearsal decoded it. */
    async function cook<T>(file: string, args: readonly string[]): Promise<T> {
      const rehearsal = await simulate(file, args);
      assert.equal(rehearsal.ok, true, `the rehearsal reverts: ${rehearsal.reason}`);
      await run(file, args);

      return rehearsal.returned as T;
    }

    /** What Uniswap's QuoterV2 says, its first output. */
    async function quote(
      functionName: "quoteExactOutputSingle" | "quoteExactInput" | "quoteExactOutput",
      args: readonly unknown[],
    ): Promise<bigint> {
      const { result } = await env.publicClient.simulateContract({
        address: QUOTER,
        abi: abi.quoter,
        functionName,
        args: args as never,
      });

      // Each of the three returns the amount first: amountIn, or amountOut.
      const amount: unknown = Array.isArray(result) ? result[0] : undefined;
      assert.equal(typeof amount, "bigint", `${functionName} returned no amount`);

      return amount as bigint;
    }

    async function send(request: unknown): Promise<void> {
      const hash = await env.walletClient.writeContract(request as never);
      assert.equal((await env.publicClient.waitForTransactionReceipt({ hash })).status, "success");
    }

    describe("exact-output: an exact amount bought through the SwapRouter", () => {
      const FILE = join(SWAPS, "exact-output.sauce.ts");
      const HELD = 5000n * DAI_UNIT;
      const AMOUNT_OUT = WETH_UNIT / 10n;
      const MAX_IN = 1000n * DAI_UNIT;
      const quoted = () =>
        quote("quoteExactOutputSingle", [
          { tokenIn: DAI, tokenOut: WETH, amount: AMOUNT_OUT, fee: 3000, sqrtPriceLimitX96: 0n },
        ]);
      const args = (maxIn: bigint, recipient: Address) => [
        DAI,
        WETH,
        "3000",
        String(AMOUNT_OUT),
        String(maxIn),
        recipient,
      ];

      it("buys 0.1 WETH for what the quoter quotes, and withdraws the rest of the allowance", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, HELD);
        const cost = await quoted();
        assert.ok(cost > 0n && cost < MAX_IN);
        const before = await balanceOf(env, WETH, recipient);

        const spent = BigInt(await cook<string>(FILE, args(MAX_IN, recipient)));
        assert.equal(spent, cost, "it paid what QuoterV2 quotes");
        assert.equal((await balanceOf(env, WETH, recipient)) - before, AMOUNT_OUT);
        assert.equal(await balanceOf(env, DAI, env.pot), HELD - cost);
        assert.equal(await allowance(env, DAI, env.pot, ROUTER), 0n, "no allowance is left");
      });

      it("refuses a maxIn below the cost, and a maxIn the Pot does not hold", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, HELD);
        const cost = await quoted();
        const short = await simulate(FILE, args(cost - 1n, recipient));
        assert.equal(short.ok, false, "the output costs more than maxIn");
        const absent = await simulate(FILE, args(HELD + 1n, recipient));
        assert.equal(absent.ok, false);
        assert.match(String(absent.reason), /maxIn is not in the Pot/);
      });
    });

    describe("swap-path: DAI → USDC (0.01%) → WETH (0.3%) along an encoded path", () => {
      const FILE = join(SWAPS, "swap-path.sauce.ts");
      const HELD = 5000n * DAI_UNIT;
      const TOKENS = JSON.stringify([DAI, USDC, WETH]);
      const FEES = "[100,3000]";
      const args = (exactOut: boolean, amount: bigint, limit: bigint, recipient: Address) => [
        TOKENS,
        FEES,
        String(exactOut),
        String(amount),
        String(limit),
        recipient,
      ];

      it("sells exactly 1,000 DAI for the WETH the quoter quotes", async () => {
        const [recipient] = PEOPLE;
        const amountIn = 1000n * DAI_UNIT;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, HELD);
        const out = await quote("quoteExactInput", [path(DAI, 100, USDC, 3000, WETH), amountIn]);
        assert.ok(out > 0n);
        const before = await balanceOf(env, WETH, recipient);

        const returned = await cook<{ paid: string; received: string }>(
          FILE,
          args(false, amountIn, out, recipient),
        );
        assert.deepEqual([BigInt(returned.paid), BigInt(returned.received)], [amountIn, out]);
        assert.equal((await balanceOf(env, WETH, recipient)) - before, out);
        assert.equal(await balanceOf(env, DAI, env.pot), HELD - amountIn);
        assert.equal(await allowance(env, DAI, env.pot, ROUTER), 0n);
      });

      it("buys exactly 0.1 WETH for the DAI the quoter quotes, and withdraws the rest of the allowance", async () => {
        const [recipient] = PEOPLE;
        const amountOut = WETH_UNIT / 10n;
        const limit = 1000n * DAI_UNIT;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, HELD);
        // An exact output's path runs from the token bought.
        const cost = await quote("quoteExactOutput", [path(WETH, 3000, USDC, 100, DAI), amountOut]);
        assert.ok(cost > 0n && cost < limit);
        const before = await balanceOf(env, WETH, recipient);

        const returned = await cook<{ paid: string; received: string }>(
          FILE,
          args(true, amountOut, limit, recipient),
        );
        assert.deepEqual([BigInt(returned.paid), BigInt(returned.received)], [cost, amountOut]);
        assert.equal((await balanceOf(env, WETH, recipient)) - before, amountOut);
        assert.equal(await balanceOf(env, DAI, env.pot), HELD - cost);
        assert.equal(await allowance(env, DAI, env.pot, ROUTER), 0n, "no allowance is left");
      });

      it("refuses a minimum the route cannot meet, a cost above the limit, and a fee per pair missing", async () => {
        const [recipient] = PEOPLE;
        const amountIn = 1000n * DAI_UNIT;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, HELD);
        const out = await quote("quoteExactInput", [path(DAI, 100, USDC, 3000, WETH), amountIn]);
        const short = await simulate(FILE, args(false, amountIn, out + 1n, recipient));
        assert.equal(short.ok, false, "less than limit arrives");
        const amountOut = WETH_UNIT / 10n;
        const cost = await quote("quoteExactOutput", [path(WETH, 3000, USDC, 100, DAI), amountOut]);
        const dear = await simulate(FILE, args(true, amountOut, cost - 1n, recipient));
        assert.equal(dear.ok, false, "it costs more than limit");
        const unpaired = await simulate(FILE, [
          TOKENS,
          "[100]",
          "false",
          String(amountIn),
          "0",
          recipient,
        ]);
        assert.equal(unpaired.ok, false);
        assert.match(String(unpaired.reason), /give one fee per pair of tokens/);
      });
    });

    describe("v3-position-open and v3-position-manage: a full-range DAI/USDC 0.3% position", () => {
      const OPEN = join(PROTOCOLS, "v3-position-open.sauce.ts");
      const MANAGE = join(PROTOCOLS, "v3-position-manage.sauce.ts");

      const position = async (tokenId: bigint) =>
        env.publicClient.readContract({
          address: MANAGER,
          abi: abi.manager,
          functionName: "positions",
          args: [tokenId],
        });
      const ownerOf = (tokenId: bigint) =>
        env.publicClient.readContract({
          address: MANAGER,
          abi: abi.manager,
          functionName: "ownerOf",
          args: [tokenId],
        });

      /** What the position manager itself pays for `decreaseLiquidity` (when `liquidity` > 0), then `collect`, called by the Pot. */
      async function payout(
        tokenId: bigint,
        liquidity: bigint,
      ): Promise<readonly [bigint, bigint]> {
        const [recipient] = PEOPLE;
        const calls: Hex[] = [];
        if (liquidity > 0n)
          calls.push(
            encodeFunctionData({
              abi: abi.manager,
              functionName: "decreaseLiquidity",
              args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: 2n ** 40n }],
            }),
          );
        calls.push(
          encodeFunctionData({
            abi: abi.manager,
            functionName: "collect",
            args: [{ tokenId, recipient, amount0Max: UINT128_MAX, amount1Max: UINT128_MAX }],
          }),
        );
        const { result } = await env.publicClient.simulateContract({
          account: env.pot,
          address: MANAGER,
          abi: abi.manager,
          functionName: "multicall",
          args: [calls],
        });
        const collected = decodeFunctionResult({
          abi: abi.manager,
          functionName: "collect",
          data: result[result.length - 1],
        });

        return collected;
      }

      /** Someone else trades DAI and USDC both ways in the 0.3% pool: fees for the position. */
      async function trade(): Promise<void> {
        const trader = env.account.address;
        await setBalance(env, DAI, BALANCE.DAI, trader, 100n * DAI_UNIT);
        await setBalance(env, USDC, BALANCE.USDC, trader, 100n * USDC_UNIT);
        for (const [tokenIn, tokenOut, amountIn] of [
          [DAI, USDC, 100n * DAI_UNIT],
          [USDC, DAI, 100n * USDC_UNIT],
        ] as const) {
          await send({
            address: tokenIn,
            abi: abi.erc20,
            functionName: "approve",
            args: [ROUTER, amountIn],
          });
          await send({
            address: ROUTER,
            abi: abi.router,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn,
                tokenOut,
                fee: 3000,
                recipient: trader,
                deadline: 2n ** 40n,
                amountIn,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });
        }
      }

      const open = (tokenId: bigint, pool: Address, dai: bigint, usdc: bigint, minDai = 0n) => [
        String(tokenId),
        pool,
        String(dai),
        String(usdc),
        String(minDai),
        "0",
      ];
      const manage = (tokenId: bigint, share: bigint, recipient: Address, newOwner: Address) => [
        String(tokenId),
        String(share),
        "0",
        "0",
        recipient,
        newOwner,
      ];
      const NOBODY = "0x0000000000000000000000000000000000000000";

      interface Opened {
        tokenId: string;
        liquidity: string;
        spent0: string;
        spent1: string;
      }

      /**
       * The factory's pool for DAI/USDC at `fee`, as its CREATE2 derives it (the position manager
       * finds a pool the same way, with Uniswap V3's pool init-code hash), checked by its own reads.
       */
      async function poolOf(fee: number): Promise<Address> {
        const pool = getCreate2Address({
          from: FACTORY,
          salt: keccak256(
            encodeAbiParameters(
              [{ type: "address" }, { type: "address" }, { type: "uint24" }],
              [DAI, USDC, fee],
            ),
          ),
          bytecodeHash: "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54",
        });
        const read = (functionName: "token0" | "token1" | "fee") =>
          env.publicClient.readContract({ address: pool, abi: abi.pool, functionName });
        assert.deepEqual(
          [await read("token0"), await read("token1"), await read("fee")],
          [DAI, USDC, fee],
          `the DAI/USDC ${fee} pool`,
        );

        return pool;
      }
      interface Managed {
        removed: string;
        paid0: string;
        paid1: string;
      }

      it("mints to the Pot, adds, collects the fees, removes half, and hands the NFT over", async () => {
        const [recipient, newOwner] = PEOPLE;
        const held = { dai: 5000n * DAI_UNIT, usdc: 5000n * USDC_UNIT };
        await setBalance(env, DAI, BALANCE.DAI, env.pot, held.dai);
        await setBalance(env, USDC, BALANCE.USDC, env.pot, held.usdc);
        assert.ok(BigInt(DAI) < BigInt(USDC), "DAI is the pool's token0");
        const pool = await poolOf(3000);
        const spacing = await env.publicClient.readContract({
          address: pool,
          abi: abi.pool,
          functionName: "tickSpacing",
        });
        const top = Math.trunc(887272 / spacing) * spacing;

        // Minted: the Pot owns it, on the pool's widest range, holding what the mint reports.
        const minted = await cook<Opened>(
          OPEN,
          open(0n, pool, 1000n * DAI_UNIT, 1000n * USDC_UNIT),
        );
        const tokenId = BigInt(minted.tokenId);
        assert.equal(await ownerOf(tokenId), env.pot);
        let state = await position(tokenId);
        assert.deepEqual([state[2], state[3], state[4]], [DAI, USDC, 3000]);
        assert.deepEqual([state[5], state[6]], [-top, top], "the full range");
        assert.equal(state[7], BigInt(minted.liquidity));
        assert.ok(state[7] > 0n);
        const spent = { dai: BigInt(minted.spent0), usdc: BigInt(minted.spent1) };
        assert.ok(spent.dai > 0n && spent.usdc > 0n);
        assert.equal(await balanceOf(env, DAI, env.pot), held.dai - spent.dai);
        assert.equal(await balanceOf(env, USDC, env.pot), held.usdc - spent.usdc);
        assert.equal(await allowance(env, DAI, env.pot, MANAGER), 0n);
        assert.equal(await allowance(env, USDC, env.pot, MANAGER), 0n);

        // Added to: the position grows by what the call says it added.
        const added = await cook<Opened>(
          OPEN,
          open(tokenId, pool, 500n * DAI_UNIT, 500n * USDC_UNIT),
        );
        assert.equal(BigInt(added.tokenId), tokenId);
        const grown = (await position(tokenId))[7];
        assert.equal(grown, state[7] + BigInt(added.liquidity));
        spent.dai += BigInt(added.spent0);
        spent.usdc += BigInt(added.spent1);
        assert.equal(await balanceOf(env, DAI, env.pot), held.dai - spent.dai);
        assert.equal(await balanceOf(env, USDC, env.pot), held.usdc - spent.usdc);
        assert.equal(await allowance(env, DAI, env.pot, MANAGER), 0n);
        assert.equal(await allowance(env, USDC, env.pot, MANAGER), 0n);

        // Fees: what the position manager itself would pay, paid to the recipient.
        await trade();
        const owed = await payout(tokenId, 0n);
        assert.ok(owed[0] > 0n && owed[1] > 0n, "the trades paid the position fees");
        const paid = {
          dai: await balanceOf(env, DAI, recipient),
          usdc: await balanceOf(env, USDC, recipient),
        };
        const fees = await cook<Managed>(MANAGE, manage(tokenId, 0n, recipient, NOBODY));
        assert.deepEqual(
          [BigInt(fees.removed), BigInt(fees.paid0), BigInt(fees.paid1)],
          [0n, ...owed],
        );
        assert.equal((await balanceOf(env, DAI, recipient)) - paid.dai, owed[0]);
        assert.equal((await balanceOf(env, USDC, recipient)) - paid.usdc, owed[1]);
        assert.equal((await position(tokenId))[7], grown, "collecting fees leaves the liquidity");

        // Half: half the liquidity out, and what the position manager frees for it paid out.
        const half = grown / 2n;
        const freed = await payout(tokenId, half);
        const halved = await cook<Managed>(MANAGE, manage(tokenId, 5000n, recipient, NOBODY));
        assert.deepEqual(
          [BigInt(halved.removed), BigInt(halved.paid0), BigInt(halved.paid1)],
          [half, ...freed],
        );
        state = await position(tokenId);
        assert.equal(state[7], grown - half);
        assert.equal((await balanceOf(env, DAI, recipient)) - paid.dai, owed[0] + freed[0]);
        assert.equal((await balanceOf(env, USDC, recipient)) - paid.usdc, owed[1] + freed[1]);
        assert.equal(await ownerOf(tokenId), env.pot, "the Pot keeps it");

        // Handed over: the NFT is the new owner's, the liquidity left in it.
        await cook<Managed>(MANAGE, manage(tokenId, 0n, recipient, newOwner));
        assert.equal(await ownerOf(tokenId), newOwner);
        assert.equal((await position(tokenId))[7], grown - half);
      });

      it("refuses a minimum the mint cannot meet, a share above all, and a position on another pool", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, DAI, BALANCE.DAI, env.pot, 5000n * DAI_UNIT);
        await setBalance(env, USDC, BALANCE.USDC, env.pot, 5000n * USDC_UNIT);
        const pool = await poolOf(3000);
        const greedy = await simulate(
          OPEN,
          open(0n, pool, 1000n * DAI_UNIT, 1000n * USDC_UNIT, 1000n * DAI_UNIT + 1n),
        );
        assert.equal(greedy.ok, false, "a minimum above the amount cannot be met");
        const absent = await simulate(OPEN, open(0n, pool, 5001n * DAI_UNIT, 1000n * USDC_UNIT));
        assert.equal(absent.ok, false);
        assert.match(String(absent.reason), /amount0 is not in the Pot/);

        const minted = await cook<Opened>(
          OPEN,
          open(0n, pool, 1000n * DAI_UNIT, 1000n * USDC_UNIT),
        );
        const tokenId = BigInt(minted.tokenId);
        const elsewhere = await simulate(
          OPEN,
          open(tokenId, await poolOf(100), DAI_UNIT, USDC_UNIT),
        );
        assert.equal(elsewhere.ok, false);
        assert.match(String(elsewhere.reason), /the position is on another pool/);
        const over = await simulate(MANAGE, manage(tokenId, 10001n, recipient, NOBODY));
        assert.equal(over.ok, false);
        assert.match(String(over.reason), /share is at most 10000/);
      });
    });
  });
}
