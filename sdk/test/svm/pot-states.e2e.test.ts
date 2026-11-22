/**
 * A Solana Pot in each state the Kitchen cooks, on the `sauce` command's own paths, against the
 * released Kitchen and engine in LiteSVM behind the JSON-RPC shim (`rpc-shim.ts`).
 *
 * The Kitchen signs for a Pot's address whether or not `create_pot` ever made the account (its IDL:
 * the Pot "holds no data and need not exist for a program that keeps no storage"), and the command
 * cooked such an address before this release. An address that holds only lamports (the System
 * Program's, no data) is a Pot no engine owns yet: it is cooked as it is, on the installed engine,
 * with no `create_pot`, and stays the System Program's. That is also the only state in which a
 * program can pay SOL out of the Pot through the System Program, whose transfer takes no `from`
 * that carries data. Anyone can put an address in that state by sending it lamports, so refusing it
 * would let a stranger stop an owner's first cook for the price of an empty account's rent.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI. Not run on the legacy arm: its CLI suites load the engine at the released id themselves.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { hexToBytes } from "viem";

import { requireChain } from "../../src/chains/canonical.js";
import { potSalt } from "../../src/deployments/pot.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { svmTokenRows } from "../../src/routes/token-registry.js";
import { derivePotPda, MAX_POT_LEN } from "../../src/svm/index.js";
import { jsonOf, sauce, type Run } from "../cli-anvil.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  setMint,
  setTokenAccount,
  startEngine,
  tokenAmount,
  type EngineHarness,
} from "./engine-harness.js";
import { solanaShim, type SolanaShim } from "./rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65530/";
const SYSTEM = address("11111111111111111111111111111111");
const INSTALLED = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());

/** The docs' payout: `pay.sauce.ts <recipient> <amount>`, USDC from the Pot; past one transaction. */
const PAY = fileURLToPath(new URL("../../../docs/examples/pay.sauce.ts", import.meta.url));
/** A program that returns 7: it fits one transaction, so a cluster simulates it. */
const SEVEN = ["// @chain solana", "function main(): Uint256 {", "  return 7;", "}", ""].join("\n");
/** A program carrying `bytes` literal bytes: past one transaction, so it is staged. */
const blobSource = (bytes: number): string =>
  [
    "// @chain solana",
    "function main(): Uint256 {",
    `  const blob = hex\`${"ab".repeat(bytes)}\`;`,
    `  const at = ctx.timestamp() % ${bytes};`,
    "  const value = blob.slice(at, at + 1).toBe();",
    "  require(value == 171);",
    "  return value;",
    "}",
    "",
  ].join("\n");
/** The Pot pays 1,000,000 lamports to `to` through the System Program. */
const SOL_PAYOUT = [
  "// @chain solana",
  "function main(system: Account, pot: Account<Writable, Signer>, to: Account<Writable>) {",
  "  let native = hex`02000000`;",
  "  svm.call(system, [pot, to], native.concat(1000000n.toBytesLe(8)));",
  "}",
  "",
].join("\n");

/** What `sauce simulate --json` returns, as these tests read it. */
interface Simulated {
  readonly ok: boolean;
  readonly path: string;
  readonly pot?: string;
  readonly logs: string[];
  readonly createPot?: unknown;
  readonly tokenChanges?: ReadonlyArray<{ readonly delta: string }>;
}
/** What `sauce tx --json` hands out: the cook alone, or a plan's step. */
interface Planned {
  readonly createsPot?: boolean;
  readonly transaction?: string;
  readonly step?: string;
  readonly transactions?: ReadonlyArray<{ readonly what: string }>;
  readonly cursor: string;
}
/** What `sauce run --json` reports of the cook. */
interface Ran {
  readonly cook: { readonly status: string };
  readonly createPot?: unknown;
}
/** What `sauce send --cursor --json` returns: what was sent, and the step after. */
interface Sent {
  readonly ok: boolean;
  readonly next: Planned;
}
/** What `sauce pot --json` says of the cluster. */
interface PotStatus {
  readonly deployment: { readonly pot: Record<string, unknown> };
}
const read = <T>(run: Run): T => jsonOf(run) as unknown as T;

