/**
 * The `sauce-solana-distributed-swap` skill's program run as its header says, through `sauce run`
 * itself: the command stages the program (6 KB, past one transaction), finds its 46 accounts past
 * one transaction too, creates an address lookup table holding them, and cooks on the owner's Pot,
 * which it creates first. Against the released Kitchen and engine and the venues' own mainnet
 * programs and pools (`svm/venue-fixture.ts`) in LiteSVM, behind a JSON-RPC shim
 * (`svm/rpc-shim.ts`). A second run takes the table the first created with `--lookup-table`.
 * `sauce simulate` rehearses it in a local copy of the accounts it reads, and `sauce tx`, which
 * cannot hand a cook past one transaction to a signer, refuses it. `sauce pools` gives each pool's
 * slot as the fixture holds it, and a rehearsal for an owner with nothing takes `--assume-balance`
 * and its accounts from an `--accounts` file. The program's own behavior is held in
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
  MEMO,
  NONE,
  ownLimit,
  pool,
  restoreVenues,
  SLOT_NAMES,
  TOKEN,
  TOKEN_2022,
  USDC,
  WSOL,
} from "./svm/venue-fixture.js";
import type { Pool } from "./svm/venue-fixture.js";

/** The skill's program. */
const PROGRAM = fileURLToPath(
  new URL(
    "../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
);

const SOLANA_URL = "http://127.0.0.1:65533/";
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = address(v12SvmEngineProgramId());

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
  "the Solana distributed swap through sauce run: staged, its accounts in a table",
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let work: string;
    let owner: { path: string; signer: KeyPairSigner };
    let pot: Address;

    /** The Pot's associated account for `mint`, holding `amount`: what `pot:<mint>` names. */
    async function potAccount(mint: Address, amount: bigint): Promise<Address> {
      const [account] = await findAssociatedTokenPda({ owner: pot, mint, tokenProgram: TOKEN });
      return setTokenAccount(harness, account, mint, pot, amount);
    }

    /** Every account the program takes, by name, in its manifest's order. */
    const named = (slots: Pool[], recipient: Address, refund: Address): Record<string, string> => {
      const filled = [...slots];
      while (filled.length < 4) filled.push(NONE);
      const byName: Record<string, string> = {
        authority: "pot",
        source: "pot:USDC",
        output: "pot:WSOL",
        recipient,
        refund,
        payMint: "mint:USDC",
        buyMint: "mint:WSOL",
        tokenProgram: TOKEN,
        token2022: TOKEN_2022,
        memo: MEMO,
      };
      filled.forEach((p, k) => {
        const each = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra, ...p.payB];
        SLOT_NAMES(k).forEach((name, j) => (byName[name] = each[j]!));
      });

      return byName;
    };
    /** The same as `--account` flags. */
    const accounts = (slots: Pool[], recipient: Address, refund: Address): string[] =>
      Object.entries(named(slots, recipient, refund)).flatMap(([name, value]) => [
        "--account",
        `${name}=${value}`,
      ]);

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

    it("creates the Pot's missing token account, stages the program, creates a lookup table for its accounts, and cooks", async () => {
      const source = await potAccount(USDC, budget + 3n);
      // The Pot's WSOL account, which the cook buys into, does not exist yet: the run creates it.
      const [output] = await findAssociatedTokenPda({
        owner: pot,
        mint: WSOL,
        tokenProgram: TOKEN,
      });
      expect(harness.svm.getAccount(output).exists).toBe(false);
      const recipient = setTokenAccount(harness, randomAddress(), WSOL, randomAddress(), 0n);
      const refund = setTokenAccount(harness, randomAddress(), USDC, randomAddress(), 0n);
      const run = await sauce(
        ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
        ...["--auto-approve", "--json", ...accounts(DEEP, recipient, refund)],
        ...["--args", String(budget), String(maxPrice), "0", "0"],
      );
      if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}\n${run.stdout}`);
      const out = JSON.parse(run.stdout) as {
        createTokenAccounts?: { accounts: string[] };
        staged?: { transactions: string[] };
        lookupTable?: { address: Address; accounts: number; transactions: string[] };
        cook: { status: string };
      };
      expect(out.createTokenAccounts?.accounts).toEqual([`the Pot's WSOL account, ${output}`]);
      expect(out.cook.status).toBe("success");
      expect(out.staged?.transactions.length).toBeGreaterThan(1);
      expect(out.lookupTable?.accounts).toBeGreaterThan(40);
      for (const p of DEEP) expect(priceOf(p)).toBe(ownLimit(p, maxPrice, false));
      const bought = tokenAmount(harness, recipient);
      const refunded = tokenAmount(harness, refund);
      expect(bought).toBeGreaterThan(0n);
      expect(tokenAmount(harness, source)).toBe(3n);
      expect((budget - refunded) * E18).toBeLessThanOrEqual(maxPrice * bought);

      // The table stays: a second cook naming the same accounts takes it, and creates none.
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      const again = await sauce(
        ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
        ...[
          "--json",
          "--lookup-table",
          out.lookupTable!.address,
          ...accounts(DEEP, recipient, refund),
        ],
        ...["--args", String(budget), String(maxPrice), "0", "0"],
      );
      if (again.code !== 0) throw new Error(`exit ${again.code}\n${again.stderr}\n${again.stdout}`);
      const second = JSON.parse(again.stdout) as {
        createTokenAccounts?: unknown;
        lookupTable?: unknown;
        cook: { status: string };
      };
      expect(second.cook.status).toBe("success");
      expect(second.lookupTable).toBeUndefined();
      expect(second.createTokenAccounts).toBeUndefined();
    }, 300_000);

    it("simulates it in a local copy of its accounts, and prints it as a plan of steps", async () => {
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      await potAccount(WSOL, 0n);
      const recipient = setTokenAccount(harness, randomAddress(), WSOL, randomAddress(), 0n);
      const refund = setTokenAccount(harness, randomAddress(), USDC, randomAddress(), 0n);
      const argv = (command: string, minTokens = "0"): string[] => [
        ...[command, PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, ...accounts(DEEP, recipient, refund)],
        ...["--args", String(budget), String(maxPrice), minTokens, "0"],
        ...(command === "simulate" ? ["--json"] : []),
      ];
      const rehearsed = await sauce(...argv("simulate"));
      if (rehearsed.code !== 0)
        throw new Error(`exit ${rehearsed.code}\n${rehearsed.stderr}\n${rehearsed.stdout}`);
      const out = JSON.parse(rehearsed.stdout) as {
        path: string;
        staged: { bytes: number };
        returned: { spent: string; bought: string; unspent: string };
      };
      expect(out.path).toBe("local copy (LiteSVM)");
      expect(out.staged.bytes).toBeGreaterThan(1232);
      const bought = BigInt(out.returned.bought);
      expect(bought).toBeGreaterThan(0n);
      expect(BigInt(out.returned.spent) + BigInt(out.returned.unspent)).toBe(budget);
      // Nothing happened on the cluster: the pools and the accounts are as they were.
      for (const p of DEEP)
        expect(priceOf(p)).toBe(le(BYTES.get(p.pool)!, LAYOUT[p.venue]!.price, 16));
      expect(tokenAmount(harness, recipient)).toBe(0n);

      // A rehearsal that reverts says why, first; held to that revert, it is what was asked.
      const short = await sauce(...argv("simulate", String(bought + 1n)));
      expect(short.code).toBe(1);
      expect(short.stdout).toContain("bought below minTokens");
      expect(short.stderr.split("\n")[0]).toBe(
        'the cook reverts: the program threw "bought below minTokens"',
      );
      const guarded = await sauce(
        ...argv("simulate", String(bought + 1n)),
        "--expect-revert",
        "bought below minTokens",
      );
      expect(guarded.code).toBe(0);
      expect((JSON.parse(guarded.stdout) as { asExpected: boolean }).asExpected).toBe(true);

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
      const steps = planned.transactions.map((one) => one.what);
      expect(steps).toEqual(
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

    it("finds the pair's pools and chooses each slot with sauce pools, which the rehearsal takes", async () => {
      restoreVenues(harness.svm);
      // SOL names the wrapped SOL a pool holds.
      const listed = await sauce(
        "pools",
        "--chain",
        "solana",
        "USDC",
        "SOL",
        "--rpc-url",
        SOLANA_URL,
        "--json",
      );
      if (listed.code !== 0)
        throw new Error(`exit ${listed.code}\n${listed.stderr}\n${listed.stdout}`);
      expect(
        (JSON.parse(listed.stdout) as { tokens: { symbol: string }[] }).tokens.map((t) => t.symbol),
      ).toEqual(["USDC", "WSOL"]);
      const out = JSON.parse(listed.stdout) as {
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
      // Every SOL/USDC pool of the fixture, its slot paying USDC the one the suite cooks with.
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
        const found = out.pools.find((one) => one.pool === p.pool);
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
      expect(out.skipped.find((one) => one.pool === pool("byreal-sol-usdc").pool)?.why).toMatch(
        /more than one rate/,
      );

      // Chosen for a swap paying USDC within maxPrice, one pool a venue: the accounts of the
      // program's four slots, which a rehearsal takes as they are, beside the shared ones.
      const choosing = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL, "--json"],
        ...["--pay", "USDC", "--max-price", String(maxPrice), "--per-venue"],
      );
      if (choosing.code !== 0)
        throw new Error(`exit ${choosing.code}\n${choosing.stderr}\n${choosing.stdout}`);
      const picked = JSON.parse(choosing.stdout) as {
        chosen: { venue: string; pool: Address }[];
        accounts: Record<string, string>;
      };
      expect(picked.chosen).toHaveLength(4);
      expect(new Set(picked.chosen.map((one) => one.venue)).size).toBe(4);
      picked.chosen.forEach((one, k) => {
        const p = manifest.pools.find((entry) => entry.pool === one.pool)!;
        const each = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra, ...p.payB];
        SLOT_NAMES(k).forEach((name, j) => expect(picked.accounts[name]).toBe(each[j]));
      });
      const recipient = setTokenAccount(harness, randomAddress(), WSOL, randomAddress(), 0n);
      const refund = setTokenAccount(harness, randomAddress(), USDC, randomAddress(), 0n);
      const file = join(work, "chosen.json");
      writeFileSync(file, JSON.stringify({ ...named([], recipient, refund), ...picked.accounts }));
      const rehearsal = await sauce(
        ...["simulate", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", (await keypairFile(work)).signer.address, "--accounts", file],
        ...["--assume-balance", "USDC:1000000", "--json"],
        ...["--args", String(budget), String(maxPrice), "0", "0"],
      );
      if (rehearsal.code !== 0)
        throw new Error(`exit ${rehearsal.code}\n${rehearsal.stderr}\n${rehearsal.stdout}`);
      const rehearsed = JSON.parse(rehearsal.stdout) as { returned: { bought: string } };
      expect(BigInt(rehearsed.returned.bought)).toBeGreaterThan(0n);
    }, 300_000);

    it("rehearses for an owner with no Pot, no lamports and no USDC, given --assume-balance and --accounts", async () => {
      restoreVenues(harness.svm);
      const stranger = (await keypairFile(work)).signer.address;
      const recipient = setTokenAccount(harness, randomAddress(), WSOL, randomAddress(), 0n);
      const refund = setTokenAccount(harness, randomAddress(), USDC, randomAddress(), 0n);
      // Every account but one from an `--accounts` file, and that one as an `--account` beside it.
      const rest = Object.fromEntries(
        Object.entries(named(DEEP, recipient, refund)).filter(([name]) => name !== "refund"),
      );
      const file = join(work, "accounts.json");
      writeFileSync(file, JSON.stringify(rest));
      const run = await sauce(
        ...["simulate", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--owner", stranger],
        ...[
          "--assume-balance",
          "USDC:1000000",
          "--accounts",
          file,
          "--account",
          `refund=${refund}`,
        ],
        ...["--args", String(budget), String(maxPrice), "0", "0", "--json"],
      );
      if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}\n${run.stdout}`);
      const out = JSON.parse(run.stdout) as {
        createPot: unknown;
        returned: { spent: string; bought: string };
      };
      expect(out.createPot).not.toBeNull();
      expect(BigInt(out.returned.bought)).toBeGreaterThan(0n);
      // The Pot's SOL account, which the cluster does not have, was made empty in the copy.
      expect(run.stderr).toContain("--account output: the Pot's WSOL account");
      expect(run.stderr).toContain("assumed: the Pot's USDC account");
    }, 300_000);
  },
);
