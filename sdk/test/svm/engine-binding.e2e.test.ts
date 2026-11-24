/**
 * The Solana Kitchen binds no engine to a Pot (probe S2 of the security review of #284). Its IDL
 * says it "pins no engine" and that the owner's signature stands in for that guarantee, and the
 * engine has no fault for a Pot it does not own: a Pot one release's engine created, cooked naming
 * the OTHER release's engine, runs, signs for the Pot's tokens, and leaves the Pot owned by the
 * engine that created it, both ways round.
 *
 * That is the Solana counterpart of `evm/release-routing.e2e.test.ts`'s negative controls, and the
 * opposite of them: there an engine refuses another release's Pot, and a cook that names the wrong
 * one reverts. Here nothing on the chain refuses, so the engine a cook names is a fund-safety value
 * only this SDK chooses: from the Pot's own owner program (`svmPotEngine`, `potCookEngine`), from
 * the release table (`svm/engine-release.ts`, `solana-release.ts`), and, for a plan carried between
 * calls, from a cursor that names only an engine that table holds (`decodeCursor`). A change that
 * starts relying on the chain for any of it fails here first.
 *
 * Loads BOTH engines at their release ids: the installed one the packaged ELF, the earlier one the
 * ELF `sync-engine-artifacts` takes from that release's public package. GATED on the engine
 * artifacts and the earlier engine's, and a hard failure without them in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import {
  address,
  AccountRole,
  createKeyPairSignerFromBytes,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { hexToBytes } from "viem";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { potSalt } from "../../src/deployments/pot.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  derivePotPda,
  MAX_POT_LEN,
} from "../../src/svm/index.js";
import { hasLegacyArtifacts, legacyArtifactsDir } from "../release-arm.js";
import {
  ENGINE_SO,
  randomAddress,
  sendSigned,
  setMint,
  setTokenAccount,
  startEngine,
  svmArtifactsPresent,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
  type RunResult,
} from "./engine-harness.js";
import { join } from "node:path";

/** v12-svm 1.4.0's engine: the earlier release whose programs this SDK's also run on. */
const EARLIER = address("53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW");
const INSTALLED = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());

const legacyPresent = hasLegacyArtifacts("svm", "1.4.0");
if (!legacyPresent && process.env.CI) {
  throw new Error(
    "the earlier Solana engine's artifacts are absent in CI: sync-engine-artifacts writes them " +
      "to src/artifacts/legacy",
  );
}
const describeBoth = legacyPresent && svmArtifactsPresent ? describe : describe.skip;

const SEVEN = "function main(): Uint256 {\n  return 7;\n}\n";
/** The Pot signs an SPL transfer of 400 out of a token account it owns. */
const TRANSFER =
  "function main(pot: Account<Writable, Signer>, tokenProgram: Account, " +
  "source: Account<Writable>, tokenDestination: Account<Writable>) {\n" +
  "  let token = hex`03`;\n" +
  "  svm.call(tokenProgram, [source, tokenDestination, pot], token.concat(400n.toBytesLe(8)));\n" +
  "}";

