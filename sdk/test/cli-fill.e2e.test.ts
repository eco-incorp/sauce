/**
 * `sauce fill`: a solver's fill of a file's intent, rehearsed on the destination with no key and
 * nothing sent — on a local anvil standing in for Base, with the released gated stack
 * (`cli-anvil.ts`) and the real eco-routes Portal (`evm/fixtures/Portal.json`, its own forge
 * creation code) at the address the SDK records for Base, so the CLI runs with no override.
 *
 * THE PORTAL IS PUT IN PLACE, NOT DEPLOYED THERE (`cli-anvil.ts#placePortal`, which says why):
 * the fixture is deployed wherever it lands, then both runtimes are copied to the registry's
 * Portal and the Executor derived from it, with exactly the two immutables that name each other
 * rewritten. Its chain id (8453, anvil's), its vault implementation and its EIP-712 cache are
 * untouched. `executor()` read back through the copy is the Executor the SDK derives, and every
 * fulfill below runs the copy's real `_fulfill`: the hash check, the token pulls,
 * `Executor.execute` and its `onlyPortal`.
 *
 * Nothing is ever sent: after every rehearsal the shared Pot is not deployed, the solver holds
 * nothing and the block has not moved.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, pad, parseAbi, type Address, type Hex } from "viem";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { DEFAULT_SOLVER } from "../src/cli/fill.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import {
  describeEvm,
  FEE,
  fixture,
  jsonOf,
  placePortal,
  registered,
  sauce,
  startChain,
  WORKER,
  type LocalChain,
} from "./cli-anvil.js";

const PORTAL = parseAbi(["function executor() view returns (address)"]);

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const REFUND_TO: Address = "0x7777777777777777777777777777777777777777";
const CREATOR: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const AMOUNT_IN = 5_000_000n;
const DEADLINE = "2000000000";

/** The intent: Base USDC delivered to the shared Pot, a floor checked, all of it sent on. */
const COOKED = [
  "Base(",
  "  () => {",
  "    const usdc = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n;",
  "    const got = Token(usdc).balanceOf(ctx.self());",
  '    require(got >= MIN_OUT, "output below MIN_OUT");',
  "    Token(usdc).transfer(RECIPIENT, got - KEEP - REFUND);",
  "    if (REFUND > 0n) {",
  "      Token(usdc).transfer(REFUND_TO, REFUND);",
  "    }",
  "  },",
  "  { tokens: [{ token: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n, amount: AMOUNT_IN }] }",
  ").reward({ tokens: [{ token: USDC, amount: 6000000n }] });",
  "",
].join("\n");

/** An intent whose body is plain token transfers: route calls the Executor runs, no Pot. */
const DIRECT = [
  "Base(() => {",
  "  Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).transfer(RECIPIENT, AMOUNT_IN);",
  "}).reward({ tokens: [{ token: USDC, amount: 6000000n }] });",
  "",
].join("\n");

/** A program that measures what its intent carries, so the intent has no route until it runs. */
const MEASURED = [
  "function main() {",
  "  const amount = USDC.balanceOf(ctx.self());",
  "  Base(() => {",
  "    Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).transfer(RECIPIENT, amount);",
  "  }).reward({ tokens: [{ token: USDC, amount }] });",
  "}",
  "",
].join("\n");

