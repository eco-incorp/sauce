/**
 * An intent's whole life through the intent tools, on two anvils standing in for Ethereum (the
 * source) and Base (the destination), with every transaction built by the server UNSIGNED and
 * signed and sent here, by a key the server never sees: published and funded on Ethereum by the
 * creator's wallet, read back from its transaction, filled and proven on Base, the proof carried
 * back, claimed; refunded after the reward's deadline and not before; cancelled after the route's
 * deadline, the cancellation proven and refunded before the reward's.
 *
 * Each intent is built by hand (`assembleIntent`) and published with the transactions
 * `intentSourceTxs` gives any wallet: opening an intent from a program is coming soon, and what is
 * under test is everything that acts on one once it exists.
 *
 * The server has no endpoint of its own: every call gives both chains' by `rpcUrls`.
 *
 * REAL: the released gated stack (`sdk/test/cli-anvil.ts`) and eco-routes' own Portal and
 * HyperProver at the addresses the SDK records (`sdk/test/eco-routes-anvil.ts`, the harness the
 * `sauce intent` suite uses). MOCKED, and only this: Hyperlane's off-chain half — the test delivers
 * each dispatched message to the other chain's Mailbox (`relay`).
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { assembleIntent } from "../../sdk/dist/routes/intent.js";
import { intentSourceTxs, type IntentFundVia } from "../../sdk/dist/routes/portal.js";

import {
  fixture,
  OWNER,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import {
  deployMailbox,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
  relay,
} from "../../sdk/test/eco-routes-anvil.js";
import { connect, ok, type Connected } from "./harness.js";

/** Anvil's fourth dev account: the solver. A public key, local only. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
/** What the Mailbox charges per message: the prover's quoted fee. */
const HYPERLANE_FEE = 7_777n;

interface Tx {
  readonly chainId?: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
  readonly what: string;
}
interface Plan {
  readonly ready: boolean;
  readonly why?: string;
  readonly from: null;
  readonly transactions: readonly Tx[];
  readonly notes?: readonly string[];
}
type IntentRecord = Record<string, unknown> & { readonly intentHash: Hex };

