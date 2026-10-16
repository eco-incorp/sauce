/**
 * The Solana example programs the package ships — the skills' and the manual's (`docs/examples`) —
 * run by the testing kit on Solana mainnet's own accounts —
 * USDC, PYUSD and TSLAx as mainnet holds them, an Orca whirlpool and its program — replayed from a
 * state file it recorded (`state/solana-examples.json.gz`), with the released engine and Kitchen
 * and mainnet's Kitchen fee. No RPC, and no funds: each program's inputs are funded on the copy.
 *
 * The state file was recorded from the SDK's pinned mainnet dumps served on loopback
 * (`solana-support.ts#pinnedCluster`); `RECAPTURE_SOLANA_STATE=1` records it again from there.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { resolve } from "node:path";

import { CookReverted, fork, type SolanaTestChain } from "../../src/testing/index.js";
import {
  MAINNET_FEE,
  PINNED,
  pinnedCluster,
  pinnedPool,
  recordingSolana,
  solanaMissing,
  solanaState,
} from "./solana-support.js";

const REPO = resolve(import.meta.dirname, "../../..");
const example = (path: string): string => resolve(REPO, path);
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe(
  "the skills' and the manual's Solana examples, on mainnet's accounts, replayed",
  { skip: solanaMissing() },
  () => {
    let solana: SolanaTestChain;
    let cluster: Awaited<ReturnType<typeof pinnedCluster>> | undefined;
    before(async () => {
      cluster = recordingSolana ? await pinnedCluster() : undefined;
      solana = await fork("solana", {
        state: solanaState("solana-examples"),
        mode: recordingSolana ? "record" : "replay",
        ...(cluster === undefined ? {} : { rpcUrl: cluster.url }),
      });
    });
    after(async () => {
      await solana?.stop();
      await cluster?.close();
    });
    beforeEach(() => solana.snapshot());
    afterEach(() => solana.revert());

    it("replays at the recorded slot and time, with mainnet's Kitchen fee", async () => {
      assert.equal(solana.mode, recordingSolana ? "record" : "replay");
      assert.equal(await solana.slot(), PINNED.slot);
      assert.equal(await solana.now(), PINNED.unixTimestamp);
      assert.equal(await solana.executionFee(), MAINNET_FEE);
    });

    it("skills/sauce-solana/examples/pay.sauce.ts pays USDC from the Pot, every account derived", async () => {
      const alice = solana.account(0);
      const bob = solana.account(1).address;
      await solana.fund(alice.pot, { USDC: "1" });
      const result = await solana.run(example("skills/sauce-solana/examples/pay.sauce.ts"), {
        args: [bob, 400n],
      });
      assert.equal(result.delta(bob, "USDC"), 400n);
      assert.equal(result.delta(alice.pot, "USDC"), -400n);
      // The owner paid the Kitchen's fee and the transaction's.
      assert.equal(result.delta(alice.address, "SOL"), -(MAINNET_FEE + 5_000n));

      await assert.rejects(
        solana.simulate(example("skills/sauce-solana/examples/pay.sauce.ts"), {
          args: [bob, 2_000_000n],
        }),
        (error: unknown) => error instanceof CookReverted && error.reason === "not enough USDC",
      );
    });

    it("skills/sauce-solana/examples/solana.sauce.ts pays an SPL mint through the accounts it names", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { USDC: "2" });
      // As its header's usage line names them.
      const result = await solana.run(example("skills/sauce-solana/examples/solana.sauce.ts"), {
        args: [USDC, 1_000_000n],
        accounts: {
          tokenProgram: SPL_TOKEN,
          source: `pot:${USDC}`,
          destination: `${bob}:USDC`,
          authority: "pot",
        },
      });
      assert.equal(result.returned, 1_000_000n);
      assert.equal(result.delta(bob, "USDC"), 1_000_000n);
      assert.equal(await solana.balanceOf(pot, "USDC"), 1_000_000n);
    });

    it("skills/sauce-solana/examples/token-2022.sauce.ts pays PYUSD with transferChecked", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { PYUSD: "1" });
      const result = await solana.run(example("skills/sauce-solana/examples/token-2022.sauce.ts"), {
        args: [1_000_000n],
        accounts: {
          tokenProgram: "program:PYUSD",
          source: "pot:PYUSD",
          mint: "mint:PYUSD",
          destination: `${bob}:PYUSD`,
          pot: "pot",
        },
      });
      // What the destination received: PYUSD withholds no fee.
      assert.equal(result.returned, 1_000_000n);
      assert.equal(result.delta(bob, "PYUSD"), 1_000_000n);
      assert.equal(result.delta(pot, "PYUSD"), -1_000_000n);
    });

    it("skills/sauce-chains/examples/payout-solana.sauce.ts pays cash and a Token-2022 stock, staged", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { USDC: "1", TSLAx: "1" });
      const result = await solana.run(
        example("skills/sauce-chains/examples/payout-solana.sauce.ts"),
        { args: [bob, 1_000_000n, 50_000_000n] },
      );
      // Past one transaction: staged into a code buffer first, as `sauce run` stages it.
      assert.equal(result.staged, true);
      assert.equal(result.returned, 50_000_000n);
      assert.equal(result.delta(bob, "USDC"), 1_000_000n);
      assert.equal(result.delta(bob, "TSLAx"), 50_000_000n);
      assert.equal(result.delta(pot, "TSLAx"), -50_000_000n);
    });

    it("skills/sauce-swaps/examples/solana-swap.sauce.ts buys WSOL at an Orca whirlpool and forwards it", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { USDC: "100" });
      const swap = example("skills/sauce-swaps/examples/solana-swap.sauce.ts");
      const pool = pinnedPool("orca-whirlpool-sol-usdc");
      // Its header's example: 100 USDC at up to 200 USDC a SOL, for at least 0.4 SOL.
      const result = await solana.run(swap, {
        args: [pool, bob, 100_000_000n, 200_000_000_000_000_000n, 400_000_000n],
      });
      const bought = result.returned as bigint;
      assert.ok(bought >= 400_000_000n, `bought ${bought}`);
      assert.equal(result.delta(bob, "WSOL"), bought);
      assert.equal(result.delta(pot, "USDC"), -100_000_000n);

      // A limit below the pool's price: the pool is skipped, and nothing moves.
      await solana.fund(pot, { USDC: "100" });
      const skipped = await solana.simulate(swap, {
        args: [pool, bob, 100_000_000n, 1_000_000_000_000_000n, 0n],
      });
      assert.equal(skipped.returned, 0n);
      assert.equal(skipped.delta(pot, "USDC"), 0n);
      assert.equal(skipped.delta(bob, "WSOL"), 0n);
    });

    it("docs/examples/solana-swap.sauce.ts, the manual's single swap, buys WSOL at an Orca whirlpool", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { USDC: "100" });
      const swap = example("docs/examples/solana-swap.sauce.ts");
      const pool = pinnedPool("orca-whirlpool-sol-usdc");
      // Its header's example: 100 USDC at up to 200 USDC a SOL, for at least 0.4 SOL.
      const args = [pool, bob, 100_000_000n, 200_000_000_000_000_000n, 400_000_000n] as const;
      const result = await solana.run(swap, { args });
      const bought = result.returned as bigint;
      assert.ok(bought >= 400_000_000n, `bought ${bought}`);
      assert.equal(result.delta(bob, "WSOL"), bought);
      assert.equal(result.delta(pot, "USDC"), -100_000_000n);

      // Below `minOut`, the whole cook reverts, and nothing moves.
      await solana.fund(pot, { USDC: "100" });
      await assert.rejects(
        solana.simulate(swap, { args: [pool, bob, 100_000_000n, args[3], bought * 2n] }),
        (error: unknown) => error instanceof CookReverted && error.reason === "below minOut",
      );
      // A pool already past `maxPrice` is skipped: `swap` returns 0, and nothing moves.
      const skipped = await solana.simulate(swap, {
        args: [pool, bob, 100_000_000n, 1_000_000_000_000_000n, 0n],
      });
      assert.equal(skipped.returned, 0n);
      assert.equal(skipped.delta(pot, "USDC"), 0n);
    });

    it("docs/examples/pay.sauce.ts pays USDC from the Pot on Solana, as on Base", async () => {
      const pot = solana.account(0).pot;
      const bob = solana.account(1).address;
      await solana.fund(pot, { USDC: "5" });
      const pay = example("docs/examples/pay.sauce.ts");
      // Its header's Solana line: 1 USDC to the recipient.
      const result = await solana.run(pay, { args: [bob, 1_000_000n] });
      assert.equal(result.delta(bob, "USDC"), 1_000_000n);
      assert.equal(result.delta(pot, "USDC"), -1_000_000n);
      await assert.rejects(
        solana.simulate(pay, { args: [bob, 5_000_000n] }),
        (error: unknown) => error instanceof CookReverted && error.reason === "not enough USDC",
      );
    });
  },
);
