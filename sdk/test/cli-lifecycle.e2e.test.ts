/**
 * An intent's whole life through the `sauce` command, on two anvils standing in for Ethereum (the
 * source) and Base (the destination): published and funded on Ethereum from the creator's wallet,
 * stored with `sauce intent import`, filled and proven on Base as a solver does it (`fill --send`),
 * the proof carried back, claimed on Ethereum — and the creator's side, refunded after the reward's
 * deadline, or cancelled on Base after the route's deadline, the cancellation proven and refunded
 * before the reward's. And the same life for an intent whose body is a program, through the
 * routes Portal helpers alone.
 *
 * EVERY INTENT IS BUILT BY HAND (`assembleIntent`) and published with `intentSourceTxs`, the
 * transactions any wallet sends: a transfer of the reward into the intent's vault, then
 * `Portal.publish` (or the approvals and `publishAndFund`). Opening an intent from a program is
 * coming soon, so nothing here compiles one that does; what is under test is everything that acts
 * on an intent once it exists, which is the same whoever published it.
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
  bytesToHex,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  numberToHex,
  pad,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { SAUCE_INTENT_POT_SALT } from "../src/deployments/pot.js";
import { v12EngineAddress } from "../src/deployments/v12-addresses.js";
import { destinationExecutionFee } from "../src/evm/execution-fee.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { assembleIntent } from "../src/routes/intent.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import {
  CANCELLED_CLAIMANT,
  fulfillAndProveTx,
  fulfillApprovalTxs,
  hyperlaneProverData,
  intentSourceTxs,
  isIntentFundedCall,
  proverFeeCall,
  provenIntentCall,
  withdrawTx,
  type IntentFundVia,
  type PortalTx,
} from "../src/routes/portal.js";
import { buildSauceEvmCall, sauceEvmDeployPotCall } from "../src/routes/sauce-calls.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import type { Intent } from "../src/routes/types.js";
import {
  describeEvm,
  FEE,
  fixture,
  jsonOf,
  OWNER,
  OWNER_KEY,
  registered,
  sauce,
  sauceWith,
  startChain,
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
const TRANSFER = parseAbi(["function transfer(address, uint256)"]);

describeEvm("the intent lifecycle: publish, fill and prove, claim; refund; cancel", () => {
  let ethereum: LocalChain;
  let base: LocalChain;
  let work: string;
  let config: string;
  let ethereumUsdc: Address;
  let baseUsdc: Address;
  let ethereumMailbox: Address;
  let baseMailbox: Address;
  /** Each intent's own salt, so no two built here are ever one intent. */
  let salts = 0;

  const now = async (local: LocalChain): Promise<bigint> =>
    (await local.publicClient.getBlock()).timestamp;
  /** Moves `local`'s clock on by `seconds`, and mines a block there. */
  const warp = async (local: LocalChain, seconds: number): Promise<void> => {
    await local.testClient.increaseTime({ seconds });
    await local.testClient.mine({ blocks: 1 });
  };
  /** `amount` of Base's `token` to `RECIPIENT`, for Ethereum USDC: a route of one transfer, which
   *  the Executor runs. */
  const bridge = (route: bigint, reward: bigint, token: Address = baseUsdc): Intent =>
    assembleIntent(
      requireChain("ethereum"),
      requireChain("base"),
      {
        salt: numberToHex(++salts, { size: 32 }),
        deadline: route,
        portal: ecoRoutesPortal("base"),
        tokens: [{ token, amount: AMOUNT }],
        calls: [
          {
            target: token,
            data: encodeFunctionData({
              abi: TRANSFER,
              functionName: "transfer",
              args: [RECIPIENT, AMOUNT],
            }),
            value: 0n,
          },
        ],
      },
      {
        deadline: reward,
        creator: OWNER.address,
        prover: ecoRoutesProver("ethereum", "base"),
        tokens: [{ token: ethereumUsdc, amount: REWARD }],
      },
    );
  /** Sends `txs` in order from `from` on `local`, returning their hashes. */
  const sendAll = async (
    local: LocalChain,
    from: Parameters<LocalChain["send"]>[0],
    txs: readonly PortalTx[],
  ): Promise<Hex[]> => {
    const hashes: Hex[] = [];
    for (const tx of txs) hashes.push(await local.send(from, tx.to, tx.data, tx.value));

    return hashes;
  };
  /** The creator publishes `intent` from their wallet, as any wallet would; `sauce intent import`
   *  stores it from the transaction that published it. Returns its hash. */
  const publishAndImport = async (
    store: string,
    intent: Intent,
    fundVia: IntentFundVia = "transfer",
  ): Promise<Hex> => {
    const sent = await sendAll(
      ethereum,
      ethereum.owner,
      intentSourceTxs(intent, { portal: ecoRoutesPortal("ethereum") }, { fundVia }),
    );
    const imported = jsonOf(
      await sauce(
        ...["intent", "import", sent.at(-1)!, "--chain", "ethereum"],
        ...["--config", config, "--store", store, "--json"],
      ),
    );
    const [one] = imported.intents as Array<{ record: { intentHash: Hex } }>;
    expect(one!.record.intentHash).toBe(hashIntent(intent).intentHash);

    return one!.record.intentHash;
  };
  /** The bridge intent, published and stored: its hash. */
  const publish = (store: string, route: bigint, reward: bigint): Promise<Hex> =>
    publishAndImport(store, bridge(route, reward));
  const lifecycle = (command: string, hash: Hex, store: string, ...flags: string[]) =>
    sauce("intent", command, hash, "--config", config, "--store", store, ...flags);

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-lifecycle-e2e-"));
    [ethereum, base] = await Promise.all([startChain("ethereum"), startChain("base")]);
    ethereumUsdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    baseUsdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    for (const local of [ethereum, base]) await plantPortal(local, PORTAL_FIXTURES.v2_12);
    ethereumMailbox = await deployMailbox(ethereum, HYPERLANE_FEE);
    baseMailbox = await deployMailbox(base, HYPERLANE_FEE);
    await plantHyperProver(ethereum, ethereumMailbox);
    await plantHyperProver(base, baseMailbox);
    // The creator holds the rewards; the solver what it delivers, and gas on Base.
    await ethereum.mint(ethereumUsdc, OWNER.address, 20n * REWARD);
    await base.mint(baseUsdc, SOLVER.address, 10n * AMOUNT);
    config = join(work, "sauce.config.json");
    writeFileSync(
      config,
      JSON.stringify({ rpcUrls: { "1": ethereum.rpcUrl, "8453": base.rpcUrl } }),
    );
  }, 180_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await Promise.all([ethereum?.stop(), base?.stop()]);
  });

  it("publishes from a wallet, imports, fills and proves, carries the proof, and claims", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 3600n, start + 7200n);
    // import stored it: the intent once, and what happened.
    const stored = join(store, hash, "intent.json");
    expect(existsSync(stored)).toBe(true);
    const events = () =>
      readFileSync(join(store, hash, "events.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { event: string }).event);
    // Imported, and funded by the transfer before `publish`, which the Portal counts.
    const published = events();
    expect(published).toEqual(["imported", "funded"]);
    // Funded by a transfer into its vault, the default: the Portal's status stays Initial, and
    // isIntentFunded counts it funded, which is what a solver checks.
    const shownFunded = jsonOf(
      await sauce("intent", "show", hash, "--config", config, "--store", store, "--json"),
    );
    expect(shownFunded.status).toMatchObject({
      state: "funded",
      source: { rewardStatus: "Initial", funded: true },
      can: { fill: { ok: true } },
    });

    // The simulation, by hash: fulfillAndProve with the Hyperlane fee in its value.
    const simulated = jsonOf(
      await lifecycle("fill", hash, store, "--solver", SOLVER.address, "--json"),
    );
    const [planned] = simulated.intents as Array<Record<string, unknown>>;
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
    expect(events()).toEqual([...published, "filled", "proving"]);

    // Not claimable before the proof arrives: said, with the message it travels as.
    const early = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("Not claimable yet");
    expect(early.stderr).toContain("Hyperlane message 0x");

    // Hyperlane's delivery, mocked; the provers on both sides are real.
    expect(await relay(base, baseMailbox, transactions[1]!.hash, ethereum, ethereumMailbox)).toBe(
      1,
    );
    const shown = jsonOf(
      await sauce("intent", "show", hash, "--config", config, "--store", store, "--json"),
    );
    expect((shown.status as { state: string }).state).toBe("proven");

    const before = await ethereum.balanceOf(ethereumUsdc, SOLVER.address);
    const claimed = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY, "--json");
    expect(claimed.code).toBe(0);
    expect(await ethereum.balanceOf(ethereumUsdc, SOLVER.address)).toBe(before + REWARD);
    expect(events()).toEqual([...published, "filled", "proving", "claimed"]);

    // Nothing is left for the creator: refund says why.
    const refund = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(refund.code).toBe(1);
    expect(refund.stdout).toContain("the vault holds nothing to refund");
  }, 240_000);

  it("an intent whose body is a program, through the Portal helpers alone: filled, proven, claimed", async () => {
    type Wallet = Parameters<LocalChain["send"]>[0];
    const solverOn = (local: LocalChain): Wallet =>
      createWalletClient({ account: SOLVER, transport: http(local.rpcUrl) });
    const read = async <T>(local: LocalChain, call: { to: Hex; data: Hex; decode(r: Hex): T }) =>
      call.decode((await local.publicClient.call({ to: call.to, data: call.data })).data!);

    // The shared Pot a program body cooks on. A solver deploys it once per Portal; here, the test.
    const executor = ecoRoutesExecutorOf(ecoRoutesPortal("base"));
    const deploy = sauceEvmDeployPotCall({ owner: executor, salt: SAUCE_INTENT_POT_SALT });
    await base.send(base.deployer, deploy.to, deploy.data);
    const pot = destinationPot("base");
    expect(await base.balanceOf(baseUsdc, pot)).toBe(0n);
    const fee = await read(base, destinationExecutionFee());
    expect(fee).toBe(FEE);

    // The body, compiled for Base and cooked on the shared Pot with the Kitchen's fee; the route
    // first moves what the solver delivered from the Executor into the Pot.
    const program = compileSauceProgram(
      "base",
      "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held);",
      { defines: { RECIPIENT: BigInt(RECIPIENT) } },
    );
    const start = [await now(base), await now(ethereum)].reduce((a, b) => (a > b ? a : b));
    const built = (nativeAmount: bigint): Intent => {
      const cook = buildSauceEvmCall({
        pot,
        engine: v12EngineAddress() as Hex,
        program: bytesToHex(program.bytecode),
        value: fee,
      });

      return assembleIntent(
        requireChain("ethereum"),
        requireChain("base"),
        {
          salt: numberToHex(++salts, { size: 32 }),
          deadline: start + 3600n,
          portal: ecoRoutesPortal("base"),
          nativeAmount,
          tokens: [{ token: baseUsdc, amount: AMOUNT }],
          calls: [
            {
              target: baseUsdc,
              data: encodeFunctionData({
                abi: TRANSFER,
                functionName: "transfer",
                args: [pot, AMOUNT],
              }),
              value: 0n,
            },
            { target: cook.to, data: cook.data, value: cook.value },
          ],
        },
        {
          deadline: start + 7200n,
          creator: OWNER.address,
          prover: ecoRoutesProver("ethereum", "base"),
          tokens: [{ token: ethereumUsdc, amount: REWARD }],
        },
      );
    };
    const intent = built(FEE);
    expect(intent.route.calls.map((call) => call.value)).toEqual([0n, FEE]);

    // ---- Ethereum: the creator pays the reward into the vault and publishes --------------------
    await ethereum.mint(ethereumUsdc, OWNER.address, REWARD);
    const portal = { portal: ecoRoutesPortal("ethereum") };
    await sendAll(ethereum, ethereum.owner, intentSourceTxs(intent, portal));
    expect(await read(ethereum, isIntentFundedCall(intent, portal))).toBe(true);

    // ---- Base: the solver fills and proves -----------------------------------------------------
    await base.mint(baseUsdc, SOLVER.address, AMOUNT);
    await sendAll(base, solverOn(base), fulfillApprovalTxs(intent));
    const prover = ecoRoutesProver("base", "ethereum");
    const data = hyperlaneProverData({ sourceProver: intent.reward.prover });
    const proof = { prover, sourceDomain: intent.sourceChainId, data };
    const proverFee = await read(
      base,
      proverFeeCall({
        ...proof,
        destinationChainId: intent.destination,
        pairs: [{ intentHash: hashIntent(intent).intentHash, claimant: SOLVER.address }],
      }),
    );
    const fill = fulfillAndProveTx(intent, { claimant: SOLVER.address, ...proof, fee: proverFee });

    // CONTROL: the same intent with no native amount cannot pay its cook's fee, so its fill
    // reverts, in the same state where the paid one's goes through.
    const simulate = (tx: PortalTx) =>
      base.publicClient.call({
        account: SOLVER.address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
    await expect(
      simulate(
        fulfillAndProveTx(built(0n), { claimant: SOLVER.address, ...proof, fee: proverFee }),
      ),
    ).rejects.toThrow();
    await expect(simulate(fill)).resolves.toBeDefined();

    const paid = await base.balanceOf(baseUsdc, RECIPIENT);
    expect(fill.value).toBe(FEE + proverFee);
    const [filled] = await sendAll(base, solverOn(base), [fill]);
    expect(await base.balanceOf(baseUsdc, RECIPIENT)).toBe(paid + AMOUNT);
    expect(await base.balanceOf(baseUsdc, pot)).toBe(0n);
    expect(await base.publicClient.getBalance({ address: executor })).toBe(0n);

    // ---- The proof reaches Ethereum's HyperProver, the reward's prover; the solver claims ------
    expect(await relay(base, baseMailbox, filled!, ethereum, ethereumMailbox)).toBe(1);
    expect(getAddress((await read(ethereum, provenIntentCall(intent))).claimant)).toBe(
      SOLVER.address,
    );
    const before = await ethereum.balanceOf(ethereumUsdc, SOLVER.address);
    await sendAll(ethereum, solverOn(ethereum), [withdrawTx(intent, portal)]);
    expect(await ethereum.balanceOf(ethereumUsdc, SOLVER.address)).toBe(before + REWARD);
  }, 240_000);

  it("an intent published through publishAndFund is recorded Funded", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publishAndImport(
      store,
      bridge(start + 3605n, start + 7200n),
      "publishAndFund",
    );
    const shown = jsonOf(
      await sauce("intent", "show", hash, "--config", config, "--store", store, "--json"),
    );
    expect(shown.status).toMatchObject({
      state: "funded",
      source: { rewardStatus: "Funded", funded: true },
    });
  }, 240_000);

  it("refunds an unfilled intent from the reward's deadline, not before", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(ethereum);
    const hash = await publish(store, start + 60n, start + 600n);
    const early = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("not before the reward's deadline");
    await warp(ethereum, 700);
    const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
    const refunded = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY, "--json");
    expect(refunded.code).toBe(0);
    expect(await ethereum.balanceOf(ethereumUsdc, OWNER.address)).toBe(before + REWARD);
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
      ...["--private-key", OWNER_KEY, "--yes", "--json"],
    );
    expect(proved.code).toBe(0);
    const proof = JSON.parse(proved.stdout) as { transactions: Array<{ hash: Hex }> };
    expect(
      await relay(base, baseMailbox, proof.transactions[0]!.hash, ethereum, ethereumMailbox),
    ).toBe(1);
    // The sentinel is recorded on the source, and pays no claimant.
    const claim = await lifecycle("claim", hash, store, "--private-key", SOLVER_KEY);
    expect(claim.code).toBe(1);
    expect(claim.stdout).toContain("pays no claimant");
    const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
    const refunded = await lifecycle("refund", hash, store, "--private-key", SOLVER_KEY);
    expect(refunded.code).toBe(0);
    expect(await ethereum.balanceOf(ethereumUsdc, OWNER.address)).toBe(before + REWARD);
    expect(getAddress(CANCELLED_CLAIMANT)).toBe("0xe685056aEc77686A83E2a6bDf37c6f71dD2fdB5f");
  }, 240_000);

  it("proves two fills in one message, leaves out one proven, claims both in one batchWithdraw", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const one = await publish(store, start + 3601n, start + 7200n);
    const two = await publish(store, start + 3602n, start + 7200n);
    const three = await publish(store, start + 3603n, start + 7200n);
    const send = ["--send", "--private-key", SOLVER_KEY, "--yes", "--json"];
    for (const hash of [one, two]) {
      expect((await lifecycle("fill", hash, store, "--no-prove", ...send)).code).toBe(0);
    }
    // The third proves itself as it fills, and its proof is carried.
    const third = jsonOf(await lifecycle("fill", three, store, ...send));
    const fulfill = (
      third.intents as Array<{ transactions: Array<{ kind: string; hash: Hex }> }>
    )[0]!.transactions.find((tx) => tx.kind === "fulfill")!.hash;
    expect(await relay(base, baseMailbox, fulfill, ethereum, ethereumMailbox)).toBe(1);

    // One proof for the two left unproven, the third left out with a note.
    const proved = await sauce(
      ...["intent", "prove", one, two, three, "--config", config, "--store", store],
      ...["--private-key", SOLVER_KEY, "--yes", "--json"],
    );
    expect(proved.code).toBe(0);
    expect(proved.stderr).toContain(`${three} is proven on ethereum already`);
    const proof = JSON.parse(proved.stdout) as {
      transactions: Array<{ hash: Hex; value: string }>;
      messages: unknown[];
    };
    expect(proof.transactions).toHaveLength(1);
    expect(proof.transactions[0]!.value).toBe(String(HYPERLANE_FEE));
    expect(proof.messages).toHaveLength(1);
    expect(
      await relay(base, baseMailbox, proof.transactions[0]!.hash, ethereum, ethereumMailbox),
    ).toBe(1);

    // Both claimed in one transaction.
    const before = await ethereum.balanceOf(ethereumUsdc, SOLVER.address);
    const claimed = await sauce(
      ...["intent", "claim", one, two, "--config", config, "--store", store],
      ...["--private-key", SOLVER_KEY, "--json"],
    );
    expect(claimed.code).toBe(0);
    const claim = JSON.parse(claimed.stdout) as {
      transactions: Array<{ what: string }>;
      claims: unknown[];
    };
    expect(claim.transactions).toHaveLength(1);
    expect(claim.transactions[0]!.what).toContain("Portal.batchWithdraw(2 intents)");
    expect(claim.claims).toHaveLength(2);
    expect(await ethereum.balanceOf(ethereumUsdc, SOLVER.address)).toBe(before + 2n * REWARD);
  }, 240_000);

  it("cancels and proves in one transaction with --and-prove, paying the fee", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 60n, start + 100_000n);
    await warp(base, 120);
    const cancelled = await lifecycle(
      "cancel",
      hash,
      store,
      ...["--and-prove", "--private-key", OWNER_KEY, "--yes", "--json"],
    );
    expect(cancelled.code).toBe(0);
    // It proves at once, without waiting for the cancel to be final: said.
    expect(cancelled.stderr).toMatch(/final/);
    const [entry] = (
      JSON.parse(cancelled.stdout) as {
        intents: Array<{
          transactions: Array<{ hash: Hex; value: string; data: Hex }>;
          messages: unknown[];
        }>;
      }
    ).intents;
    expect(entry!.transactions[0]!.value).toBe(String(HYPERLANE_FEE));
    expect(entry!.messages).toHaveLength(1);
    expect(
      await relay(base, baseMailbox, entry!.transactions[0]!.hash, ethereum, ethereumMailbox),
    ).toBe(1);
    const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
    const refunded = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(refunded.code).toBe(0);
    expect(await ethereum.balanceOf(ethereumUsdc, OWNER.address)).toBe(before + REWARD);
  }, 240_000);

  it("sends nothing when the prover's fee rises while the person is deciding", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const hash = await publish(store, start + 3604n, start + 7200n);
    // The question stands while the Hyperlane fee doubles: the plan is made again once it is
    // answered, and spends more than was approved, so nothing goes out.
    const raising = {
      canAsk: () => true,
      confirm: async () => {
        await deployMailbox(base, 2n * HYPERLANE_FEE, baseMailbox);

        return true;
      },
    };
    const delivered = await base.balanceOf(baseUsdc, RECIPIENT);
    try {
      const fill = await sauceWith(
        raising,
        ...["intent", "fill", hash, "--config", config, "--store", store],
        ...["--send", "--private-key", SOLVER_KEY],
      );
      expect(fill.code).toBe(1);
      expect(fill.stderr).toContain(`more than the ${formatEther(HYPERLANE_FEE)} ETH you approved`);
      expect(await base.balanceOf(baseUsdc, RECIPIENT)).toBe(delivered);
      // Filled without its proof, then proven: the same for the proof's fee.
      await deployMailbox(base, HYPERLANE_FEE, baseMailbox);
      expect(
        (
          await lifecycle(
            "fill",
            hash,
            store,
            ...["--send", "--no-prove", "--private-key", SOLVER_KEY, "--yes"],
          )
        ).code,
      ).toBe(0);
      const prove = await sauceWith(
        raising,
        ...["intent", "prove", hash, "--config", config, "--store", store],
        ...["--private-key", SOLVER_KEY],
      );
      expect(prove.code).toBe(1);
      expect(prove.stderr).toContain(
        `more than the ${formatEther(HYPERLANE_FEE)} ETH you approved`,
      );
    } finally {
      await deployMailbox(base, HYPERLANE_FEE, baseMailbox);
    }
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
    await plantPortal(ethereum, PORTAL_FIXTURES.pre);
    try {
      const run = await lifecycle("cancel", hash, store, "--private-key", OWNER_KEY);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain("would pay a proven cancellation to");
      expect(run.stdout).toContain("an address nobody controls");
    } finally {
      await plantPortal(ethereum, PORTAL_FIXTURES.v2_12);
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
    const start = await now(base);
    const hash = await publishAndImport(store, bridge(start + 3600n, start + 7200n, usdt));
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

  it("imports the same record into any store, and lists it; an unfilled intent has nothing to prove", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(ethereum);
    const intent = bridge(start + 3600n, start + 7200n);
    const sent = await sendAll(
      ethereum,
      ethereum.owner,
      intentSourceTxs(intent, { portal: ecoRoutesPortal("ethereum") }),
    );
    const hash = hashIntent(intent).intentHash;
    // Two stores learn it from the transaction alone, byte for byte the same.
    const other = mkdtempSync(join(work, "store-"));
    for (const into of [store, other]) {
      const imported = jsonOf(
        await sauce(
          ...["intent", "import", sent.at(-1)!, "--chain", "ethereum"],
          ...["--config", config, "--store", into, "--json"],
        ),
      );
      expect(
        (imported.intents as Array<{ record: { intentHash: Hex } }>)[0]!.record.intentHash,
      ).toBe(hash);
    }
    expect(readFileSync(join(other, hash, "intent.json"), "utf8")).toBe(
      readFileSync(join(store, hash, "intent.json"), "utf8"),
    );
    // Proving an unfilled intent: nothing to prove.
    const prove = await lifecycle("prove", hash, store);
    expect(prove.code).toBe(1);
    expect(prove.stdout).toContain("neither filled nor cancelled");
    const list = await sauceWith({}, "intent", "list", "--config", config, "--store", store);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(hash);
    expect(list.stdout).toContain("funded");
  }, 240_000);
});
