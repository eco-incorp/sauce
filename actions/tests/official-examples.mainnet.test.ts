/**
 * The protocols' own examples, ported to Sauce (`skills/sauce-swaps/examples` and
 * `skills/sauce-protocols/examples`, each header naming the official file it ports), EXECUTED: each
 * program run as its header says, through the `sauce` command itself (`runCli`): `simulate` for
 * what `main` returns, then `run` to send the cook, on Ethereum's state captured at its pinned block
 * (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. No RPC is reached.
 *
 * Every result is held to something the program did not compute: the swap to Uniswap's own
 * V4Quoter on the same pool, the lending to the protocol's own reads, and each to the balances it
 * moved.
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

const abi = {
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

    describe("Compound's MyContract, on Compound III's USDC market", () => {
      const FILE = example("sauce-protocols", "compound-v3-my-contract");
      const COMET = named("CompoundV3_CUSDCv3");
      const USDC = named("USDC");
      const WETH = named("WETH");
      const WETH_BALANCE = { slot: 3n };
      const USDC_BALANCE = { slot: 9n };
      /** COMP, and Compound's CometRewards on Ethereum, as Compound's docs list them. */
      const COMP: Address = "0xc00e94Cb662C3520282E6f5717214004A7f26888";
      /** WBTC, a collateral of the market with 8 decimals, beside WETH's 18 and USDC's 6. */
      const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
      const WBTC_BALANCE = { slot: 0n };
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

        // What a collateral balance lets the Pot borrow, in USD with 8 decimals, from the Comet's
        // own reads: the balance at its asset's price over its asset's scale, at its factor.
        const borrowingValue = async (asset: Address, balance: bigint): Promise<bigint> => {
          const info = await read<{
            priceFeed: Address;
            scale: bigint;
            borrowCollateralFactor: bigint;
          }>("getAssetInfoByAddress", [asset]);
          const price = await read<bigint>("getPrice", [info.priceFeed]);

          return (((balance * price) / info.scale) * info.borrowCollateralFactor) / 10n ** 18n;
        };

        // supply: 10 WETH (18 decimals), then 0.5 WBTC (8), the Pot's limit their two values.
        const tenWeth = 10n * 10n ** 18n;
        await setBalance(env, WETH, WETH_BALANCE, env.pot, tenWeth);
        const supplied = asNumbers((await cook(FILE, args(1, WETH, tenWeth))) as Market);
        assert.equal(supplied.moved, tenWeth);
        assert.equal((await read<[bigint, bigint]>("userCollateral", [env.pot, WETH]))[0], tenWeth);
        assert.equal(supplied.borrowable, await borrowingValue(WETH, tenWeth));
        const halfWbtc = 5n * 10n ** 7n;
        await setBalance(env, WBTC, WBTC_BALANCE, env.pot, halfWbtc);
        const both = asNumbers((await cook(FILE, args(1, WBTC, halfWbtc))) as Market);
        assert.equal(
          (await read<[bigint, bigint]>("userCollateral", [env.pot, WBTC]))[0],
          halfWbtc,
        );
        const collateralUsd =
          (await borrowingValue(WETH, tenWeth)) + (await borrowingValue(WBTC, halfWbtc));
        assert.equal(both.borrowable, collateralUsd);

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
        // The debt in USDC (6 decimals), at USDC's price over the base's own scale.
        const debtUsd = (owed * basePrice) / (await read<bigint>("baseScale"));
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
  },
);
