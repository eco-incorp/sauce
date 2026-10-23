/**
 * The `sauce-cli` skill's programs, run by the `sauce` command as the skill runs them, on a local
 * Base: the released gated stack at its release addresses (`cli-anvil.ts`), Uniswap's own V3
 * factory and pools (`@uniswap/v3-core`) where Base's `UniswapV3.Factory` stands, and canonical
 * Permit2 (`fixtures/cli/Permit2.json`). Nothing is forked and nothing reaches a network.
 *
 * The pools: WETH/USDC at 0.05%, 2,650 USDC per WETH with the most liquidity, and at 0.3%, 2,653 with
 * less. The tokens are OpenZeppelin ERC-20s at Base's USDC and WETH addresses, so WETH is token0, as
 * on Base, and the command names them by the registry's symbols and decimals.
 *
 * `buy.sauce.ts`: compiled, its arguments and return type read back; rehearsed with an assumed
 * balance, its record return decoded and what moved listed; refused with each guard's reason;
 * stopped at its price limit with the rest of the budget returned; rehearsed with a keyless
 * `--fund`, and on an earlier `--block`, where it chooses another pool; its unsigned `sauce tx`
 * sent by a wallet; sent by `sauce run` from a wallet, on a funded Pot and with `--fund`; and read
 * back by `sauce inspect --source`. `payout.sauce.ts`: a JSON array of records as its argument, the
 * Pot's measured USDC split by weight with the remainder to the last payee, and the weights' guard.
 *
 * The manual's quick start, `docs/examples/pay.sauce.ts`, runs here too: its header's `sauce
 * simulate` and `sauce run` lines for Base, as written, from the wallet `me` the page makes, the
 * Pot deployed when the run asks and paying from what the page has its reader send it. So does the
 * program its second tutorial builds, `docs/examples/pay-list.sauce.ts`: its header's two lines,
 * from the same wallet, a list of two recipients and a limit that pays only the first.
 *
 * The examples are checked through returned values, token movements and transaction results,
 * without pinning illustrative terminal wording or gas measurements.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  encodeFunctionData,
  getAddress,
  hexToBytes,
  maxUint256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { v12PredictPot } from "../src/deployments/pot.js";
import { addressOn, getDescriptor } from "../src/descriptors/query.js";
import { sqrtPriceX96FromPrice } from "../src/price.js";
import {
  CLI_FIXTURES,
  DEPLOYER,
  deployPot,
  describeEvm,
  fixture,
  jsonOf,
  OWNER as KEYED,
  registered,
  sauceWith,
  startChain,
  type LocalChain,
  type Run,
} from "./cli-anvil.js";
import { FACTORY, LIQUIDITY, POOL } from "./pools-anvil.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "../../skills/sauce-cli/examples");
/** The programs, by the path the command prints back: relative, as a reader runs them. */
const BUY = relative(process.cwd(), join(EXAMPLES, "buy.sauce.ts"));
const PAYOUT = relative(process.cwd(), join(EXAMPLES, "payout.sauce.ts"));

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const PAYEE_A: Address = "0x7777777777777777777777777777777777777777";
const PAYEE_B: Address = "0x8888888888888888888888888888888888888888";
/** What the skill's runs pass: 2,700 USDC per WETH, the limit `sauce price` gives buying WETH. */
const LIMIT = "4116816085950893928074568";
const BUDGET = "100000000"; // 100 USDC
const MIN_OUT = "37000000000000000"; // 0.037 WETH
const PAIR = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };

