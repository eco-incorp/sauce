import { AccountRole } from "@solana/kit";
import type { AccountLookupMeta, AccountMeta, Address, Instruction } from "@solana/kit";
import {
  COOK_AND_PAY_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
} from "./engine.js";
import type { ResolvedAccountMeta } from "./resolve.js";
import { assertEngineRunsCompiler } from "../deployments/releases.js";

function withDiscriminator(
  discriminator: Uint8Array,
  ...parts: (Uint8Array | number[])[]
): Uint8Array {
  const total = discriminator.length + parts.reduce((n, p) => n + p.length, 0);
  const data = new Uint8Array(total);
  data.set(discriminator, 0);
  let offset = discriminator.length;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }

  return data;
}

export interface ExecuteInstructionInput {
  programId: Address;
  bytecode: Uint8Array;
  accounts: readonly ResolvedAccountMeta[];
}

/**
 * Builds the engine execute instruction. The account list IS the user-account
 * index space: accounts[i] is user index i (no fixed prefix — interpreter
 * memory lives in the transaction's heap frame, not accounts). MSG_SENDER is
 * the first in-list signer, resolved LAZILY: a signerless list is valid unless
 * the program reads MSG_SENDER/TX_ORIGIN (NoSigner then). Every transaction
 * carrying this instruction MUST also carry RequestHeapFrame(262144) — see
 * buildHeapFramePrepend.
 */
export function buildExecuteInstruction({
  programId,
  bytecode,
  accounts,
}: ExecuteInstructionInput): Instruction {
  assertEngineRunsCompiler("svm", programId);

  return {
    programAddress: programId,
    accounts: [...accounts],
    data: withDiscriminator(EXECUTE_DISCRIMINATOR, bytecode),
  };
}

export interface ExecuteFromAccountInstructionInput {
  programId: Address;
  /** The finalized code account; the engine reads its data VERBATIM as the program. */
  code: Address;
  accounts: readonly ResolvedAccountMeta[];
}

/**
 * `executeFromAccount`: account 0 is the code, the caller's tail follows at its natural indices,
 * and the program is that account's data verbatim.
 *
 * No payload beyond the discriminator. The pre-release engine took `[flags][pin][offset,len][args]`
 * so a caller could pin the staged bytes at execute time; the released engine has no such grammar
 * and the pin moved to the kitchen — `buildCookFromAccountInstruction`'s `pin` refuses unless the
 * staged bytes hash to it. Needs RequestHeapFrame, like `execute` — see `buildHeapFramePrepend`.
 */
export function buildExecuteFromAccountInstruction({
  programId,
  code,
  accounts,
}: ExecuteFromAccountInstructionInput): Instruction {
  assertEngineRunsCompiler("svm", programId);

  return {
    programAddress: programId,
    accounts: [{ address: code, role: AccountRole.READONLY }, ...accounts],
    data: withDiscriminator(EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, new Uint8Array()),
  };
}

/**
 * Rejects a would-be execute-time content pin, naming where the enforceable one lives.
 *
 * Lives here because the reason is this module's: `executeFromAccount` above emits the discriminator
 * and nothing else, so a pin handed to a caller of it has no destination. The surfaces that used to
 * accept one — `StagedBufferRef.expectedSha256`, `SimulateStagedOpts.expectedSha256` — forwarded it
 * and dropped it while documenting it as engine-verified, which is the failure this converts into a
 * loud one.
 */
export function assertNoExecutePin(expectedSha256: Uint8Array | undefined): void {
  if (expectedSha256 === undefined) return;

  throw new Error(
    "expectedSha256 cannot be enforced: the released v12 SVM engine's `execute_from_account` takes " +
      "no instruction payload, so there is nowhere to carry a pin. Pin the CONTENT at staging time " +
      "instead — `buildFinalizeCodeBufferInstruction({ expectedSha256 })`, which the kitchen checks " +
      "on chain — and omit this field here. A direct engine cook does take one: " +
      '`buildCookAndPayFromAccountPinnedInstruction`, or the client with `via: "engine"`.',
  );
}

// --- direct paid cooks --------------------------------------------------------------------------

/** One account of a direct cook's tail: the program's own accounts, at their natural indices. */
type DirectTailAccount = AccountLookupMeta | AccountMeta;

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const U64_MAX = (1n << 64n) - 1n;

function feeCap(maxExecutionFee: bigint): Uint8Array {
  if (typeof maxExecutionFee !== "bigint" || maxExecutionFee < 0n || maxExecutionFee > U64_MAX) {
    throw new Error(
      `maxExecutionFee must be a u64 of lamports (a bigint in 0..=2^64-1), got ${String(maxExecutionFee)}`,
    );
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, maxExecutionFee, true);

  return bytes;
}

/**
 * What a direct cook pays with — the three accounts the engine reads LAST and strips before the
 * program sees its tail, so bytecode indices and `MSG_SENDER` keep their meanings.
 */
