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
 * The output the skill quotes is the output of these runs: each ```text block of its SKILL.md that
 * quotes one is held, line by line, to what the command printed here, with the addresses written as
 * the roles the skill names them by. Each quoted rehearsal runs on the chain as `beforeAll` leaves
 * it (an anvil snapshot), so the numbers do not depend on the order the tests run in.
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
  isAddress,
  maxUint256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { shortAddress } from "../src/cli/effects.js";
import { v12KitchenAddress } from "../src/deployments/index.js";
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
import { FACTORY, freePort, LIQUIDITY, POOL } from "./pools-anvil.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "../../skills/sauce-cli/examples");
/** The programs, by the path the command prints back: relative, as a reader runs them. */
const BUY = relative(process.cwd(), join(EXAMPLES, "buy.sauce.ts"));
const PAYOUT = relative(process.cwd(), join(EXAMPLES, "payout.sauce.ts"));
const SKILL = readFileSync(join(EXAMPLES, "../SKILL.md"), "utf8");

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const PAYEE_A: Address = "0x7777777777777777777777777777777777777777";
const PAYEE_B: Address = "0x8888888888888888888888888888888888888888";
/** What the skill's runs pass: 2,700 USDC per WETH, the limit `sauce price` gives buying WETH. */
const LIMIT = "4116816085950893928074568";
const BUDGET = "100000000"; // 100 USDC
const MIN_OUT = "37000000000000000"; // 0.037 WETH
const PAIR = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };

/** The ```text blocks of the skill, each as its lines, without the indent of a list item. */
const QUOTES = [...SKILL.matchAll(/^( *)```text\n([\s\S]*?)^\1```$/gm)].map(([, indent, body]) =>
  body!
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(indent!.length)),
);

/**
 * Holds the skill's quote of a run to its output: the ```text block whose first line starts with
 * `first` is lines the run printed, in order and one after another, except where a line of the
 * quote is `…` alone, which stands for lines left out; a `…` within a line stands for anything. The
 * output is first written as the skill writes it: each of `roles` (an address, a path, a hash) as
 * the name the skill gives it, an address's short form (`0x6666…6666`, as the flow of what moved
 * prints it) too, a block number as `<block>`, and what `main` returned as `<N bytes>`. The columns
 * the flow pads are then a different width, so a run of spaces inside a line matches any other.
 */
function expectQuoted(first: string, run: Run, roles: Record<string, string>): void {
  const quote = QUOTES.find((lines) => lines[0]!.startsWith(first));
  if (quote === undefined) throw new Error(`SKILL.md quotes no output starting "${first}"`);
  let text = run.stdout;
  for (const [value, role] of Object.entries(roles)) {
    text = text.replaceAll(value, role);
    if (isAddress(value)) text = text.replaceAll(shortAddress(getAddress(value)), role);
  }
  text = text
    .replace(/\bblock \d+/g, "block <block>")
    .replace(/returns 0x([0-9a-f]*)/g, (_, hex: string) => `returns <${hex.length / 2} bytes>`);
  const printed = text.split("\n");
  let at = 0;
  let skip = true;
  for (const line of quote) {
    if (line.trim() === "…") {
      skip = true;
      continue;
    }
    const escaped = line
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("…", ".*")
      .replace(/(\S) {2,}/g, "$1 +");
    const pattern = new RegExp(`^${escaped}$`);
    const found = skip
      ? printed.findIndex((candidate, index) => index >= at && pattern.test(candidate))
      : pattern.test(printed[at] ?? "")
        ? at
        : -1;
    if (found < 0) {
      throw new Error(
        `SKILL.md quotes\n  ${line}\n${skip ? "which the run does not print" : "where the run prints\n  " + (printed[at] ?? "nothing")}; it printed:\n${text}`,
      );
    }
    at = found + 1;
    skip = false;
  }
}

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
  /** The roles the skill names the rehearsals' addresses by. */
  const roles = (): Record<string, string> => ({
    [OWNER]: "<owner>",
    [ownerPot]: "<Pot>",
    [wallet]: "<owner>",
    [pot]: "<Pot>",
    [pools.get(500)!]: "<pool>",
    [RECIPIENT]: "<recipient>",
    [PAYEE_A]: "<payee A>",
    [PAYEE_B]: "<payee B>",
    [getAddress(v12KitchenAddress())]: "<Kitchen>",
    [BUY]: "buy.sauce.ts",
  });
  const fresh = async (): Promise<void> => {
    await base.testClient.revert({ id: snapshot });
    snapshot = await base.testClient.snapshot();
  };
  const call = (to: Address, abi: Abi, functionName: string, args: readonly unknown[]) =>
    base.send(base.deployer, to, encodeFunctionData({ abi, functionName, args }));
  const sqrtAt = (usdcPerWeth: string): bigint => sqrtPriceX96FromPrice(usdcPerWeth, PAIR);
  const tickOf = (sqrtPriceX96: bigint): number =>
    Math.floor(Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(Math.sqrt(1.0001)));
  /** The record `buy.sauce.ts` returns, from a rehearsal's JSON. */
  const bought = (run: Run) =>
    jsonOf(run).returned as { pool: Address; spent: string; bought: string };

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-examples-"));
    base = await startChain("base", await freePort());
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
      expect(out.returnType).toBe("{ pool: Address, spent: Uint256, bought: Uint256 }");
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
      expectQuoted("The cook succeeds from <owner>", run, roles());
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
      expectQuoted('The cook reverts: the program threw "bought less than minOut"', short, roles());
      const empty = await simulateBuy(...buyArgs());
      expect(empty.code).toBe(1);
      expect(empty.stdout).toMatch(
        /^The cook reverts: the program threw "the budget is not in the Pot"$/m,
      );
    }, 120_000);

    it("stops at the price limit, and sends the rest of the budget back with what it bought", async () => {
      await fresh();
      const text = await simulateBuy(
        "--assume-balance",
        "USDC:100000",
        ...buyArgs({ budget: "100000000000", minOut: "0" }),
      );
      expectQuoted(
        "main returns { pool: Address, spent: Uint256, bought: Uint256 }: { pool: <pool>, spent: 48361532981",
        text,
        roles(),
      );
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
      expect(Object.keys(tx)).toEqual(["chainId", "to", "data", "value"]);
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
      expectQuoted("cook <tx hash>: success", run, { ...roles(), [hash]: "<tx hash>" });
      expect(await base.balanceOf(usdc, pot)).toBe(0n);
      const inspected = await sauce("inspect", hash, "--chain", "base", ...rpc(), "--source", BUY);
      expect(inspected.code).toBe(0);
      expectQuoted("transaction <tx hash> on base: success", inspected, {
        ...roles(),
        [hash]: "<tx hash>",
      });
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
          "sauce run asks to approve it first (--auto-approve approves it), and the rehearsal runs " +
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
        ...["--assume-balance", "USDC:1000", "--args", payees(7000, 3000)],
      );
      expect(run.code).toBe(0);
      expectQuoted("main returns Uint256[]", run, roles());
      const refused = await sauce(
        ...["simulate", PAYOUT, "--chain", "base", "--owner", OWNER, ...rpc()],
        ...["--assume-balance", "USDC:1000", "--args", payees(7000, 2000)],
      );
      expect(refused.code).toBe(1);
      expectQuoted(
        'The cook reverts: the program threw "the weights do not add up to 10000"',
        refused,
        roles(),
      );
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
});
