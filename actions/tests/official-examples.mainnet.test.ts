/**
 * The protocols' own examples, ported to Sauce (`skills/sauce-swaps/examples` and
 * `skills/sauce-protocols/examples`, each header naming the official file it ports), EXECUTED: each
 * program run as its header says, through the `sauce` command itself (`runCli`): `simulate` for
 * what `main` returns, then `run` to send the cook, on Ethereum's state captured at its pinned block
 * (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * Every result is held to something the program did not compute: each swap to Uniswap's own
 * QuoterV2 on the same route, and to the balances it moved.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { OWNER_KEY, REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { allowance, balanceOf, setBalance } from "./swap-venues.js";

const example = (skill: string, name: string): string =>
  join(REPO_ROOT, "skills", skill, "examples", `${name}.sauce.ts`);

/** The address a program compiled for Ethereum names `name` by: the SDK's own define for it. */
function named(name: string): Address {
  const value = routes.chainDefines(requireChain("ethereum"))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on ethereum`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

/** Uniswap's own QuoterV2 on Ethereum: what every swap here is held to. */
const QUOTER: Address = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

const abi = {
  erc20: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
  swapRouter: parseAbi([
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  ]),
  positionManager: parseAbi([
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)",
  ]),
  quoter: parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
    "function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
  ]),
};

/** Recipients: anvil's dev accounts past the owner's. */
const PEOPLE: readonly Address[] = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
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

describe(
  "the protocols' own examples, ported and executed",
  { skip: skipReason(), timeout: 1_800_000 },
  () => {
    let env: Anvil;
    let snapshot: Hex;

    before(async () => {
      env = await startAnvil({ mainnet: "official-ethereum", chain: "ethereum" });
    });
    after(async () => {
      await env?.stop();
    });
    beforeEach(async () => {
      snapshot = await env.testClient.snapshot();
    });
    afterEach(async () => {
      await env.testClient.revert({ id: snapshot });
    });

    /** `sauce simulate` of an example on the owner's Pot: the JSON it prints. */
    async function simulate(
      file: string,
      args: readonly string[],
    ): Promise<{ ok: boolean; returned?: unknown; reason?: string }> {
      const { code, stdout, stderr } = await sauce([
        ...["simulate", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--owner", env.account.address, "--salt-hex", POT_SALT, "--json"],
        ...(args.length === 0 ? [] : ["--args", ...args]),
      ]);
      assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

      return JSON.parse(stdout) as { ok: boolean; returned?: unknown; reason?: string };
    }

    /** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
    async function run(file: string, args: readonly string[]): Promise<void> {
      const { code, stdout, stderr } = await sauce([
        ...["run", file, "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...(args.length === 0 ? [] : ["--args", ...args]),
      ]);
      assert.equal(code, 0, `${stderr}\n${stdout}`);
      assert.equal((JSON.parse(stdout) as { cook: { status: string } }).cook.status, "success");
    }

    /** Simulates, then runs: `main`'s return as the rehearsal decoded it, from the state it ran on. */
    async function cook(file: string, args: readonly string[]): Promise<unknown> {
      const rehearsal = await simulate(file, args);
      assert.equal(rehearsal.ok, true, `the rehearsal reverts: ${rehearsal.reason}`);
      await run(file, args);

      return rehearsal.returned;
    }

    describe("Uniswap V3's SwapExamples", () => {
      const FILE = example("sauce-swaps", "uniswap-v3-swap-examples");
      const DAI = named("Maker_Dai");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const ROUTER = named("UniswapV3_SwapRouter");
      const DAI_BALANCE = { slot: 2n };
      const FEE = 3000;
      const STABLE_FEE = 100;
      /** A router path: tokens with the fee of the pool between each two. */
      const path = (...hops: Array<Address | number>): Hex =>
        `0x${hops
          .map((hop) =>
            typeof hop === "number" ? hop.toString(16).padStart(6, "0") : hop.slice(2),
          )
          .join("")}` as Hex;
      const ONE_THOUSAND_DAI = 1000n * 10n ** 18n;
      const HELD = 5000n * 10n ** 18n;

      const quote = async (functionName: string, args: readonly unknown[]): Promise<bigint> => {
        const { result } = await env.publicClient.simulateContract({
          address: QUOTER,
          abi: abi.quoter,
          functionName: functionName as "quoteExactInput",
          args: args as never,
        });

        return (result as unknown as readonly [bigint])[0];
      };

      for (const multihop of [false, true]) {
        const route = multihop ? "DAI → USDC → WETH" : "DAI → WETH";

        it(`swapExactInput${multihop ? "Multihop" : "Single"}: sells 1,000 DAI ${route}, as the quoter quotes`, async () => {
          const [recipient] = PEOPLE;
          await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
          const quoted = multihop
            ? await quote("quoteExactInput", [
                path(DAI, STABLE_FEE, USDC, FEE, WETH),
                ONE_THOUSAND_DAI,
              ])
            : await quote("quoteExactInputSingle", [
                {
                  tokenIn: DAI,
                  tokenOut: WETH,
                  amountIn: ONE_THOUSAND_DAI,
                  fee: FEE,
                  sqrtPriceLimitX96: 0n,
                },
              ]);

          const returned = await cook(FILE, [
            String(multihop),
            "false",
            String(ONE_THOUSAND_DAI),
            String(quoted),
            recipient,
          ]);
          assert.equal(BigInt(returned as string), quoted);
          assert.equal(await balanceOf(env, WETH, recipient), quoted);
          assert.equal(await balanceOf(env, DAI, env.pot), HELD - ONE_THOUSAND_DAI);
        });

        it(`swapExactOutput${multihop ? "Multihop" : "Single"}: buys 0.1 WETH ${route}, keeps the unspent DAI and no allowance`, async () => {
          const [recipient] = PEOPLE;
          const amountOut = 10n ** 17n;
          await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
          const quoted = multihop
            ? await quote("quoteExactOutput", [path(WETH, FEE, USDC, STABLE_FEE, DAI), amountOut])
            : await quote("quoteExactOutputSingle", [
                {
                  tokenIn: DAI,
                  tokenOut: WETH,
                  amount: amountOut,
                  fee: FEE,
                  sqrtPriceLimitX96: 0n,
                },
              ]);
          const amountInMaximum = (quoted * 101n) / 100n;

          const returned = await cook(FILE, [
            String(multihop),
            "true",
            String(amountOut),
            String(amountInMaximum),
            recipient,
          ]);
          assert.equal(BigInt(returned as string), quoted);
          assert.equal(await balanceOf(env, WETH, recipient), amountOut);
          assert.equal(await balanceOf(env, DAI, env.pot), HELD - quoted);
          assert.equal(
            await allowance(env, DAI, env.pot, ROUTER),
            0n,
            "the allowance is withdrawn",
          );
        });
      }

      it("refuses a minimum the pool cannot meet, and DAI the Pot does not hold", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, DAI, DAI_BALANCE, env.pot, HELD);
        const quoted = await quote("quoteExactInputSingle", [
          {
            tokenIn: DAI,
            tokenOut: WETH,
            amountIn: ONE_THOUSAND_DAI,
            fee: FEE,
            sqrtPriceLimitX96: 0n,
          },
        ]);
        const short = await simulate(FILE, [
          "false",
          "false",
          String(ONE_THOUSAND_DAI),
          String(quoted + 1n),
          recipient,
        ]);
        assert.equal(short.ok, false);
        assert.match(String(short.reason), /Too little received/);

        const more = await simulate(FILE, ["false", "false", String(HELD + 1n), "0", recipient]);
        assert.equal(more.ok, false);
        assert.match(String(more.reason), /the DAI to spend is not in the Pot/);
      });
    });

    describe("Uniswap V3's PairFlash, as a flash swap through the Router", () => {
      const FILE = example("sauce-swaps", "uniswap-v3-pair-flash");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const ROUTER = named("UniswapV3_SwapRouter");
      const WETH_BALANCE = { slot: 3n };
      const ONE_WETH = 10n ** 18n;

      const quoteIn = async (
        tokenIn: Address,
        tokenOut: Address,
        amountIn: bigint,
        fee: number,
      ) => {
        const { result } = await env.publicClient.simulateContract({
          address: QUOTER,
          abi: abi.quoter,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
        });

        return result[0];
      };

      /** Someone else sells `amount` WETH into the 0.3% pool, so WETH is cheaper there than at 0.05%. */
      async function dumpWeth(amount: bigint): Promise<void> {
        const whale = env.account.address;
        await setBalance(env, WETH, WETH_BALANCE, whale, amount);
        for (const request of [
          { address: WETH, abi: abi.erc20, functionName: "approve", args: [ROUTER, amount] },
          {
            address: ROUTER,
            abi: abi.swapRouter,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: WETH,
                tokenOut: USDC,
                fee: 3000,
                recipient: whale,
                deadline: 2n ** 40n,
                amountIn: amount,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n,
              },
            ],
          },
        ] as const) {
          const hash = await env.walletClient.writeContract(request as never);
          assert.equal(
            (await env.publicClient.waitForTransactionReceipt({ hash })).status,
            "success",
          );
        }
      }

      it("borrows USDC from the 0.05% pool for 1 WETH, sells it back at 0.3%, repays and pays the profit", async () => {
        const [payer] = PEOPLE;
        await dumpWeth(1000n * ONE_WETH);
        // What the flash swap sends first, and what selling it back at 0.3% returns: both pools'
        // own quotes, the borrow pool's before the flash swap moves it.
        const borrowed = await quoteIn(WETH, USDC, ONE_WETH, 500);
        const back = await quoteIn(USDC, WETH, borrowed, 3000);
        assert.ok(back > ONE_WETH, "the trade above makes the cycle pay");
        const held = {
          usdc: await balanceOf(env, USDC, env.pot),
          weth: await balanceOf(env, WETH, env.pot),
        };

        const returned = await cook(FILE, [WETH, USDC, "500", String(ONE_WETH), "3000", payer]);
        assert.equal(BigInt(returned as string), back - ONE_WETH);
        assert.equal(await balanceOf(env, WETH, payer), back - ONE_WETH);
        // The Pot started with nothing of either and ends with nothing: the loan paid for itself.
        assert.deepEqual(
          {
            usdc: await balanceOf(env, USDC, env.pot),
            weth: await balanceOf(env, WETH, env.pot),
          },
          held,
        );
      });

      it("reverts, moving nothing, when selling back does not repay the borrow pool", async () => {
        const [payer] = PEOPLE;
        const rehearsal = await simulate(FILE, [
          WETH,
          USDC,
          "500",
          String(ONE_WETH),
          "3000",
          payer,
        ]);
        assert.equal(rehearsal.ok, false, "with no trade before it, the cycle loses both fees");
      });
    });
    describe("Uniswap V3's LiquidityExamples, the Pot keeping the position", () => {
      const FILE = example("sauce-protocols", "uniswap-v3-liquidity-examples");
      const DAI = named("Maker_Dai");
      const USDC = named("USDC");
      const MANAGER = named("UniswapV3_NonfungiblePositionManager");
      const ROUTER = named("UniswapV3_SwapRouter");
      const DAI_BALANCE = { slot: 2n };
      const USDC_BALANCE = { slot: 9n };
      const DAI_UNIT = 10n ** 18n;
      const USDC_UNIT = 10n ** 6n;

      interface Moved {
        tokenId: string;
        liquidity: string;
        amount0: string;
        amount1: string;
      }
      const step = async (args: readonly (string | bigint)[]): Promise<Moved> =>
        (await cook(FILE, args.map(String))) as Moved;
      const position = (tokenId: bigint) =>
        env.publicClient.readContract({
          address: MANAGER,
          abi: abi.positionManager,
          functionName: "positions",
          args: [tokenId],
        });
      const ownerOf = (tokenId: bigint) =>
        env.publicClient.readContract({
          address: MANAGER,
          abi: abi.positionManager,
          functionName: "ownerOf",
          args: [tokenId],
        });

      /** Someone else trades DAI and USDC both ways in the 0.3% pool: fees for the position. */
      async function trade(): Promise<void> {
        const trader = env.account.address;
        await setBalance(env, DAI, DAI_BALANCE, trader, 100n * DAI_UNIT);
        await setBalance(env, USDC, USDC_BALANCE, trader, 100n * USDC_UNIT);
        for (const [tokenIn, tokenOut, amountIn] of [
          [DAI, USDC, 100n * DAI_UNIT],
          [USDC, DAI, 100n * USDC_UNIT],
        ] as const) {
          for (const request of [
            { address: tokenIn, abi: abi.erc20, functionName: "approve", args: [ROUTER, amountIn] },
            {
              address: ROUTER,
              abi: abi.swapRouter,
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
            },
          ] as const) {
            const hash = await env.walletClient.writeContract(request as never);
            assert.equal(
              (await env.publicClient.waitForTransactionReceipt({ hash })).status,
              "success",
            );
          }
        }
      }

      it("mints into the Pot, adds, collects fees, takes half out and hands the NFT back", async () => {
        const [owner] = PEOPLE;
        const held = { dai: 5000n * DAI_UNIT, usdc: 5000n * USDC_UNIT };
        await setBalance(env, DAI, DAI_BALANCE, env.pot, held.dai);
        await setBalance(env, USDC, USDC_BALANCE, env.pot, held.usdc);

        // mintNewPosition: the NFT is the Pot's, the position holds what the mint says it took.
        const minted = await step([0n, 0n, 1000n * DAI_UNIT, 1000n * USDC_UNIT, owner]);
        const tokenId = BigInt(minted.tokenId);
        assert.equal(await ownerOf(tokenId), env.pot);
        assert.equal((await position(tokenId))[7], BigInt(minted.liquidity));
        assert.ok(BigInt(minted.liquidity) > 0n);
        assert.equal(await balanceOf(env, DAI, env.pot), held.dai - BigInt(minted.amount0));
        assert.equal(await balanceOf(env, USDC, env.pot), held.usdc - BigInt(minted.amount1));
        assert.equal(await allowance(env, DAI, env.pot, MANAGER), 0n);
        assert.equal(await allowance(env, USDC, env.pot, MANAGER), 0n);

        // increaseLiquidityCurrentRange: the position grows by what the call says it added.
        const added = await step([3n, tokenId, 500n * DAI_UNIT, 500n * USDC_UNIT, owner]);
        assert.equal(
          (await position(tokenId))[7],
          BigInt(minted.liquidity) + BigInt(added.liquidity),
        );

        // collectAllFees: what the position manager itself would pay the Pot, paid to the owner.
        await trade();
        const { result: owed } = await env.publicClient.simulateContract({
          account: env.pot,
          address: MANAGER,
          abi: abi.positionManager,
          functionName: "collect",
          args: [
            { tokenId, recipient: owner, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n },
          ],
        });
        assert.ok(owed[0] + owed[1] > 0n, "the trades paid the position fees");
        const fees = await step([1n, tokenId, 0n, 0n, owner]);
        assert.deepEqual([BigInt(fees.amount0), BigInt(fees.amount1)], [...owed]);
        assert.equal(await balanceOf(env, DAI, owner), owed[0]);
        assert.equal(await balanceOf(env, USDC, owner), owed[1]);

        // decreaseLiquidityInHalf: half the liquidity out, and the tokens it frees at the owner.
        const before = (await position(tokenId))[7];
        const halved = await step([2n, tokenId, 0n, 0n, owner]);
        assert.equal(BigInt(halved.liquidity), before / 2n);
        assert.equal((await position(tokenId))[7], before - before / 2n);
        assert.equal(await balanceOf(env, DAI, owner), owed[0] + BigInt(halved.amount0));
        assert.equal(await balanceOf(env, USDC, owner), owed[1] + BigInt(halved.amount1));

        // retrieveNFT: the position is the owner's.
        await step([4n, tokenId, 0n, 0n, owner]);
        assert.equal(await ownerOf(tokenId), owner);
      });
    });
  },
);