describeEvm("sauce fill: a solver's fill, rehearsed on the destination", () => {
  let base: LocalChain;
  let work: string;
  let usdc: Address;
  const portal = getAddress(ecoRoutesPortal("base"));
  const executor = getAddress(ecoRoutesExecutorOf(portal));
  const pot = getAddress(v12PredictPot(executor, SAUCE_INTENT_POT_SALT) as Address);

  const defines = (overrides: Record<string, string> = {}): string[] =>
    Object.entries({
      AMOUNT_IN: String(AMOUNT_IN),
      MIN_OUT: String(AMOUNT_IN),
      RECIPIENT,
      REFUND_TO,
      KEEP: "0",
      REFUND: "0",
      ...overrides,
    }).flatMap(([name, value]) => ["--define", `${name}=${value}`]);
  const file = (name: string, text: string): string => {
    const path = join(work, name);
    writeFileSync(path, text);

    return path;
  };
  const fill = (path: string, ...flags: string[]) =>
    sauce(
      ...["fill", path, "--chain", "arbitrum", "--rpc-url", base.rpcUrl],
      ...["--intent-deadline", DEADLINE, "--intent-creator", CREATOR],
      ...flags,
    );
  /** What a rehearsal must leave as it found it. */
  const untouched = async (block: bigint): Promise<void> => {
    expect(await base.publicClient.getBlockNumber()).toBe(block);
    expect(await base.publicClient.getCode({ address: pot })).toBeUndefined();
    expect(await base.balanceOf(usdc, DEFAULT_SOLVER)).toBe(0n);
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(0n);
  };

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-fill-e2e-"));
    base = await startChain("base", 9300 + WORKER);
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    // The real Portal, deployed wherever it lands, then moved to the registry's address.
    const placed = await placePortal(base);
    expect(placed).toEqual({ portal, executor });
    expect(
      await base.publicClient.readContract({
        address: portal,
        abi: PORTAL,
        functionName: "executor",
      }),
    ).toBe(executor);
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await base?.stop();
  });

  it("deploys the shared Pot, approves and fulfills in one block, and shows what moved", async () => {
    const path = file("cooked.sauce.ts", COOKED);
    const block = await base.publicClient.getBlockNumber();
    const run = await fill(
      path,
      ...defines({ REFUND: "1000000" }),
      "--intent-execution-fee",
      String(FEE),
      "--json",
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as {
      ok: boolean;
      intents: Array<Record<string, unknown>>;
    };
    expect(out.ok).toBe(true);
    const [one] = out.intents;
    expect(one).toMatchObject({
      ok: true,
      source: "arbitrum",
      destination: "base",
      portal,
      executor,
      pot,
      potDeployed: false,
      solver: DEFAULT_SOLVER,
      claimant: DEFAULT_SOLVER,
      value: String(FEE),
      path: "eth_simulateV1",
      fulfilled: { claimant: pad(DEFAULT_SOLVER).toLowerCase() },
      assumed: [
        { holder: DEFAULT_SOLVER, token: usdc, symbol: "USDC", amount: String(AMOUNT_IN) },
        { holder: DEFAULT_SOLVER, token: "native", amount: String(FEE) },
      ],
    });
    expect((one!.calls as Array<{ kind: string; status: string }>).map((c) => c.kind)).toEqual([
      "deploy",
      "approve",
      "fulfill",
    ]);
    expect((one!.calls as Array<{ status: string }>).every((c) => c.status === "success")).toBe(
      true,
    );
    const changes = one!.balanceChanges as Array<{
      address: Address;
      label?: string;
      deltas: Array<{ token: string; amount: string }>;
    }>;
    const change = (address: Address) => changes.find((entry) => entry.address === address);
    expect(change(RECIPIENT)).toMatchObject({
      label: "RECIPIENT",
      deltas: [{ token: usdc, amount: "4000000" }],
    });
    expect(change(REFUND_TO)).toMatchObject({
      label: "REFUND_TO",
      deltas: [{ token: usdc, amount: "1000000" }],
    });
    expect(change(DEFAULT_SOLVER)?.deltas).toEqual(
      expect.arrayContaining([expect.objectContaining({ token: usdc, amount: "-5000000" })]),
    );
    // Nothing stays in the shared Pot or the Executor.
    const left = one!.leftBehind as Array<{ holder: Address; after: string }>;
    expect(left.map((entry) => entry.holder)).toEqual(expect.arrayContaining([pot, executor]));
    expect(left.every((entry) => entry.after === "0")).toBe(true);
    // The shared Pot is not deployed: said, with the transaction that deploys it.
    expect(run.stderr).toContain(`the shared intent Pot ${pot} is not deployed on base`);
    expect(run.stderr).toContain(`sauce pot --owner ${executor} --chain base`);
    await untouched(block);
  }, 120_000);

  it("prints the block, what it assumed, what moved and what was left", async () => {
    const run = await fill(
      file("cooked.sauce.ts", COOKED),
      ...defines(),
      "--intent-execution-fee",
      String(FEE),
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^Intent 0x[0-9a-f]{64} from arbitrum to base: the fill succeeds/);
    expect(run.stdout).toContain(`  1. Kitchen.deployPot(${executor}, ${SAUCE_INTENT_POT_SALT})`);
    expect(run.stdout).toContain("  2. approve the Portal for 5 USDC");
    expect(run.stdout).toMatch(/ {2}3\. Portal\.fulfill\(0x[0-9a-f]{64}, route, 0x[0-9a-f]{64}, /);
    expect(run.stdout).toContain("the solver holds 5 USDC: the route's tokens");
    expect(run.stdout).toContain(
      `5 USDC: ${pot} (the shared intent Pot) -> ${RECIPIENT} (RECIPIENT)`,
    );
    expect(run.stdout).toContain("The Portal records the fill: IntentFulfilled(");
    expect(run.stdout).toContain("Left behind: nothing.");
  }, 120_000);

  it("decodes a body that reverts down to the program's own message", async () => {
    const block = await base.publicClient.getBlockNumber();
    const run = await fill(
      file("cooked.sauce.ts", COOKED),
      ...defines({ MIN_OUT: String(AMOUNT_IN + 1n) }),
      "--intent-execution-fee",
      String(FEE),
      "--json",
    );
    expect(run.code).toBe(1);
    const [one] = (JSON.parse(run.stdout) as { intents: Array<Record<string, unknown>> }).intents;
    expect(one).toMatchObject({ ok: false, stage: "fulfill" });
    expect(one!.reason).toBe(
      `route call 2 of 2 (the cook on the shared Pot ${pot}) reverted: ` +
        'the program threw "output below MIN_OUT"',
    );
    await untouched(block);
  }, 120_000);

  it("names the Portal's own refusal: a route whose deadline has passed", async () => {
    const run = await sauce(
      ...["fill", file("direct.sauce.ts", DIRECT), "--chain", "arbitrum"],
      ...["--rpc-url", base.rpcUrl, ...defines()],
      ...["--intent-deadline", "1000", "--intent-creator", CREATOR],
    );
    expect(run.code).toBe(1);
    // fill rehearses it anyway, where compile and publish refuse it, and says so.
    expect(run.stderr).toContain(
      "--intent-deadline 1000 (1970-01-01T00:16:40.000Z) has passed: an intent can be filled " +
        "only until its deadline: the rehearsal shows the Portal refusing it",
    );
    expect(run.stdout).toContain(
      "the fill reverts: IntentExpired(): the route's deadline, 1000 (1970-01-01T00:16:40.000Z), " +
        "has passed",
    );
  }, 60_000);

  it("names a Kitchen fee the route underpays, and the revert it causes", async () => {
    const run = await fill(
      file("cooked.sauce.ts", COOKED),
      ...defines(),
      "--intent-execution-fee",
      "0",
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      `route call 2 pays the Kitchen 0 wei, and base's Kitchen charges ${FEE}`,
    );
    expect(run.stdout).toContain(`reverted: FeeNotPaid(${FEE}, 0)`);
  }, 120_000);

  it("warns when the fill leaves tokens in the shared Pot", async () => {
    const run = await fill(
      file("cooked.sauce.ts", COOKED),
      ...defines({ KEEP: "7" }),
      "--intent-execution-fee",
      String(FEE),
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`${pot} (the shared intent Pot) ends holding 0.000007 USDC`);
    expect(run.stderr).toContain(
      "warning: the fill leaves 0.000007 USDC in " + `${pot} (the shared intent Pot)`,
    );
  }, 120_000);

  it("fills a body of plain transfers with no Pot, and from a given solver", async () => {
    const solver = getAddress("0x8888888888888888888888888888888888888888");
    const block = await base.publicClient.getBlockNumber();
    const out = jsonOf(
      await fill(
        file("direct.sauce.ts", DIRECT),
        ...defines(),
        "--solver",
        solver,
        "--claimant",
        `0x${"ab".repeat(32)}`,
        "--json",
      ),
    );
    const [one] = out.intents as Array<Record<string, unknown>>;
    expect(one).toMatchObject({
      ok: true,
      solver,
      claimant: `0x${"ab".repeat(32)}`,
      value: "0",
      fulfilled: { claimant: `0x${"ab".repeat(32)}` },
    });
    expect((one!.calls as Array<{ kind: string }>).map((c) => c.kind)).toEqual([
      "approve",
      "fulfill",
    ]);
    expect(await base.publicClient.getBlockNumber()).toBe(block);
  }, 120_000);

  it("rehearses on a deployed shared Pot without deploying it again", async () => {
    // Deployed the way the warning says: `sauce pot` prints it, and any account sends it.
    const deploy = jsonOf(await sauce("pot", "--owner", executor, "--chain", "base"));
    await base.send(base.deployer, deploy.to as Address, deploy.data as Hex);
    try {
      const run = await fill(
        file("cooked.sauce.ts", COOKED),
        ...defines(),
        "--intent-execution-fee",
        String(FEE),
        "--json",
      );
      expect(run.code).toBe(0);
      expect(run.stderr).not.toContain("is not deployed");
      const [one] = (JSON.parse(run.stdout) as { intents: Array<Record<string, unknown>> }).intents;
      expect(one).toMatchObject({ ok: true, potDeployed: true });
      expect((one!.calls as Array<{ kind: string }>).map((c) => c.kind)).toEqual([
        "approve",
        "fulfill",
      ]);
    } finally {
      await base.testClient.setCode({ address: pot, bytecode: "0x" });
    }
  }, 120_000);

  it("says when a delivered token's balance cannot be given to the solver", async () => {
    // A token whose balanceOf is computed (always 7): no storage word to write.
    const computed: Address = "0x5a0Ce00000000000000000000000000000000007";
    await base.testClient.setCode({ address: computed, bytecode: "0x600760005260206000f3" });
    const run = await fill(
      file(
        "computed.sauce.ts",
        `Base(() => {\n  Token(${computed.toLowerCase()}n).transfer(RECIPIENT, AMOUNT_IN);\n}).reward({ tokens: [{ token: USDC, amount: 6000000n }] });\n`,
      ),
      ...defines(),
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      `the solver delivers ${computed}, and the rehearsal cannot give it a balance: no storage ` +
        `slot of ${computed} holds the balance its balanceOf reports`,
    );
    expect(run.stderr).toContain("Pass --solver <an address that holds it>.");
  }, 60_000);

  it("refuses an intent with no route until its program runs", async () => {
    const run = await fill(file("measured.sauce.ts", MEASURED), ...defines());
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("uses `amount`, measured on chain while the program runs");
  }, 60_000);

  it("names the destination when --rpc-url serves another chain", async () => {
    const other = await startChain("arbitrum", 9350 + WORKER);
    try {
      const run = await sauce(
        ...["fill", file("cooked.sauce.ts", COOKED), "--chain", "arbitrum"],
        ...["--rpc-url", other.rpcUrl, ...defines()],
        ...["--intent-deadline", DEADLINE, "--intent-creator", CREATOR],
        ...["--intent-execution-fee", String(FEE)],
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("--rpc-url is base's endpoint, not arbitrum's");
    } finally {
      await other.stop();
    }
  }, 120_000);
});
