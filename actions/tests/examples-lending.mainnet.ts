/**
 * The `sauce-protocols` skill's lending examples (`skills/sauce-protocols/examples`), EXECUTED: Aave
 * V3 credit delegation, a borrow on Compound III's USDC market and one on Morpho Blue's USDC market
 * against WETH, each program run as its header says, through the `sauce` command itself (`runCli`):
 * `simulate` for what `main` returns, then `run` to send the cook, on Ethereum's state captured at
 * its pinned block (`mainnet.ts`), through the released engine, Kitchen and Pot. No RPC is reached.
 *
 * Every result is held to something the program did not compute: Aave's aTokens, debt tokens and
 * delegation allowance; Comet's utilization, rates, balances and its own refusal of a borrow past
 * what the Pot may borrow, and CometRewards' record of what it paid; Morpho's position, market
 * totals and oracle; and the balances and allowances each run left.
 *
 * A group, not a suite of its own: `examples.mainnet.test.ts` registers it on the one anvil every
 * group reading `official-ethereum` shares, and a capture there writes all of their state.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  createWalletClient,
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
import { OWNER_KEY, REPO_ROOT, type Anvil } from "./anvil.js";
import { allowance, balanceOf, setBalance } from "./swap-venues.js";

const EXAMPLES = join(REPO_ROOT, "skills/sauce-protocols/examples");
const example = (name: string): string => join(EXAMPLES, `${name}.sauce.ts`);

/** The address a program compiled for Ethereum names `name` by: the SDK's own define for it. */
function named(name: string): Address {
  const value = routes.chainDefines(requireChain("ethereum"))[name];
  assert.equal(typeof value, "bigint", `${name} is not a name on ethereum`);

  return getAddress(toHex(value as bigint, { size: 20 }));
}

const USDC = named("USDC");
const WETH = named("WETH");
/** Where USDC and WETH keep `balanceOf` on Ethereum. */
const BALANCE_SLOT = { USDC: { slot: 9n }, WETH: { slot: 3n } } as const;
const ONE_WETH = 10n ** 18n;
const USDC_UNIT = 10n ** 6n;
const WAD = 10n ** 18n;
const SECONDS_PER_YEAR = 31_536_000n;
const MONTH = 30 * 86_400;