describe(
  "the intent tools: published by a wallet, imported, filled and proven, claimed; refunded; cancelled",
  {
    skip: RUNTIME_HEX_PATH === undefined,
  },
  () => {
    let ethereum: LocalChain;
    let base: LocalChain;
    let ethereumUsdc: Address;
    let baseUsdc: Address;
    let ethereumMailbox: Address;
    let baseMailbox: Address;
    let mcp: Connected;
    let rpcUrls: Record<string, string>;
    /** Each intent's own salt, so no two built here are ever one intent. */
    let salts = 0;

    const now = async (local: LocalChain): Promise<bigint> =>
      (await local.publicClient.getBlock()).timestamp;
    const warp = async (local: LocalChain, seconds: number): Promise<void> => {
      await local.testClient.increaseTime({ seconds });
      await local.testClient.mine({ blocks: 1 });
    };
    const solverOn = (local: LocalChain) =>
      createWalletClient({ account: SOLVER, transport: http(local.rpcUrl) });

    /** Sends `txs` in order on `local` from `wallet`, as the user's own signer would. */
    const sendAll = async (
      local: LocalChain,
      wallet: Parameters<LocalChain["send"]>[0],
      txs: readonly Tx[],
    ): Promise<Hex[]> => {
      const hashes: Hex[] = [];
      for (const tx of txs) {
        if (tx.chainId !== undefined) assert.equal(tx.chainId, local.chain.id, tx.what);
        hashes.push(await local.send(wallet, tx.to, tx.data, BigInt(tx.value)));
      }

      return hashes;
    };

    /**
     * Base USDC to `RECIPIENT` for Ethereum USDC, built by hand and published from the creator's
     * wallet (the transfer into its vault and `publish`, or the approval and `publishAndFund`);
     * then read back with sauce_intent_import, whose `record` every other tool takes.
     */
    const publish = async (
      route: bigint,
      reward: bigint,
      fundVia: IntentFundVia = "transfer",
    ): Promise<{ record: IntentRecord; tx: Hex; funded: boolean }> => {
      const intent = assembleIntent(
        requireChain("ethereum"),
        requireChain("base"),
        {
          salt: numberToHex(++salts, { size: 32 }),
          deadline: route,
          portal: ecoRoutesPortal("base"),
          tokens: [{ token: baseUsdc, amount: AMOUNT }],
          calls: [
            {
              target: baseUsdc,
              data: encodeFunctionData({
                abi: erc20Abi,
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
      const hashes: Hex[] = [];
      for (const tx of intentSourceTxs(
        intent,
        { portal: ecoRoutesPortal("ethereum") },
        { fundVia },
      )) {
        hashes.push(await ethereum.send(ethereum.owner, tx.to, tx.data, tx.value));
      }
      const tx = hashes.at(-1)!;
      const imported = (await call("sauce_intent_import", { txHash: tx, chain: "ethereum" })) as {
        intents: Array<{ record: IntentRecord; funded: boolean }>;
      };
      assert.equal(imported.intents.length, 1);

      return { record: imported.intents[0]!.record, tx, funded: imported.intents[0]!.funded };
    };
    /** A tool's result, with both chains' endpoints given by the call. */
    const call = async (tool: string, args: Record<string, unknown>): Promise<unknown> =>
      ok(await mcp.call(tool, { ...args, rpcUrls }));

    before(async () => {
      [ethereum, base] = await Promise.all([startChain("ethereum"), startChain("base")]);
      ethereumUsdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
      baseUsdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
      for (const local of [ethereum, base]) await plantPortal(local, PORTAL_FIXTURES.v2_12);
      ethereumMailbox = await deployMailbox(ethereum, HYPERLANE_FEE);
      baseMailbox = await deployMailbox(base, HYPERLANE_FEE);
      await plantHyperProver(ethereum, ethereumMailbox);
      await plantHyperProver(base, baseMailbox);
      await ethereum.mint(ethereumUsdc, OWNER.address, 10n * REWARD);
      await base.mint(baseUsdc, SOLVER.address, 10n * AMOUNT);
      // The solver pays the proof's fee on Base, and gas on both chains.
      for (const local of [ethereum, base]) {
        await local.testClient.setBalance({ address: SOLVER.address, value: 10n ** 20n });
      }
      rpcUrls = { ethereum: ethereum.rpcUrl, base: base.rpcUrl };
      mcp = await connect();
    });

    after(async () => {
      await mcp?.close();
      await Promise.all([ethereum?.stop(), base?.stop()]);
      // Every byte the server sent: never an endpoint.
      for (const local of [ethereum, base]) {
        assert.ok(!mcp.received.join("\n").includes(local.rpcUrl.replace("http://", "")));
      }
    });

    it("reads back a published intent, fills and proves it, carries the proof, and claims", async () => {
      const start = await now(base);
      // Funded by a transfer into its vault, then published: read back from its transaction alone.
      const { record, tx, funded: imported } = await publish(start + 3600n, start + 7200n);
      assert.equal(imported, true);
      const funded = (await call("sauce_intent_status", { txHash: tx, chain: "ethereum" })) as {
        state: string;
        source: { rewardStatus: string; funded: boolean };
        can: Record<string, { ok: boolean; why: string }>;
      };
      // The Portal records no Funded status for a transfer, and its isIntentFunded says funded.
      assert.deepEqual([funded.source.rewardStatus, funded.source.funded], ["Initial", true]);
      assert.equal(funded.state, "funded");
      assert.equal(funded.can.fill!.ok, true, funded.can.fill!.why);
      assert.equal(funded.can.claim!.ok, false);

      // The fill, built for the solver: its approval, then fulfillAndProve with the fee in value.
      const fill = (await call("sauce_intent_fill", { intent: record, from: SOLVER.address })) as {
        from: Address;
        intents: Array<{ proves: boolean; fee: { prover: string }; transactions: Tx[] }>;
      };
      assert.equal(fill.from, SOLVER.address);
      const [built] = fill.intents;
      assert.equal(built!.proves, true);
      assert.equal(built!.fee.prover, String(HYPERLANE_FEE));
      assert.deepEqual(
        built!.transactions.map((each) => each.what.split(" ")[0]),
        ["approve", "Portal.fulfillAndProve(" + record.intentHash + ","],
      );
      assert.equal(built!.transactions[1]!.value, String(HYPERLANE_FEE));
      const sent = await sendAll(base, solverOn(base), built!.transactions);
      assert.equal(await base.balanceOf(baseUsdc, RECIPIENT), AMOUNT);
      const filled = (await call("sauce_intent_status", { intent: record })) as { state: string };
      assert.equal(filled.state, "filled");

      // Not claimable before the proof arrives: a result saying why, not an error.
      const early = (await call("sauce_intent_claim", { intent: record })) as Plan;
      assert.equal(early.ready, false);
      assert.match(early.why!, /prove|proof/);

      // Hyperlane's delivery, mocked; the provers on both sides are real.
      assert.equal(await relay(base, baseMailbox, sent.at(-1)!, ethereum, ethereumMailbox), 1);
      const proven = (await call("sauce_intent_status", { intent: record })) as { state: string };
      assert.equal(proven.state, "proven");

      const claim = (await call("sauce_intent_claim", { intent: record })) as Plan & {
        claims: Array<{ claimant: Address }>;
      };
      assert.equal(claim.ready, true);
      assert.equal(claim.from, null, "any account may send it");
      assert.equal(getAddress(claim.claims[0]!.claimant), SOLVER.address);
      const before = await ethereum.balanceOf(ethereumUsdc, SOLVER.address);
      // Sent by someone else entirely: the reward still goes to the claimant.
      await sendAll(ethereum, ethereum.deployer, claim.transactions);
      assert.equal(await ethereum.balanceOf(ethereumUsdc, SOLVER.address), before + REWARD);
      const claimed = (await call("sauce_intent_status", { intent: record })) as { state: string };
      assert.equal(claimed.state, "claimed");
    });

    it("reads an intent funded by publishAndFund as funded too", async () => {
      const start = await now(base);
      const deadlines = [start + 3700n, start + 7300n] as const;
      const { record, funded } = await publish(...deadlines, "publishAndFund");
      assert.equal(funded, true);
      const status = (await call("sauce_intent_status", { intent: record })) as {
        state: string;
        source: { rewardStatus: string };
        can: Record<string, { ok: boolean }>;
      };
      assert.deepEqual([status.state, status.source.rewardStatus], ["funded", "Funded"]);
      assert.equal(status.can.fill!.ok, true);
    });

    it("refunds an unfilled intent from the reward's deadline, not before", async () => {
      const start = await now(ethereum);
      const { record } = await publish(start + 60n, start + 600n);
      const early = (await call("sauce_intent_refund", { intent: record })) as Plan;
      assert.equal(early.ready, false);
      assert.match(early.why!, /not before the reward's deadline/);
      await warp(ethereum, 700);
      const refund = (await call("sauce_intent_refund", { intent: record })) as Plan & {
        refundee: Address;
      };
      assert.equal(refund.ready, true);
      assert.equal(getAddress(refund.refundee), OWNER.address);
      const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
      await sendAll(ethereum, ethereum.deployer, refund.transactions);
      assert.equal(await ethereum.balanceOf(ethereumUsdc, OWNER.address), before + REWARD);
    });

    it("cancels after the route's deadline, proves it, and refunds before the reward's", async () => {
      const start = await now(base);
      const { record } = await publish(start + 60n, start + 100_000n);
      const early = (await call("sauce_intent_cancel", { intent: record })) as Plan;
      assert.equal(early.ready, false);
      assert.match(early.why!, /not before the route's deadline/);
      await warp(base, 120);
      const cancel = (await call("sauce_intent_cancel", { intent: record })) as Plan;
      assert.equal(cancel.ready, true, cancel.why);
      assert.match(cancel.transactions[0]!.what, /^Portal\.cancel\(/);
      const [cancelled] = await sendAll(base, base.deployer, cancel.transactions);
      const block = (await base.publicClient.getTransactionReceipt({ hash: cancelled! }))
        .blockNumber;
      const status = (await call("sauce_intent_status", { intent: record })) as {
        state: string;
        can: Record<string, { ok: boolean }>;
      };
      assert.equal(status.state, "cancelled");
      assert.equal(status.can.fill!.ok, false);

      // Its proof waits until the block that cancelled it is final (anvil finalizes 64 back).
      const cancelledIn = { [record.intentHash]: String(block) };
      const unfinal = (await call("sauce_intent_prove", { intent: record, cancelledIn })) as Plan;
      assert.equal(unfinal.ready, false);
      assert.match(unfinal.why!, /not final yet/);
      await base.testClient.mine({ blocks: 70 });
      const prove = (await call("sauce_intent_prove", { intent: record, cancelledIn })) as Plan & {
        fee: string;
      };
      assert.equal(prove.ready, true, prove.why);
      assert.equal(prove.fee, String(HYPERLANE_FEE));
      const [proof] = await sendAll(base, solverOn(base), prove.transactions);
      assert.equal(await relay(base, baseMailbox, proof!, ethereum, ethereumMailbox), 1);
      const cancelProven = (await call("sauce_intent_status", { intent: record })) as {
        state: string;
      };
      assert.equal(cancelProven.state, "cancelProven");

      // Refunded at once, well before the reward's deadline.
      const refund = (await call("sauce_intent_refund", { intent: record })) as Plan;
      assert.equal(refund.ready, true, refund.why);
      const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
      await sendAll(ethereum, ethereum.deployer, refund.transactions);
      assert.equal(await ethereum.balanceOf(ethereumUsdc, OWNER.address), before + REWARD);
    });
  },
);