describeEvm("the sauce-cli skill's programs, run by the command on a local Base", () => {
  let base: LocalChain;
  let work: string;
  let usdc: Address;
  let weth: Address;
  let liquidity: Address;
  /** The two pools, by fee. */
  const pools = new Map<number, Address>();
  /** The wallet `sauce wallet new` made, its Pot, and the owner a keyless rehearsal names. */
  let wallet: Address;
  let pot: Address;
  const OWNER = getAddress("0x5a0Ce00000000000000000000000000000000a9e");
  const ownerPot = getAddress(v12PredictPot(OWNER) as Address);
  /** The chain as `beforeAll` leaves it, for each quoted rehearsal to start from. */
  let snapshot: Hex;

  // A throwaway password, as an agent's .env would hold one.
  const password = `throwaway-${process.pid}-${Date.now()}`;
  const readEnv = (name: string) => (name === "SAUCE_WALLET_PASSWORD" ? password : undefined);
  const SIGNER = ["--wallet", "agent", "--password-env", "SAUCE_WALLET_PASSWORD"];
  /** The command, with the wallet directory and a terminal that agrees to what it is asked. */
  const sauce = (...argv: string[]): Promise<Run> =>
    sauceWith(
      { readEnv, walletsDir: join(work, "wallets"), canAsk: () => true, confirm: async () => true },
      ...argv,
    );
  const rpc = (): string[] => ["--rpc-url", base.rpcUrl];
  /** `buy.sauce.ts`'s arguments, as the skill passes them unless a test says otherwise. */
  const buyArgs = (more: { budget?: string; minOut?: string } = {}): string[] => [
    "--args",
    weth,
    more.budget ?? BUDGET,
    LIMIT,
    more.minOut ?? MIN_OUT,
    RECIPIENT,
  ];
  const simulateBuy = (...flags: string[]): Promise<Run> =>
    sauce("simulate", BUY, "--chain", "base", "--owner", OWNER, ...rpc(), ...flags);
  const fresh = async (): Promise<void> => {
    await base.testClient.revert({ id: snapshot });
    snapshot = await base.testClient.snapshot();
  };
  // A gas limit of its own rather than an estimate: an estimate is made against the pending block,
  // and a liquidity mint mined a moment later may need more than it, as `pools-anvil.ts` found —
  // the setup then reverted now and then.
  const call = async (to: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
    const hash = await base.deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to,
      data: encodeFunctionData({ abi, functionName, args }),
      gas: 15_000_000n,
    });
    const { status } = await base.publicClient.waitForTransactionReceipt({ hash });
    if (status !== "success") throw new Error(`${functionName} on ${to} reverted`);
  };
  const sqrtAt = (usdcPerWeth: string): bigint => sqrtPriceX96FromPrice(usdcPerWeth, PAIR);
  const tickOf = (sqrtPriceX96: bigint): number =>
    Math.floor(Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(Math.sqrt(1.0001)));
  /** The record `buy.sauce.ts` returns, from a rehearsal's JSON. */
  const bought = (run: Run) =>
    jsonOf(run).returned as { pool: Address; spent: string; bought: string };

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-examples-"));
    base = await startChain("base");
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    weth = await base.plant(fixture("MockERC20"), registered(base.chain, "WETH"));
    for (const token of [usdc, weth]) await base.mint(token, DEPLOYER.address, 10n ** 30n);

    // The pools, created and initialized by Uniswap's own factory, and their liquidity minted
    // through `PoolsLiquidity`, which later moves a pool's price with a swap of its own.
    const deployed = async (creationCode: Hex): Promise<Address> => {
      const hash = await base.deployer.sendTransaction({
        account: DEPLOYER,
        chain: null,
        data: creationCode,
      });
      return (await base.publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    liquidity = await deployed(LIQUIDITY.creationCode);
    const approve = parseAbi(["function approve(address, uint256) returns (bool)"]);
    for (const token of [usdc, weth])
      await call(token, approve, "approve", [liquidity, maxUint256]);
    const factory = await deployed(FACTORY.bytecode);
    for (const [fee, spacing, price, amount] of [
      [500, 10, "2650", 10n ** 17n],
      [3000, 60, "2653", 2n * 10n ** 16n],
    ] as const) {
      await call(factory, FACTORY.abi, "createPool", [weth, usdc, fee]);
      const pool = getAddress(
        (await base.publicClient.readContract({
          address: factory,
          abi: FACTORY.abi,
          functionName: "getPool",
          args: [weth, usdc, fee],
        })) as Address,
      );
      await call(pool, POOL.abi, "initialize", [sqrtAt(price)]);
      const at = Math.floor(tickOf(sqrtAt(price)) / spacing) * spacing;
      await call(liquidity, LIQUIDITY.abi, "mint", [pool, at - 1200, at + 1200, amount]);
      pools.set(fee, pool);
    }
    // The factory's code and storage where Base's stands, so `UniswapV3.Factory.getPool` in the
    // program finds the pools.
    const dumped = JSON.parse(
      new TextDecoder().decode(gunzipSync(hexToBytes(await base.testClient.dumpState()))),
    ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
    const state = dumped.accounts[factory.toLowerCase()]!;
    const atBase = getAddress(addressOn(getDescriptor("uniswap-v3", "Factory")!, base.chain)!);
    await base.testClient.setCode({ address: atBase, bytecode: state.code });
    for (const [index, value] of Object.entries(state.storage)) {
      await base.testClient.setStorageAt({ address: atBase, index: index as Hex, value });
    }
    const permit2 = JSON.parse(readFileSync(join(CLI_FIXTURES, "Permit2.json"), "utf8")) as {
      address: Address;
      runtime: Hex;
    };
    await base.testClient.setCode({ address: permit2.address, bytecode: permit2.runtime });

    // The agent's wallet, as the skill makes it, with gas money and USDC of its own.
    const created = jsonOf(
      await sauce("wallet", "new", "agent", "--password-env", "SAUCE_WALLET_PASSWORD", "--json"),
    );
    wallet = getAddress(created.address as string);
    pot = getAddress(v12PredictPot(wallet) as Address);
    await base.send(base.deployer, wallet, "0x", parseEther("1"));
    await base.mint(usdc, wallet, 2_000_000_000n);
    snapshot = await base.testClient.snapshot();
  }, 180_000);

  afterAll(async () => {
    await base?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  describe("buy.sauce.ts", () => {
    it("compiles for Base: main's arguments, its return type, USDC and the factory it names", async () => {
      expect(readFileSync(BUY, "utf8").split("\n")[0]).toBe("#!/usr/bin/env -S sauce simulate");
      const out = jsonOf(await sauce("compile", BUY, "--chain", "base", "--json"));
      expect(out.entryParams).toEqual([
        { name: "token", type: "Address" },
        { name: "budget", type: "Uint256" },
        { name: "sqrtPriceLimitX96", type: "Uint256" },
        { name: "minOut", type: "Uint256" },
        { name: "recipient", type: "Address" },
      ]);
      expect(out.returnType).toBe("{ pool: Address; spent: Uint256; bought: Uint256 }");
      expect(out.defines).toEqual([expect.objectContaining({ name: "USDC", value: usdc })]);
      expect(out.contracts).toEqual([
        expect.objectContaining({
          reference: "UniswapV3.Factory",
          address: getAddress(addressOn(getDescriptor("uniswap-v3", "Factory")!, base.chain)!),
        }),
      ]);
      // The limit the skill passes is the one `sauce price` prints for buying WETH at 2,700.
      const price = await sauce("price", "--chain", "base", "2700", "USDC", "per", "WETH");
      expect(price.stdout).toMatch(
        new RegExp(`Buying WETH[^\\n]*\\n  sqrtPriceLimitX96  ${LIMIT}`),
      );
    }, 120_000);

    it("rehearses with an assumed balance: the record main returns, and what the cook moved", async () => {
      await fresh();
      const run = await simulateBuy("--assume-balance", "USDC:100", ...buyArgs());
      expect(run.code).toBe(0);
      const json = await simulateBuy("--assume-balance", "USDC:100", "--json", ...buyArgs());
      // The deepest pool, all of the budget, and at least minOut: 100 USDC at 2,650 less the fee.
      expect(bought(json)).toEqual({
        pool: pools.get(500),
        spent: BUDGET,
        bought: "37716248833222607",
      });
      // Nothing was sent: the Pot is still not deployed, and the recipient has nothing.
      expect(await base.publicClient.getCode({ address: ownerPot })).toBeUndefined();
      expect(await base.balanceOf(weth, RECIPIENT)).toBe(0n);
    }, 120_000);

    it("names the guard a cook fails: minOut above what fills, a budget not in the Pot", async () => {
      await fresh();
      const short = await simulateBuy(
        "--assume-balance",
        "USDC:100",
        ...buyArgs({ minOut: "40000000000000000" }),
      );
      expect(short.code).toBe(1);
      const empty = await simulateBuy(...buyArgs());
      expect(empty.code).toBe(1);
      expect(empty.stdout).toMatch(
        /^The cook reverts: the program threw "the budget is not in the Pot"$/m,
      );
    }, 120_000);

    it("stops at the price limit, and sends the rest of the budget back with what it bought", async () => {
      await fresh();
      const run = await simulateBuy(
        "--assume-balance",
        "USDC:100000",
        "--json",
        ...buyArgs({ budget: "100000000000", minOut: "0" }),
      );
      const out = bought(run);
      expect(out.pool).toBe(pools.get(500));
      // The 0.05% pool reached 2,700 USDC per WETH having taken part of the budget.
      expect(BigInt(out.spent)).toBeLessThan(100_000_000_000n);
      expect(BigInt(out.spent)).toBeGreaterThan(10_000_000_000n);
      const transfers = jsonOf(run).transfers as {
        token: Address;
        from: Address;
        to: Address;
        amount: string;
      }[];
      expect(transfers).toContainEqual(
        expect.objectContaining({
          token: usdc,
          from: ownerPot,
          to: RECIPIENT,
          amount: (100_000_000_000n - BigInt(out.spent)).toString(),
        }),
      );
    }, 120_000);

    it("--fund with no key credits the Pot what the pull would bring", async () => {
      await fresh();
      const run = await simulateBuy("--fund", "USDC:100", "--json", ...buyArgs());
      expect(bought(run)).toMatchObject({ spent: BUDGET, bought: "37716248833222607" });
      expect(jsonOf(run).assumed).toContainEqual(
        expect.objectContaining({ holder: ownerPot, token: usdc, amount: BUDGET }),
      );
    }, 120_000);

    it("--block rehearses an earlier block: before the 0.05% pool reached the limit", async () => {
      await fresh();
      // Uncached: viem serves a block number up to 4 s old, which can predate the suite's setup.
      const before = (await base.publicClient.getBlockNumber({ cacheTime: 0 })).toString();
      // Someone buys WETH on the 0.05% pool up to 2,700 USDC per WETH.
      await call(liquidity, LIQUIDITY.abi, "swap", [
        pools.get(500),
        false,
        100_000_000_000n,
        BigInt(LIMIT),
      ]);
      const now = bought(await simulateBuy("--assume-balance", "USDC:100", "--json", ...buyArgs()));
      expect(now.pool).toBe(pools.get(3000));
      const then = await simulateBuy(
        ...["--block", before, "--assume-balance", "USDC:100", "--json"],
        ...buyArgs(),
      );
      expect(jsonOf(then).block).toBe(before);
      expect(bought(then)).toEqual({
        pool: pools.get(500),
        spent: BUDGET,
        bought: "37716248833222607",
      });
    }, 120_000);

    it("`sauce tx` prints the unsigned cook, and the owner who sends it buys", async () => {
      await fresh();
      // An owner whose key the test holds, its Pot deployed and holding the budget.
      const keyedPot = await deployPot(base, KEYED.address);
      await base.mint(usdc, keyedPot, 100_000_000n);
      const tx = jsonOf(
        await sauce("tx", BUY, "--chain", "base", "--owner", KEYED.address, ...rpc(), ...buyArgs()),
      );
      expect(Object.keys(tx)).toEqual(["chainId", "to", "data", "value", "sendCalls"]);
      expect(tx).toMatchObject({ chainId: 8453, to: keyedPot });
      // Sent as printed, by any signer: here the test's own client.
      await base.send(base.owner, tx.to as Address, tx.data as Hex, BigInt(tx.value as string));
      expect(await base.balanceOf(weth, RECIPIENT)).toBe(37_716_248_833_222_607n);
      expect(await base.balanceOf(usdc, keyedPot)).toBe(0n);
    }, 120_000);

    it("`sauce run` buys from the wallet's funded Pot, and `sauce inspect` reads it back", async () => {
      await fresh();
      expect((await sauce("pot", "--deploy", "--chain", "base", ...rpc(), ...SIGNER)).code).toBe(0);
      // Funded as the skill says: the budget sent to the Pot's address.
      await base.mint(usdc, pot, 100_000_000n);
      const run = await sauce("run", BUY, "--chain", "base", ...rpc(), ...SIGNER, ...buyArgs());
      expect(run.code).toBe(0);
      const hash = /^cook (0x[0-9a-f]{64}): success/m.exec(run.stdout)![1]!;
      expect(await base.balanceOf(usdc, pot)).toBe(0n);
      const inspected = await sauce("inspect", hash, "--chain", "base", ...rpc(), "--source", BUY);
      expect(inspected.code).toBe(0);
    }, 120_000);

    it("`sauce run --fund` pulls the budget from the wallet into its Pot in the same cook", async () => {
      await fresh();
      // Rehearsed with the wallet's key before the first run: the approval of Permit2 that run
      // will ask for runs first, in the cook's block, and the pull with it; nothing is sent.
      const keyed = (): Promise<Run> =>
        sauce(
          ...["simulate", BUY, "--chain", "base", ...rpc(), ...SIGNER],
          ...["--fund", "USDC:100", "--json", ...buyArgs()],
        );
      const unapproved = await keyed();
      expect(unapproved.code).toBe(0);
      expect(unapproved.stderr).toContain(
        "USDC: Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) may not move your tokens yet: " +
          "sauce run asks to approve it first (--yes approves it), and the simulation runs " +
          "that approval before the cook",
      );
      expect(
        (jsonOf(unapproved).transactions as Array<{ step: string; what?: string }>).map(
          (each) => each.what ?? each.step,
        ),
      ).toEqual(["deployPot", "approve Permit2 for USDC", "cook"]);
      expect(jsonOf(unapproved).transfers).toContainEqual(
        expect.objectContaining({ token: usdc, from: wallet, to: pot, amount: BUDGET }),
      );
      expect(await base.balanceOf(usdc, wallet)).toBe(2_000_000_000n);
      const run = await sauce(
        ...["run", BUY, "--chain", "base", ...rpc(), ...SIGNER, "--fund", "USDC:100"],
        ...buyArgs(),
      );
      expect(run.code).toBe(0);
      // The Pot deployed and Permit2 approved first, each asked for; then the cook.
      expect(run.stdout).toMatch(/^deployed Pot 0x[0-9a-fA-F]{40} in 0x[0-9a-f]{64}: success/m);
      expect(run.stdout).toMatch(/^approve USDC to 0x[0-9a-fA-F]{40} 0x[0-9a-f]{64}: success/m);
      expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
      expect(await base.balanceOf(usdc, wallet)).toBe(1_900_000_000n);
      expect(await base.balanceOf(weth, RECIPIENT)).toBe(37_716_248_833_222_607n);
      // Approved now, the keyed rehearsal signs the pull and runs it: from the wallet, into its Pot.
      const signed = await keyed();
      expect(jsonOf(signed).transfers).toContainEqual(
        expect.objectContaining({ token: usdc, from: wallet, to: pot, amount: BUDGET }),
      );
      expect(bought(signed).spent).toBe(BUDGET);
      expect(await base.balanceOf(usdc, wallet)).toBe(1_900_000_000n);
    }, 120_000);
  });

  describe("payout.sauce.ts", () => {
    const payees = (a: number, b: number): string =>
      JSON.stringify([
        { to: PAYEE_A, bps: a },
        { to: PAYEE_B, bps: b },
      ]);

    it("takes a JSON array of records, and returns what each payee was paid", async () => {
      await fresh();
      const run = await sauce(
        ...["simulate", PAYOUT, "--chain", "base", "--owner", OWNER, ...rpc()],
        ...["--assume-balance", "USDC:1000", "--args", payees(7000, 3000), "--json"],
      );
      expect(run.code).toBe(0);
      expect(jsonOf(run).returned).toEqual(["700000000", "300000000"]);
      const refused = await sauce(
        ...["simulate", PAYOUT, "--chain", "base", "--owner", OWNER, ...rpc()],
        ...["--assume-balance", "USDC:1000", "--args", payees(7000, 2000)],
      );
      expect(refused.code).toBe(1);
    }, 120_000);

    it("pays out what --fund brought, the rounding remainder to the last payee", async () => {
      await fresh();
      const run = await sauce(
        ...["run", PAYOUT, "--chain", "base", ...rpc(), ...SIGNER],
        ...["--fund", "USDC:250.000001", "--args", payees(7000, 3000)],
      );
      expect(run.code).toBe(0);
      expect(await base.balanceOf(usdc, PAYEE_A)).toBe(175_000_000n);
      expect(await base.balanceOf(usdc, PAYEE_B)).toBe(75_000_001n);
      expect(await base.balanceOf(usdc, pot)).toBe(0n);
      expect(await base.balanceOf(usdc, wallet)).toBe(2_000_000_000n - 250_000_001n);
    }, 120_000);
  });

  /** The quick start's wallet, `me`, made as the page makes it: its password from a variable here,
   *  where the page's reader types it at the prompt. Made once, funded with gas, and kept in the
   *  snapshot, for every page of the manual that runs from it. */
  const PASSWORD = ["--password-env", "SAUCE_WALLET_PASSWORD"];
  let quickStartWallet: Address | undefined;
  const walletMe = async (): Promise<Address> => {
    if (quickStartWallet === undefined) {
      await fresh();
      quickStartWallet = getAddress(
        jsonOf(await sauce("wallet", "new", "me", ...PASSWORD, "--json")).address as string,
      );
      await base.send(base.deployer, quickStartWallet, "0x", parseEther("1"));
      snapshot = await base.testClient.snapshot();
    }
    return quickStartWallet;
  };

  describe("the manual's quick start, docs/examples/pay.sauce.ts", () => {
    const PAY = relative(process.cwd(), join(HERE, "../../docs/examples/pay.sauce.ts"));
    /** The `sauce <command> pay.sauce.ts --chain base` line of the example's header, as words, its
     *  `<recipient>` filled in and the file given by its path. */
    const usage = (command: string): string[] => {
      const line = readFileSync(PAY, "utf8")
        .split("\n")
        .map((one) => one.replace(/^\/\/\s*/, ""))
        .find((one) => one.startsWith(`sauce ${command} pay.sauce.ts --chain base `));
      if (line === undefined) throw new Error(`pay.sauce.ts has no \`sauce ${command}\` line`);

      return line
        .split(/\s+/)
        .slice(1)
        .map((word) => ({ "pay.sauce.ts": PAY, "<recipient>": RECIPIENT })[word] ?? word);
    };
    let me: Address;

    beforeAll(async () => {
      me = await walletMe();
    }, 120_000);

    it("simulates as the page says: the wallet names the owner, no password, nothing sent", async () => {
      await fresh();
      const run = await sauce(...usage("simulate"), ...rpc(), "--json");
      expect(jsonOf(run)).toMatchObject({ ok: true });
      expect(jsonOf(run).transfers).toContainEqual(
        expect.objectContaining({ token: usdc, to: RECIPIENT, amount: "1000000" }),
      );
      expect(await base.balanceOf(usdc, RECIPIENT)).toBe(0n);
      // Past what the Pot holds, its own check stops it.
      const short = await sauce(
        ...usage("simulate").map((word) => (word === "USDC:5" ? "USDC:0.5" : word)),
        ...rpc(),
      );
      expect(short.code).toBe(1);
      expect(short.stdout).toContain('The cook reverts: the program threw "not enough USDC"');
    }, 120_000);

    it("runs as the page says: the Pot deployed when asked, then 1 USDC paid from it", async () => {
      await fresh();
      // The page's step before the run: 1 USDC sent to the Pot's address.
      const pot = getAddress(v12PredictPot(me) as Address);
      await base.mint(usdc, pot, 1_000_000n);
      const run = await sauce(...usage("run"), ...PASSWORD, ...rpc());
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/^deployed Pot 0x[0-9a-fA-F]{40} in 0x[0-9a-f]{64}: success/m);
      expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
      expect(await base.balanceOf(usdc, RECIPIENT)).toBe(1_000_000n);
      expect(await base.balanceOf(usdc, pot)).toBe(0n);
    }, 120_000);
  });

  describe("the manual's second tutorial, docs/examples/pay-list.sauce.ts", () => {
    const PAY_LIST = relative(process.cwd(), join(HERE, "../../docs/examples/pay-list.sauce.ts"));
    const FIRST: Address = "0x9999999999999999999999999999999999999999";
    const SECOND: Address = "0x5555555555555555555555555555555555555555";
    /** The `sauce <command> pay-list.sauce.ts --chain base` line of the example's header, as words:
     *  the file given by its path, and the `--args` JSON word as the shell passes it, its single
     *  quotes gone and its two `<recipient>`s filled in with FIRST and SECOND, in that order. */
    const usage = (command: string): string[] => {
      const line = readFileSync(PAY_LIST, "utf8")
        .split("\n")
        .map((one) => one.replace(/^\/\/\s*/, ""))
        .find((one) => one.startsWith(`sauce ${command} pay-list.sauce.ts --chain base `));
      if (line === undefined) throw new Error(`pay-list.sauce.ts has no \`sauce ${command}\` line`);

      const recipients = [FIRST, SECOND];
      return line
        .split(/\s+/)
        .slice(1)
        .map((word) => {
          if (word === "pay-list.sauce.ts") return PAY_LIST;
          if (!word.startsWith("'")) return word;
          return word.slice(1, -1).replace(/<recipient>/g, () => recipients.shift()!);
        });
    };
    let me: Address;

    beforeAll(async () => {
      me = await walletMe();
    }, 120_000);

    it("reads its header's lines: two recipients, 1 USDC each, a limit of 1.5 USDC", () => {
      for (const command of ["simulate", "run"]) {
        const words = usage(command);
        expect(words.slice(words.indexOf("--args") + 1)).toEqual([
          JSON.stringify([FIRST, SECOND]),
          "1000000",
          "1500000",
        ]);
      }
    });

    it("simulates as the page says: the first recipient paid, the second not, 1 USDC returned", async () => {
      await fresh();
      const run = await sauce(...usage("simulate"), ...rpc(), "--json");
      expect(jsonOf(run)).toMatchObject({ ok: true, returnType: "Uint256" });
      expect(String(jsonOf(run).returned)).toBe("1000000");
      const transfers = jsonOf(run).transfers as { token: string; to: string; amount: string }[];
      expect(transfers).toContainEqual(
        expect.objectContaining({ token: usdc, to: FIRST, amount: "1000000" }),
      );
      expect(transfers.filter(({ to }) => to === SECOND)).toEqual([]);
      expect(await base.balanceOf(usdc, FIRST)).toBe(0n);
      expect(await base.balanceOf(usdc, SECOND)).toBe(0n);
    }, 120_000);

    it("runs with sauce run: 1 USDC paid on chain to the first recipient, none to the second", async () => {
      await fresh();
      const pot = getAddress(v12PredictPot(me) as Address);
      await base.mint(usdc, pot, 1_000_000n);
      const run = await sauce(...usage("run"), ...PASSWORD, ...rpc());
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/^cook 0x[0-9a-f]{64}: success/m);
      expect(await base.balanceOf(usdc, FIRST)).toBe(1_000_000n);
      expect(await base.balanceOf(usdc, SECOND)).toBe(0n);
      expect(await base.balanceOf(usdc, pot)).toBe(0n);
    }, 120_000);
  });
});
