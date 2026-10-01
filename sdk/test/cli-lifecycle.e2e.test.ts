/**
 * An intent's whole life through the `sauce` command, on two anvils standing in for Arbitrum (the
 * source) and Base (the destination): published and funded on Arbitrum, filled and proven on Base
 * as a solver does it (`fill --send`), the proof carried back, claimed on Arbitrum — and the
 * creator's side, refunded after the reward's deadline, or cancelled on Base after the route's
 * deadline, the cancellation proven and refunded before the reward's.
 *
 * REAL: the released gated stack on both chains (`cli-anvil.ts`), eco-routes' own Portal and
 * HyperProver at the addresses the SDK records (`eco-routes-anvil.ts`: v2.12.0, built from source
 * and byte-identical outside its immutables to the deployed 2.12.0 code; and the release before
 * proven cancellation, for what that one refuses), every transaction the command sends.
 *
 * MOCKED, and only this: Hyperlane's off-chain half. The Mailbox on each chain is real where the
 * provers touch it (dispatch, the fee quote, its events), and the test delivers each dispatched
 * message to the other chain's Mailbox itself (`relay`), standing in for Hyperlane's relayer and
 * validators: no ISM checks it. The source HyperProver still checks the sender is whitelisted and
 * the message's chain id, and records the proof the source Portal then pays on.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  pad,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { CANCELLED_CLAIMANT } from "../src/routes/portal.js";
import {
  describeEvm,
  fixture,
  jsonOf,
  OWNER,
  OWNER_KEY,
  registered,
  sauce,
  sauceWith,
  startChain,
  WORKER,
  type LocalChain,
} from "./cli-anvil.js";
import {
  deployMailbox,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
  relay,
} from "./eco-routes-anvil.js";

/** Anvil's fourth dev account: the solver. A public key, local only. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
/** What the Mailbox charges per message: the prover's quoted fee. */
const HYPERLANE_FEE = 7_777n;

const APPROVE = parseAbi(["function approve(address, uint256)"]);

/** Base USDC to RECIPIENT, for Arbitrum USDC: a body of plain transfers, run by the Executor. */
const INTENT = [
  "Base(() => {",
  "  USDC.transfer(RECIPIENT, AMOUNT);",
  "}).reward({ tokens: [{ token: USDC, amount: REWARD }] });",
  "",
].join("\n");

