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
import {
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain, routes } from "../../sdk/dist/index.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { OWNER_KEY, REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { allowance, balanceOf, NATIVE, setBalance } from "./swap-venues.js";

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
  aave: parseAbi([
    "function getReserveAToken(address asset) view returns (address)",
    "function getReserveVariableDebtToken(address asset) view returns (address)",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  ]),
  debtToken: parseAbi([
    "function borrowAllowance(address fromUser, address toUser) view returns (uint256)",
  ]),
  comet: parseAbi([
    "struct AssetInfo { uint8 offset; address asset; address priceFeed; uint64 scale; uint64 borrowCollateralFactor; uint64 liquidateCollateralFactor; uint64 liquidationFactor; uint128 supplyCap; }",
    "function getUtilization() view returns (uint256)",
    "function getSupplyRate(uint256) view returns (uint64)",
    "function getBorrowRate(uint256) view returns (uint64)",
    "function getPrice(address) view returns (uint256)",
    "function baseTokenPriceFeed() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function totalBorrow() view returns (uint256)",
    "function baseTrackingSupplySpeed() view returns (uint64)",
    "function baseTrackingBorrowSpeed() view returns (uint64)",
    "function baseIndexScale() pure returns (uint64)",
    "function baseScale() view returns (uint256)",
    "function numAssets() view returns (uint8)",
    "function getAssetInfo(uint8) view returns (AssetInfo)",
    "function getAssetInfoByAddress(address) view returns (AssetInfo)",
    "function totalsCollateral(address) view returns (uint128 totalSupplyAsset, uint128 _reserved)",
    "function userCollateral(address, address) view returns (uint128 balance, uint128 _reserved)",
    "function borrowBalanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]),
  morpho: parseAbi([
    "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
    "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
    "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
    "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
    "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
    "function price() view returns (uint256)",
  ]),
  v4Quoter: parseAbi([
    "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
  ]),
  permit2: parseAbi([
    "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  ]),
  balancer: parseAbi([
    "struct BatchSwapStep { bytes32 poolId; uint256 assetInIndex; uint256 assetOutIndex; uint256 amount; bytes userData; }",
    "struct FundManagement { address sender; bool fromInternalBalance; address recipient; bool toInternalBalance; }",
    "function queryBatchSwap(uint8 kind, BatchSwapStep[] swaps, address[] assets, FundManagement funds) returns (int256[])",
    "struct JoinPoolRequest { address[] assets; uint256[] maxAmountsIn; bytes userData; bool fromInternalBalance; }",
    "function joinPool(bytes32 poolId, address sender, address recipient, JoinPoolRequest request) payable",
    "function create(string name, string symbol, address[] tokens, uint256[] normalizedWeights, address[] rateProviders, uint256 swapFeePercentage, address owner, bytes32 salt) returns (address)",
    "function getPoolId() view returns (bytes32)",
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
    describe("Aave's credit delegation, on Aave V3", () => {
      const FILE = example("sauce-protocols", "aave-v3-credit-delegation");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const POOL = named("AaveV3_Pool");
      const WETH_BALANCE = { slot: 3n };
      const USDC_BALANCE = { slot: 9n };
      const TEN_WETH = 10n * 10n ** 18n;
      const LOAN = 1000n * 10n ** 6n;
      /** The borrower: anvil's second dev account, which signs its own borrow. */
      const BORROWER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

      const reserve = (
        functionName: "getReserveAToken" | "getReserveVariableDebtToken",
        asset: Address,
      ) =>
        env.publicClient.readContract({
          address: POOL,
          abi: abi.aave,
          functionName,
          args: [asset],
        });

      it("supplies, delegates, the borrower borrows on the Pot's credit, the Pot repays and withdraws", async () => {
        const borrower = privateKeyToAccount(BORROWER_KEY);
        const [, owner] = PEOPLE;
        const aWeth = await reserve("getReserveAToken", WETH);
        const usdcDebt = await reserve("getReserveVariableDebtToken", USDC);
        await setBalance(env, WETH, WETH_BALANCE, env.pot, TEN_WETH);

        // depositCollateral: the Pot's WETH supplied, its aTokens the Pot's.
        assert.equal(
          BigInt((await cook(FILE, ["0", WETH, String(TEN_WETH), owner])) as string),
          TEN_WETH,
        );
        const supplied = await balanceOf(env, aWeth, env.pot);
        assert.ok(supplied >= TEN_WETH - 1n && supplied <= TEN_WETH, `aWETH ${supplied}`);
        assert.equal(await balanceOf(env, WETH, env.pot), 0n);

        // approveBorrower: the debt token records the allowance.
        await cook(FILE, ["1", USDC, String(LOAN), borrower.address]);
        assert.equal(
          await env.publicClient.readContract({
            address: usdcDebt,
            abi: abi.debtToken,
            functionName: "borrowAllowance",
            args: [env.pot, borrower.address],
          }),
          LOAN,
        );

        // The borrower borrows on the Pot's credit, from its own wallet: the debt is the Pot's.
        const wallet = createWalletClient({
          account: borrower,
          chain: env.walletClient.chain,
          transport: http(env.rpc),
        });
        const hash = await wallet.writeContract({
          address: POOL,
          abi: abi.aave,
          functionName: "borrow",
          args: [USDC, LOAN, 2n, 0, env.pot],
        });
        assert.equal(
          (await env.publicClient.waitForTransactionReceipt({ hash })).status,
          "success",
        );
        assert.equal(await balanceOf(env, USDC, borrower.address), LOAN);
        const debt = await balanceOf(env, usdcDebt, env.pot);
        assert.ok(debt >= LOAN, `the Pot owes ${debt}`);

        // repayBorrower: more than is owed, so all of it; the debt is gone, the rest stays.
        await setBalance(env, USDC, USDC_BALANCE, env.pot, 2n * LOAN);
        // The rehearsal ran a block before the cook, so the cook repaid that block's interest too.
        const rehearsed = BigInt(
          (await cook(FILE, ["2", USDC, String(2n * LOAN), owner])) as string,
        );
        const repaid = 2n * LOAN - (await balanceOf(env, USDC, env.pot));
        assert.ok(
          repaid >= rehearsed && repaid - rehearsed < 1000n,
          `repaid ${repaid}, rehearsed ${rehearsed}`,
        );
        assert.ok(repaid >= debt && repaid < LOAN + LOAN / 1000n, `repaid ${repaid}`);
        assert.equal(await balanceOf(env, usdcDebt, env.pot), 0n);
        assert.equal(await allowance(env, USDC, env.pot, POOL), 0n);

        // withdrawCollateral: every aToken redeemed, the WETH to the owner.
        const rehearsedOut = BigInt((await cook(FILE, ["3", WETH, "0", owner])) as string);
        const withdrawn = await balanceOf(env, WETH, owner);
        assert.ok(withdrawn >= rehearsedOut && withdrawn >= supplied, `withdrew ${withdrawn}`);
        assert.equal(await balanceOf(env, aWeth, env.pot), 0n);
      });
    });
    describe("Compound's MyContract, on Compound III's USDC market", () => {
      const FILE = example("sauce-protocols", "compound-v3-my-contract");
      const COMET = named("CompoundV3_CUSDCv3");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const WETH_BALANCE = { slot: 3n };
      const USDC_BALANCE = { slot: 9n };
      /** COMP, and Compound's CometRewards on Ethereum, as Compound's docs list them. */
      const COMP: Address = "0xc00e94Cb662C3520282E6f5717214004A7f26888";
      const REWARDS: Address = "0x1B0e765F6224C21223AeA2af16c1C46E38885a40";
      const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

      interface Market {
        moved: string;
        supplyApr: string;
        borrowApr: string;
        rewardAprForSupplyBase: string;
        rewardAprForBorrowBase: string;
        borrowable: string;
        borrowCollateralFactor: string;
        liquidateCollateralFactor: string;
        price: string;
        rewardsOwed: string;
        tvl: string;
      }
      const read = <T>(
        functionName: string,
        args: readonly unknown[] = [],
        address: Address = COMET,
      ): Promise<T> =>
        env.publicClient.readContract({
          address,
          abi: abi.comet,
          functionName,
          args,
        } as never) as Promise<T>;

      /** What MyContract's views compute, read off the Comet here, for the Pot. */
      async function expected(asset: Address, rewardFeed: Address) {
        const utilization = await read<bigint>("getUtilization");
        const baseFeed = await read<Address>("baseTokenPriceFeed");
        const basePrice = await read<bigint>("getPrice", [baseFeed]);
        const rewardPrice = await read<bigint>("getPrice", [rewardFeed]);
        const perDay = async (speed: string) =>
          (await read<bigint>(speed)) *
          86400n *
          ((await read<bigint>("baseIndexScale")) / (await read<bigint>("baseScale")));
        const info = await read<{
          priceFeed: Address;
          borrowCollateralFactor: bigint;
          liquidateCollateralFactor: bigint;
        }>("getAssetInfoByAddress", [asset]);
        let tvl =
          ((await read<bigint>("totalSupply")) * basePrice) /
          10n ** BigInt(await read<number>("decimals"));
        for (let i = 0; i < (await read<number>("numAssets")); i++) {
          const each = await read<{ asset: Address; priceFeed: Address }>("getAssetInfo", [i]);
          const [supplied] = await read<[bigint, bigint]>("totalsCollateral", [each.asset]);
          const decimals = await read<number>("decimals", [], each.asset);
          tvl +=
            (supplied * (await read<bigint>("getPrice", [each.priceFeed]))) /
            10n ** BigInt(decimals);
        }
        return {
          supplyApr: (await read<bigint>("getSupplyRate", [utilization])) * SECONDS_PER_YEAR * 100n,
          borrowApr: (await read<bigint>("getBorrowRate", [utilization])) * SECONDS_PER_YEAR * 100n,
          rewardAprForSupplyBase:
            ((rewardPrice * (await perDay("baseTrackingSupplySpeed"))) /
              ((await read<bigint>("totalSupply")) * basePrice)) *
            365n,
          rewardAprForBorrowBase:
            ((rewardPrice * (await perDay("baseTrackingBorrowSpeed"))) /
              ((await read<bigint>("totalBorrow")) * basePrice)) *
            365n,
          borrowCollateralFactor: info.borrowCollateralFactor,
          liquidateCollateralFactor: info.liquidateCollateralFactor,
          price: await read<bigint>("getPrice", [info.priceFeed]),
          tvl,
        };
      }

      it("reads the market as MyContract's views do, supplies WETH, borrows, repays in full, claims", async () => {
        const rewardFeed = (await read<{ priceFeed: Address }>("getAssetInfoByAddress", [COMP]))
          .priceFeed;
        const args = (step: number, asset: Address, amount: bigint) => [
          String(step),
          COMET,
          asset,
          String(amount),
          REWARDS,
          rewardFeed,
        ];
        const asNumbers = (market: Market) =>
          Object.fromEntries(Object.entries(market).map(([k, v]) => [k, BigInt(v)]));

        // Step 0, simulated: every view, as the Comet's own reads give it.
        const viewed = await simulate(FILE, args(0, WETH, 0n));
        assert.equal(viewed.ok, true, viewed.reason);
        const market = asNumbers(viewed.returned as Market);
        assert.deepEqual(
          { ...market, moved: undefined, borrowable: undefined, rewardsOwed: undefined },
          {
            ...(await expected(WETH, rewardFeed)),
            moved: undefined,
            borrowable: undefined,
            rewardsOwed: undefined,
          },
        );
        assert.equal(market.borrowable, 0n);

        // supply: 10 WETH of collateral, what the Pot can borrow its value at the factor.
        const tenWeth = 10n * 10n ** 18n;
        await setBalance(env, WETH, WETH_BALANCE, env.pot, tenWeth);
        const supplied = asNumbers((await cook(FILE, args(1, WETH, tenWeth))) as Market);
        assert.equal(supplied.moved, tenWeth);
        assert.equal((await read<[bigint, bigint]>("userCollateral", [env.pot, WETH]))[0], tenWeth);
        const collateralUsd =
          (((tenWeth * market.price) / 10n ** 8n) * market.borrowCollateralFactor) / 10n ** 18n;
        assert.equal(supplied.borrowable, collateralUsd);

        // withdraw past nothing supplied: a 1,000 USDC borrow, the Pot's limit less the debt.
        const loan = 1000n * 10n ** 6n;
        await cook(FILE, args(2, USDC, loan));
        assert.equal(await balanceOf(env, USDC, env.pot), loan);
        const owed = await read<bigint>("borrowBalanceOf", [env.pot]);
        assert.ok(owed >= loan, `owes ${owed}`);
        const after = asNumbers((await simulate(FILE, args(0, USDC, 0n))).returned as Market);
        const basePrice = await read<bigint>("getPrice", [
          await read<Address>("baseTokenPriceFeed"),
        ]);
        const debtUsd = (owed * basePrice) / 10n ** 8n;
        // The borrow, read at the present index as a negative principal: within a unit of rounding.
        assert.ok(
          after.borrowable <= collateralUsd - debtUsd + 1n &&
            after.borrowable >= collateralUsd - debtUsd - 1n,
          `borrowable ${after.borrowable}, expected about ${collateralUsd - debtUsd}`,
        );

        // repayFullBorrow: the whole debt, from more USDC than it needs, no allowance left.
        await setBalance(env, USDC, USDC_BALANCE, env.pot, 2n * loan);
        await cook(FILE, args(3, USDC, 0n));
        assert.equal(await read<bigint>("borrowBalanceOf", [env.pot]), 0n);
        const repaid = 2n * loan - (await balanceOf(env, USDC, env.pot));
        assert.ok(repaid >= owed && repaid < loan + loan / 1000n, `repaid ${repaid}`);
        assert.equal(await allowance(env, USDC, env.pot, COMET), 0n);

        // claimCometRewards: whatever the Pot is owed arrives in COMP.
        const claimed = asNumbers((await cook(FILE, args(4, USDC, 0n))) as Market);
        assert.equal(await balanceOf(env, COMP, env.pot), claimed.moved);
      });
    });
    describe("Morpho's snippets, on Morpho Blue's USDC market with WETH collateral", () => {
      const FILE = example("sauce-protocols", "morpho-blue-snippets");
      const MORPHO = named("MorphoBlue_Morpho");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const WETH_BALANCE = { slot: 3n };
      const USDC_BALANCE = { slot: 9n };
      /** The USDC market with WETH collateral at an 86% LLTV, by Morpho's id. */
      const ID = "0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd" as Hex;
      const USDC_UNIT = 10n ** 6n;
      const WAD = 10n ** 18n;

      interface Snippet {
        assets: string;
        shares: string;
        supplyApy: string;
        borrowApy: string;
        supplied: string;
        borrowed: string;
        collateral: string;
        totalSupply: string;
        totalBorrow: string;
        healthFactor: string;
      }
      const position = async () => {
        const [supplyShares, borrowShares, collateral] = await env.publicClient.readContract({
          address: MORPHO,
          abi: abi.morpho,
          functionName: "position",
          args: [ID, env.pot],
        });

        return { supplyShares, borrowShares, collateral };
      };
      const step = async (n: number, amount: bigint, receiver: Address) =>
        (await cook(FILE, [String(n), ID, String(amount), receiver])) as Snippet;

      it("supplies, takes collateral, borrows, repays and withdraws each way, and reads the position", async () => {
        const [receiver] = PEOPLE;
        await setBalance(env, USDC, USDC_BALANCE, env.pot, 5000n * USDC_UNIT);
        await setBalance(env, WETH, WETH_BALANCE, env.pot, WAD);
        const usdc = () => balanceOf(env, USDC, env.pot);

        // supply, then supplyCollateral: Morpho records both for the Pot.
        await step(1, 1000n * USDC_UNIT, receiver);
        assert.equal(await usdc(), 4000n * USDC_UNIT);
        assert.ok((await position()).supplyShares > 0n);
        await step(2, WAD, receiver);
        assert.equal((await position()).collateral, WAD);
        assert.equal(await allowance(env, USDC, env.pot, MORPHO), 0n);
        assert.equal(await allowance(env, WETH, env.pot, MORPHO), 0n);

        // borrow: 500 USDC to the receiver, a debt on the Pot.
        await step(8, 500n * USDC_UNIT, receiver);
        assert.equal(await balanceOf(env, USDC, receiver), 500n * USDC_UNIT);

        // The views, read with nothing changed: Morpho's own position, the oracle and the IRM.
        const viewed = await simulate(FILE, ["0", ID, "0", receiver]);
        assert.equal(viewed.ok, true, viewed.reason);
        const views = Object.fromEntries(
          Object.entries(viewed.returned as Snippet).map(([k, v]) => [k, BigInt(v)]),
        );
        assert.equal(views.collateral, WAD);
        assert.ok(views.borrowed >= 500n * USDC_UNIT && views.borrowed < 501n * USDC_UNIT);
        const [loanToken, collateralToken, oracle, irm, lltv] = await env.publicClient.readContract(
          {
            address: MORPHO,
            abi: abi.morpho,
            functionName: "idToMarketParams",
            args: [ID],
          },
        );
        const price = await env.publicClient.readContract({
          address: oracle,
          abi: abi.morpho,
          functionName: "price",
        });
        const maxBorrow = (((WAD * price) / 10n ** 36n) * lltv) / WAD;
        assert.equal(views.healthFactor, (maxBorrow * WAD) / views.borrowed);
        const [
          totalSupplyAssets,
          totalSupplyShares,
          totalBorrowAssets,
          totalBorrowShares,
          lastUpdate,
          fee,
        ] = await env.publicClient.readContract({
          address: MORPHO,
          abi: abi.morpho,
          functionName: "market",
          args: [ID],
        });
        const rate = await env.publicClient.readContract({
          address: irm,
          abi: abi.morpho,
          functionName: "borrowRateView",
          args: [
            { loanToken, collateralToken, oracle, irm, lltv },
            {
              totalSupplyAssets,
              totalSupplyShares,
              totalBorrowAssets,
              totalBorrowShares,
              lastUpdate,
              fee,
            },
          ],
        });
        const first = rate * 365n * 86400n;
        const apy =
          first +
          (first * first) / (2n * WAD) +
          (((first * first) / (2n * WAD)) * first) / (3n * WAD);
        // The program accrued the interest since the market's last update first, which moves the
        // rate a little: within 1%.
        assert.ok(
          views.borrowApy * 100n >= apy * 99n && views.borrowApy * 100n <= apy * 101n,
          `${views.borrowApy} vs ${apy}`,
        );
        assert.ok(views.supplyApy > 0n && views.supplyApy < views.borrowApy);
        assert.ok(views.totalSupply >= totalSupplyAssets && views.totalBorrow >= totalBorrowAssets);

        // repayAmount, repay50Percent, repayAmountOrAll (more than owed: all of it).
        await step(9, 100n * USDC_UNIT, receiver);
        const owedShares = (await position()).borrowShares;
        await step(10, 0n, receiver);
        assert.equal((await position()).borrowShares, owedShares - owedShares / 2n);
        await step(12, 10_000n * USDC_UNIT, receiver);
        assert.equal((await position()).borrowShares, 0n);
        assert.equal(await allowance(env, USDC, env.pot, MORPHO), 0n);

        // repayAll, on a second borrow.
        await step(8, 200n * USDC_UNIT, receiver);
        await step(11, 0n, receiver);
        assert.equal((await position()).borrowShares, 0n);

        // withdrawAmount, withdraw50Percent, withdrawAmountOrAll (more than supplied: all of it).
        const paidOut = await balanceOf(env, USDC, receiver);
        await step(4, 100n * USDC_UNIT, receiver);
        assert.equal(await balanceOf(env, USDC, receiver), paidOut + 100n * USDC_UNIT);
        const suppliedShares = (await position()).supplyShares;
        await step(5, 0n, receiver);
        assert.equal((await position()).supplyShares, suppliedShares - suppliedShares / 2n);
        await step(7, 10_000n * USDC_UNIT, receiver);
        assert.equal((await position()).supplyShares, 0n);

        // withdrawAll, on a second supply; then withdrawCollateral.
        await step(1, 100n * USDC_UNIT, receiver);
        await step(6, 0n, receiver);
        assert.equal((await position()).supplyShares, 0n);
        await step(3, WAD, receiver);
        assert.equal((await position()).collateral, 0n);
        assert.equal(await balanceOf(env, WETH, receiver), WAD);
      });
    });
    describe("Uniswap V4's swap guide, through the Universal Router", () => {
      const FILE = example("sauce-swaps", "uniswap-v4-swap");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const ROUTER = named("UniswapV4_UniversalRouter");
      const PERMIT2 = named("Permit2_Permit2");
      const USDC_BALANCE = { slot: 9n };
      /** Uniswap's V4Quoter on Ethereum: what the swap is held to. */
      const V4_QUOTER: Address = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203";
      const KEY = {
        currency0: USDC,
        currency1: WETH,
        fee: 500,
        tickSpacing: 10,
        hooks: "0x0000000000000000000000000000000000000000" as Address,
      };
      const AMOUNT_IN = 1000n * 10n ** 6n;

      it("approves through Permit2 and sells 1,000 USDC for WETH in the 0.05% pool, as the quoter quotes", async () => {
        const held = 3000n * 10n ** 6n;
        await setBalance(env, USDC, USDC_BALANCE, env.pot, held);
        const { result } = await env.publicClient.simulateContract({
          address: V4_QUOTER,
          abi: abi.v4Quoter,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: KEY, zeroForOne: true, exactAmount: AMOUNT_IN, hookData: "0x" }],
        });
        const quoted = result[0];
        assert.ok(quoted > 0n);

        const key = JSON.stringify({ ...KEY, fee: KEY.fee, tickSpacing: KEY.tickSpacing });
        const returned = await cook(FILE, [key, String(AMOUNT_IN), String(quoted)]);
        assert.equal(BigInt(returned as string), quoted);
        assert.equal(await balanceOf(env, WETH, env.pot), quoted);
        assert.equal(await balanceOf(env, USDC, env.pot), held - AMOUNT_IN);
        // Both approvals were exactly what the swap spent: nothing stands after it.
        assert.equal(await allowance(env, USDC, env.pot, PERMIT2), 0n);
        const [left] = await env.publicClient.readContract({
          address: PERMIT2,
          abi: abi.permit2,
          functionName: "allowance",
          args: [env.pot, USDC, ROUTER],
        });
        assert.equal(left, 0n);
      });

      it("refuses a minimum the pool cannot meet", async () => {
        await setBalance(env, USDC, USDC_BALANCE, env.pot, AMOUNT_IN);
        const { result } = await env.publicClient.simulateContract({
          address: V4_QUOTER,
          abi: abi.v4Quoter,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: KEY, zeroForOne: true, exactAmount: AMOUNT_IN, hookData: "0x" }],
        });
        const rehearsal = await simulate(FILE, [
          JSON.stringify(KEY),
          String(AMOUNT_IN),
          String(result[0] + 1n),
        ]);
        assert.equal(rehearsal.ok, false);
      });
    });
    describe("Balancer's batch swap examples, through the V2 Vault", () => {
      const FILE = example("sauce-swaps", "balancer-v2-batch-swap");
      const VAULT = named("BalancerV2_Vault");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
      const USDC_BALANCE = { slot: 9n };
      /** Balancer's 50/50 USDC/WETH and WBTC/WETH pools on Ethereum. */
      const USDC_WETH = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
      const WBTC_WETH = "0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e" as Hex;
      const HELD = 5000n * 10n ** 6n;

      /** What the Vault's own `queryBatchSwap` says the same steps move, by asset: + in, - out. */
      async function query(givenOut: boolean, amount: bigint): Promise<readonly bigint[]> {
        const step = (poolId: Hex, assetInIndex: bigint, assetOutIndex: bigint, value: bigint) => ({
          poolId,
          assetInIndex,
          assetOutIndex,
          amount: value,
          userData: "0x" as Hex,
        });
        const swaps = givenOut
          ? [step(WBTC_WETH, 1n, 2n, amount), step(USDC_WETH, 0n, 1n, 0n)]
          : [step(USDC_WETH, 0n, 1n, amount), step(WBTC_WETH, 1n, 2n, 0n)];
        const { result } = await env.publicClient.simulateContract({
          address: VAULT,
          abi: abi.balancer,
          functionName: "queryBatchSwap",
          args: [
            givenOut ? 1 : 0,
            swaps,
            [USDC, WETH, WBTC],
            {
              sender: env.pot,
              fromInternalBalance: false,
              recipient: env.pot,
              toInternalBalance: false,
            },
          ],
        });

        return result;
      }
      const args = (givenOut: boolean, amount: bigint, limit: bigint, recipient: Address) => [
        String(givenOut),
        USDC_WETH,
        WBTC_WETH,
        USDC,
        WETH,
        WBTC,
        String(amount),
        String(limit),
        recipient,
      ];
      interface Swapped {
        paid: string;
        received: string;
      }

      it("given in (Example 1): sells 1,000 USDC for WBTC through WETH, as the Vault quotes", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, USDC_BALANCE, env.pot, HELD);
        const amount = 1000n * 10n ** 6n;
        const deltas = await query(false, amount);
        const out = -deltas[2];
        const returned = (await cook(FILE, args(false, amount, out, recipient))) as Swapped;
        assert.deepEqual([BigInt(returned.paid), BigInt(returned.received)], [amount, out]);
        assert.equal(await balanceOf(env, WBTC, recipient), out);
        assert.equal(await balanceOf(env, USDC, env.pot), HELD - amount);
      });

      it("given out (Example 2): buys 0.001 WBTC with at most 1% over the quote, the rest kept", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, USDC_BALANCE, env.pot, HELD);
        const amount = 100_000n; // 0.001 WBTC, 8 decimals
        const deltas = await query(true, amount);
        const maxIn = (deltas[0] * 101n) / 100n;
        const returned = (await cook(FILE, args(true, amount, maxIn, recipient))) as Swapped;
        assert.deepEqual([BigInt(returned.paid), BigInt(returned.received)], [deltas[0], amount]);
        assert.equal(await balanceOf(env, WBTC, recipient), amount);
        assert.equal(await balanceOf(env, USDC, env.pot), HELD - deltas[0]);
        assert.equal(await allowance(env, USDC, env.pot, VAULT), 0n);
      });

      it("refuses a limit the pools cannot meet", async () => {
        const [recipient] = PEOPLE;
        await setBalance(env, USDC, USDC_BALANCE, env.pot, HELD);
        const amount = 1000n * 10n ** 6n;
        const out = -(await query(false, amount))[2];
        const rehearsal = await simulate(FILE, args(false, amount, out + 1n, recipient));
        assert.equal(rehearsal.ok, false);
        assert.match(String(rehearsal.reason), /BAL#507/);
      });
    });
    describe("Balancer's flash swap, through the V2 Vault", () => {
      const FILE = example("sauce-swaps", "balancer-v2-flash-swap");
      const VAULT = named("BalancerV2_Vault");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const USDC_BALANCE = { slot: 9n };
      const WETH_BALANCE = { slot: 3n };
      /** Balancer's 50/50 USDC/WETH pool on Ethereum, and its weighted pool factory. */
      const USDC_WETH = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
      const FACTORY: Address = "0x897888115Ada5773E02aA29F775430BFB5F34c51";
      const ONE_WETH = 10n ** 18n;

      async function send(request: unknown): Promise<void> {
        const hash = await env.walletClient.writeContract(request as never);
        assert.equal(
          (await env.publicClient.waitForTransactionReceipt({ hash })).status,
          "success",
        );
      }

      /**
       * The guide's second pool, planted: a 50/50 USDC/WETH pool where WETH costs 2,900 USDC. The
       * factory is disabled at the pinned block (`_disabled`, its slot 1), so it is enabled first.
       */
      async function plantDearPool(): Promise<Hex> {
        const owner = env.account.address;
        await env.testClient.setStorageAt({
          address: FACTORY,
          index: toHex(1n, { size: 32 }),
          value: toHex(0n, { size: 32 }),
        });
        const created = [
          "Dear WETH",
          "DEAR",
          [USDC, WETH],
          [5n * 10n ** 17n, 5n * 10n ** 17n],
          [NATIVE, NATIVE],
          3n * 10n ** 15n,
          owner,
          toHex(1n, { size: 32 }),
        ] as const;
        const { result: pool } = await env.publicClient.simulateContract({
          account: env.account,
          address: FACTORY,
          abi: abi.balancer,
          functionName: "create",
          args: created,
        });
        await send({ address: FACTORY, abi: abi.balancer, functionName: "create", args: created });
        const poolId = await env.publicClient.readContract({
          address: pool,
          abi: abi.balancer,
          functionName: "getPoolId",
        });
        const amounts = [290_000n * 10n ** 6n, 100n * ONE_WETH] as const;
        await setBalance(env, USDC, USDC_BALANCE, owner, amounts[0]);
        await setBalance(env, WETH, WETH_BALANCE, owner, amounts[1]);
        await send({
          address: USDC,
          abi: abi.erc20,
          functionName: "approve",
          args: [VAULT, amounts[0]],
        });
        await send({
          address: WETH,
          abi: abi.erc20,
          functionName: "approve",
          args: [VAULT, amounts[1]],
        });
        await send({
          address: VAULT,
          abi: abi.balancer,
          functionName: "joinPool",
          args: [
            poolId,
            owner,
            owner,
            {
              assets: [USDC, WETH],
              maxAmountsIn: [...amounts],
              // A weighted pool's first join: INIT (0) with each token's amount.
              userData: encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256[]" }],
                [0n, [...amounts]],
              ),
              fromInternalBalance: false,
            },
          ],
        });

        return poolId;
      }

      const profitOf = async (sellPool: Hex, buyPool: Hex): Promise<bigint> => {
        const { result } = await env.publicClient.simulateContract({
          address: VAULT,
          abi: abi.balancer,
          functionName: "queryBatchSwap",
          args: [
            0,
            [
              {
                poolId: sellPool,
                assetInIndex: 0n,
                assetOutIndex: 1n,
                amount: ONE_WETH,
                userData: "0x",
              },
              { poolId: buyPool, assetInIndex: 1n, assetOutIndex: 0n, amount: 0n, userData: "0x" },
            ],
            [WETH, USDC],
            {
              sender: env.pot,
              fromInternalBalance: false,
              recipient: env.pot,
              toInternalBalance: false,
            },
          ],
        });

        return -result[0];
      };

      it("sells 1 WETH where it is dear and buys it back where it is cheap, holding nothing", async () => {
        const [recipient] = PEOPLE;
        const dear = await plantDearPool();
        const profit = await profitOf(dear, USDC_WETH);
        assert.ok(profit > 0n, "the planted pool prices WETH above Balancer's own");
        const returned = await cook(FILE, [
          dear,
          USDC_WETH,
          WETH,
          USDC,
          String(ONE_WETH),
          recipient,
        ]);
        assert.equal(BigInt(returned as string), profit);
        assert.equal(await balanceOf(env, WETH, recipient), profit);
        assert.equal(await balanceOf(env, WETH, env.pot), 0n);
        assert.equal(await balanceOf(env, USDC, env.pot), 0n);
      });

      it("reverts the other way round, which would cost the Pot WETH it has not offered", async () => {
        const [recipient] = PEOPLE;
        const dear = await plantDearPool();
        const rehearsal = await simulate(FILE, [
          USDC_WETH,
          dear,
          WETH,
          USDC,
          String(ONE_WETH),
          recipient,
        ]);
        assert.equal(rehearsal.ok, false);
        assert.match(String(rehearsal.reason), /BAL#507/);
      });
    });
    describe("Pendle's router samples, on its wstETH market", () => {
      const FILE = example("sauce-protocols", "pendle-router-sample");
      const ROUTER = named("Pendle_Router");
      const WSTETH = named("Lido_WstETH");
      const WSTETH_BALANCE = { slot: 0n };
      /** Pendle's wstETH market on Ethereum, expiring at the end of 2027. */
      const MARKET = getAddress("0x34280882267ffa6383b363e278b027be083bbe3b");
      const ONE = 10n ** 18n;
      const HELD = 3n * ONE;
      const pendleAbi = parseAbi([
        "function readTokens() view returns (address sy, address pt, address yt)",
      ]);

      const roundTrips = [
        // The least share of the wstETH each round trip pays back: YT's leverage costs more (a
        // fifth, at the pinned block).
        [1, "buys PT and sells it back", 98n],
        [2, "buys YT and sells it back", 75n],
        [3, "zaps into the market's liquidity and out", 98n],
        [4, "mints SY and redeems it", 98n],
        [5, "mints PT and YT and redeems them", 98n],
      ] as const;
      for (const [step, what, percent] of roundTrips) {
        it(`step ${step} ${what}: wstETH back, nothing else left, no allowance`, async () => {
          const [sy, pt, yt] = await env.publicClient.readContract({
            address: MARKET,
            abi: pendleAbi,
            functionName: "readTokens",
          });
          await setBalance(env, WSTETH, WSTETH_BALANCE, env.pot, HELD);
          const legs = (await cook(FILE, [
            String(step),
            MARKET,
            WSTETH,
            String(ONE),
            String((ONE * percent) / 100n),
          ])) as {
            out: string;
            back: string;
          };
          assert.ok(BigInt(legs.out) > 0n, "the first leg bought something");
          const back = (await balanceOf(env, WSTETH, env.pot)) - (HELD - ONE);
          assert.ok(back >= (ONE * percent) / 100n && back <= ONE, `wstETH back: ${back}`);
          for (const [name, token] of [
            ["SY", sy],
            ["PT", pt],
            ["YT", yt],
            ["LP", MARKET],
          ] as const)
            assert.equal(await balanceOf(env, token, env.pot), 0n, `${name} left in the Pot`);
          for (const token of [WSTETH, sy, pt, yt, MARKET]) {
            assert.equal(await allowance(env, token, env.pot, ROUTER), 0n);
          }
        });
      }

      it("step 6 zaps in with no price impact, keeping the YT it mints", async () => {
        const [, , yt] = await env.publicClient.readContract({
          address: MARKET,
          abi: pendleAbi,
          functionName: "readTokens",
        });
        await setBalance(env, WSTETH, WSTETH_BALANCE, env.pot, HELD);
        const legs = (await cook(FILE, ["6", MARKET, WSTETH, String(ONE), "0"])) as {
          out: string;
          back: string;
        };
        assert.ok(BigInt(legs.out) > 0n && BigInt(legs.back) > 0n);
        assert.equal(await balanceOf(env, MARKET, env.pot), BigInt(legs.out));
        assert.equal(await balanceOf(env, yt, env.pot), BigInt(legs.back));
        assert.equal(await balanceOf(env, WSTETH, env.pot), HELD - ONE);
      });

      it("refuses a round trip that pays back less than minBack", async () => {
        await setBalance(env, WSTETH, WSTETH_BALANCE, env.pot, HELD);
        const rehearsal = await simulate(FILE, ["1", MARKET, WSTETH, String(ONE), String(ONE)]);
        assert.equal(rehearsal.ok, false);
      });
    });
  },
);
