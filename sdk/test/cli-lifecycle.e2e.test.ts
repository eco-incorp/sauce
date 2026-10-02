/**
 * An intent's whole life through the `sauce` command, on two anvils standing in for Ethereum (the
 * source) and Base (the destination): published and funded on Ethereum, filled and proven on Base
 * as a solver does it (`fill --send`), the proof carried back, claimed on Ethereum — and the
 * creator's side, refunded after the reward's deadline, or cancelled on Base after the route's
 * deadline, the cancellation proven and refunded before the reward's. And the same life for an
 * intent built in TypeScript (`Base(body, options).reward(...)`) with nothing the SDK records
 * passed: no Portal, prover, Pot, engine or native amount; and for the nested-intents guide's
 * example, whose body opens the next intent on Base when it runs.
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
import { fileURLToPath } from "node:url";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  pad,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { destinationExecutionFee } from "../src/evm/execution-fee.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import {
  ecoRoutesContract,
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { Base, Ethereum } from "../src/routes/chain-exports.generated.js";
import { encodeRouteEvm } from "../src/routes/encode.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import {
  CANCELLED_CLAIMANT,
  fulfillAndProveTx,
  fulfillApprovalTxs,
  hyperlaneProverData,
  proverFeeCall,
  provenIntentCall,
  withdrawTx,
  type PortalTx,
} from "../src/routes/portal.js";
import { sauceEvmDeployPotCall } from "../src/routes/sauce-calls.js";
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
const TRANSFER = parseAbi(["function transfer(address, uint256)"]);

/** Base USDC to `recipient`, for Ethereum USDC: a body of plain transfers, run by the Executor. */
const INTENT = [
  "function main(recipient: Address, amount: Uint256, reward: Uint256) {",
  "  Base(() => {",
  "    USDC.transfer(recipient, amount);",
  "  }).reward({ tokens: [{ token: USDC, amount: reward }] });",
  "}",
  "",
].join("\n");

