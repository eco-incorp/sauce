/**
 * A Solana Pot cooks on the engine that owns it, on the `sauce` command's own paths: an owner whose
 * Pot a v12-svm 1.4.0 engine created cooks through that engine, an owner with no Pot is given one
 * of the installed release (v12-svm 1.4.1) and cooks through that — in a simulation on the cluster,
 * in the local copy a staged program is simulated in, in a plan's cursor, and in a cook sent. The
 * cluster is a LiteSVM bank behind the JSON-RPC shim (`rpc-shim.ts`), of devnet's genesis hash, that
 * holds BOTH engines at their release ids, each as its release built it for that cluster: the
 * installed one the packaged ELF, the earlier one the ELF `sync-engine-artifacts` takes from that
 * release's public package (`legacy/`). The docs' `pay.sauce.ts` is the program: USDC moved out of
 * the Pot by the engine's CPI, which only a Pot the engine accepts can sign for.
 *
 * The local copy runs the code its cluster is shown to run and never another build: the earlier
 * engine's ELF where the cluster holds it as that release's build for the cluster's kind (held to
 * the release's committed digest), a refusal otherwise. Nothing is substituted.
 *
 * GATED on the engine artifacts and on the earlier engine's ELF, and a hard failure without them
 * in CI. The legacy arm does not run it: it loads both engines itself.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { hexToBytes } from "viem";

import { requireChain } from "../../src/chains/canonical.js";
import { decodeCursor, planEngine } from "../../src/cli/svm-plan.js";
import { potSalt } from "../../src/deployments/pot.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { svmTokenRows } from "../../src/routes/token-registry.js";
import {
  buildCreatePotInstruction,
  buildExecuteTransaction,
  derivePotPda,
  KITCHEN_DISCRIMINATORS,
  MAX_POT_LEN,
} from "../../src/svm/index.js";
import { svmEnginePath } from "../../src/svm/engine-artifacts.js";
import { jsonOf, sauce, type Run } from "../cli-anvil.js";
import { hasLegacyArtifacts, legacyArtifactsDir } from "../release-arm.js";
import {
  ENGINE_SO,
  randomAddress,
  sendSigned,
  setMint,
  setTokenAccount,
  startEngine,
  svmArtifactsPresent,
  tokenAmount,
  type EngineHarness,
} from "./engine-harness.js";
import { solanaShim, type SolanaShim } from "./rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65529/";
/** Devnet's genesis hash: `--chain solana` takes an endpoint of any cluster, and the local copy of
 *  a devnet cluster runs the devnet builds. */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** v12-svm 1.4.0's engine: the earlier release whose programs this SDK's also run on. */
const EARLIER = address("53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW");
const INSTALLED = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());

const legacyPresent = hasLegacyArtifacts("svm");
if (!legacyPresent && process.env.CI) {
  throw new Error(
    "the earlier Solana engine's artifacts are absent in CI: sync-engine-artifacts writes them " +
      "to src/artifacts/legacy (SPEC D16)",
  );
}
const describeBoth = legacyPresent && svmArtifactsPresent ? describe : describe.skip;

/** The docs' payout: `pay.sauce.ts <recipient> <amount>`, USDC from the Pot. */
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

/** The part of a compiled message these tests read: its accounts and instructions. */
interface Compiled {
  readonly staticAccounts: readonly string[];
  readonly instructions: readonly {
    readonly programAddressIndex: number;
    readonly accountIndices?: readonly number[];
    readonly data?: Uint8Array;
  }[];
}

/** Where the engine is among a Kitchen cook's accounts: `cook`'s second, `cook_from_account`'s fourth. */
const ENGINE_AT = [
  [KITCHEN_DISCRIMINATORS.cook, 1],
  [KITCHEN_DISCRIMINATORS.cookFromAccount, 3],
] as const;

/**
 * The engine the Kitchen cook in `transaction` names: the account at the index the cook's layout
 * puts it, resolved through the message — an engine merely among the transaction's keys is not it.
 */
function cookEngine(transaction: Transaction): string | undefined {
  // The decoder's union of message versions, read as the static layout every transaction here has.
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  ) as unknown as Compiled;
  for (const instruction of message.instructions) {
    if (message.staticAccounts[instruction.programAddressIndex] !== KITCHEN) continue;
    const found = ENGINE_AT.find(([head]) =>
      head.every((byte, at) => instruction.data?.[at] === byte),
    );
    const index = found === undefined ? undefined : instruction.accountIndices?.[found[1]];
    if (index !== undefined) return message.staticAccounts[index];
  }

  return undefined;
}

