/**
 * The `sauce-solana-distributed-swap` skill's programs run as their headers say, through the `sauce`
 * command itself, with `--args` alone: the pay and buy tokens, the pools in slot order, the amounts,
 * the recipient and the refund. Every account the program names is derived as the cook is built:
 * each pool's nine read from the pool on the cluster, the Pot's, the mints' and the recipient's and
 * refund's token accounts. `sauce run` stages the program (6 KB, past one transaction), finds its
 * accounts past one transaction too, creates an address lookup table holding them, creates the
 * token accounts the cook names that do not exist yet, and cooks on the owner's Pot, which it creates
 * first. Against the released Kitchen and engine and the venues' own mainnet programs and pools
 * (`svm/venue-fixture.ts`) in LiteSVM, behind a JSON-RPC shim (`svm/rpc-shim.ts`). A second run
 * takes the table the first created with `--lookup-table`. `sauce simulate` runs it in a local copy
 * of the accounts it reads, holds each guard to its revert with `--expect-revert`, and simulates for
 * an owner with nothing given `--assume-balance`; `sauce tx` prints it as a plan of steps. `sauce
 * pools --pay` gives the pools in slot order, which the simulation takes as they are, and the
 * five-slot program takes five. The program's own behavior is held in
 * `svm/distributed-swap.e2e.test.ts`.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, createKeyPairSignerFromBytes, lamports } from "@solana/kit";
import type { Address, KeyPairSigner } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { Rent } from "litesvm";

import { nodeIo, runCli } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import {
  buildSetExecutionFeeInstruction,
  deriveProgramDataPda,
  derivePotPda,
} from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  sendInstructions,
  setTokenAccount,
  startEngine,
  tokenAmount,
} from "./svm/engine-harness.js";
import type { EngineHarness } from "./svm/engine-harness.js";
import { solanaShim } from "./svm/rpc-shim.js";
import type { SolanaShim } from "./svm/rpc-shim.js";
import {
  allIn,
  BYTES,
  E18,
  LAYOUT,
  le,
  loadVenues,
  manifest,
  ownLimit,
  pool,
  restoreVenues,
  TOKEN,
  USDC,
  WSOL,
} from "./svm/venue-fixture.js";
import type { Pool } from "./svm/venue-fixture.js";

/** The skill's program, and the same with a fifth slot. */
const PROGRAM = fileURLToPath(
  new URL(
    "../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
);
const PROGRAM_5 = fileURLToPath(
  new URL(
    "../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap-5.sauce.ts",
    import.meta.url,
  ),
);

const SOLANA_URL = "http://127.0.0.1:65533/";
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = address(v12SvmEngineProgramId());
/** An empty slot: no pool. */
const EMPTY = "11111111111111111111111111111111";

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    confirm: async () => undefined,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

/** A keypair file as solana-keygen writes it, and the signer it holds. */
async function keypairFile(dir: string): Promise<{ path: string; signer: KeyPairSigner }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const bytes = new Uint8Array([...seed, ...pub]);
  const path = join(dir, "owner.json");
  writeFileSync(path, JSON.stringify([...bytes]));

  return { path, signer: await createKeyPairSignerFromBytes(bytes) };
}

