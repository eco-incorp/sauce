/**
 * The `sauce-solana-distributed-swap` skill's program run as its header says, through the `sauce`
 * command itself, with `--args` alone: the amounts and the recipient. It buys SPCX_US, a Token-2022
 * mint, with USDC. The program finds its pools by key (`Raydium.CLMM.pool(USDC, SPCX_US, fee)`), and
 * every account it names is derived as the cook is built: each pool its keys find read from the cluster with its nine accounts, a key with no pool
 * an empty slot, the Pot's, the mints' and the recipient's token accounts. `sauce run` stages the
 * program (past one transaction), finds its accounts past one transaction too, creates an address
 * lookup table holding them, creates the token accounts the cook names that do not exist yet, and
 * cooks on the owner's Pot, which it creates first. Against the released Kitchen and engine and the
 * venues' own mainnet programs and pools (`svm/venue-fixture.ts`) in LiteSVM, behind a JSON-RPC shim
 * (`svm/rpc-shim.ts`). A second run takes the table the first created with `--lookup-table`. `sauce
 * simulate` runs it in a local copy of the accounts it reads, holds each guard to its revert with
 * `--expect-revert`, and simulates for an owner with nothing given `--assume-balance`; `sauce tx`
 * prints it as a plan of steps. `sauce pools` lists each pool with the key a program finds it by. A
 * program whose keys find more pools than one transaction locks is refused, naming each key's pool.
 * The program's own behavior is held in `svm/distributed-swap.e2e.test.ts`.
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
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
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
  TOKEN_2022,
  USDC,
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
/** SpaceX, as Backpack issues it: a Token-2022 mint of 6 decimals. */
const SPCX_US = address("SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb");
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
  "the Solana distributed swap through the sauce command, its pools and every input --args",
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let work: string;
    let owner: { path: string; signer: KeyPairSigner };
    let pot: Address;

    /** A holder's associated account for `mint`, holding `amount`: what the program derives. */
    async function ata(holder: Address, mint: Address): Promise<Address> {
      const tokenProgram = mint === SPCX_US ? TOKEN_2022 : TOKEN;
      return (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram }))[0];
    }
    async function potAccount(mint: Address, amount: bigint): Promise<Address> {
      return setTokenAccount(harness, await ata(pot, mint), mint, pot, amount);
    }
    /** The Pot's SPCX_US account, as the ATA program creates it, holding nothing. */
    async function potStock(): Promise<Address> {
      const at = await ata(pot, SPCX_US);
      const account = harness.svm.getAccount(at);
      if (account.exists) {
        const data = new Uint8Array(account.data);
        data.fill(0, 64, 72); // amount
        harness.svm.setAccount({ ...account, data });
        return at;
      }
      const created = await sendInstructions(harness, [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: harness.payer,
          ata: at,
          owner: pot,
          mint: SPCX_US,
          tokenProgram: TOKEN_2022,
        }),
      ]);
      if (!created.ok) throw new Error(`the ATA program made no SPCX_US account: ${created.err}`);
      return at;
    }
    const held = (account: Address): bigint =>
      harness.svm.getAccount(account).exists ? tokenAmount(harness, account) : 0n;

    beforeAll(async () => {
      // A little after the pools were read: a pool refuses a clock before its last update.
      const read = Math.max(manifest.unixTimestamp, ...FOUND.map((p) => p.unixTimestamp ?? 0));
      harness = await startEngine(BigInt(read) + 60n, ENGINE_SO as string, ENGINE);
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

    /** The pools of the program's keys the fixture holds; its other key finds none there. */
    const FOUND = [
      pool("raydium-clmm-spcx-usdc"),
      pool("byreal-spcx-usdc"),
      pool("pancakeswap-clmm-spcx-usdc"),
    ];
    const priceLimit =
      (FOUND.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b)) * 10003n) / 10000n;
    const budget = 1_000_000n * 10n ** 6n;
    const priceOf = (p: Pool): bigint => {
      const account = harness.svm.getAccount(p.pool);
      if (!account.exists) throw new Error(`pool ${p.pool} is gone`);
      return le(account.data, LAYOUT[p.venue]!.price, 16);
    };
    /** main's arguments, as the header gives them. */
    const args = (recipient: Address, { minTokens = 0n, maxAvgPrice = 0n } = {}): string[] => [
      ...["--args", String(budget), String(priceLimit), String(minTokens), String(maxAvgPrice)],
      recipient,
    ];
    const ok = (run: Run): Record<string, unknown> => {
      if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}\n${run.stdout}`);
      return JSON.parse(run.stdout) as Record<string, unknown>;
    };

    it("creates the token accounts it names, stages the program, creates a lookup table for its accounts, and cooks", async () => {
      restoreVenues(harness.svm);
      const source = await potAccount(USDC, budget + 3n);
      // The Pot's SPCX_US account, which the cook buys into, does not exist yet, nor do the
      // recipient's SPCX_US and USDC accounts: the run creates them, under each mint's program.
      const output = await ata(pot, SPCX_US);
      expect(harness.svm.getAccount(output).exists).toBe(false);
      const recipient = randomAddress();
      const out = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--yes", "--json", ...args(recipient)],
        ),
      ) as {
        createTokenAccounts?: { accounts: string[] };
        staged?: { transactions: string[] };
        lookupTable?: { address: Address; accounts: number; transactions: string[] };
        cook: { status: string };
      };
      expect(out.createTokenAccounts?.accounts).toEqual(
        expect.arrayContaining([`the Pot's SPCX_US account, ${output}`]),
      );
      expect(out.createTokenAccounts?.accounts).toHaveLength(3);
      expect(out.cook.status).toBe("success");
      expect(out.staged?.transactions.length).toBeGreaterThan(1);
      expect(out.lookupTable?.accounts).toBeGreaterThan(25);
      for (const p of FOUND) expect(priceOf(p)).toBe(ownLimit(p, priceLimit, false));
      const bought = tokenAmount(harness, await ata(recipient, SPCX_US));
      const refunded = tokenAmount(harness, await ata(recipient, USDC));
      expect(bought).toBeGreaterThan(0n);
      expect(refunded).toBeGreaterThan(0n);
      // What was bought and what is left of the budget went to the recipient: the Pot keeps only
      // its own 3 USDC, and nothing bought.
      expect(tokenAmount(harness, source)).toBe(3n);
      expect(tokenAmount(harness, output)).toBe(0n);
      expect((budget - refunded) * E18).toBeLessThanOrEqual(priceLimit * bought);

      // The table stays: a second cook naming the same accounts takes it, and creates none.
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      const second = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--json", "--lookup-table", out.lookupTable!.address],
          ...args(recipient),
        ),
      ) as { createTokenAccounts?: unknown; lookupTable?: unknown; cook: { status: string } };
      expect(second.cook.status).toBe("success");
      expect(second.lookupTable).toBeUndefined();
      expect(second.createTokenAccounts).toBeUndefined();
    }, 300_000);

    it("keeps what it bought and the rest of the budget in the Pot, given the Pot's own address", async () => {
      restoreVenues(harness.svm);
      const source = await potAccount(USDC, budget);
      const output = await potStock();
      const out = ok(
        await sauce(
          ...["run", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
          ...["--keypair", owner.path, "--yes", "--json", ...args(pot)],
        ),
      ) as { createTokenAccounts?: { accounts: string[] }; cook: { status: string } };
      expect(out.cook.status).toBe("success");
      // The Pot's two accounts exist, and the recipient's is the Pot's: nothing made.
      expect(out.createTokenAccounts).toBeUndefined();
      const bought = tokenAmount(harness, output);
      expect(bought).toBeGreaterThan(0n);
      const unspent = tokenAmount(harness, source);
      expect(unspent).toBeGreaterThan(0n);
      expect((budget - unspent) * E18).toBeLessThanOrEqual(priceLimit * bought);
    }, 300_000);

    it("simulates it in a local copy of its accounts, holds each guard to its revert, and prints it as a plan of steps", async () => {
      restoreVenues(harness.svm);
      await potAccount(USDC, budget);
      await potStock();
      const recipient = randomAddress();
      const argv = (command: string, checks: { minTokens?: bigint; maxAvgPrice?: bigint } = {}) => [
        ...[command, PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, ...args(recipient, checks)],
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
      for (const p of FOUND)
        expect(priceOf(p)).toBe(le(BYTES.get(p.pool)!, LAYOUT[p.venue]!.price, 16));
      expect(held(await ata(recipient, SPCX_US))).toBe(0n);

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

    it("lists the pair's pools with sauce pools, each with the key a program finds it by", async () => {
      restoreVenues(harness.svm);
      // SOL/USDC, whose pools the fixture holds at every venue. SOL names the wrapped SOL a pool
      // holds.
      const solUsdc = [pool("orca-whirlpool-sol-usdc"), pool("raydium-clmm-sol-usdc")];
      const solLimit =
        (solUsdc.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b)) * 10003n) / 10000n;
      const listed = ok(
        await sauce(
          ...["pools", "--chain", "solana", "USDC", "SOL", "--rpc-url", SOLANA_URL, "--json"],
        ),
      ) as {
        tokens: { symbol: string }[];
        pools: {
          venue: string;
          pool: Address;
          byKey?: string;
          sides: { pay: string; priceLimit: string }[];
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
      // Every SOL/USDC pool of the fixture, its slot paying USDC the one a cook derives, and the
      // key a program finds it by where its venue finds pools by key.
      for (const [name, key] of [
        ["raydium-clmm-sol-usdc", "Raydium.CLMM.pool(USDC, WSOL, 400)"],
        ["pancakeswap-clmm-sol-usdc", "Pancakeswap.CLMM.pool(USDC, WSOL, 100, 10)"],
        ["orca-whirlpool-sol-usdc", "Orca.Whirlpool.pool(USDC, WSOL, 4)"],
        ["cropper-sol-usdc", "Cropper.Whirlpool.pool(USDC, WSOL, 2)"],
        ["defituna-sol-usdc", "Defituna.Fusion.pool(USDC, WSOL, 4)"],
        ["crema-sol-usdc", "Crema.CLMM.pool(USDC, WSOL, 50)"],
        ["phoenix-sol-usdc", undefined],
      ] as const) {
        const p = pool(name);
        const found = listed.pools.find((one) => one.pool === p.pool);
        if (found === undefined) throw new Error(`sauce pools does not list ${name}`);
        expect(found.byKey).toBe(key);
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
      // Each side's price, fee included, as a swap's priceLimit.
      const orca = listed.pools.find((one) => one.pool === solUsdc[0]!.pool)!;
      expect(BigInt(orca.sides.find((side) => side.pay === "USDC")!.priceLimit)).toBe(
        allIn(solUsdc[0]!, false),
      );
      // Its pool on Orca's adaptive tier at the same spacing: skipped, as the program skips it.
      expect(
        listed.skipped.find((one) => one.pool === pool("orca-whirlpool-sol-usdc-adaptive").pool)
          ?.why,
      ).toMatch(/adaptive fee/);
      // Byreal's SOL/USDC pool adds fees past its rate: skipped, as the program skips it.
      expect(listed.skipped.find((one) => one.pool === pool("byreal-sol-usdc").pool)?.why).toMatch(
        /more than one rate/,
      );
      const text = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL],
      );
      expect(text.stdout).toContain("found by key: Orca.Whirlpool.pool(USDC, WSOL, 4)");

      // Chosen for a program that takes its pools as arguments, paying USDC within a priceLimit,
      // one pool a venue: the pools in slot order.
      const picked = ok(
        await sauce(
          ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", SOLANA_URL, "--json"],
          ...["--pay", "USDC", "--price-limit", String(solLimit), "--per-venue"],
        ),
      ) as { chosen: { venue: string; pool: Address }[]; poolArgs: string[] };
      expect(picked.chosen.length).toBeGreaterThanOrEqual(2);
      expect(new Set(picked.chosen.map((one) => one.venue)).size).toBe(picked.chosen.length);
      expect(picked.poolArgs.slice(0, picked.chosen.length)).toEqual(
        picked.chosen.map((one) => one.pool),
      );
    }, 300_000);

    it("simulates for an owner with no Pot, no lamports and no USDC, given --assume-balance", async () => {
      restoreVenues(harness.svm);
      const stranger = (await keypairFile(work)).signer.address;
      const run = await sauce(
        ...["simulate", PROGRAM, "--chain", "solana", "--rpc-url", SOLANA_URL, "--owner", stranger],
        ...["--assume-balance", "USDC:1000000", "--json"],
        ...args(randomAddress()),
      );
      const out = ok(run) as { createPot: unknown; returned: { spent: string; bought: string } };
      expect(out.createPot).not.toBeNull();
      expect(BigInt(out.returned.bought)).toBeGreaterThan(0n);
      // The Pot's SPCX_US account, which the cluster does not have, was made empty in the copy.
      expect(run.stderr).toContain("the Pot's SPCX_US account");
      expect(run.stderr).toContain("assumed: the Pot's USDC account");
    }, 300_000);

    it("refuses keys that find more pools than one transaction locks, naming each key's pool", async () => {
      restoreVenues(harness.svm);
      // Every SOL/USDC pool the fixture holds that a key finds, each a slot of its own.
      const greedy = join(work, "greedy.sauce.ts");
      const swaps = [
        "Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4)",
        "Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, 400)",
        "Pancakeswap.CLMM.swap(Pancakeswap.CLMM.pool(USDC, WSOL, 100)",
        "Defituna.Fusion.swap(Defituna.Fusion.pool(USDC, WSOL, 4)",
        "Crema.CLMM.swap(Crema.CLMM.pool(USDC, WSOL, 50)",
        "Cropper.Whirlpool.swap(Cropper.Whirlpool.pool(USDC, WSOL, 2)",
        "Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 1)",
      ];
      writeFileSync(
        greedy,
        "function main(priceLimit: Uint256): Uint256 {\n  let bought = 0;\n" +
          swaps
            .map((swap) => `  bought += ${swap}, USDC, WSOL, self.USDC, priceLimit, 0);\n`)
            .join("") +
          "  return bought;\n}\n",
      );
      const run = await sauce(
        ...["simulate", greedy, "--chain", "solana", "--rpc-url", SOLANA_URL],
        ...["--owner", owner.signer.address, "--args", String(priceLimit)],
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(
        /the cook names \d+ accounts, and a Solana transaction locks at most 64/,
      );
      expect(run.stderr).toContain(
        `Orca.Whirlpool.pool(USDC, WSOL, 4) is ${pool("orca-whirlpool-sol-usdc").pool}`,
      );
      expect(run.stderr).toContain("Orca.Whirlpool.pool(USDC, WSOL, 1) finds none");
      for (const [key, name] of [
        ["Raydium.CLMM.pool(USDC, WSOL, 400)", "raydium-clmm-sol-usdc"],
        ["Pancakeswap.CLMM.pool(USDC, WSOL, 100)", "pancakeswap-clmm-sol-usdc"],
        ["Defituna.Fusion.pool(USDC, WSOL, 4)", "defituna-sol-usdc"],
        ["Crema.CLMM.pool(USDC, WSOL, 50)", "crema-sol-usdc"],
        ["Cropper.Whirlpool.pool(USDC, WSOL, 2)", "cropper-sol-usdc"],
      ] as const)
        expect(run.stderr).toContain(`${key} is ${pool(name).pool}`);
      expect(run.stderr).toContain("name fewer keys");
    }, 300_000);
  },
);
