/**
 * The intent store a LOCAL server keeps, recording from the chain: on two anvils standing in for
 * Ethereum (the source) and Base (the destination), every transaction the intent tools build is
 * signed here, by keys the server never sees, and broadcast through `sauce_send` — or sent from one
 * of the server's wallets through `sauce_wallet_send` — and what each did lands in the store as the
 * `sauce` command records it: published and funded, filled and proving, claimed, refunded. An
 * intent the server never stored, named by its record, is stored once its fill lands. Every step
 * after the publish names the intent by its hash alone.
 *
 * REAL: the released gated stack (`sdk/test/cli-anvil.ts`) and eco-routes' own Portal and
 * HyperProver at the addresses the SDK records (`sdk/test/eco-routes-anvil.ts`). MOCKED, and only
 * this: Hyperlane's off-chain half (`relay`).
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { getAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import type { IntentRecord } from "../../sdk/dist/cli/lifecycle.js";
import { IntentStore } from "../../sdk/dist/cli/store.js";
import { WalletStore } from "../../sdk/dist/cli/wallets.js";
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
import { NO_ENDPOINTS } from "../src/config.js";
import { connect, ok, type Connected } from "./harness.js";

/** Anvil's fourth dev account: the solver. A public key, local only. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
const HYPERLANE_FEE = 7_777n;
/** A throwaway password for the server's wallets. */
const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

const INTENT = [
  "function main(recipient: Address, amount: Uint256, reward: Uint256) {",
  "  Base(() => {",
  "    USDC.transfer(recipient, amount);",
  "  }).reward({ tokens: [{ token: USDC, amount: reward }] });",
  "}",
  "",
].join("\n");

interface Tx {
  readonly chainId?: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
  readonly what: string;
}
interface StoreEvent {
  readonly event: string;
  readonly chain: string;
  readonly tx: string;
  readonly from?: string;
  readonly message?: string;
}