describeSvm("a Solana Pot address that holds only lamports", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let seven: string;
  let blob: string;
  let payout: string;
  const recipient = randomAddress();

  const keypair = async (name: string): Promise<{ path: string; signer: KeyPairSigner }> => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const bytes = new Uint8Array([...seed, ...pub]);
    const path = join(work, `${name}.json`);
    writeFileSync(path, JSON.stringify([...bytes]));
    const signer = await createKeyPairSignerFromBytes(bytes);
    harness.svm.airdrop(signer.address, lamports(50_000_000_000n));

    return { path, signer };
  };
  const potOf = async (owner: Address, salt: string): Promise<Address> =>
    (await derivePotPda(KITCHEN, owner, hexToBytes(potSalt(salt)))).address;
  const ataOf = async (holder: Address, mint: Address): Promise<Address> =>
    (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  /** The flags that name `owner`'s Pot of `salt` on the cluster, for a command that signs nothing. */
  const named = (owner: Address, salt: string): string[] => [
    ...["--chain", "solana", "--owner", owner, "--salt", salt, "--rpc-url", RPC_URL],
  ];
  /** The flags of a command that signs as the keypair at `path`: its own Pot of `salt`. */
  const signedAs = (path: string, salt: string): string[] => [
    ...["--chain", "solana", "--salt", salt, "--rpc-url", RPC_URL, "--keypair", path],
  ];
  const account = (key: Address) => harness.svm.getAccount(key);
  const dataLength = (key: Address): number | undefined => {
    const held = harness.svm.getAccount(key);

    return held.exists ? held.data.length : undefined;
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, INSTALLED);
    work = mkdtempSync(join(tmpdir(), "sauce-pot-states-"));
    seven = join(work, "seven.sauce.ts");
    blob = join(work, "blob.sauce.ts");
    payout = join(work, "payout.sauce.ts");
    writeFileSync(seven, SEVEN);
    writeFileSync(blob, blobSource(1500));
    writeFileSync(payout, SOL_PAYOUT);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("simulates, plans and runs a cook on it, as it is, on the installed engine, and leaves it the System Program's", async () => {
    const owner = await keypair("prefunded");
    const pot = await potOf(owner.signer.address, "prefunded");
    harness.svm.airdrop(pot, lamports(5_000_000n));
    expect(account(pot)).toMatchObject({ exists: true, programAddress: SYSTEM });
    const flags = named(owner.signer.address, "prefunded");

    // On the cluster, a program that fits one transaction: simulated with no create_pot ahead of it.
    const simulated = await sauce("simulate", seven, ...flags, "--json");
    const inline = read<Simulated>(simulated);
    expect(inline).toMatchObject({ ok: true, pot, path: "simulateTransaction", createPot: null });
    expect(inline.logs.some((line) => line.startsWith(`Program ${INSTALLED} invoke`))).toBe(true);
    expect(simulated.stderr).toContain(
      `Pot ${pot} holds 5000000 lamports and no engine owns it yet`,
    );

    // The plan: the cook alone, creating nothing.
    const planned = await sauce("tx", seven, ...flags);
    expect(read<Planned>(planned)).toMatchObject({ createsPot: false });
    expect(planned.stderr).toContain(`Pot ${pot} holds 5000000 lamports and no engine owns it yet`);

    // Sent: it succeeds, creates no Pot, and the address is still the System Program's, with what
    // it held.
    const ran = await sauce("run", seven, ...signedAs(owner.path, "prefunded"), "--yes", "--json");
    expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
    expect(read<Ran>(ran).createPot).toBeUndefined();
    expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 5_000_000n });
    expect(dataLength(pot)).toBe(0);
  }, 180_000);

  it("pays SOL out of it through the System Program, which a Pot carrying data could not", async () => {
    const owner = await keypair("sol-payout");
    const pot = await potOf(owner.signer.address, "sol-payout");
    const to = randomAddress();
    harness.svm.airdrop(pot, lamports(5_000_000n));
    const ran = await sauce(
      ...["run", payout, ...signedAs(owner.path, "sol-payout")],
      ...["--account", "system=system", "--account", "pot=pot", "--account", `to=${to}`],
      ...["--yes", "--json"],
    );
    expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
    expect(account(to)).toMatchObject({ exists: true, lamports: 1_000_000n });
    expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 4_000_000n });
  }, 180_000);

  it("moves the Pot's tokens in a staged cook: simulated in the local copy, then sent", async () => {
    const owner = await keypair("staged");
    const pot = await potOf(owner.signer.address, "staged");
    harness.svm.airdrop(pot, lamports(5_000_000n));
    const usdc = address(
      svmTokenRows(requireChain("solana")).find((row) => row.symbol === "USDC")!.mint,
    );
    setMint(harness, usdc, 6);
    const potUsdc = await ataOf(pot, usdc);
    setTokenAccount(harness, potUsdc, usdc, pot, 3_000_000n);
    const toUsdc = await ataOf(recipient, usdc);
    setTokenAccount(harness, toUsdc, usdc, recipient, 0n);
    const args = ["--args", recipient, "1000000"];

    // Past one transaction, so the local copy simulates it: the Pot's signature through the engine's
    // CPI into the token program, from an address the System Program owns.
    const simulated = read<Simulated>(
      await sauce("simulate", PAY, ...named(owner.signer.address, "staged"), ...args, "--json"),
    );
    expect(simulated).toMatchObject({ ok: true, path: "local copy (LiteSVM)", pot });
    expect(simulated.tokenChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: "-1000000" }),
        expect.objectContaining({ delta: "1000000" }),
      ]),
    );
    expect(tokenAmount(harness, toUsdc)).toBe(0n);

    const ran = await sauce(
      "run",
      PAY,
      ...signedAs(owner.path, "staged"),
      ...args,
      "--yes",
      "--json",
    );
    expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
    expect(tokenAmount(harness, toUsdc)).toBe(1_000_000n);
    expect(tokenAmount(harness, potUsdc)).toBe(2_000_000n);
    expect(account(pot)).toMatchObject({ programAddress: SYSTEM });
  }, 180_000);

  it("carries on a plan whose Pot was funded after its cursor was made: no create_pot, no refusal", async () => {
    const owner = await keypair("planned");
    const pot = await potOf(owner.signer.address, "planned");
    const flags = named(owner.signer.address, "planned");
    // The Pot is missing, so the plan's setup creates it, first.
    const first = read<Planned>(await sauce("tx", blob, ...flags));
    expect(first.step).toBe("setup");
    expect(first.transactions!.map((tx) => tx.what)[0]).toBe("creating the Pot");
    // Lamports reach the address before the owner signs a thing.
    harness.svm.airdrop(pot, lamports(1_000_000n));
    const resumed = read<Sent>(
      await sauce("send", "--cursor", first.cursor, "--rpc-url", RPC_URL, "--json"),
    );
    expect(resumed.ok).toBe(true);
    expect(resumed.next.step).toBe("setup");
    const whats = resumed.next.transactions!.map((tx) => tx.what);
    expect(whats).not.toContain("creating the Pot");
    expect(whats[0]).toBe("creating the code buffer");
    expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 1_000_000n });
  }, 180_000);

  it("is not created: `sauce pot` says so and that cooks run on it, and --deploy creates it, keeping its lamports", async () => {
    const owner = await keypair("deployed");
    const pot = await potOf(owner.signer.address, "deployed");
    harness.svm.airdrop(pot, lamports(3_000_000n));
    const status = await sauce("pot", ...named(owner.signer.address, "deployed"));
    expect(read<PotStatus>(status).deployment.pot).toEqual({ address: pot, deployed: false });
    expect(status.stderr).toContain(
      `The Pot ${pot} holds 3000000 lamports and no engine owns it, so it is not created: cooks run on it as it is`,
    );
    expect(status.stderr).not.toContain("is already created");

    // --deploy: the Kitchen's create_pot succeeds on a prefunded address (it tops up the rent, then
    // allocates and assigns), so it is created, for the installed engine, with what it held kept.
    const deployed = await sauce("pot", "--deploy", ...signedAs(owner.path, "deployed"));
    expect(deployed.code).toBe(0);
    expect(deployed.stderr).not.toContain("is already created");
    expect(deployed.stderr).toContain(`held 3000000 lamports and no engine owned it`);
    expect(read<{ deployed: boolean }>(deployed).deployed).toBe(true);
    expect(account(pot)).toMatchObject({ programAddress: INSTALLED });
    expect(dataLength(pot)).toBe(MAX_POT_LEN);

    // Created now: reported so, on the engine that owns it, and a second --deploy changes nothing.
    const after = await sauce("pot", ...named(owner.signer.address, "deployed"));
    expect(read<PotStatus>(after).deployment.pot).toEqual({
      address: pot,
      deployed: true,
      engine: INSTALLED,
    });
    const again = await sauce("pot", "--deploy", ...signedAs(owner.path, "deployed"));
    expect(again.stderr).toContain(`Pot ${pot} is already created on solana.`);
  }, 180_000);
});