/** The engines whose `invoke` a log names: the cook's own, not the Kitchen's. */
const enginesInvoked = (logs: readonly string[]): string[] =>
  [INSTALLED, EARLIER].filter((engine) =>
    logs.some((line) => line.startsWith(`Program ${engine} invoke`)),
  );

/** What `sauce simulate --json` returns, as these tests read it. */
interface Simulated {
  readonly ok: boolean;
  readonly path: string;
  readonly pot?: string;
  readonly logs: string[];
  readonly createPot?: { readonly owner: string } | null;
  readonly tokenChanges?: ReadonlyArray<{ readonly delta: string }>;
}
/** What `sauce pot --json` says of the cluster. */
interface PotStatus {
  readonly deployment: { readonly pot: Record<string, unknown> };
}
/** What `sauce tx --json` hands out for a staged program: the plan's cursor. */
interface Planned {
  readonly cursor: string;
}
/** What `sauce run --json` reports of the cook. */
interface Ran {
  readonly cook: { readonly status: string };
}
/** A command's JSON, read as the shape the test names: the command's own output, not validated. */
const read = <T>(run: Run): T => jsonOf(run) as unknown as T;

describeBoth("a Solana Pot cooks on the engine that owns it", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let seven: string;
  let blob: string;
  /** Owner A: a Pot created by the earlier engine at salt "earlier", holding 3 USDC. */
  let a: { path: string; signer: KeyPairSigner };
  let potA: Address;
  let potAUsdc: Address;
  /** Who `pay.sauce.ts` pays, and its USDC account. */
  const recipient = randomAddress();
  let toUsdc: Address;
  const salt = hexToBytes(potSalt("earlier"));
  const earlierElf = (build: "devnet" | "mainnet") =>
    join(legacyArtifactsDir("svm"), "svm", `engine-${build}.so`);

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

  /** Holds `elf` at the earlier engine's id, as a cluster that upgraded it would. */
  const holdEarlier = (elf: string): void => harness.svm.addProgramFromFile(EARLIER, elf);

  const ataOf = async (holder: Address, mint: Address): Promise<Address> =>
    (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

  let funded = false;
  /**
   * USDC held by A's Pot (3) and nobody else, the recipient's account there and empty: what
   * `pay.sauce.ts` moves. Made by the first payout test, not at the start: `sauce pot` lists a Pot's
   * USDC account and reads its balance, which the shim does not answer.
   */
  const fund = async (): Promise<void> => {
    if (funded) return;
    const usdc = address(
      svmTokenRows(requireChain("solana")).find((row) => row.symbol === "USDC")!.mint,
    );
    setMint(harness, usdc, 6);
    potAUsdc = await ataOf(potA, usdc);
    setTokenAccount(harness, potAUsdc, usdc, potA, 3_000_000n);
    toUsdc = await ataOf(recipient, usdc);
    setTokenAccount(harness, toUsdc, usdc, recipient, 0n);
    funded = true;
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, INSTALLED);
    work = mkdtempSync(join(tmpdir(), "sauce-legacy-engine-"));
    seven = join(work, "seven.sauce.ts");
    blob = join(work, "blob.sauce.ts");
    writeFileSync(seven, SEVEN);
    writeFileSync(blob, blobSource(1500));
    // The earlier engine at its own id, as its release built it for the cluster's kind (devnet).
    holdEarlier(earlierElf("devnet"));
    a = await keypair("a");
    potA = (await derivePotPda(KITCHEN, a.signer.address, salt)).address;
    // A's Pot, created by the earlier engine, as a cluster that ran 1.4.0 has them.
    harness.svm.expireBlockhash();
    const created = sendSigned(
      harness,
      await buildExecuteTransaction({
        payer: a.signer,
        instructions: [
          buildCreatePotInstruction({
            kitchen: KITCHEN,
            owner: a.signer.address,
            engineProgram: EARLIER,
            pot: potA,
            salt,
            space: MAX_POT_LEN,
          }),
        ],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
      }),
    );
    if (!created.ok) throw new Error(`creating the earlier engine's Pot failed: ${created.err}`);
    shim = solanaShim(harness.svm, RPC_URL, undefined, DEVNET_GENESIS);
    shim.install();
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  afterEach(() => {
    // What a test held at an engine's id is put back: the earlier engine's devnet build, and the
    // installed engine as the harness loaded it.
    holdEarlier(earlierElf("devnet"));
    harness.svm.addProgramFromFile(INSTALLED, ENGINE_SO as string);
  });

  it("the Pot the earlier engine created is owned by it, and `sauce pot` says so", async () => {
    expect(harness.svm.getAccount(potA)).toMatchObject({ exists: true, programAddress: EARLIER });
    const status = await sauce(
      ...["pot", "--chain", "solana", "--owner", a.signer.address, "--salt", "earlier"],
      ...["--rpc-url", RPC_URL],
    );
    expect(read<PotStatus>(status).deployment.pot).toEqual({
      address: potA,
      deployed: true,
      engine: EARLIER,
    });
    expect(status.stderr).toContain(
      `The Pot ${potA} is owned by engine ${EARLIER} (v12-svm 1.4.0): cooks on it run there; a ` +
        `new Pot runs on ${INSTALLED} (v12-svm 1.4.1).`,
    );
    // An owner with no Pot: nothing to say of an engine, and a new Pot runs on the installed one.
    const none = await sauce(
      ...["pot", "--chain", "solana", "--owner", randomAddress(), "--salt", "earlier"],
      ...["--rpc-url", RPC_URL],
    );
    expect(read<PotStatus>(none).deployment.pot).toEqual({
      address: expect.any(String),
      deployed: false,
    });
    expect(none.stderr).not.toContain("is owned by engine");
  });

  it("simulates a cook on the cluster through the engine that owns the Pot; a new Pot's through the installed one", async () => {
    const before = shim.handed.length;
    const earlier = read<Simulated>(
      await sauce(
        ...["simulate", seven, "--chain", "solana", "--owner", a.signer.address],
        ...["--salt", "earlier", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(earlier).toMatchObject({ ok: true, pot: potA, path: "simulateTransaction" });
    const handed = shim.handed.slice(before).filter((one) => one.method === "simulateTransaction");
    expect(handed.map((one) => cookEngine(one.transaction))).toEqual([EARLIER]);
    expect(enginesInvoked(earlier.logs)).toEqual([EARLIER]);

    const fresh = (await keypair("fresh")).signer.address;
    const mark = shim.handed.length;
    const created = read<Simulated>(
      await sauce(
        ...["simulate", seven, "--chain", "solana", "--owner", fresh],
        ...["--salt", "earlier", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(created).toMatchObject({ ok: true, createPot: { owner: fresh } });
    const second = shim.handed.slice(mark).filter((one) => one.method === "simulateTransaction");
    expect(second.map((one) => cookEngine(one.transaction))).toEqual([INSTALLED]);
    expect(enginesInvoked(created.logs)).toEqual([INSTALLED]);
  }, 60_000);

  it("simulates a staged cook in a local copy running the earlier engine's own code for its Pot, the installed engine's for a new one", async () => {
    const earlier = read<Simulated>(
      await sauce(
        ...["simulate", blob, "--chain", "solana", "--owner", a.signer.address],
        ...["--salt", "earlier", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(earlier).toMatchObject({ ok: true, path: "local copy (LiteSVM)", pot: potA });
    expect(enginesInvoked(earlier.logs)).toEqual([EARLIER]);

    const fresh = (await keypair("fresh-staged")).signer.address;
    const created = read<Simulated>(
      await sauce(
        ...["simulate", blob, "--chain", "solana", "--owner", fresh],
        ...["--salt", "earlier", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(created).toMatchObject({ ok: true, path: "local copy (LiteSVM)" });
    expect(enginesInvoked(created.logs)).toEqual([INSTALLED]);
  }, 120_000);

  it("pays USDC in the local copy through the earlier engine's own code for its Pot, the installed engine's for a new one", async () => {
    await fund();
    const fresh = (await keypair("fresh-pay")).signer.address;
    // The payout does not fit one transaction, so it is simulated in the local copy: the Pot's own
    // signature through the engine's CPI into the token program, on the engine that owns the Pot.
    // A holds the USDC in the Pot; a new owner's Pot has none, so it is given 5 to pay from.
    for (const [owner, engine, balance] of [
      [a.signer.address, EARLIER, []],
      [fresh, INSTALLED, ["--assume-balance", "USDC:5"]],
    ] as const) {
      const out = read<Simulated>(
        await sauce(
          ...["simulate", PAY, "--chain", "solana", "--owner", owner],
          ...["--salt", "earlier", "--rpc-url", RPC_URL, ...balance],
          ...["--json", "--args", recipient, "1000000"],
        ),
      );
      expect(out).toMatchObject({ ok: true, path: "local copy (LiteSVM)" });
      expect(enginesInvoked(out.logs)).toEqual([engine]);
      expect(out.tokenChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ delta: "-1000000" }),
          expect.objectContaining({ delta: "1000000" }),
        ]),
      );
    }
    // Simulated, not sent: the accounts hold what they held.
    expect(tokenAmount(harness, toUsdc)).toBe(0n);
    expect(tokenAmount(harness, potAUsdc)).toBe(3_000_000n);
  }, 120_000);

  it("names the engine in a plan's cursor only for a Pot of an earlier release", async () => {
    const earlier = read<Planned>(
      await sauce(
        ...["tx", blob, "--chain", "solana", "--owner", a.signer.address],
        ...["--salt", "earlier", "--rpc-url", RPC_URL],
      ),
    );
    expect(decodeCursor(earlier.cursor).engine).toBe(EARLIER);
    expect(planEngine(decodeCursor(earlier.cursor))).toBe(EARLIER);
    const fresh = read<Planned>(
      await sauce(
        ...["tx", blob, "--chain", "solana", "--owner", randomAddress()],
        ...["--salt", "earlier", "--rpc-url", RPC_URL],
      ),
    );
    expect(decodeCursor(fresh.cursor).engine).toBeUndefined();
    expect(planEngine(decodeCursor(fresh.cursor))).toBe(INSTALLED);
  }, 120_000);

  it("sends a cook on the Pot through the engine that owns it, and creates a new owner's Pot under the installed one", async () => {
    const sent = shim.sent.length;
    const ran = read<Ran>(
      await sauce(
        ...["run", seven, "--chain", "solana", "--keypair", a.path, "--salt", "earlier"],
        ...["--rpc-url", RPC_URL, "--yes", "--json"],
      ),
    );
    expect(ran.cook).toMatchObject({ status: "success" });
    expect(shim.sent.slice(sent).map(cookEngine)).toEqual([EARLIER]);
    expect(harness.svm.getAccount(potA)).toMatchObject({ programAddress: EARLIER });

    const owner = await keypair("owner-b");
    const mark = shim.sent.length;
    read<Ran>(
      await sauce(
        ...["run", seven, "--chain", "solana", "--keypair", owner.path, "--salt", "later"],
        ...["--rpc-url", RPC_URL, "--yes", "--json"],
      ),
    );
    expect(shim.sent.slice(mark).map(cookEngine)).toEqual([INSTALLED]);
    const potB = (await derivePotPda(KITCHEN, owner.signer.address, hexToBytes(potSalt("later"))))
      .address;
    expect(harness.svm.getAccount(potB)).toMatchObject({ exists: true, programAddress: INSTALLED });
  }, 120_000);

  it("stages a program and cooks it from the code buffer through the engine that owns the Pot", async () => {
    const sent = shim.sent.length;
    const ran = read<Ran>(
      await sauce(
        ...["run", blob, "--chain", "solana", "--keypair", a.path, "--salt", "earlier"],
        ...["--rpc-url", RPC_URL, "--yes", "--json"],
      ),
    );
    expect(ran.cook).toMatchObject({ status: "success" });
    // The staged cook's engine is its fourth account, `cook_from_account`'s: the staging
    // transactions before it name none.
    const engines = shim.sent
      .slice(sent)
      .map(cookEngine)
      .filter((one) => one !== undefined);
    expect(engines).toEqual([EARLIER]);
  }, 120_000);

  it("pays USDC out of the Pot through the engine that owns it, sent: the recipient is paid, the Pot is left with the rest", async () => {
    await fund();
    const sent = shim.sent.length;
    const ran = read<Ran>(
      await sauce(
        ...["run", PAY, "--chain", "solana", "--keypair", a.path, "--salt", "earlier"],
        ...["--rpc-url", RPC_URL, "--yes", "--json", "--args", recipient, "1000000"],
      ),
    );
    expect(ran.cook).toMatchObject({ status: "success" });
    // Staged: the cook is the one transaction that names an engine, as `cook_from_account`.
    const engines = shim.sent
      .slice(sent)
      .map(cookEngine)
      .filter((one) => one !== undefined);
    expect(engines).toEqual([EARLIER]);
    expect(tokenAmount(harness, toUsdc)).toBe(1_000_000n);
    expect(tokenAmount(harness, potAUsdc)).toBe(2_000_000n);
  }, 120_000);

  it("refuses a cluster whose earlier engine is not that release's build, running nothing", async () => {
    // The installed engine's ELF at the earlier engine's id: another release's build.
    holdEarlier(ENGINE_SO as string);
    const sent = shim.sent.length;
    const handed = shim.handed.length;
    for (const argv of [
      ["simulate", seven],
      ["simulate", blob],
      ["tx", seven],
      ["run", seven, "--keypair", a.path, "--yes"],
    ]) {
      const out = await sauce(
        ...argv,
        ...["--chain", "solana", "--owner", a.signer.address, "--salt", "earlier"],
        ...["--rpc-url", RPC_URL],
      );
      expect([argv[0], out.code]).toEqual([argv[0], 1]);
      expect(out.stderr).toContain(
        `the engine ${EARLIER} (v12-svm 1.4.0) is not deployed on solana as that release's build`,
      );
    }
    expect(shim.sent.length).toBe(sent);
    // Not one of them reached the cluster's simulation either: the check comes first.
    expect(shim.handed.length).toBe(handed);
  }, 120_000);

  it("simulates in a local copy only the code its cluster runs: another build of the earlier engine is refused, never replaced", async () => {
    // The release's mainnet build on a devnet cluster: the cluster's own check passes — either
    // build is the release's — but the copy needs the build for the cluster's kind.
    holdEarlier(earlierElf("mainnet"));
    const out = await sauce(
      ...["simulate", blob, "--chain", "solana", "--owner", a.signer.address],
      ...["--salt", "earlier", "--rpc-url", RPC_URL],
    );
    expect(out.code).toBe(1);
    expect(out.stderr).toContain(
      `simulating a cook on a Pot of engine ${EARLIER} needs that engine's own code, and solana ` +
        "does not run that release's build: the simulation would run other code",
    );
    // The same cluster, simulated on the cluster itself: that build runs the cook.
    const inline = read<Simulated>(
      await sauce(
        ...["simulate", seven, "--chain", "solana", "--owner", a.signer.address],
        ...["--salt", "earlier", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(inline).toMatchObject({ ok: true });
  }, 120_000);

  it("simulates in a local copy only the code its cluster runs, the installed engine's too: the release's other build is refused", async () => {
    // The release's MAINNET build at the installed engine's id on a DEVNET cluster. The cluster's own
    // check passes — either build is the release's — but the copy would run the devnet build, which
    // is not what the cluster runs: refused, nothing simulated.
    harness.svm.addProgramFromFile(INSTALLED, svmEnginePath("mainnet"));
    const sent = shim.sent.length;
    const out = await sauce(
      ...["simulate", blob, "--chain", "solana", "--owner", randomAddress()],
      ...["--salt", "other-build", "--rpc-url", RPC_URL],
    );
    expect(out.code).toBe(1);
    expect(out.stderr).toContain(
      `simulating a cook on a Pot of engine ${INSTALLED} needs that engine's own code, and solana ` +
        "does not run that release's build: the simulation would run other code",
    );
    expect(shim.sent.length).toBe(sent);
    // The devnet build, which is what a devnet cluster runs, simulates the same cook.
    harness.svm.addProgramFromFile(INSTALLED, svmEnginePath("devnet"));
    const ok = read<Simulated>(
      await sauce(
        ...["simulate", blob, "--chain", "solana", "--owner", randomAddress()],
        ...["--salt", "other-build", "--rpc-url", RPC_URL, "--json"],
      ),
    );
    expect(ok).toMatchObject({ ok: true, path: "local copy (LiteSVM)" });
  }, 120_000);
});