describe(
  "the local server's intent store, kept from what its transactions do",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let ethereum: LocalChain;
    let base: LocalChain;
    let ethereumMailbox: Address;
    let baseMailbox: Address;
    let ethereumUsdc: Address;
    let dir: string;
    let store: IntentStore;
    let mcp: Connected;
    let rpcUrls: Record<string, string>;

    const now = async (local: LocalChain): Promise<bigint> =>
      (await local.publicClient.getBlock()).timestamp;
    const call = async (tool: string, args: Record<string, unknown>) =>
      ok(await mcp.call(tool, { ...args, rpcUrls }));
    /** `txs` signed by `account` as its own signer would, then broadcast through sauce_send. */
    const sendSigned = async (
      local: LocalChain,
      account: PrivateKeyAccount,
      txs: readonly Tx[],
    ): Promise<{ sent: Array<{ hash: Hex; status: string }>; notes?: string[] }> => {
      const fees = await local.publicClient.estimateFeesPerGas();
      const first = await local.publicClient.getTransactionCount({ address: account.address });
      const transactions = await Promise.all(
        txs.map((tx, index) =>
          account.signTransaction({
            chainId: local.chain.id,
            type: "eip1559",
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
            nonce: first + index,
            gas: 1_000_000n,
            maxFeePerGas: fees.maxFeePerGas * 2n,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          }),
        ),
      );
      const sent = ok(await mcp.call("sauce_send", { transactions, rpcUrl: local.rpcUrl })) as {
        ok: boolean;
        sent: Array<{ hash: Hex; status: string }>;
        notes?: string[];
      };
      assert.equal(sent.ok, true);

      return sent;
    };
    /** The intent's publish, built for the creator and sent through sauce_send. */
    const publish = async (route: bigint, reward: bigint) => {
      const built = ok(
        await mcp.call("sauce_intent_publish", {
          source: INTENT,
          chain: "ethereum",
          args: [RECIPIENT, String(AMOUNT), String(REWARD)],
          intentDeadline: String(route),
          intentRewardDeadline: String(reward),
          intentCreator: OWNER.address,
          from: OWNER.address,
          rpcUrl: ethereum.rpcUrl,
        }),
      ) as { intents: Array<{ record: IntentRecord; transactions: Tx[] }> };
      const [intent] = built.intents;

      return { intent: intent!, sent: await sendSigned(ethereum, OWNER, intent!.transactions) };
    };
    const shown = async (intentHash: Hex) =>
      (await call("sauce_intent_show", { intentHash })) as {
        events: StoreEvent[];
        status?: { state: string };
      };
    const notesOf = (result: { notes?: string[] }) => (result.notes ?? []).join("\n");

    before(async () => {
      [ethereum, base] = await Promise.all([startChain("ethereum"), startChain("base")]);
      ethereumUsdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
      const baseUsdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
      for (const local of [ethereum, base]) await plantPortal(local, PORTAL_FIXTURES.v2_12);
      ethereumMailbox = await deployMailbox(ethereum, HYPERLANE_FEE);
      baseMailbox = await deployMailbox(base, HYPERLANE_FEE);
      await plantHyperProver(ethereum, ethereumMailbox);
      await plantHyperProver(base, baseMailbox);
      await ethereum.mint(ethereumUsdc, OWNER.address, 10n * REWARD);
      await base.mint(baseUsdc, SOLVER.address, 10n * AMOUNT);
      for (const local of [ethereum, base]) {
        await local.testClient.setBalance({ address: SOLVER.address, value: 10n ** 20n });
      }
      rpcUrls = { ethereum: ethereum.rpcUrl, base: base.rpcUrl };
      dir = mkdtempSync(join(tmpdir(), "sauce-mcp-intents-store-e2e-"));
      store = new IntentStore(join(dir, "intents"));
      // As `sauce mcp --wallets` serves over stdio: the command's intent store kept, and wallets.
      mcp = await connect(
        NO_ENDPOINTS,
        undefined,
        {
          store: new WalletStore(join(dir, "wallets")),
          password: PASSWORD,
          source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
        },
        true,
        { intents: store },
      );
    });

    after(async () => {
      await mcp?.close();
      await Promise.all([ethereum?.stop(), base?.stop()]);
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
      for (const local of [ethereum, base]) {
        assert.ok(!mcp.received.join("\n").includes(local.rpcUrl.replace("http://", "")));
      }
    });

    it("records an intent's life, each step named by its hash, as the sauce command does", async () => {
      const start = await now(base);
      const { intent, sent } = await publish(start + 3600n, start + 7200n);
      const hash = intent.record.intentHash;
      assert.match(notesOf(sent), new RegExp(`stored intent ${hash} in ${store.dir}`));

      const listed = (await call("sauce_intent_list", {})) as {
        intents: Array<{ intentHash: Hex; last: string; state?: string }>;
      };
      assert.deepEqual(
        listed.intents.map((each) => [each.intentHash, each.last, each.state]),
        [[hash, "funded", "funded"]],
      );

      // The fill, built for the solver from the hash alone, signed by it, sent.
      const fill = (await call("sauce_intent_fill", {
        intentHash: hash,
        from: SOLVER.address,
      })) as {
        intents: Array<{ transactions: Tx[] }>;
      };
      const filled = await sendSigned(base, SOLVER, fill.intents[0]!.transactions);
      assert.match(notesOf(filled), new RegExp(`intent ${hash}: filled, proving, recorded in`));
      assert.equal(
        await relay(base, baseMailbox, filled.sent.at(-1)!.hash, ethereum, ethereumMailbox),
        1,
      );

      const claim = (await call("sauce_intent_claim", { intentHash: hash })) as {
        ready: boolean;
        transactions: Tx[];
      };
      assert.equal(claim.ready, true);
      const claimed = await sendSigned(ethereum, SOLVER, claim.transactions);
      assert.match(notesOf(claimed), new RegExp(`intent ${hash}: claimed, recorded in`));

      const { events, status } = await shown(hash);
      assert.deepEqual(
        events.map((event) => `${event.event} ${event.chain}`),
        [
          "published ethereum",
          "funded ethereum",
          "filled base",
          "proving base",
          "claimed ethereum",
        ],
      );
      assert.equal(getAddress(events[0]!.from!), OWNER.address);
      assert.equal(events[2]!.tx, filled.sent.at(-1)!.hash);
      assert.match(events[3]!.message!, /^0x[0-9a-f]{64}$/);
      assert.equal(getAddress(events[4]!.from!), SOLVER.address);
      assert.equal(status?.state, "claimed");
    });

    it("stores an intent it never held, named by its record, once its fill lands", async () => {
      const start = await now(base);
      // Published by the creator's own means, not through the server: the store has not seen it.
      const built = ok(
        await mcp.call("sauce_intent_publish", {
          source: INTENT,
          chain: "ethereum",
          args: [RECIPIENT, String(AMOUNT), String(REWARD)],
          intentDeadline: String(start + 3700n),
          intentRewardDeadline: String(start + 7300n),
          intentCreator: OWNER.address,
          from: OWNER.address,
          rpcUrl: ethereum.rpcUrl,
        }),
      ) as { intents: Array<{ record: IntentRecord; transactions: Tx[] }> };
      const { record, transactions } = built.intents[0]!;
      for (const tx of transactions) await ethereum.send(ethereum.owner, tx.to, tx.data);
      assert.equal(store.has(record.intentHash), false);

      const fill = (await call("sauce_intent_fill", { intent: record, from: SOLVER.address })) as {
        intents: Array<{ transactions: Tx[] }>;
      };
      await sendSigned(base, SOLVER, fill.intents[0]!.transactions);
      assert.deepEqual(store.load(record.intentHash).record, record);
      assert.deepEqual(
        store.load(record.intentHash).events.map((event) => event.event),
        ["filled", "proving"],
      );
    });

    it("records what a wallet of the server sends: the refund of an intent past its deadline", async () => {
      const created = ok(await mcp.call("sauce_wallet_create", { name: "keeper" }));
      const wallet = getAddress(String(created.address));
      await ethereum.send(ethereum.deployer, wallet, "0x", parseEther("1"));
      const start = await now(ethereum);
      const { intent } = await publish(start + 60n, start + 600n);
      const hash = intent.record.intentHash;
      await ethereum.testClient.increaseTime({ seconds: 700 });
      await ethereum.testClient.mine({ blocks: 1 });

      const refund = await call("sauce_intent_refund", { intentHash: hash });
      assert.equal(refund.ready, true, String(refund.why));
      const before = await ethereum.balanceOf(ethereumUsdc, OWNER.address);
      const sent = ok(
        await mcp.call("sauce_wallet_send", {
          wallet: "keeper",
          transaction: refund,
          rpcUrl: ethereum.rpcUrl,
        }),
      ) as { ok: boolean; notes?: string[] };
      assert.equal(sent.ok, true);
      assert.equal(await ethereum.balanceOf(ethereumUsdc, OWNER.address), before + REWARD);
      assert.match(notesOf(sent), new RegExp(`intent ${hash}: refunded, recorded in`));
      const { events } = await shown(hash);
      assert.deepEqual(
        events.map((event) => event.event),
        ["published", "funded", "refunded"],
      );
      assert.equal(getAddress(events[2]!.from!), wallet);
    });
  },
);
