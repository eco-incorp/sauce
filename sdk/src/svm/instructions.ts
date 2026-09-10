import { AccountRole } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { EXECUTE_DISCRIMINATOR, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR } from "./engine.js";
import type { ResolvedAccountMeta } from "./resolve.js";

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
  return {
    programAddress: programId,
    accounts: [{ address: code, role: AccountRole.READONLY }, ...accounts],
    data: withDiscriminator(EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, new Uint8Array()),
  };
}
