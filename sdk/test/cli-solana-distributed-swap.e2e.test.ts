/**
 * The `sauce-solana-distributed-swap` skill's program run as its header says, through `sauce run`
 * itself: the command stages the program (6 KB, past one transaction), finds its 46 accounts past
 * one transaction too, creates an address lookup table holding them, and cooks on the owner's Pot,
 * which it creates first. Against the released Kitchen and engine and the venues' own mainnet
 * programs and pools (`svm/venue-fixture.ts`) in LiteSVM, behind a JSON-RPC shim
 * (`svm/rpc-shim.ts`). A second run takes the table the first created with `--lookup-table`.
 * `sauce simulate` and `sauce tx` refuse it, a cook past one transaction, naming staging and the
 * lookup table. The program's own behavior is held in `svm/distributed-swap.e2e.test.ts`.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, createKeyPairSignerFromBytes, lamports } from "@solana/kit";
import type { Address, KeyPairSigner } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import { nodeIo, runCli } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
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
  PROGRAM,
  restoreVenues,
  SLOT_NAMES,
  TOKEN,
  TOKEN_2022,
  USDC,
  WSOL,
} from "./svm/venue-fixture.js";
import type { Pool } from "./svm/venue-fixture.js";

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

    /** Every account the program takes, as `--account` flags in its manifest's order. */
    const accounts = (slots: Pool[], recipient: Address, refund: Address): string[] => {
      const filled = [...slots];
      while (filled.length < 4) filled.push(NONE);
      const named: Record<string, string> = {
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
        SLOT_NAMES(k).forEach((name, j) => (named[name] = each[j]!));
      });

      return Object.entries(named).flatMap(([name, value]) => ["--account", `${name}=${value}`]);
    };

    beforeAll(async () => {
      harness = await startEngine(
        BigInt(manifest.unixTimestamp) + 60n,
        ENGINE_SO as string,
        ENGINE,
      );
      loadVenues(harness.svm);
      restoreVenues(harness.svm);
      work = mkdtempSync(join(tmpdir(), "sauce-solana-dswap-"));
      owner = await keypairFile(work);
      harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
      pot = (await derivePotPda(KITCHEN, owner.signer.address, new Uint8Array(32))).address;
      shim = solanaShim(harness.svm, SOLANA_URL);
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

    it("stages the program, creates a lookup table for its accounts, and cooks", async () => {
      const source = await potAccount(USDC, budget + 3n);
      await potAccount(WSOL, 0n);
      const recipient = setTokenAccount(harness, randomAddress(), WSOL, randomAddress(), 0n);
      const refund = setTokenAccount(harness, randomAddress(), USDC, randomAddress(), 0n);
      const run = await sauce(
        ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
        ...["--auto-approve", "--json", ...accounts(DEEP, recipient, refund)],
        ...["--args", String(budget), String(maxPrice), "0", "0"],
      );
      if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}\n${run.stdout}`);
      const out = JSON.parse(run.stdout) as {
        staged?: { transactions: string[] };
        lookupTable?: { address: Address; accounts: number; transactions: string[] };
        cook: { status: string };
      };
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
        lookupTable?: unknown;
        cook: { status: string };
      };
      expect(second.cook.status).toBe("success");
      expect(second.lookupTable).toBeUndefined();
    }, 300_000);

    it("refuses to simulate or print it as one transaction, naming staging and the table", async () => {
      const recipient = randomAddress();
      const refund = randomAddress();
      for (const command of ["simulate", "tx"]) {
        const run = await sauce(
          ...[command, PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--owner", owner.signer.address, ...accounts(DEEP, recipient, refund)],
          ...["--args", String(budget), String(maxPrice), "0", "0"],
        );
        expect(run.code).toBe(1);
        expect(run.stderr).toContain("sauce run");
        expect(run.stderr).toContain("--lookup-table");
      }
      void BYTES;
    }, 120_000);
  },
);