describeSvm(
  "the Solana distributed swap through the sauce command, its pools and every input --args",
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let work: string;
    let owner: { path: string; signer: KeyPairSigner };
    let pot: Address;

    /** A holder's associated account for `mint`, holding `amount`: what the program derives. */
    async function ata(holder: Address, mint: Address): Promise<Address> {
      return (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: TOKEN }))[0];
    }
    async function potAccount(mint: Address, amount: bigint): Promise<Address> {
      return setTokenAccount(harness, await ata(pot, mint), mint, pot, amount);
    }
    const held = (account: Address): bigint =>
      harness.svm.getAccount(account).exists ? tokenAmount(harness, account) : 0n;

    beforeAll(async () => {
      harness = await startEngine(
        BigInt(manifest.unixTimestamp) + 60n,
        ENGINE_SO as string,
        ENGINE,
      );
      // Mainnet's rent, which is not LiteSVM's default, and its Kitchen fee, paid by each cook into
      // the fee config, which holds just its rent-exempt balance under that rent, as mainnet's
      // does: a rehearsal's copy that kept LiteSVM's own rent would fail the cook as leaving the
      // fee config below the minimum.
      harness.svm.setRent(new Rent(5080n, 1.0, 50));
      const feeConfig = harness.svm.getAccount(harness.feeConfig);
      if (!feeConfig.exists) throw new Error("the harness made no Kitchen fee config");
      harness.svm.setAccount({
        address: harness.feeConfig,
        data: feeConfig.data,
        executable: false,
        lamports: lamports(
          harness.svm.minimumBalanceForRentExemption(BigInt(feeConfig.data.length)),
        ),
        programAddress: feeConfig.programAddress,
        space: BigInt(feeConfig.data.length),
      });
      const { address: programData } = await deriveProgramDataPda(KITCHEN);
      const priced = await sendInstructions(harness, [
        buildSetExecutionFeeInstruction({
          kitchen: KITCHEN,
          authority: harness.payer.address,
          programData,
          feeConfig: harness.feeConfig,
          fee: 85_672n,
        }),
      ]);
      if (!priced.ok) throw new Error(`set_execution_fee: ${priced.err}`);
      loadVenues(harness.svm);
      restoreVenues(harness.svm);
      work = mkdtempSync(join(tmpdir(), "sauce-solana-dswap-"));
      owner = await keypairFile(work);
      harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
      pot = (await derivePotPda(KITCHEN, owner.signer.address, new Uint8Array(32))).address;
      // `sauce pools` scans the venues' accounts: the bank's are the fixture's.
      shim = solanaShim(harness.svm, SOLANA_URL, () => [...BYTES.keys()]);
      shim.install();
    }, 120_000);

    afterAll(() => {
      shim?.restore();
      if (work !== undefined) rmSync(work, { recursive: true, force: true });
    });

    const DEEP = [
      pool("orca-whirlpool-sol-usdc"),
      pool("raydium-clmm-sol-usdc"),
      pool("pancakeswap-clmm-sol-usdc"),
      pool("defituna-sol-usdc"),
    ];
    const maxPrice =
      (DEEP.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b)) * 10003n) / 10000n;
    const budget = 1_000_000n * 10n ** 6n;
    const priceOf = (p: Pool): bigint => {
      const account = harness.svm.getAccount(p.pool);
      if (!account.exists) throw new Error(`pool ${p.pool} is gone`);
      return le(account.data, LAYOUT[p.venue]!.price, 16);
    };
    /** main's arguments, as the header gives them: the pools padded with empty slots. */
    const args = (
      pools: readonly Pool[],
      recipient: Address,
      refund: Address,
      { minTokens = 0n, maxAvgPrice = 0n, slots = 4 } = {},
    ): string[] => {
      const given = pools.map((p) => p.pool as string);
      while (given.length < slots) given.push(EMPTY);
      return [
        ...["--args", "USDC", "WSOL", ...given, String(budget), String(maxPrice)],
        ...[String(minTokens), String(maxAvgPrice), recipient, refund],
      ];
    };
    const ok = (run: Run): Record<string, unknown> => {
      if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}\n${run.stdout}`);
      return JSON.parse(run.stdout) as Record<string, unknown>;
    };

    it("creates the token accounts it names, stages the program, creates a lookup table for its accounts, and cooks", async () => {
      restoreVenues(harness.svm);
      const source = await potAccount(USDC, budget + 3n);
      // The Pot's WSOL account, which the cook buys into, does not exist yet, nor do the
      // recipient's WSOL account and the refund's USDC account: the run creates them.
      const output = await ata(pot, WSOL);
      expect(harness.svm.getAccount(output).exists).toBe(false);
      const recipient = randomAddress();
      const refund = randomAddress();
      const out = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--yes", "--json", ...args(DEEP, recipient, refund)],
        ),
      ) as {
        createTokenAccounts?: { accounts: string[] };
        staged?: { transactions: string[] };
        lookupTable?: { address: Address; accounts: number; transactions: string[] };
        cook: { status: string };
      };
      expect(out.createTokenAccounts?.accounts).toEqual(
        expect.arrayContaining([`the Pot's WSOL account, ${output}`]),
      );
      expect(out.createTokenAccounts?.accounts).toHaveLength(3);
      expect(out.cook.status).toBe("success");
      expect(out.staged?.transactions.length).toBeGreaterThan(1);
      expect(out.lookupTable?.accounts).toBeGreaterThan(40);
      for (const p of DEEP) expect(priceOf(p)).toBe(ownLimit(p, maxPrice, false));
      const bought = tokenAmount(harness, await ata(recipient, WSOL));
      const refunded = tokenAmount(harness, await ata(refund, USDC));
      expect(bought).toBeGreaterThan(0n);
      expect(refunded).toBeGreaterThan(0n);
      // The Pot's own 3 USDC beside the budget stay; nothing bought stays.
      expect(tokenAmount(harness, source)).toBe(3n);
      expect(tokenAmount(harness, output)).toBe(0n);
      expect((budget - refunded) * E18).toBeLessThanOrEqual(maxPrice * bought);

      // The table stays: a second cook naming the same accounts takes it, and creates none.
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      const second = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--json", "--lookup-table", out.lookupTable!.address],
          ...args(DEEP, recipient, refund),
        ),
      ) as { createTokenAccounts?: unknown; lookupTable?: unknown; cook: { status: string } };
      expect(second.cook.status).toBe("success");
      expect(second.lookupTable).toBeUndefined();
      expect(second.createTokenAccounts).toBeUndefined();
    }, 300_000);

    it("keeps what it bought and the rest of the budget in the Pot, given the Pot's own address", async () => {
      restoreVenues(harness.svm);
      const source = await potAccount(USDC, budget);
      const output = await potAccount(WSOL, 0n);
      const out = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--yes", "--json", ...args(DEEP, pot, pot)],
        ),
      ) as { cook: { status: string } };
      expect(out.cook.status).toBe("success");
      const bought = tokenAmount(harness, output);
      expect(bought).toBeGreaterThan(0n);
      const unspent = tokenAmount(harness, source);
      expect(unspent).toBeGreaterThan(0n);
      expect((budget - unspent) * E18).toBeLessThanOrEqual(maxPrice * bought);
    }, 300_000);

    it("simulates it in a local copy of its accounts, holds each guard to its revert, and prints it as a plan of steps", async () => {
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      await potAccount(WSOL, 0n);
      const recipient = randomAddress();
      const refund = randomAddress();
      const argv = (command: string, checks: { minTokens?: bigint; maxAvgPrice?: bigint } = {}) => [
        ...[command, PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, ...args(DEEP, recipient, refund, checks)],
        ...(command === "simulate" ? ["--json"] : []),
      ];
      const out = ok(await sauce(...argv("simulate"))) as {
        path: string;
        staged: { bytes: number };
        returned: { spent: string; bought: string; unspent: string };
      };
      expect(out.path).toBe("local copy (LiteSVM)");
      expect(out.staged.bytes).toBeGreaterThan(1232);
      const bought = BigInt(out.returned.bought);
      const spent = BigInt(out.returned.spent);
      expect(bought).toBeGreaterThan(0n);
      expect(spent + BigInt(out.returned.unspent)).toBe(budget);
      // Nothing happened on the cluster: the pools and the accounts are as they were.
      for (const p of DEEP)
        expect(priceOf(p)).toBe(le(BYTES.get(p.pool)!, LAYOUT[p.venue]!.price, 16));
      expect(held(await ata(recipient, WSOL))).toBe(0n);

      // A simulation that reverts says why, first; held to that revert, it is what was asked.
      const short = await sauce(...argv("simulate", { minTokens: bought + 1n }));
      expect(short.code).toBe(1);
      expect(short.stdout).toContain("bought below minTokens");
      expect(short.stderr.split("\n")[0]).toBe(
        'the cook reverts: the program threw "bought below minTokens"',
      );
      const guarded = await sauce(
        ...argv("simulate", { minTokens: bought + 1n }),
        ...["--expect-revert", "bought below minTokens"],
      );
      expect(guarded.code).toBe(0);
      expect((JSON.parse(guarded.stdout) as { asExpected: boolean }).asExpected).toBe(true);
      const average = (spent * E18) / bought;
      const dear = await sauce(
        ...argv("simulate", { maxAvgPrice: average - 1n }),
        ...["--expect-revert", "average too high"],
      );
      expect(dear.code).toBe(0);
      expect((JSON.parse(dear.stdout) as { asExpected: boolean }).asExpected).toBe(true);
      // At the average, both guards pass, and expecting a revert then fails.
      const met = await sauce(
        ...argv("simulate", { minTokens: bought, maxAvgPrice: average + 1n }),
        ...["--expect-revert", "average too high"],
      );
      expect(met.code).toBe(1);

      // Too large for one transaction, and naming too many accounts to list: `sauce tx` plans it,
      // its first step staging the program and creating the lookup table the cook goes through.
      const tx = await sauce(...argv("tx"));
      expect(tx.code).toBe(0);
      const planned = JSON.parse(tx.stdout) as {
        step: string;
        transactions: Array<{ what: string }>;
        cursor: string;
      };
      expect(planned.step).toBe("setup");
      expect(planned.transactions.map((one) => one.what)).toEqual(
        expect.arrayContaining([
          "creating the code buffer",
          "finalizing the code buffer",
          "creating the lookup table",
          "extending the lookup table",
        ]),
      );
      expect(tx.stderr).toContain("sauce send");

      // An owner that cannot pay, such as a pool, is refused by name before anything runs.
      const orca = pool("orca-whirlpool-sol-usdc").pool;
      const pooled = await sauce(
        ...argv("simulate").map((value) => (value === owner.signer.address ? orca : value)),
      );
      expect(pooled.code).toBe(1);
      expect(pooled.stderr).toContain(
        `--owner ${orca} is an account of whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`,
      );
      expect(pooled.stderr).toContain("not a wallet");
    }, 300_000);

    it("finds the pair's pools with sauce pools, which gives them in slot order for --args", async () => {
      restoreVenues(harness.svm);
      // SOL names the wrapped SOL a pool holds.
      const listed = ok(
        await sauce(
          ...["pools", "--chain", "solana", "USDC", "SOL", "--rpc-url", SOLANA_URL, "--json"],
        ),
      ) as {
        tokens: { symbol: string }[];
        pools: {
          venue: string;
          pool: Address;
          slots: Record<
            string,
            {
              program: Address;
              pool: Address;
              config: Address;
              vaultA: Address;
              vaultB: Address;
              extra: Address;
              ticks: Address[];
            }
          >;
        }[];
        skipped: { venue: string; pool: Address; why: string }[];
      };
      expect(listed.tokens.map((t) => t.symbol)).toEqual(["USDC", "WSOL"]);
      // Every SOL/USDC pool of the fixture, its slot paying USDC the one a cook derives.
      for (const name of [
        "raydium-clmm-sol-usdc",
        "pancakeswap-clmm-sol-usdc",
        "orca-whirlpool-sol-usdc",
        "cropper-sol-usdc",
        "defituna-sol-usdc",
        "crema-sol-usdc",
        "phoenix-sol-usdc",
      ]) {
        const p = pool(name);
        const found = listed.pools.find((one) => one.pool === p.pool);
        if (found === undefined) throw new Error(`sauce pools does not list ${name}`);
        expect(found.slots.USDC).toEqual({
          program: p.program,
          pool: p.pool,
          config: p.config,
          vaultA: p.vaultA,
          vaultB: p.vaultB,
          extra: p.extra,
          ticks: p.payB,
        });
      }
      // Byreal's SOL/USDC pool adds fees past its rate: skipped, as the program skips it.
      expect(listed.skipped.find((one) => one.pool === pool("byreal-sol-usdc").pool)?.why).toMatch(
        /more than one rate/,
      );

      // Chosen for a swap paying USDC within maxPrice, one pool a venue: the pools in slot order,
      // which a simulation takes as they are.
      const choosing = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL],
        ...["--pay", "USDC", "--max-price", String(maxPrice), "--per-venue"],
      );
      const picked = ok(
        await sauce(
          ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL, "--json"],
          ...["--pay", "USDC", "--max-price", String(maxPrice), "--per-venue"],
        ),
      ) as { chosen: { venue: string; pool: Address }[]; poolArgs: string[] };
      expect(picked.chosen).toHaveLength(4);
      expect(new Set(picked.chosen.map((one) => one.venue)).size).toBe(4);
      expect(picked.poolArgs).toEqual(picked.chosen.map((one) => one.pool));
      expect(choosing.stdout).toContain(`in slot order: ${picked.poolArgs.join(" ")}`);
      const stranger = (await keypairFile(work)).signer.address;
      const simulated = ok(
        await sauce(
          ...["simulate", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--owner", stranger, "--assume-balance", "USDC:1000000", "--json"],
          ...["--args", "USDC", "WSOL", ...picked.poolArgs, String(budget), String(maxPrice)],
          ...["0", "0", randomAddress(), randomAddress()],
        ),
      ) as { returned: { bought: string } };
      expect(BigInt(simulated.returned.bought)).toBeGreaterThan(0n);

      // Five slots: the fifth an empty one where fewer pools are chosen.
      const five = ok(
        await sauce(
          ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL, "--json"],
          ...["--pay", "USDC", "--max-price", String(maxPrice), "--per-venue", "--slots", "5"],
        ),
      ) as { chosen: { pool: Address }[]; poolArgs: string[] };
      expect(five.poolArgs).toHaveLength(5);
      expect(five.poolArgs.slice(0, five.chosen.length)).toEqual(five.chosen.map((p) => p.pool));
      expect(new Set(five.poolArgs.slice(five.chosen.length))).toEqual(
        new Set(five.chosen.length === 5 ? [] : [EMPTY]),
      );
    }, 300_000);

    it("simulates for an owner with no Pot, no lamports and no USDC, given --assume-balance", async () => {
      restoreVenues(harness.svm);
      const stranger = (await keypairFile(work)).signer.address;
      const run = await sauce(
        ...["simulate", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--owner", stranger],
        ...["--assume-balance", "USDC:1000000", "--json"],
        ...args(DEEP, randomAddress(), randomAddress()),
      );
      const out = ok(run) as { createPot: unknown; returned: { spent: string; bought: string } };
      expect(out.createPot).not.toBeNull();
      expect(BigInt(out.returned.bought)).toBeGreaterThan(0n);
      // The Pot's SOL account, which the cluster does not have, was made empty in the copy.
      expect(run.stderr).toContain("the Pot's WSOL account");
      expect(run.stderr).toContain("assumed: the Pot's USDC account");
    }, 300_000);

    it("runs the five-slot program with five pools, each trading to its own limit or sitting out", async () => {
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      const cropper = pool("cropper-sol-usdc");
      const recipient = randomAddress();
      const out = ok(
        await sauce(
          ...["simulate", PROGRAM_5, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--owner", owner.signer.address, "--json"],
          ...args([...DEEP, cropper], recipient, randomAddress(), { slots: 5 }),
        ),
      ) as { units: number; returned: { spent: string; bought: string; unspent: string } };
      expect(BigInt(out.returned.bought)).toBeGreaterThan(0n);
      expect(BigInt(out.returned.spent) + BigInt(out.returned.unspent)).toBe(budget);
      expect(BigInt(out.returned.spent) * E18).toBeLessThanOrEqual(
        maxPrice * BigInt(out.returned.bought),
      );
    }, 300_000);
  },
);
