import { createHash } from "node:crypto";
import { getCompiledTransactionMessageDecoder } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import {
  buildCookFromAccountInstruction,
  buildCreateCodeBufferInstruction,
  buildFinalizeCodeBufferInstruction,
  buildSetExecutionFeeInstruction,
  buildWriteCodeBufferInstruction,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveProgramDataPda,
} from "../../src/svm/kitchen.js";
import { buildHeapFramePrepend } from "../../src/svm/prepends.js";
import { resolveAccounts } from "../../src/svm/resolve.js";
import { svmSettleSource } from "../../src/svm/recipes/index.js";
import { verifySvmSettleExecution } from "../../src/svm/verify.js";
import type { SignedExecuteTransaction } from "../../src/svm/transaction.js";
import { compileSource } from "../helpers";
import {
  buildExecuteTransactionForHarness,
  describeRustSvm,
  expectOk,
  HARNESS_POT_SALT,
  randomAddress,
  RUST_ENGINE_SO,
  sendInstructions,
  setMint,
  setTokenAccount,
  signExecuteTransaction,
  startEngine,
  TOKEN_PROGRAM,
} from "./engine-harness.js";
import type { EngineHarness } from "./engine-harness.js";

const expected = { minOut: 0n, splCount: 1n };

describeRustSvm("settlement verifier against actual released Kitchen CPIs", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, RUST_ENGINE_SO!);
  });

  it("verifies both inline and staged engine instructions recorded by LiteSVM", async () => {
    const compiled = compileSource(svmSettleSource(1), "svm", {
      defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
    });
    const artifact = { bytecode: compiled.bytecode, manifest: compiled.manifest! };
    const mint = setMint(harness, randomAddress(), 6);
    const escrow = setTokenAccount(harness, randomAddress(), mint, harness.payer.address, 1_000n);
    const destination = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
    const resolution = {
      tokenProgram0: TOKEN_PROGRAM,
      tokenProgram1: TOKEN_PROGRAM,
      escrow0: escrow,
      mint0: mint,
      dest0: destination,
      owner: { address: harness.payer.address, signer: harness.payer },
    };
    const pin = new Uint8Array(createHash("sha256").update(artifact.bytecode).digest());

    const verifyRecordedInstruction = (transaction: SignedExecuteTransaction, staged: boolean) => {
      const result = harness.svm.sendTransaction(transaction);
      if (result instanceof FailedTransactionMetadata) throw new Error(String(result.err()));
      const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      const instruction = result
        .innerInstructions()
        .flat()
        .map((inner) => inner.instruction())
        .find((inner) => message.staticAccounts[inner.programIdIndex()] === harness.programId);
      expect(instruction).toBeDefined();
      const verified = verifySvmSettleExecution({
        instructionData: new Uint8Array(instruction!.data()),
        accounts: Array.from(instruction!.accounts(), (index) => message.staticAccounts[index]!),
        ...expected,
        ...(staged ? { bytecode: artifact.bytecode, pin } : {}),
      });
      expect(verified.genuine).toBe(true);
      expect(verified.accounts.tokenProgram0).toBe(TOKEN_PROGRAM);
      expect(verified.accounts.escrow0).toBe(escrow);
      expect(verified.accounts.owner).toBe(harness.payer.address);
      expect(verified.gate?.owner).toBe(harness.payer.address);
      expect(verified.gate?.pot).toBe(harness.pot);
      expect(verified.hadBufferAccount).toBe(staged);
    };

    verifyRecordedInstruction(await signExecuteTransaction(harness, artifact, resolution), false);

    const nonce = 948n;
    const { address: codeBuffer } = await deriveCodeBufferPda(
      harness.kitchen,
      harness.payer.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(harness.kitchen, codeBuffer);
    const codeAccounts = {
      kitchen: harness.kitchen,
      owner: harness.payer.address,
      codeBuffer,
      code,
    };
    expectOk(
      await sendInstructions(harness, [
        buildCreateCodeBufferInstruction({
          ...codeAccounts,
          nonce,
          capacity: artifact.bytecode.length,
        }),
      ]),
    );
    expectOk(
      await sendInstructions(harness, [
        buildWriteCodeBufferInstruction({
          ...codeAccounts,
          offset: 0,
          chunk: artifact.bytecode,
        }),
      ]),
    );
    expectOk(
      await sendInstructions(harness, [
        buildFinalizeCodeBufferInstruction({
          ...codeAccounts,
          len: artifact.bytecode.length,
          expectedSha256: pin,
        }),
      ]),
    );
    const { address: programData } = await deriveProgramDataPda(harness.kitchen);
    expectOk(
      await sendInstructions(harness, [
        buildSetExecutionFeeInstruction({
          kitchen: harness.kitchen,
          authority: harness.payer.address,
          programData,
          feeConfig: harness.feeConfig,
          fee: 25_000n,
        }),
      ]),
    );
    const feeAccount = harness.svm.getAccount(harness.feeConfig);
    if (!feeAccount.exists) throw new Error("Missing initialized fee account");
    expect(feeAccount.programAddress).toBe(harness.kitchen);
    expect(feeAccount.data.length).toBe(16);
    expect(feeAccount.data.slice(0, 8)).toEqual(
      new Uint8Array(
        createHash("sha256").update("account:ExecutionFeeConfig").digest().subarray(0, 8),
      ),
    );
    const quotedFee = new DataView(
      feeAccount.data.buffer,
      feeAccount.data.byteOffset,
      feeAccount.data.byteLength,
    ).getBigUint64(8, true);
    expect(quotedFee).toBe(25_000n);
    const transaction = await buildExecuteTransactionForHarness(harness, [
      buildHeapFramePrepend(),
      buildCookFromAccountInstruction({
        ...codeAccounts,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        potBump: harness.potBump,
        feeConfig: harness.feeConfig,
        maxExecutionFee: quotedFee,
        pin,
        tail: resolveAccounts(artifact.manifest, resolution, harness.payer.address),
      }),
    ]);
    verifyRecordedInstruction(transaction, true);
    const paidFeeAccount = harness.svm.getAccount(harness.feeConfig);
    if (!paidFeeAccount.exists) throw new Error("Missing fee account after cook");
    expect(paidFeeAccount.lamports - feeAccount.lamports).toBe(quotedFee);
  });
});