describeBoth("the Kitchen binds no engine to a Pot", () => {
  let harness: EngineHarness;
  const salt = hexToBytes(potSalt("cross"));

  const keypair = async (): Promise<KeyPairSigner> => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const signer = await createKeyPairSignerFromBytes(new Uint8Array([...seed, ...pub]));
    harness.svm.airdrop(signer.address, lamports(50_000_000_000n));

    return signer;
  };

  /** A Pot `engine` creates for `owner`: the Kitchen's create_pot, signed by the owner. */
  const createPot = async (owner: KeyPairSigner, engine: Address): Promise<Address> => {
    const pot = (await derivePotPda(KITCHEN, owner.address, salt)).address;
    harness.svm.expireBlockhash();
    const created = sendSigned(
      harness,
      await buildExecuteTransaction({
        payer: owner,
        instructions: [
          buildCreatePotInstruction({
            kitchen: KITCHEN,
            owner: owner.address,
            engineProgram: engine,
            pot,
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
    if (!created.ok)
      throw new Error(`create_pot failed: ${created.err}\n${created.logs.join("\n")}`);

    return pot;
  };

  /** A Kitchen cook of `bytecode` on `pot` naming `engine`, signed and paid by the Pot's owner. */
  const cookAs = async (
    owner: KeyPairSigner,
    pot: Address,
    engine: Address,
    bytecode: Uint8Array,
    tail: { address: Address; role: AccountRole }[] = [],
  ): Promise<RunResult> => {
    harness.svm.expireBlockhash();

    return sendSigned(
      harness,
      await buildExecuteTransaction({
        payer: owner,
        instructions: [
          ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
          buildHeapFramePrepend(),
          buildCookInstruction({
            kitchen: KITCHEN,
            owner: owner.address,
            engineProgram: engine,
            potSalt: salt,
            pot,
            feeConfig: harness.feeConfig,
            bytecode,
            maxExecutionFee: 0n,
            tail,
          }),
        ],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
      }),
    );
  };

  /** 1,000 of a fresh mint in a token account `pot` owns, an empty one of somebody else's, and the
   *  tail `TRANSFER` takes. */
  const tokensOf = (pot: Address) => {
    const mint = setMint(harness, randomAddress(), 6);
    const source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
    const destination = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);

    return {
      source,
      destination,
      tail: [
        { address: pot, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        { address: source, role: AccountRole.WRITABLE },
        { address: destination, role: AccountRole.WRITABLE },
      ],
    };
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, INSTALLED);
    harness.svm.addProgramFromFile(
      EARLIER,
      join(legacyArtifactsDir("svm", "1.4.0"), "svm", "engine-devnet.so"),
    );
  }, 120_000);

  it("cooks a Pot of either release engine through the other: it runs, signs for the Pot's tokens, and the Pot keeps its owner", async () => {
    const [a, c] = [await keypair(), await keypair()];
    const potA = await createPot(a, EARLIER);
    const potC = await createPot(c, INSTALLED);
    expect(harness.svm.getAccount(potA)).toMatchObject({ programAddress: EARLIER });
    expect(harness.svm.getAccount(potC)).toMatchObject({ programAddress: INSTALLED });
    const seven = compileSauceProgram("solana", SEVEN).bytecode;
    const transfer = compileSauceProgram("solana", TRANSFER).bytecode;

    const ownerOf = (pot: Address): string | undefined => {
      const account = harness.svm.getAccount(pot);

      return account.exists ? account.programAddress : undefined;
    };
    const rows: Record<string, unknown>[] = [];
    for (const [what, owner, pot, owns, other] of [
      ["a Pot of the earlier engine, cooked naming the installed one", a, potA, EARLIER, INSTALLED],
      ["a Pot of the installed engine, cooked naming the earlier one", c, potC, INSTALLED, EARLIER],
    ] as const) {
      const plain = await cookAs(owner, pot, other, seven);
      const { source, destination, tail } = tokensOf(pot);
      const moved = await cookAs(owner, pot, other, transfer, tail);
      rows.push({
        what,
        returnsSeven: plain.ok ? true : plain.err,
        transfer: moved.ok ? true : moved.err,
        source: tokenAmount(harness, source).toString(),
        destination: tokenAmount(harness, destination).toString(),
        otherEngineInvoked: (moved.ok ? moved.logs : plain.logs).some((line) =>
          line.startsWith(`Program ${other} invoke`),
        ),
        ownerAfter: ownerOf(pot),
        ownedBy: owns,
      });
    }
    for (const row of rows) {
      expect(row).toMatchObject({
        returnsSeven: true,
        transfer: true,
        source: "600",
        destination: "400",
        otherEngineInvoked: true,
      });
      // The Pot is still its creating engine's: a cook on another engine changes no owner.
      expect(row.ownerAfter).toBe(row.ownedBy);
    }
  }, 180_000);
});