export interface DirectCookPayment {
  /** `deriveExecutionFeeConfigPda(kitchen)`: the canonical Kitchen fee config, which is also the
   *  treasury the fee is paid into. The engine re-derives it against the Kitchen id baked into it,
   *  so any other account is `InvalidFeeConfig`. Attached writable, as a positive fee needs. */
  feeConfig: Address;
  /** Who pays the fee: a writable signer the System Program owns, holding no data — the engine
   *  moves the fee with a System `transfer` from it. Stripped from the tail, so a program that also
   *  needs this key as a signer attaches it there too. */
  feePayer: Address;
  /** What the caller consents to pay, in lamports. The engine refuses a configured fee above it
   *  (`ExecutionFeeExceedsMaximum`) before paying or running anything. */
  maxExecutionFee: bigint;
}

/** `[...head, ...tail, feePayer (writable signer), System Program, feeConfig (writable)]`. */
function directAccounts(
  head: readonly DirectTailAccount[],
  tail: readonly DirectTailAccount[],
  { feeConfig, feePayer }: DirectCookPayment,
): DirectTailAccount[] {
  return [
    ...head,
    ...tail,
    { address: feePayer, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: feeConfig, role: AccountRole.WRITABLE },
  ];
}

export interface CookAndPayInput extends DirectCookPayment {
  /** The engine the transaction calls — the interpreter that runs, and the instruction's program. */
  engineProgram: Address;
  bytecode: Uint8Array;
  /** The program's own accounts, at their natural indices (index 0 is the first). */
  tail?: readonly DirectTailAccount[];
}

/**
 * `cookAndPay` — the engine called directly, bytecode inline, paying the Kitchen's execution fee
 * itself: `[discriminator | max_execution_fee u64 LE | bytecode]`.
 *
 * No Kitchen, so no Pot: nothing signs for one, and the program acts with the signatures the
 * transaction gave its tail — the wallet that signs is the authority a token transfer names. In
 * exchange the program's own CPIs start one level higher on the invoke stack than under a Kitchen
 * cook, which CPIs the engine.
 *
 * Needs the same RequestHeapFrame as every cook — see `buildHeapFramePrepend`.
 */
export function buildCookAndPayInstruction({
  engineProgram,
  bytecode,
  tail = [],
  ...payment
}: CookAndPayInput): Instruction {
  assertEngineRunsCompiler("svm", engineProgram);

  return {
    programAddress: engineProgram,
    accounts: directAccounts([], tail, payment),
    data: withDiscriminator(COOK_AND_PAY_DISCRIMINATOR, feeCap(payment.maxExecutionFee), bytecode),
  };
}

export interface CookAndPayFromAccountInput extends DirectCookPayment {
  engineProgram: Address;
  /** The account whose data IS the program: read verbatim, whoever owns it. A Kitchen-staged code
   *  account (`deriveCodePda`) is one; so is any other account holding bytecode. */
  code: Address;
  tail?: readonly DirectTailAccount[];
}

/**
 * `cookAndPayFromAccount` — the staged direct cook: `[discriminator | max_execution_fee u64 LE]`,
 * the program being the code account's data.
 *
 * **Unpinned.** The engine checks nothing about the code account — not its owner, not a finalized
 * flag, not a digest — and runs it with the tail's signatures. Whoever can change those bytes before
 * the transaction lands chooses what the signer's authority is used for. Prefer
 * `buildCookAndPayFromAccountPinnedInstruction` unless the account is one only the signer controls.
 */
export function buildCookAndPayFromAccountInstruction({
  engineProgram,
  code,
  tail = [],
  ...payment
}: CookAndPayFromAccountInput): Instruction {
  assertEngineRunsCompiler("svm", engineProgram);

  return {
    programAddress: engineProgram,
    accounts: directAccounts([{ address: code, role: AccountRole.READONLY }], tail, payment),
    data: withDiscriminator(
      COOK_AND_PAY_FROM_ACCOUNT_DISCRIMINATOR,
      feeCap(payment.maxExecutionFee),
    ),
  };
}

export interface CookAndPayFromAccountPinnedInput extends CookAndPayFromAccountInput {
  /** SHA-256 of the code account's ENTIRE data. For a finalized Kitchen code buffer that is the
   *  digest it was finalized with (`finalize_code_buffer` shrinks the account to exactly the
   *  program), and so the sha256 of the staged bytes. */
  expectedSha256: Uint8Array;
}

/**
 * `cookAndPayFromAccountPinned` — the staged direct cook, pinned:
 * `[discriminator | max_execution_fee u64 LE | expected_sha256]`.
 *
 * The engine hashes all of the code account's data and refuses a mismatch (`CodeHashMismatch`)
 * before it validates or pays the fee, then runs the bytes it hashed under the same borrow — so
 * the program that runs is the program the caller signed for.
 */
export function buildCookAndPayFromAccountPinnedInstruction({
  expectedSha256,
  engineProgram,
  code,
  tail = [],
  ...payment
}: CookAndPayFromAccountPinnedInput): Instruction {
  if (!(expectedSha256 instanceof Uint8Array) || expectedSha256.length !== 32) {
    throw new Error("expectedSha256 must be exactly 32 bytes");
  }
  assertEngineRunsCompiler("svm", engineProgram);

  return {
    programAddress: engineProgram,
    accounts: directAccounts([{ address: code, role: AccountRole.READONLY }], tail, payment),
    data: withDiscriminator(
      COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR,
      feeCap(payment.maxExecutionFee),
      expectedSha256,
    ),
  };
}
