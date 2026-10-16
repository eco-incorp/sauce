/**
 * Solana's venue namespaces, EXECUTED: `Orca.Whirlpool.swap(pool, USDC, WSOL, …)`,
 * `Raydium.CLMM.swap(…)`, `Phoenix.Market.swap(…)`, `Meteora.DLMM.swap(…)`, every other venue's, and
 * `Solana.swap(…)` at a pool of any of them, compiled for Solana
 * and run through the `sauce`
 * command with the pool as main's argument and no `--account` — the pool's nine accounts read from
 * the pool on the cluster as the cook is built (`svm/pool-slot.ts`), the trader's derived from the
 * owner and the Pot — against the released Kitchen and engine and the venues' own mainnet programs
 * and pools (`svm/venue-fixture.ts`; Meteora DLMM's program and SOL/USDC pool from the exact-input
 * suite's fixtures) in LiteSVM, behind a JSON-RPC shim (`svm/rpc-shim.ts`).
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { address, createKeyPairSignerFromBytes, getAddressDecoder, lamports } from "@solana/kit";
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
import { venueProgram } from "./std/router/exact-in-harness.js";
import { loadFixtures } from "./svm/fixtures.js";
import {
  describeSvm,
  ENGINE_SO,
  loadFixtureAccounts,
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
  key,
  loadVenues,
  manifest,
  pool,
  restoreVenues,
  TOKEN,
  USDC,
  USDT,
  WSOL,
} from "./svm/venue-fixture.js";

const SOLANA_URL = "http://127.0.0.1:65532/";
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = address(v12SvmEngineProgramId());
/** USDC is the higher-key token of the pair: paying it, the pools' price rises. */
const PAYS_LOWER = key(USDC) < key(WSOL);
/** Meteora DLMM's program and its SOL/USDC pool, whose fixture holds the bins its swap walks. */
const DLMM = address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const DLMM_POOL = address("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
const DLMM_FIXTURES = fileURLToPath(new URL("./svm/fixtures/meteora-dlmm/", import.meta.url));

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

const json = (run: Run): Record<string, unknown> => {
  if (run.code !== 0) throw new Error(`exit ${run.code}\n${run.stderr}${run.stdout}`);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

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

describeSvm("Solana's venue namespaces through the sauce command, every account derived", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let owner: { path: string; signer: KeyPairSigner };
  let pot: Address;
  let potUsdc: Address;
  let potWsol: Address;

  const program = (name: string, source: string): string => {
    const path = join(work, `${name}.sauce.ts`);
    writeFileSync(path, source);

    return path;
  };
  const run = (file: string, ...rest: string[]) =>
    sauce(
      ...["run", file, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
      ...["--json", "--yes", ...rest],
    );
  const simulate = (file: string, ...rest: string[]) =>
    sauce(
      ...["simulate", file, "--chain", "solana", "--rpc-url", SOLANA_URL],
      ...["--owner", owner.signer.address, "--json", ...rest],
    );
  /** A swap's limit a little past the pool's own price with its fee: the swap runs. */
  const priceAbove = (name: string): bigint => (allIn(pool(name), PAYS_LOWER) * 10003n) / 10000n;

  beforeAll(async () => {
    harness = await startEngine(BigInt(manifest.unixTimestamp) + 60n, ENGINE_SO as string, ENGINE);
    // Mainnet's rent and its Kitchen fee, as the distributed swap's suite runs them.
    harness.svm.setRent(new Rent(5080n, 1.0, 50));
    const feeConfig = harness.svm.getAccount(harness.feeConfig);
    if (!feeConfig.exists) throw new Error("the harness made no Kitchen fee config");
    harness.svm.setAccount({
      address: harness.feeConfig,
      data: feeConfig.data,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(feeConfig.data.length))),
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
    // Meteora DLMM's program and pool. Its reserve of wrapped SOL holds its amount in lamports too.
    harness.svm.addProgram(DLMM, venueProgram("meteora-dlmm.so.gz"));
    const dlmm = loadFixtures(DLMM_FIXTURES).filter(
      (one) => !BYTES.has(one.address as Address) || one.address === DLMM_POOL,
    );
    loadFixtureAccounts(harness, dlmm);
    for (const one of dlmm) {
      const account = harness.svm.getAccount(one.address as Address);
      if (
        !account.exists ||
        account.programAddress !== TOKEN ||
        account.data.length !== 165 ||
        getAddressDecoder().decode(account.data.subarray(0, 32)) !== WSOL
      )
        continue;
      const held = new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(
        64,
        true,
      );
      harness.svm.setAccount({
        ...account,
        lamports: lamports(harness.svm.minimumBalanceForRentExemption(165n) + held),
      });
    }
    work = mkdtempSync(join(tmpdir(), "sauce-solana-venues-"));
    owner = await keypairFile(work);
    harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
    pot = (await derivePotPda(KITCHEN, owner.signer.address, new Uint8Array(32))).address;
    const ata = async (mint: Address) =>
      (await findAssociatedTokenPda({ owner: pot, mint, tokenProgram: TOKEN }))[0];
    potUsdc = setTokenAccount(harness, await ata(USDC), USDC, pot, 10_000n * 10n ** 6n);
    potWsol = await ata(WSOL);
    shim = solanaShim(harness.svm, SOLANA_URL, () => [...BYTES.keys()]);
    shim.install();
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it.each([
    ["the sauce-swaps skill's", "../../skills/sauce-swaps/examples/solana-swap.sauce.ts"],
    ["the manual's", "../../docs/examples/solana-swap.sauce.ts"],
  ])(
    "runs %s Solana swap as its header says: the pool and amounts as --args",
    async (whose, path) => {
      restoreVenues(harness.svm);
      const file = fileURLToPath(new URL(path, import.meta.url));
      const header = readFileSync(file, "utf8")
        .split("\n")
        .filter((one) => one.startsWith("//"))
        .map((one) => one.replace(/^\/\/\s*/, ""));
      const first = header.findIndex((one) =>
        one.startsWith("sauce run solana-swap.sauce.ts --chain solana"),
      );
      const line = header
        .slice(first, first + 2)
        .map((one) => one.replace(/\\$/, ""))
        .join(" ");
      const orca = pool("orca-whirlpool-sol-usdc");
      const to = randomAddress();
      const [toWsol] = await findAssociatedTokenPda({ owner: to, mint: WSOL, tokenProgram: TOKEN });
      const filled: Record<string, string> = {
        "<keypair>": owner.path,
        "<pool>": orca.pool,
        "<recipient>": to,
      };
      const argv = line
        .split(/\s+/)
        .filter((word) => word !== "")
        .slice(1)
        .map((word) => filled[word] ?? word);
      expect(argv.slice(0, 2)).toEqual(["run", "solana-swap.sauce.ts"]);
      expect(argv).not.toContain("--account");
      argv[1] = file;
      const before = tokenAmount(harness, potUsdc);
      // The Pot's WSOL account, where the swap lands what it buys, does not exist before the first
      // run: the run makes it.
      if (whose === "the sauce-swaps skill's") {
        expect(harness.svm.getAccount(potWsol).exists).toBe(false);
      }
      const out = json(await sauce(...argv, "--rpc-url", SOLANA_URL, "--json", "--yes"));
      expect(out).toMatchObject({ cook: { status: "success" } });
      // 100 USDC at a whirlpool near 118 USDC a SOL: the 0.4 SOL floor is met, and all of it forwarded.
      expect(tokenAmount(harness, toWsol)).toBeGreaterThanOrEqual(400_000_000n);
      expect(tokenAmount(harness, potUsdc)).toBe(before - 100_000_000n);
    },
    300_000,
  );

  it("`sauce compile --json` lists the pool's slot and the trader's accounts with their derivations", async () => {
    const file = program(
      "orca-compile",
      "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n",
    );
    const out = json(await sauce("compile", file, "--chain", "solana", "--json"));
    const derive = (out.manifest as { accounts: { name: string; derive?: string }[] }).accounts.map(
      (slot) => `${slot.name}=${slot.derive}`,
    );
    expect(derive).toEqual([
      "poolProgram=slot:@pool:USDC.program",
      "poolAccount=slot:@pool:USDC.pool",
      "poolConfig=slot:@pool:USDC.config",
      "poolVaultA=slot:@pool:USDC.vaultA",
      "poolVaultB=slot:@pool:USDC.vaultB",
      "poolExtra=slot:@pool:USDC.extra",
      "poolTicks0=slot:@pool:USDC.ticks0",
      "poolTicks1=slot:@pool:USDC.ticks1",
      "poolTicks2=slot:@pool:USDC.ticks2",
      "pot=self",
      "potUSDC=self:USDC",
      "mintUSDC=mint:USDC",
      "mintWSOL=mint:WSOL",
      `tokenProgram=${TOKEN}`,
      "token2022Program=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "memoProgram=MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      "potWSOL=self:WSOL",
    ]);
  });

  it("swaps at an Orca whirlpool given only its address, returning what arrived in the Pot", async () => {
    restoreVenues(harness.svm);
    const file = program(
      "orca",
      "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n",
    );
    const orca = pool("orca-whirlpool-sol-usdc");
    const amount = 100n * 10n ** 6n;
    const args = ["--args", orca.pool, String(amount), String(priceAbove(orca.name))];
    const before = tokenAmount(harness, potUsdc);
    const held = harness.svm.getAccount(potWsol).exists ? tokenAmount(harness, potWsol) : 0n;

    // Simulated first, then run: what main returns is what arrived in the Pot.
    const rehearsed = json(await simulate(file, ...args));
    expect(rehearsed).toMatchObject({ ok: true });
    const out = json(await run(file, ...args));
    expect(out).toMatchObject({ cook: { status: "success" } });
    const bought = tokenAmount(harness, potWsol) - held;
    expect(bought).toBeGreaterThan(0n);
    expect(BigInt(rehearsed.returned as string)).toBe(bought);
    expect(tokenAmount(harness, potUsdc)).toBe(before - amount);
  }, 300_000);

  it("Raydium.CLMM.swap then forwards what arrived; past its limit it skips, moving nothing", async () => {
    restoreVenues(harness.svm);
    const file = program(
      "raydium-forward",
      "function main(pool: Address, to: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  const got = Raydium.CLMM.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n" +
        "  if (got > 0) WSOL.transfer(to, got);\n" +
        "  return got;\n}\n",
    );
    const raydium = pool("raydium-clmm-sol-usdc");
    const to = randomAddress();
    const [toWsol] = await findAssociatedTokenPda({ owner: to, mint: WSOL, tokenProgram: TOKEN });
    const amount = 50n * 10n ** 6n;
    const before = tokenAmount(harness, potUsdc);

    const out = json(
      await run(file, "--args", raydium.pool, to, String(amount), String(priceAbove(raydium.name))),
    );
    expect(out).toMatchObject({ cook: { status: "success" } });
    expect(tokenAmount(harness, toWsol)).toBeGreaterThan(0n);
    expect(tokenAmount(harness, potUsdc)).toBe(before - amount);

    // A limit below the pool's price: the try form returns 0, and nothing moves.
    const skipped = json(
      await simulate(
        file,
        "--args",
        raydium.pool,
        to,
        String(amount),
        String(priceAbove(raydium.name) / 2n),
      ),
    );
    expect(skipped).toMatchObject({ ok: true, returned: "0" });
  }, 300_000);

  it("takes from Phoenix's order book, its slot the same paying either token", async () => {
    restoreVenues(harness.svm);
    const file = program(
      "phoenix",
      "function main(market: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Phoenix.Market.swap(market, USDC, WSOL, amountIn, maxPrice, 1);\n}\n",
    );
    const phoenix = pool("phoenix-sol-usdc");
    // Any limit above the book's best offer: Phoenix's own arithmetic is the router's to hold.
    const out = json(
      await simulate(file, "--args", phoenix.pool, String(20n * 10n ** 6n), String(10n ** 30n)),
    );
    expect(out).toMatchObject({ ok: true });
    expect(BigInt(out.returned as string)).toBeGreaterThan(0n);
  }, 300_000);

  it.each([
    ["Pancakeswap.CLMM", "pancakeswap-clmm-sol-usdc", WSOL],
    ["Byreal.CLMM", "byreal-usdc", address("4SoQ8UkWfeDH47T56PA53CZCeW4KytYCiU65CwBWoJUt")],
    ["Stabble.CLMM", "stabble-clmm-usdc-usdt", USDT],
    ["Cropper.Whirlpool", "cropper-sol-usdc", WSOL],
    ["Defituna.Fusion", "defituna-sol-usdc", WSOL],
    ["Crema.CLMM", "crema-sol-usdc", WSOL],
  ] as const)(
    "%s.swap at %s, given only the pool and the mint bought, lands what it bought in the Pot",
    async (namespace, name, buy) => {
      restoreVenues(harness.svm);
      const file = program(
        `venue-${namespace}`,
        "function main(pool: Address, buy: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
          `  return ${namespace}.swap(pool, USDC, buy, amountIn, maxPrice, 1);\n}\n`,
      );
      const p = pool(name);
      const amount = 5n * 10n ** 6n;
      const maxPrice = (allIn(p, key(USDC) < key(buy)) * 10003n) / 10000n;
      const args = ["--args", p.pool, buy, String(amount), String(maxPrice)];
      const mint = harness.svm.getAccount(buy);
      if (!mint.exists) throw new Error(`the fixture has no mint ${buy}`);
      const [potBuy] = await findAssociatedTokenPda({
        owner: pot,
        mint: buy,
        tokenProgram: mint.programAddress,
      });
      const held = harness.svm.getAccount(potBuy).exists ? tokenAmount(harness, potBuy) : 0n;
      const before = tokenAmount(harness, potUsdc);

      // The run creates the Pot's account for what it buys where there is none (--yes).
      expect(json(await run(file, ...args))).toMatchObject({ cook: { status: "success" } });
      const bought = tokenAmount(harness, potBuy) - held;
      expect(bought).toBeGreaterThan(0n);
      const paid = before - tokenAmount(harness, potUsdc);
      expect(paid > 0n && paid <= amount).toBe(true);
      // Simulated again, what main returns is what arrives.
      restoreVenues(harness.svm);
      const again = json(await simulate(file, ...args));
      expect(again).toMatchObject({ ok: true });
      expect(BigInt(again.returned as string)).toBeGreaterThan(0n);
    },
    300_000,
  );

  it("Solana.swap takes a pool of any venue, and an empty slot, given by --args alone", async () => {
    restoreVenues(harness.svm);
    // Three slots, each a pool at whichever venue it is, or none: what a distributed swap takes.
    const file = program(
      "any-venue",
      "function main(pool0: Address, pool1: Address, pool2: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  const first = Solana.swap(pool0, USDC, WSOL, amountIn, maxPrice, 0);\n" +
        "  const second = Solana.swap(pool1, USDC, WSOL, amountIn, maxPrice, 0);\n" +
        "  const third = Solana.swap(pool2, USDC, WSOL, amountIn, maxPrice, 0);\n" +
        "  return first + second + third;\n}\n",
    );
    const compiled = json(await sauce("compile", file, "--chain", "solana", "--json")) as {
      manifest: { accounts: { name: string; derive?: string }[] };
      accountsToGive: unknown[];
    };
    // Every account derived: nothing to give.
    expect(compiled.accountsToGive).toEqual([]);
    expect(compiled.manifest.accounts.map((slot) => slot.derive)).toContain(
      "slot:@pool1:USDC.vaultA",
    );
    const orca = pool("orca-whirlpool-sol-usdc");
    const raydium = pool("raydium-clmm-sol-usdc");
    const amount = 20n * 10n ** 6n;
    const maxPrice = [priceAbove(orca.name), priceAbove(raydium.name)].reduce((a, b) =>
      a > b ? a : b,
    );
    const empty = "11111111111111111111111111111111";
    const args = ["--args", orca.pool, empty, raydium.pool, String(amount), String(maxPrice)];
    const before = tokenAmount(harness, potUsdc);
    const held = harness.svm.getAccount(potWsol).exists ? tokenAmount(harness, potWsol) : 0n;

    const rehearsed = json(await simulate(file, ...args));
    expect(rehearsed).toMatchObject({ ok: true });
    const out = json(await run(file, ...args));
    expect(out).toMatchObject({ cook: { status: "success" } });
    // Two pools swapped, the empty slot skipped: what main returned is what arrived in the Pot.
    const bought = tokenAmount(harness, potWsol) - held;
    expect(bought).toBeGreaterThan(0n);
    expect(BigInt(rehearsed.returned as string)).toBe(bought);
    expect(tokenAmount(harness, potUsdc)).toBe(before - 2n * amount);
  }, 300_000);

  it("Meteora.DLMM.swap walks the pool's bins to maxPrice, and Solana.swap takes the pool too", async () => {
    // A limit a twentieth above the pool's active bin, which paying USDC costs its price, Q64.64 USDC
    // per SOL, fee aside: the swap takes what the bins within it hold.
    const pair = harness.svm.getAccount(DLMM_POOL);
    if (!pair.exists) throw new Error("no DLMM pool");
    const active = new DataView(pair.data.buffer, pair.data.byteOffset).getInt32(76, true);
    const index = Math.floor(active / 70);
    const bins = harness.svm.getAccount(address("EsMdTh8Ce3fdpQoLGhbuqrXKQnZTUQfVpKAbokm6QjYC"));
    if (!bins.exists || index !== -90) throw new Error("the fixture's active bin array moved");
    const cell = 56 + (active - index * 70) * 144 + 16;
    let price = 0n;
    for (let i = 15; i >= 0; i--) price = (price << 8n) | BigInt(bins.data[cell + i]!);
    const maxPrice = (((price * 10n ** 18n) >> 64n) * 21n) / 20n;
    const file = program(
      "dlmm",
      "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Meteora.DLMM.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n",
    );
    const amount = 100n * 10n ** 6n;
    const args = ["--args", DLMM_POOL, String(amount), String(maxPrice)];
    const derive = (
      json(await sauce("compile", file, "--chain", "solana", "--json")) as {
        manifest: { accounts: { derive?: string }[] };
      }
    ).manifest.accounts.map((slot) => slot.derive);
    expect(derive).toContain("slot:@pool:USDC.ticks1");
    const rehearsed = json(await simulate(file, ...args));
    expect(rehearsed).toMatchObject({ ok: true });
    const held = harness.svm.getAccount(potWsol).exists ? tokenAmount(harness, potWsol) : 0n;
    const before = tokenAmount(harness, potUsdc);
    expect(json(await run(file, ...args))).toMatchObject({ cook: { status: "success" } });
    const bought = tokenAmount(harness, potWsol) - held;
    expect(bought).toBeGreaterThan(0n);
    expect(BigInt(rehearsed.returned as string)).toBe(bought);
    expect(tokenAmount(harness, potUsdc)).toBe(before - amount);
    // The same pool through Solana.swap; below the pool's price, nothing moves.
    const any = program(
      "dlmm-any",
      "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Solana.swap(pool, USDC, WSOL, amountIn, maxPrice, 0);\n}\n",
    );
    const again = json(await simulate(any, ...args));
    expect(again).toMatchObject({ ok: true });
    expect(BigInt(again.returned as string)).toBeGreaterThan(0n);
    const below = json(
      await simulate(any, "--args", DLMM_POOL, String(amount), String(maxPrice / 2n)),
    );
    expect(below).toMatchObject({ ok: true, returned: "0" });
  }, 300_000);

  it("refuses a pool no price-limit venue owns before the cook, and another venue's on chain", async () => {
    const file = program(
      "orca-refused",
      "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n",
    );
    const book = pool("manifest-sol-usdc");
    const wrong = await simulate(file, "--args", book.pool, "1", "1");
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain(
      `the account poolProgram (slot:@pool:USDC.program): pool ${book.pool}'s slot paying USDC ` +
        "could not be read",
    );
    expect(wrong.stderr).toContain("which is not a venue whose swap stops at a price limit");
    // Another venue's pool, even one holding the token paid: its program refuses it on chain, by
    // the venue's own check, before anything moves.
    const stabble = pool("stabble-clmm-usdc-usdt");
    const other = await simulate(file, "--args", stabble.pool, "1", "1");
    expect(other.code).toBe(1);
    expect(JSON.parse(other.stdout)).toMatchObject({
      ok: false,
      reason: 'the program threw "not an Orca whirlpool"',
    });
  }, 120_000);
});