describeEvm("the intent lifecycle: publish, fill and prove, claim; refund; cancel", () => {
  let ethereum: LocalChain;
  let base: LocalChain;
  let work: string;
  let config: string;
  let file: string;
  let ethereumUsdc: Address;
  let baseUsdc: Address;
  let ethereumMailbox: Address;
  let baseMailbox: Address;

  /** The flags every intent here is built with, its deadlines given, and main's arguments. */
  const intentFlags = (route: bigint, reward: bigint): string[] => [
    ...["--chain", "ethereum"],
    ...["--intent-deadline", String(route), "--intent-reward-deadline", String(reward)],
    ...["--intent-creator", OWNER.address],
    ...["--args", RECIPIENT, String(AMOUNT), String(REWARD)],
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
        ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );

    return (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
  };
  const lifecycle = (command: string, hash: Hex, store: string, ...flags: string[]) =>
    sauce("intent", command, hash, "--config", config, "--store", store, ...flags);

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-lifecycle-e2e-"));
    [ethereum, base] = await Promise.all([
      startChain("ethereum", 9400 + WORKER),
      startChain("base", 9450 + WORKER),
    ]);
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
    file = join(work, "bridge.sauce.ts");
    writeFileSync(file, INTENT);
  }, 180_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await Promise.all([ethereum?.stop(), base?.stop()]);
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
    // Funded by a transfer into its vault, the default: the Portal's status stays Initial, and
    // isIntentFunded counts it funded, which is what a solver checks.
    const published = jsonOf(
      await sauce("intent", "show", hash, "--config", config, "--store", store, "--json"),
    );
    expect(published.status).toMatchObject({
      state: "funded",
      source: { rewardStatus: "Initial", funded: true },
      can: { fill: { ok: true } },
    });

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
      ...["--send", "--private-key", SOLVER_KEY, "--auto-approve", "--json"],
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
    expect(events()).toEqual(["published", "funded", "filled", "proving", "claimed"]);

    // Nothing is left for the creator: refund says why.
    const refund = await lifecycle("refund", hash, store, "--private-key", OWNER_KEY);
    expect(refund.code).toBe(1);
    expect(refund.stdout).toContain("the vault holds nothing to refund");
  }, 240_000);

  it("an intent built in TypeScript with only its own values: published, filled, proven, claimed", async () => {
    // What the caller passes is theirs: the deadlines, the creator, the amounts, and the fee read
    // from Base's Kitchen. The Portals, the prover, the Pot, the engine and the native amount the
    // solver sends are the SDK's — and the anvils hold eco-routes at the registry's addresses, so
    // what it picks is what runs.
    type Wallet = Parameters<LocalChain["send"]>[0];
    const solverOn = (local: LocalChain): Wallet =>
      createWalletClient({ account: SOLVER, transport: http(local.rpcUrl) });
    const sendAll = async (local: LocalChain, from: Wallet, txs: readonly PortalTx[]) => {
      const hashes: Hex[] = [];
      for (const tx of txs) hashes.push(await local.send(from, tx.to, tx.data, tx.value));

      return hashes;
    };
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

    const start = [await now(base), await now(ethereum)].reduce((a, b) => (a > b ? a : b));
    const options = {
      execution: { value: fee },
      deadline: start + 3600n,
      defines: { RECIPIENT: BigInt(RECIPIENT) },
      // Delivered to the Executor; the program spends from the Pot, so the first call moves it.
      tokens: [{ token: baseUsdc, amount: AMOUNT }],
      precalls: [
        {
          target: baseUsdc,
          data: encodeFunctionData({
            abi: TRANSFER,
            functionName: "transfer",
            args: [pot, AMOUNT],
          }),
        },
      ],
    };
    const reward = {
      source: "ethereum",
      creator: OWNER.address,
      deadline: start + 7200n,
      tokens: [{ token: ethereumUsdc, amount: REWARD }],
    } as const;
    // A program, not a token-only body: it cooks on the Pot and pays the Kitchen's fee.
    const body = "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held);";
    const built = openRoute("base", body, options).reward(reward);

    expect(built.intent.route.portal).toBe(toUniversalAddress(ecoRoutesPortal("base")));
    expect(built.intent.reward.prover).toBe(
      toUniversalAddress(ecoRoutesContract("ethereum", "HyperProver")),
    );
    expect(built.intent.route.calls.map((call) => call.value)).toEqual([0n, FEE]);
    expect(built.intent.route.nativeAmount).toBe(FEE);

    // ---- Ethereum: the creator pays the reward into the vault and publishes --------------------
    await ethereum.mint(ethereumUsdc, OWNER.address, REWARD);
    await sendAll(ethereum, ethereum.owner, built.sourceTxs());
    expect(await read(ethereum, built.fundedCall())).toBe(true);

    // ---- Base: the solver fills and proves -----------------------------------------------------
    await base.mint(baseUsdc, SOLVER.address, AMOUNT);
    await sendAll(base, solverOn(base), fulfillApprovalTxs(built.intent));
    const prover = ecoRoutesProver("base", "ethereum");
    const data = hyperlaneProverData({ sourceProver: built.intent.reward.prover });
    const proof = { prover, sourceDomain: built.intent.sourceChainId, data };
    const proverFee = await read(
      base,
      proverFeeCall({
        ...proof,
        destinationChainId: built.intent.destination,
        pairs: [{ intentHash: built.hash().intentHash, claimant: SOLVER.address }],
      }),
    );
    const fill = fulfillAndProveTx(built.intent, {
      claimant: SOLVER.address,
      ...proof,
      fee: proverFee,
    });

    // CONTROL: the same intent with no native amount cannot pay its cook's fee, so its fill
    // reverts, in the same state where the defaulted one's goes through.
    const unpaid = openRoute("base", body, { ...options, nativeAmount: 0n }).reward(reward);
    const rehearse = (tx: PortalTx) =>
      base.publicClient.call({
        account: SOLVER.address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
    await expect(
      rehearse(
        fulfillAndProveTx(unpaid.intent, { claimant: SOLVER.address, ...proof, fee: proverFee }),
      ),
    ).rejects.toThrow();
    await expect(rehearse(fill)).resolves.toBeDefined();

    const paid = await base.balanceOf(baseUsdc, RECIPIENT);
    expect(fill.value).toBe(FEE + proverFee);
    const [filled] = await sendAll(base, solverOn(base), [fill]);
    expect(await base.balanceOf(baseUsdc, RECIPIENT)).toBe(paid + AMOUNT);
    expect(await base.balanceOf(baseUsdc, pot)).toBe(0n);
    expect(await base.publicClient.getBalance({ address: executor })).toBe(0n);

    // ---- The proof reaches Ethereum's HyperProver, the reward's prover; the solver claims ------
    expect(await relay(base, baseMailbox, filled!, ethereum, ethereumMailbox)).toBe(1);
    expect(getAddress((await read(ethereum, provenIntentCall(built.intent))).claimant)).toBe(
      SOLVER.address,
    );
    const before = await ethereum.balanceOf(ethereumUsdc, SOLVER.address);
    await sendAll(ethereum, solverOn(ethereum), [
      withdrawTx(built.intent, { portal: ecoRoutesPortal("ethereum") }),
    ]);
    expect(await ethereum.balanceOf(ethereumUsdc, SOLVER.address)).toBe(before + REWARD);
  }, 240_000);

  it("the nested-intents guide's file: published on Ethereum, its body opens the next on Base", async () => {
    // docs/examples/nested-intent.sauce.ts, as written: all SauceScript, opened on Ethereum, its
    // main's arguments given with --args as the guide gives them.
    const nested = fileURLToPath(
      new URL("../../docs/examples/nested-intent.sauce.ts", import.meta.url),
    );
    const store = mkdtempSync(join(work, "store-"));
    const send = ["--send", "--private-key", SOLVER_KEY, "--auto-approve", "--json"];
    const pot = destinationPot("base");
    const deploy = sauceEvmDeployPotCall({
      owner: ecoRoutesExecutorOf(ecoRoutesPortal("base")),
      salt: SAUCE_INTENT_POT_SALT,
    });
    await base.send(base.deployer, deploy.to, deploy.data);
    expect(await base.balanceOf(baseUsdc, pot)).toBe(0n);

    // ---- Ethereum: the creator publishes the outer intent from a wallet -----------------------
    await ethereum.mint(ethereumUsdc, OWNER.address, REWARD);
    const start = [await now(base), await now(ethereum)].reduce((a, b) => (a > b ? a : b));
    const published = jsonOf(
      await sauce(
        ...["intent", "publish", nested, "--chain", "ethereum"],
        ...["--intent-creator", OWNER.address, "--intent-deadline", String(start + 3600n)],
        ...["--intent-reward-deadline", String(start + 7200n)],
        ...["--intent-execution-fee", String(FEE)],
        ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
        ...["--args", RECIPIENT, String(AMOUNT), String(REWARD)],
      ),
    );
    const outer = (published.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;

    // The guide's closure is the same intent: what the file's braces say, built in TypeScript.
    const PAYEE = BigInt(RECIPIENT);
    const closure = Base(
      () => {
        const amount = USDC.balanceOf(ctx.self());
        const payout = amount - amount / 1000n;
        Ethereum(() => {
          USDC.transfer(PAYEE, payout);
        }).reward({ tokens: [{ token: USDC, amount }] });
      },
      {
        execution: { value: FEE },
        deadline: start + 3600n,
        rewardDeadline: start + 7200n,
        creator: OWNER.address,
        defines: { PAYEE },
        tokens: [{ token: baseUsdc, amount: AMOUNT }],
        precalls: [
          {
            target: baseUsdc,
            data: encodeFunctionData({
              abi: TRANSFER,
              functionName: "transfer",
              args: [pot, AMOUNT],
            }),
          },
        ],
      },
    ).reward({
      source: "ethereum",
      deadline: start + 7200n,
      tokens: [{ token: ethereumUsdc, amount: REWARD }],
    });
    expect(closure.hash().intentHash).toBe(outer);

    // ---- Base: a solver fills it; the body measures what arrived and publishes the inner one ---
    await base.mint(baseUsdc, SOLVER.address, AMOUNT);
    const filled = jsonOf(await lifecycle("fill", outer, store, ...send));
    const fulfil = (
      filled.intents as Array<{ transactions: Array<{ kind: string; hash: Hex }> }>
    )[0]!.transactions.find((tx) => tx.kind === "fulfill")!.hash;
    expect(await base.balanceOf(baseUsdc, pot)).toBe(0n);
    const imported = jsonOf(
      await sauce(
        ...["intent", "import", fulfil, "--chain", "base"],
        ...["--config", config, "--store", store, "--json"],
      ),
    );
    const [inner] = imported.intents as Array<{
      record: {
        intentHash: Hex;
        destination: { chainId: number };
        route: { deadline: string };
        reward: {
          deadline: string;
          creator: string;
          prover: string;
          tokens: Array<{ token: string; amount: string }>;
        };
      };
    }>;
    // The whole delivery became its reward, in Base's USDC, escrowed on Base. Its deadlines and
    // creator are the file's, as every level's are; its prover is the registry's for Base to
    // Ethereum, which is Base's own HyperProver.
    expect(inner!.record.destination.chainId).toBe(1);
    expect(inner!.record.route.deadline).toBe(String(start + 3600n));
    expect(inner!.record.reward.deadline).toBe(String(start + 7200n));
    expect(getAddress(inner!.record.reward.creator)).toBe(OWNER.address);
    expect(getAddress(inner!.record.reward.prover)).toBe(
      getAddress(ecoRoutesProver("base", "ethereum")),
    );
    expect(inner!.record.reward.tokens.map((t) => [getAddress(t.token), BigInt(t.amount)])).toEqual(
      [[baseUsdc, AMOUNT]],
    );
    const status = jsonOf(await lifecycle("status", inner!.record.intentHash, store, "--json"));
    expect((status.intents as Array<{ status: { state: string } }>)[0]!.status.state).toBe(
      "funded",
    );

    // ---- Ethereum: a solver fills the inner one, in Ethereum's USDC, less the tenth of a percent
    const payout = AMOUNT - AMOUNT / 1000n;
    await ethereum.mint(ethereumUsdc, SOLVER.address, payout);
    const paid = await ethereum.balanceOf(ethereumUsdc, RECIPIENT);
    const innerFill = jsonOf(await lifecycle("fill", inner!.record.intentHash, store, ...send));
    expect(await ethereum.balanceOf(ethereumUsdc, RECIPIENT)).toBe(paid + payout);

    // ---- Its proof reaches Base's HyperProver, the prover the lowering chose for that level ----
    const innerFulfil = (
      innerFill.intents as Array<{ transactions: Array<{ kind: string; hash: Hex }> }>
    )[0]!.transactions.find((tx) => tx.kind === "fulfill")!.hash;
    expect(await relay(ethereum, ethereumMailbox, innerFulfil, base, baseMailbox)).toBe(1);
    const before = await base.balanceOf(baseUsdc, SOLVER.address);
    const claimed = await lifecycle(
      "claim",
      inner!.record.intentHash,
      store,
      ...["--private-key", SOLVER_KEY, "--json"],
    );
    expect(claimed.code).toBe(0);
    expect(await base.balanceOf(baseUsdc, SOLVER.address)).toBe(before + AMOUNT);
  }, 240_000);

  it("sauce-intents' fund-by-transfer publishes an intent built elsewhere, funded from a Pot", async () => {
    // The skill's file as written: the vault read and the publish go through the registry's Portal
    // by name, so nothing names the Portal here either.
    const program = fileURLToPath(
      new URL("../../skills/sauce-intents/examples/fund-by-transfer.sauce.ts", import.meta.url),
    );
    const start = await now(ethereum);
    // An intent encoded by something other than the program that publishes it.
    const built = openRoute("base", "function main() { return 1n; }", {
      execution: { value: FEE },
      deadline: start + 3600n,
    }).reward({
      source: "ethereum",
      creator: OWNER.address,
      deadline: start + 7200n,
      tokens: [{ token: ethereumUsdc, amount: REWARD }],
    });
    const { reward } = built.intent;
    const rewardJson = JSON.stringify({
      deadline: reward.deadline.toString(),
      creator: OWNER.address,
      prover: getAddress(ecoRoutesContract("ethereum", "HyperProver")),
      nativeAmount: "0",
      tokens: [{ token: ethereumUsdc, amount: REWARD.toString() }],
    });
    // The owner's Pot holds the reward it pays into the vault.
    const pot = v12PredictPot(OWNER.address, `0x${"00".repeat(32)}`) as Address;
    await ethereum.mint(ethereumUsdc, pot, REWARD);

    const run = jsonOf(
      await sauce(
        ...["run", program, "--chain", "ethereum", "--rpc-url", ethereum.rpcUrl],
        ...["--private-key", OWNER_KEY, "--auto-approve", "--json"],
        ...["--args", "8453", encodeRouteEvm(built.intent.route), rewardJson],
      ),
    );
    const { hash } = (run as { cook: { hash: Hex } }).cook;
    const receipt = await ethereum.publicClient.getTransactionReceipt({ hash });
    const [published] = parseEventLogs({
      abi: PortalABI,
      logs: receipt.logs,
      eventName: "IntentPublished",
    });
    expect(published!.args.intentHash).toBe(built.hash().intentHash);
    const funded = built.fundedCall();
    const answer = await ethereum.publicClient.call({ to: funded.to, data: funded.data });
    expect(funded.decode(answer.data!)).toBe(true);
    expect(await ethereum.balanceOf(ethereumUsdc, built.predictVault() as Address)).toBe(REWARD);
    expect(await ethereum.balanceOf(ethereumUsdc, pot)).toBe(0n);
  }, 240_000);

  it("publishes through publishAndFund with --intent-fund-via, recorded Funded", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now(base);
    const out = jsonOf(
      await sauce(
        ...["intent", "publish", file, ...intentFlags(start + 3605n, start + 7200n)],
        ...["--intent-fund-via", "publishAndFund"],
        ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );
    expect((out.transactions as Array<{ what: string }>).at(-1)!.what).toBe("publishAndFund");
    const hash = (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
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
    const unfinal = await lifecycle(
      "prove",
      hash,
      store,
      "--private-key",
      OWNER_KEY,
      "--auto-approve",
    );
    expect(unfinal.code).toBe(1);
    expect(unfinal.stdout).toMatch(/was cancelled in block \d+ on base, which is not final yet/);
    await base.testClient.mine({ blocks: 70 });
    const proved = await lifecycle(
      "prove",
      hash,
      store,
      "--private-key",
      OWNER_KEY,
      "--auto-approve",
      "--json",
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
    // Three intents, told apart by their route's deadline.
    const one = await publish(store, start + 3601n, start + 7200n);
    const two = await publish(store, start + 3602n, start + 7200n);
    const three = await publish(store, start + 3603n, start + 7200n);
    const send = ["--send", "--private-key", SOLVER_KEY, "--auto-approve", "--json"];
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
      ...["--private-key", SOLVER_KEY, "--auto-approve", "--json"],
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
      ...["--and-prove", "--private-key", OWNER_KEY, "--auto-approve", "--json"],
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
            "--send",
            "--no-prove",
            "--private-key",
            SOLVER_KEY,
            "--auto-approve",
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
    const usdtFile = join(work, "usdt.sauce.ts");
    writeFileSync(
      usdtFile,
      INTENT.replace("USDC.transfer(", `Token(${usdt.toLowerCase()}n).transfer(`),
    );
    const start = await now(base);
    const out = jsonOf(
      await sauce(
        ...["intent", "publish", usdtFile, ...intentFlags(start + 3600n, start + 7200n)],
        ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );
    const hash = (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
    const filled = await lifecycle(
      "fill",
      hash,
      store,
      ...["--send", "--private-key", SOLVER_KEY, "--auto-approve", "--json"],
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
      ...["intent", "publish", "--source", "ethereum", "--destination", "base"],
      // Amounts no other test publishes: an intent equal to one already claimed is refused.
      ...["--token", "USDC", "--amount", "1.25", "--recipient", RECIPIENT],
      ...["--reward-token", "USDC", "--reward", "1.3", "--prover", "HyperProver"],
      ...["--fill-deadline", "+1h", "--reward-deadline", "+2h", "--out", out],
      ...[
        "--config",
        config,
        "--private-key",
        OWNER_KEY,
        "--auto-approve",
        "--store",
        store,
        "--json",
      ],
    );
    expect(run.code).toBe(0);
    // What it made and rehearsed, before anything was sent.
    expect(run.stderr).toContain(`Wrote ${out}:`);
    expect(run.stderr).toContain("Publishing, rehearsed on ethereum:");
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
    const start = await now(ethereum);
    const out = jsonOf(
      await sauce(
        "intent",
        "publish",
        file,
        ...intentFlags(start + 3600n, start + 7200n),
        ...["--rpc-url", ethereum.rpcUrl, "--private-key", OWNER_KEY, "--store", store, "--json"],
      ),
    );
    const hash = (out.intents as Array<{ intentHash: Hex }>)[0]!.intentHash;
    const publishTx = (out.transactions as Array<{ what: string; hash: Hex }>).find(
      (tx) => tx.what === "publish",
    )!.hash;
    // A fresh store learns it from the transaction alone.
    const fresh = mkdtempSync(join(work, "store-"));
    const imported = jsonOf(
      await sauce(
        ...["intent", "import", publishTx, "--chain", "ethereum"],
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