describeEvm("the intent lifecycle: publish, fill and prove, claim; refund; cancel", () => {
  let arbitrum: LocalChain;
  let base: LocalChain;
  let work: string;
  let config: string;
  let file: string;
  let arbitrumUsdc: Address;
  let baseUsdc: Address;
  let arbitrumMailbox: Address;
  let baseMailbox: Address;

  /** The flags every intent here is built with, its deadlines given. */
  const intentFlags = (route: bigint, reward: bigint): string[] => [
    ...["--chain", "arbitrum", "--define", `RECIPIENT=${RECIPIENT}`],
    ...["--define", `AMOUNT=${AMOUNT}`, "--define", `REWARD=${REWARD}`],
    ...["--intent-deadline", String(route), "--intent-reward-deadline", String(reward)],
    ...["--intent-creator", OWNER.address],
  ];
  const now = async (local: LocalChain): Promise<bigint> =>
    (await local.publicClient.getBlock()).timestamp;
  /** Moves `local`'s clock on by `seconds`, and mines a block there. */
  const warp = async (local: LocalChain, seconds: number): Promise<void> => {
    await local.testClient.increaseTime({ seconds });
    await local.testClient.mine({ blocks: 1 });
  };
  /** Publishes the intent from the creator, returning its hash. */
  const publish = async (store: string, route: bigint, reward: bigint): Promise<Hex> => {
    const out = jsonOf(
      await sauce(
        "intent",
        "publish",
        file,
        ...intentFlags(route, reward),
        ...["--rpc-url", arbitrum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );

    return (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
  };
  const lifecycle = (command: string, hash: Hex, store: string, ...flags: string[]) =>
    sauce("intent", command, hash, "--config", config, "--store", store, ...flags);

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-lifecycle-e2e-"));
    [arbitrum, base] = await Promise.all([
      startChain("arbitrum", 9400 + WORKER),
      startChain("base", 9450 + WORKER),
    ]);
    arbitrumUsdc = await arbitrum.plant(fixture("MockERC20"), registered(arbitrum.chain, "USDC"));
    baseUsdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    for (const local of [arbitrum, base]) await plantPortal(local, PORTAL_FIXTURES.v2_12);
    arbitrumMailbox = await deployMailbox(arbitrum, HYPERLANE_FEE);
    baseMailbox = await deployMailbox(base, HYPERLANE_FEE);
    await plantHyperProver(arbitrum, arbitrumMailbox);
    await plantHyperProver(base, baseMailbox);
    // The creator holds the rewards; the solver what it delivers, and gas on Base.
    await arbitrum.mint(arbitrumUsdc, OWNER.address, 10n * REWARD);
    await base.mint(baseUsdc, SOLVER.address, 10n * AMOUNT);
    config = join(work, "sauce.config.json");
    writeFileSync(
      config,
      JSON.stringify({ rpcUrls: { "42161": arbitrum.rpcUrl, "8453": base.rpcUrl } }),
    );
    file = join(work, "bridge.sauce.ts");
    writeFileSync(file, INTENT);
  }, 180_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await Promise.all([arbitrum?.stop(), base?.stop()]);
  });

  it("publishes, fills and proves, carries the proof, and claims", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 3600n, start + 7200n);
    // publish stored it: the intent once, and what happened.
    const stored = join(store, hash, "intent.json");
    expect(existsSync(stored)).toBe(true);
    const events = () =>
      readFileSync(join(store, hash, "events.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events()).toEqual(["published", "funded"]);

    // The rehearsal, by hash: fulfillAndProve with the Hyperlane fee in its value.
    const rehearsal = jsonOf(
      await lifecycle("fill", hash, store, "--solver", SOLVER.address, "--json"),
    );
    const [planned] = rehearsal.intents as Array<Record<string, unknown>>;
    expect(planned).toMatchObject({
      ok: true,
      proves: true,
      value: String(HYPERLANE_FEE),
      fee: { prover: String(HYPERLANE_FEE), kitchen: "0" },
      prover: { kind: "Hyperlane", supported: true },
    });

    // Sent, by the solver.
    const filled = await lifecycle(
      "fill",
      hash,
      store,
      ...["--send", "--private-key", SOLVER_KEY, "--yes", "--json"],
    );
    expect(filled.code).toBe(0);
    const out = JSON.parse(filled.stdout) as { intents: Array<Record<string, unknown>> };
    const [sent] = out.intents;
    expect(sent).toMatchObject({
      intentHash: hash,
      solver: SOLVER.address,
      proves: true,
      fulfilled: { claimant: pad(SOLVER.address).toLowerCase() },
    });
    const transactions = sent!.transactions as Array<{ kind: string; hash: Hex }>;
    expect(transactions.map((tx) => tx.kind)).toEqual(["approve", "fulfill"]);
    expect(await base.balanceOf(baseUsdc, RECIPIENT)).toBe(AMOUNT);
    expect((sent!.messages as unknown[]).length).toBe(1);
    expect(events()).toEqual(["published", "funded", "filled", "proving"]);

    // Not claimable before the proof arrives: said, with the message it travels as.
    const early = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("Not claimable yet");
    expect(early.stderr).toContain("Hyperlane message 0x");

    // Hyperlane's delivery, mocked; the provers on both sides are real.
    expect(await relay(base, baseMailbox, transactions[1]!.hash, arbitrum, arbitrumMailbox)).toBe(
      1,
    );
    const shown = jsonOf(
      await sauce("intent", "show", hash, "--config", config, "--store", store, "--json"),
    );
    expect((shown.status as { state: string }).state).toBe("proven");

    const before = await arbitrum.balanceOf(arbitrumUsdc, SOLVER.address);
    const claimed = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY, "--json");
    expect(claimed.code).toBe(0);
    expect(await arbitrum.balanceOf(arbitrumUsdc, SOLVER.address)).toBe(before + REWARD);
    expect(events()).toEqual(["published", "funded", "filled", "proving", "claimed"]);

    // Nothing is left for the creator: refund says why.
    const refund = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(refund.code).toBe(1);
    expect(refund.stdout).toContain("the vault holds nothing to refund");
  }, 240_000);

  it("refunds an unfilled intent from the reward's deadline, not before", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(arbitrum);
    const hash = await publish(store, start + 60n, start + 600n);
    const early = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("not before the reward's deadline");
    await warp(arbitrum, 700);
    const before = await arbitrum.balanceOf(arbitrumUsdc, OWNER.address);
    const refunded = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY, "--json");
    expect(refunded.code).toBe(0);
    expect(await arbitrum.balanceOf(arbitrumUsdc, OWNER.address)).toBe(before + REWARD);
  }, 240_000);

  it("cancels after the route's deadline, proves it, and refunds before the reward's", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 60n, start + 100_000n);
    const early = await lifecycle("cancel", hash, store, "--private-key", OWNER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("not before the route's deadline");
    await warp(base, 120);
    const cancelled = await lifecycle("cancel", hash, store, "--private-key", OWNER_KEY);
    expect(cancelled.code).toBe(0);
    expect(cancelled.stdout).toContain("no solver can fill it now");
    // A fill now is refused by the Portal.
    const fill = await lifecycle("fill", hash, store, "--solver", SOLVER.address);
    expect(fill.code).toBe(1);
    // Its proof waits until the block that cancelled it is final (anvil finalizes 64 blocks back).
    const unfinal = await lifecycle("prove", hash, store, "--private-key", OWNER_KEY, "--yes");
    expect(unfinal.code).toBe(1);
    expect(unfinal.stdout).toMatch(/was cancelled in block \d+ on base, which is not final yet/);
    await base.testClient.mine({ blocks: 70 });
    const proved = await lifecycle(
      "prove",
      hash,
      store,
      "--private-key",
      OWNER_KEY,
      "--yes",
      "--json",
    );
    expect(proved.code).toBe(0);
    const proof = JSON.parse(proved.stdout) as { transactions: Array<{ hash: Hex }> };
    expect(
      await relay(base, baseMailbox, proof.transactions[0]!.hash, arbitrum, arbitrumMailbox),
    ).toBe(1);
    // The sentinel is recorded on the source, and pays no claimant.
    const claim = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY);
    expect(claim.code).toBe(1);
    expect(claim.stdout).toContain("pays no claimant");
    const before = await arbitrum.balanceOf(arbitrumUsdc, OWNER.address);
    const refunded = await lifecycle("refund", hash, store, "--private-key", SOLVER_KEY);
    expect(refunded.code).toBe(0);
    expect(await arbitrum.balanceOf(arbitrumUsdc, OWNER.address)).toBe(before + REWARD);
    expect(getAddress(CANCELLED_CLAIMANT)).toBe("0xe685056aEc77686A83E2a6bDf37c6f71dD2fdB5f");
  }, 240_000);

  it("refuses to cancel where either Portal predates proven cancellation", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 60n, start + 100_000n);
    await warp(base, 120);
    // The destination without `cancel`.
    await plantPortal(base, PORTAL_FIXTURES.pre);
    try {
      const run = await lifecycle("cancel", hash, store, "--private-key", OWNER_KEY);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain("has no cancel (it predates eco-routes 2.12)");
    } finally {
      await plantPortal(base, PORTAL_FIXTURES.v2_12);
    }
    // The source without `CancelledIntent`: a proven cancellation there would pay an address no
    // key controls, so it is not cancelled even though the destination can.
    await plantPortal(arbitrum, PORTAL_FIXTURES.pre);
    try {
      const run = await lifecycle("cancel", hash, store, "--private-key", OWNER_KEY);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain("would pay a proven cancellation to");
      expect(run.stdout).toContain("an address nobody controls");
    } finally {
      await plantPortal(arbitrum, PORTAL_FIXTURES.v2_12);
    }
  }, 240_000);

  it("fills a USDT-like token from a solver with an allowance standing: zero first", async () => {
    // A token that returns nothing and refuses a nonzero allowance moved to another, as USDT does.
    const usdt = await base.plant(
      `${fixture("NoReturnERC20")}${encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint8" }],
        ["Tether USD", "USDT", 6],
      ).slice(2)}` as Hex,
    );
    await base.mint(usdt, SOLVER.address, 10n * AMOUNT);
    const portal = getAddress(ecoRoutesPortal("base"));
    await base.send(
      createWalletClient({ account: SOLVER, transport: http(base.rpcUrl) }),
      usdt,
      encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [portal, 1n] }),
    );
    const store = mkdtempSync(join(work, "store-"));
    const usdtFile = join(work, "usdt.sauce.ts");
    writeFileSync(
      usdtFile,
      INTENT.replace("USDC.transfer(", `Token(${usdt.toLowerCase()}n).transfer(`),
    );
    const start = await now(base);
    const out = jsonOf(
      await sauce(
        ...["intent", "publish", usdtFile, ...intentFlags(start + 3600n, start + 7200n)],
        ...["--rpc-url", arbitrum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );
    const hash = (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
    const filled = await lifecycle(
      "fill",
      hash,
      store,
      ...["--send", "--private-key", SOLVER_KEY, "--yes", "--json"],
    );
    expect(filled.code).toBe(0);
    const [sent] = (JSON.parse(filled.stdout) as { intents: Array<Record<string, unknown>> })
      .intents;
    expect((sent!.transactions as Array<{ what: string }>).map((tx) => tx.what)).toEqual([
      "reset the solver's USDT allowance to the Portal",
      "approve the Portal for 1 USDT",
      expect.stringMatching(/^Portal\.fulfillAndProve\(/),
    ]);
    expect(await base.balanceOf(usdt, RECIPIENT)).toBe(AMOUNT);
  }, 240_000);

  it("makes an intent from flags, writes its file, rehearses both sides, publishes and stores it", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const out = join(work, "made.sauce.ts");
    const run = await sauce(
      ...["intent", "publish", "--source", "arbitrum", "--destination", "base"],
      // Amounts no other test publishes: an intent equal to one already claimed is refused.
      ...["--token", "USDC", "--amount", "1.25", "--recipient", RECIPIENT],
      ...["--reward-token", "USDC", "--reward", "1.3", "--prover", "HyperProver"],
      ...["--fill-deadline", "+1h", "--reward-deadline", "+2h", "--out", out],
      ...["--config", config, "--private-key", OWNER_KEY, "--yes", "--store", store, "--json"],
    );
    expect(run.code).toBe(0);
    // What it made and rehearsed, before anything was sent.
    expect(run.stderr).toContain(`Wrote ${out}:`);
    expect(run.stderr).toContain("Publishing, rehearsed on arbitrum:");
    expect(run.stderr).toContain("Filling, rehearsed on base (as a solver will):");
    expect(run.stderr).toMatch(/the solver's costs on base: ~250000 gas/);
    expect(readFileSync(out, "utf8")).toContain(
      `USDC.transfer(${RECIPIENT.toLowerCase()}n, 1250000n);`,
    );
    const published = JSON.parse(run.stdout) as { intents: Array<{ intentHash: Hex }> };
    const hash = published.intents[0]!.intentHash;
    expect(existsSync(join(store, hash, "intent.json"))).toBe(true);
    const status = jsonOf(
      await sauce("intent", "status", hash, "--config", config, "--store", store, "--json"),
    );
    const [one] = status.intents as Array<{
      status: { state: string; can: { fill: { ok: boolean } } };
    }>;
    expect(one!.status.state).toBe("funded");
    expect(one!.status.can.fill.ok).toBe(true);
  }, 240_000);

  it("prints the transactions unsigned with no signer, and imports a published intent", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(arbitrum);
    const out = jsonOf(
      await sauce(
        "intent",
        "publish",
        file,
        ...intentFlags(start + 3600n, start + 7200n),
        ...["--rpc-url", arbitrum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );
    const hash = (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
    const publishTx = (out.transactions as Array<{ what: string; hash: Hex }>).find(
      (tx) => tx.what === "publishAndFund",
    )!.hash;
    // A fresh store learns it from the transaction alone.
    const fresh = mkdtempSync(join(work, "store-"));
    const imported = jsonOf(
      await sauce(
        ...["intent", "import", publishTx, "--chain", "arbitrum"],
        ...["--config", config, "--store", fresh, "--json"],
      ),
    );
    expect((imported.intents as Array<{ record: { intentHash: Hex } }>)[0]!.record.intentHash).toBe(
      hash,
    );
    expect(readFileSync(join(fresh, hash, "intent.json"), "utf8")).toBe(
      readFileSync(join(store, hash, "intent.json"), "utf8"),
    );
    // Proving an unfilled intent: nothing to prove.
    const prove = await lifecycle("prove", hash, fresh);
    expect(prove.code).toBe(1);
    expect(prove.stdout).toContain("neither filled nor cancelled");
    const list = await sauceWith({}, "intent", "list", "--config", config, "--store", fresh);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(hash);
    expect(list.stdout).toContain("funded");
  }, 240_000);
});
