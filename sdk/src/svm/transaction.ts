import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type {
  Address,
  AddressesByLookupTableAddress,
  Blockhash,
  BlockhashLifetimeConstraint,
  Instruction,
  SendableTransaction,
  Transaction,
  TransactionSigner,
  TransactionWithBlockhashLifetime,
} from "@solana/kit";

/** Byte length of the encoded wire transaction (kit's own measure; limit is 1232). */
export { getTransactionSize } from "@solana/kit";

/**
 * The largest legacy or v0 transaction on the wire, in bytes — every transaction the SDK builds is
 * one. Kit keeps its own copy of the number private since its v1 transactions, which allow more.
 */
export const TRANSACTION_SIZE_LIMIT = 1232;

export type SignedExecuteTransaction = SendableTransaction &
  Transaction &
  TransactionWithBlockhashLifetime;

export interface BuildExecuteTransactionInput {
  payer: TransactionSigner;
  instructions: readonly Instruction[];
  latestBlockhash: BlockhashLifetimeConstraint;
  lookupTables?: AddressesByLookupTableAddress;
}

/**
 * The transaction {@link buildExecuteTransaction} builds, compiled with every signature slot empty,
 * and how to sign it: for a caller that simulates or checks it before anything is signed. Signing
 * compiles the same message, so the signed transaction's bytes are these.
 */
export interface PreparedExecuteTransaction {
  readonly transaction: Transaction;
  sign(): Promise<SignedExecuteTransaction>;
}

/** {@link buildExecuteTransaction}'s transaction, compiled now and signed only when asked. */
export function prepareExecuteTransaction({
  payer,
  instructions,
  latestBlockhash,
  lookupTables,
}: BuildExecuteTransactionInput): PreparedExecuteTransaction {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  );
  const compressed = lookupTables
    ? compressTransactionMessageUsingAddressLookupTables(message, lookupTables)
    : message;

  return {
    transaction: compileTransaction(compressed),
    sign: async () => {
      const transaction = await signTransactionMessageWithSigners(compressed);
      assertIsTransactionWithBlockhashLifetime(transaction);

      return transaction;
    },
  };
}

/** Builds and fully signs a v0 transaction, optionally compressed through address lookup tables. */
export async function buildExecuteTransaction(
  input: BuildExecuteTransactionInput,
): Promise<SignedExecuteTransaction> {
  return prepareExecuteTransaction(input).sign();
}

/** A blockhash for a transaction only measured: its size and its accounts do not depend on it. */
const MEASURING_BLOCKHASH: BlockhashLifetimeConstraint = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
};

export interface MeasureExecuteTransactionInput {
  feePayer: Address;
  instructions: readonly Instruction[];
  lookupTables?: AddressesByLookupTableAddress;
}

/**
 * The transaction `buildExecuteTransaction` builds from the same fee payer, instructions and
 * tables, compiled with no signature and a placeholder blockhash: what it measures
 * (`getTransactionSize`) and the accounts it lists (`lookupTableAddresses`), known without a
 * blockhash and without asking any signer for anything.
 */
export function measureExecuteTransaction({
  feePayer,
  instructions,
  lookupTables,
}: MeasureExecuteTransactionInput): Transaction {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(MEASURING_BLOCKHASH, m),
  );

  return compileTransaction(
    lookupTables
      ? compressTransactionMessageUsingAddressLookupTables(message, lookupTables)
      : message,
  );
}