const abi = {
  erc20: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
  aave: parseAbi([
    "function getReserveAToken(address asset) view returns (address)",
    "function getReserveVariableDebtToken(address asset) view returns (address)",
    "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  ]),
  debtToken: parseAbi([
    "function borrowAllowance(address fromUser, address toUser) view returns (uint256)",
  ]),
  comet: parseAbi([
    "function getUtilization() view returns (uint256)",
    "function getSupplyRate(uint256 utilization) view returns (uint64)",
    "function getBorrowRate(uint256 utilization) view returns (uint64)",
    "function borrowBalanceOf(address account) view returns (uint256)",
    "function collateralBalanceOf(address account, address asset) view returns (uint128)",
    "function isBorrowCollateralized(address account) view returns (bool)",
    "function withdraw(address asset, uint256 amount)",
    "function baseTrackingBorrowSpeed() view returns (uint256)",
  ]),
  cometRewards: parseAbi([
    "function rewardsClaimed(address comet, address account) view returns (uint256)",
  ]),
  morpho: parseAbi([
    "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
    "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  ]),
  oracle: parseAbi(["function price() view returns (uint256)"]),
};

/** Anvil's dev accounts past the owner's: the borrower, then recipients. */
const BORROWER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PEOPLE: readonly Address[] = [
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e965cc0d6ec9c2f1ef8c",
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

/** Registers the group's tests on `anvil()`, which the entry starts before they run. */
export function register(anvil: () => Anvil): void {
  describe("the sauce-protocols lending examples, executed", () => {
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
    async function simulate(
      name: string,
      args: readonly string[],
    ): Promise<{ ok: boolean; returned?: unknown; reason?: string }> {
      const { code, stdout, stderr } = await sauce([
        ...["simulate", example(name), "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--owner", env.account.address, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.ok(stdout !== "", `simulate printed nothing (exit ${code}): ${stderr}`);

      return JSON.parse(stdout) as { ok: boolean; returned?: unknown; reason?: string };
    }

    /** `sauce run` of an example: the cook, signed by the owner and sent. Fails unless it lands. */
    async function run(name: string, args: readonly string[]): Promise<void> {
      const { code, stdout, stderr } = await sauce([
        ...["run", example(name), "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.equal(code, 0, `${stderr}\n${stdout}`);
      assert.equal((JSON.parse(stdout) as { cook: { status: string } }).cook.status, "success");
    }

    /** Simulates, then runs: `main`'s return as the rehearsal decoded it. */
    async function cook(name: string, args: readonly string[]): Promise<Record<string, string>> {
      const rehearsal = await simulate(name, args);
      assert.equal(rehearsal.ok, true, `the simulation reverts: ${rehearsal.reason}`);
      await run(name, args);

      return rehearsal.returned as Record<string, string>;
    }

    /** A refused cook: the rehearsal reverts with `reason`, and `sauce run` exits without a cook. */
    async function refuse(name: string, args: readonly string[], reason: RegExp): Promise<void> {
      const rehearsal = await simulate(name, args);
      assert.equal(rehearsal.ok, false, `${name} ran: ${JSON.stringify(rehearsal.returned)}`);
      assert.match(String(rehearsal.reason), reason);
      const { code, stdout, stderr } = await sauce([
        ...["run", example(name), "--chain", "ethereum", "--rpc-url", env.rpc],
        ...["--private-key", OWNER_KEY, "--salt-hex", POT_SALT, "--json"],
        ...["--args", ...args],
      ]);
      assert.notEqual(code, 0, `sauce run sent it:\n${stdout}`);
      assert.match(`${stderr}${stdout}`, reason);
    }

    const fund = (token: "USDC" | "WETH", holder: Address, amount: bigint) =>
      setBalance(env, token === "USDC" ? USDC : WETH, BALANCE_SLOT[token], holder, amount);

    /** Mines a block `seconds` on: the replay's anvil keeps its own block interval otherwise. */
    const passTime = async (seconds: number) => {
      const { timestamp } = await env.publicClient.getBlock();
      await env.testClient.setNextBlockTimestamp({ timestamp: timestamp + BigInt(seconds) });
      await env.testClient.mine({ blocks: 1 });
    };

    /**
     * What the rehearsal returned against what the run did: the run lands a block after the
     * rehearsal, so interest and rewards accrue a block longer there — never less, and a sliver.
     */
    const ranAsRehearsed = (rehearsed: string, actual: bigint, what: string) => {
      const value = BigInt(rehearsed);
      assert.ok(
        value <= actual && actual - value <= actual / 10_000n,
        `${what}: rehearsed ${value}, ran ${actual}`,
      );
    };

    describe("Aave V3 credit delegation: the Pot's WETH backs a borrower's USDC", () => {
      const POOL = named("AaveV3_Pool");
      const COLLATERAL = 10n * ONE_WETH;
      const CREDIT = 1_000n * USDC_UNIT;
      const LOAN = 600n * USDC_UNIT;

      const pool = <T>(functionName: string, args: readonly unknown[]): Promise<T> =>
        env.publicClient.readContract({
          address: POOL,
          abi: abi.aave,
          functionName,
          args,
        } as never) as Promise<T>;

      it("supplies, delegates, the borrower borrows in the Pot's name, the Pot repays and withdraws", async () => {
        const borrower = privateKeyToAccount(BORROWER_KEY);
        const [to] = PEOPLE;
        const debtToken = await pool<Address>("getReserveVariableDebtToken", [USDC]);
        const aWeth = await pool<Address>("getReserveAToken", [WETH]);
        const borrowAllowance = () =>
          env.publicClient.readContract({
            address: debtToken,
            abi: abi.debtToken,
            functionName: "borrowAllowance",
            args: [env.pot, borrower.address],
          });
        await fund("WETH", env.pot, COLLATERAL);

        // 1. The Pot supplies its WETH and delegates 1,000 USDC of credit.
        const opened = await cook("aave-delegate-credit", [
          borrower.address,
          String(COLLATERAL),
          String(CREDIT),
        ]);
        assert.equal(getAddress(opened.debtToken), debtToken);
        assert.equal(BigInt(opened.allowance), CREDIT);
        assert.equal(await borrowAllowance(), CREDIT, "the debt token records the delegation");
        const aWethHeld = await balanceOf(env, aWeth, env.pot);
        assert.ok(aWethHeld >= COLLATERAL - 1n, "the aWETH is the Pot's");
        ranAsRehearsed(opened.collateral, aWethHeld, "the Pot's aWETH");
        assert.equal(await balanceOf(env, debtToken, env.pot), 0n, "nothing is owed yet");
        assert.equal(await balanceOf(env, WETH, env.pot), 0n);

        // 2. The borrower borrows 600 USDC in the Pot's name, from its own wallet.
        await env.testClient.setBalance({ address: borrower.address, value: ONE_WETH });
        const wallet = createWalletClient({
          account: borrower,
          chain: env.chain,
          transport: http(env.rpc),
        });
        const held = await balanceOf(env, USDC, borrower.address);
        const hash = await wallet.writeContract({
          address: POOL,
          abi: abi.aave,
          functionName: "borrow",
          args: [USDC, LOAN, 2n, 0, env.pot],
        });
        const receipt = await env.publicClient.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success");
        assert.equal((await balanceOf(env, USDC, borrower.address)) - held, LOAN);
        assert.ok((await balanceOf(env, debtToken, env.pot)) >= LOAN, "the debt is the Pot's");
        // Aave takes the borrow off the allowance, rounding its own way by at most a unit.
        const left = await borrowAllowance();
        assert.ok(left <= CREDIT - LOAN && left >= CREDIT - LOAN - 1n, `the credit left: ${left}`);
        await assert.rejects(
          env.publicClient.simulateContract({
            account: borrower.address,
            address: POOL,
            abi: abi.aave,
            functionName: "borrow",
            args: [USDC, left + 1n, 2n, 0, env.pot],
          }),
          "Aave refuses a borrow past the credit left",
        );

        // 3. A month on, the borrower pays the loan back to the Pot, which repays the debt with its
        //    interest and takes its WETH out.
        await passTime(MONTH);
        await fund("USDC", env.pot, 20n * USDC_UNIT);
        const back = await wallet.writeContract({
          address: USDC,
          abi: abi.erc20,
          functionName: "transfer",
          args: [env.pot, LOAN],
        });
        await env.publicClient.waitForTransactionReceipt({ hash: back });
        const potUsdc = await balanceOf(env, USDC, env.pot);
        const toWeth = await balanceOf(env, WETH, to);
        const closed = await cook("aave-repay-delegated", [
          borrower.address,
          String(LOAN + 20n * USDC_UNIT),
          to,
        ]);
        const paid = potUsdc - (await balanceOf(env, USDC, env.pot));
        assert.ok(paid > LOAN, `the interest was repaid too, not only ${paid}`);
        ranAsRehearsed(closed.repaid, paid, "the USDC repaid");
        assert.equal(await balanceOf(env, debtToken, env.pot), 0n, "nothing is owed");
        assert.equal(await allowance(env, USDC, env.pot, POOL), 0n, "no allowance is left");
        assert.equal(await borrowAllowance(), 0n, "the delegation is revoked");
        assert.equal(await balanceOf(env, aWeth, env.pot), 0n, "no aWETH is left");
        const withdrawn = (await balanceOf(env, WETH, to)) - toWeth;
        assert.ok(withdrawn >= COLLATERAL, "the WETH came back with its interest");
        ranAsRehearsed(closed.withdrawn, withdrawn, "the WETH withdrawn");
      });

      it("refuses to repay a debt above maxRepay", async () => {
        const borrower = privateKeyToAccount(BORROWER_KEY);
        const [to] = PEOPLE;
        await fund("WETH", env.pot, COLLATERAL);
        await cook("aave-delegate-credit", [borrower.address, String(COLLATERAL), String(CREDIT)]);
        await env.testClient.setBalance({ address: borrower.address, value: ONE_WETH });
        const wallet = createWalletClient({
          account: borrower,
          chain: env.chain,
          transport: http(env.rpc),
        });
        const hash = await wallet.writeContract({
          address: POOL,
          abi: abi.aave,
          functionName: "borrow",
          args: [USDC, LOAN, 2n, 0, env.pot],
        });
        await env.publicClient.waitForTransactionReceipt({ hash });
        await fund("USDC", env.pot, 2n * LOAN);
        const refused = await simulate("aave-repay-delegated", [
          borrower.address,
          String(LOAN - 1n),
          to,
        ]);
        assert.equal(refused.ok, false);
        assert.match(String(refused.reason), /the debt is above maxRepay/);
      });
    });

    describe("Compound III's USDC market: WETH collateral, a borrow, repaid, COMP claimed", () => {
      const COMET = named("CompoundV3_CUSDCv3");
      /** COMP, and Compound's CometRewards on Ethereum, as Compound's deployments list them. */
      const COMP: Address = "0xc00e94Cb662C3520282E6f5717214004A7f26888";
      const REWARDS: Address = "0x1B0e765F6224C21223AeA2af16c1C46E38885a40";
      const LOAN = 1_000n * USDC_UNIT;

      const comet = <T>(functionName: string, args: readonly unknown[] = []): Promise<T> =>
        env.publicClient.readContract({
          address: COMET,
          abi: abi.comet,
          functionName,
          args,
        } as never) as Promise<T>;
      /** Whether Comet lets the Pot withdraw `amount` more USDC now: borrow it, past its supply. */
      const mayBorrow = (amount: bigint): Promise<boolean> =>
        env.publicClient
          .simulateContract({
            account: env.pot,
            address: COMET,
            abi: abi.comet,
            functionName: "withdraw",
            args: [USDC, amount],
          })
          .then(
            () => true,
            () => false,
          );

      it("reads the market, borrows within what Comet allows, repays all, withdraws and claims COMP", async () => {
        const [to] = PEOPLE;
        await fund("WETH", env.pot, ONE_WETH);
        const utilization = await comet<bigint>("getUtilization");
        const supplyRate = await comet<bigint>("getSupplyRate", [utilization]);
        const borrowRate = await comet<bigint>("getBorrowRate", [utilization]);
        const toUsdc = await balanceOf(env, USDC, to);

        // 1. The borrow, with the market's figures read on the way.
        const opened = await cook("compound-borrow", [String(ONE_WETH), String(LOAN), to]);
        assert.equal(BigInt(opened.utilization), utilization);
        assert.equal(BigInt(opened.supplyApr), supplyRate * SECONDS_PER_YEAR);
        assert.equal(BigInt(opened.borrowApr), borrowRate * SECONDS_PER_YEAR);
        assert.ok(borrowRate > supplyRate, "borrowers pay more than suppliers earn");
        assert.equal((await balanceOf(env, USDC, to)) - toUsdc, LOAN);
        assert.equal(await comet<bigint>("collateralBalanceOf", [env.pot, WETH]), ONE_WETH);
        const owed = await comet<bigint>("borrowBalanceOf", [env.pot]);
        assert.equal(BigInt(opened.owed), owed);
        assert.ok(owed >= LOAN && owed <= LOAN + 1n, `the Pot owes the loan, not ${owed}`);
        assert.equal(await comet<boolean>("isBorrowCollateralized", [env.pot]), true);
        // What the program said the Pot could borrow is what Comet lets it borrow: what is left of
        // it after the loan is allowed, and one USDC more is not.
        const left = BigInt(opened.borrowable) - LOAN;
        assert.ok(left > USDC_UNIT, `a 1 WETH collateral backs more than 1,000 USDC: ${left}`);
        assert.equal(await mayBorrow(left - USDC_UNIT / 100n), true, "Comet lends what is left");
        assert.equal(await mayBorrow(left + USDC_UNIT), false, "and refuses one USDC more");

        // 2. A month on, the Pot repays with its interest, takes its WETH out and claims its COMP.
        await passTime(MONTH);
        await fund("USDC", env.pot, LOAN + 50n * USDC_UNIT);
        const potUsdc = await balanceOf(env, USDC, env.pot);
        const toWeth = await balanceOf(env, WETH, to);
        const toComp = await balanceOf(env, COMP, to);
        // Below what is owed now, the repay is refused and nothing moves.
        const owing = await comet<bigint>("borrowBalanceOf", [env.pot]);
        assert.ok(owing > LOAN, `a month's interest accrued: ${owing}`);
        const before = [owing, potUsdc, await allowance(env, USDC, env.pot, COMET), toWeth];
        await refuse("compound-repay", [REWARDS, String(LOAN), to], /the debt is above maxRepay/);
        assert.deepEqual(
          [
            await comet<bigint>("borrowBalanceOf", [env.pot]),
            await balanceOf(env, USDC, env.pot),
            await allowance(env, USDC, env.pot, COMET),
            await balanceOf(env, WETH, to),
          ],
          before,
        );
        assert.equal(await comet<bigint>("collateralBalanceOf", [env.pot, WETH]), ONE_WETH);
        const closed = await cook("compound-repay", [REWARDS, String(LOAN + 50n * USDC_UNIT), to]);
        const paid = potUsdc - (await balanceOf(env, USDC, env.pot));
        assert.ok(paid > LOAN, `the interest was repaid too, not only ${paid}`);
        ranAsRehearsed(closed.repaid, paid, "the USDC repaid");
        assert.equal(await comet<bigint>("borrowBalanceOf", [env.pot]), 0n, "nothing is owed");
        assert.equal(await allowance(env, USDC, env.pot, COMET), 0n, "no allowance is left");
        assert.equal(await comet<bigint>("collateralBalanceOf", [env.pot, WETH]), 0n);
        assert.equal((await balanceOf(env, WETH, to)) - toWeth, ONE_WETH);
        assert.equal(BigInt(closed.withdrawn), ONE_WETH);
        assert.equal(getAddress(closed.rewardToken), COMP);
        const claimed = (await balanceOf(env, COMP, to)) - toComp;
        const recorded = await env.publicClient.readContract({
          address: REWARDS,
          abi: abi.cometRewards,
          functionName: "rewardsClaimed",
          args: [COMET, env.pot],
        });
        assert.equal(claimed, recorded, "what arrived is what CometRewards records it paid");
        ranAsRehearsed(closed.claimed, claimed, "the COMP claimed");
        // At the pinned block the market pays no COMP for borrowing: the claim runs, and pays the
        // nothing CometRewards records.
        assert.equal(await comet<bigint>("baseTrackingBorrowSpeed"), 0n);
        assert.equal(claimed, 0n);
      });

      it("refuses to borrow more than the collateral allows", async () => {
        const [to] = PEOPLE;
        await fund("WETH", env.pot, ONE_WETH);
        const refused = await simulate("compound-borrow", [
          String(ONE_WETH),
          String(1_000_000n * USDC_UNIT),
          to,
        ]);
        assert.equal(refused.ok, false);
        assert.match(String(refused.reason), /amount is above what the Pot may borrow/);
      });
    });

    describe("Morpho Blue's USDC market against WETH at an 86% LLTV", () => {
      const MORPHO = named("MorphoBlue_Morpho");
      /** The market's id, as Morpho lists it. */
      const ID = "0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd" as Hex;
      const LOAN = 1_000n * USDC_UNIT;
      const VIRTUAL_SHARES = 1_000_000n;

      const morpho = <T>(functionName: string, args: readonly unknown[]): Promise<T> =>
        env.publicClient.readContract({
          address: MORPHO,
          abi: abi.morpho,
          functionName,
          args,
        } as never) as Promise<T>;

      it("supplies WETH, borrows USDC, reads the position and its health, repays every share", async () => {
        const [to] = PEOPLE;
        const [loanToken, collateralToken, oracle, , lltv] = await morpho<
          readonly [Address, Address, Address, Address, bigint]
        >("idToMarketParams", [ID]);
        assert.deepEqual([loanToken, collateralToken], [USDC, WETH]);
        assert.equal(lltv, 860_000_000_000_000_000n);
        await fund("WETH", env.pot, ONE_WETH);
        const toUsdc = await balanceOf(env, USDC, to);

        // 1. The borrow, and the position as the program reads it back.
        const opened = await cook("morpho-borrow", [ID, String(ONE_WETH), String(LOAN), to]);
        assert.equal((await balanceOf(env, USDC, to)) - toUsdc, LOAN);
        const [, borrowShares, collateral] = await morpho<readonly [bigint, bigint, bigint]>(
          "position",
          [ID, env.pot],
        );
        assert.equal(collateral, ONE_WETH);
        assert.equal(BigInt(opened.collateral), ONE_WETH);
        const totals = await morpho<readonly bigint[]>("market", [ID]);
        const shares = totals[3] + VIRTUAL_SHARES;
        const borrowed = (borrowShares * (totals[2] + 1n) + shares - 1n) / shares;
        assert.equal(BigInt(opened.borrowed), borrowed, "the debt Morpho's shares stand for");
        assert.ok(borrowed >= LOAN && borrowed <= LOAN + 1n, `owes the loan, not ${borrowed}`);
        const price = await env.publicClient.readContract({
          address: oracle,
          abi: abi.oracle,
          functionName: "price",
        });
        const maxBorrow = (((collateral * price) / 10n ** 36n) * lltv) / WAD;
        assert.equal(BigInt(opened.maxBorrow), maxBorrow, "priced by the market's oracle");
        assert.equal(BigInt(opened.healthFactor), (maxBorrow * WAD) / borrowed);
        assert.ok(BigInt(opened.healthFactor) > WAD, "a healthy position");

        // 2. A month on, every share repaid with the interest, and the WETH taken out.
        await passTime(MONTH);
        await fund("USDC", env.pot, LOAN + 20n * USDC_UNIT);
        const potUsdc = await balanceOf(env, USDC, env.pot);
        const toWeth = await balanceOf(env, WETH, to);
        // Below what is owed now, the repay is refused and nothing moves.
        const held = await morpho<readonly bigint[]>("position", [ID, env.pot]);
        const before = [held, potUsdc, await allowance(env, USDC, env.pot, MORPHO), toWeth];
        await refuse("morpho-repay", [ID, String(LOAN), to], /the debt is above maxRepay/);
        assert.deepEqual(
          [
            await morpho<readonly bigint[]>("position", [ID, env.pot]),
            await balanceOf(env, USDC, env.pot),
            await allowance(env, USDC, env.pot, MORPHO),
            await balanceOf(env, WETH, to),
          ],
          before,
        );
        const closed = await cook("morpho-repay", [ID, String(LOAN + 20n * USDC_UNIT), to]);
        const paid = potUsdc - (await balanceOf(env, USDC, env.pot));
        assert.ok(paid > LOAN, `the interest was repaid too, not only ${paid}`);
        ranAsRehearsed(closed.repaid, paid, "the USDC repaid");
        assert.equal(BigInt(closed.sharesRepaid), borrowShares, "every share");
        assert.deepEqual(
          await morpho<readonly bigint[]>("position", [ID, env.pot]),
          [0n, 0n, 0n],
          "nothing is left of the position",
        );
        assert.equal(await allowance(env, USDC, env.pot, MORPHO), 0n, "approved exactly the debt");
        assert.equal((await balanceOf(env, WETH, to)) - toWeth, ONE_WETH);
        assert.equal(BigInt(closed.withdrawn), ONE_WETH);
      });

      it("refuses a market id Morpho does not know", async () => {
        const [to] = PEOPLE;
        const refused = await simulate("morpho-borrow", [
          `0x${"ab".repeat(32)}`,
          "0",
          String(LOAN),
          to,
        ]);
        assert.equal(refused.ok, false);
        assert.match(String(refused.reason), /no Morpho Blue market has that id/);
      });
    });
  });
}
