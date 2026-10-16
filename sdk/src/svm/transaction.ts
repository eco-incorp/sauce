import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type {
  AddressesByLookupTableAddress,
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

/** Builds and fully signs a v0 transaction, optionally compressed through address lookup tables. */
export async function buildExecuteTransaction({
  payer,
  instructions,
  latestBlockhash,
  lookupTables,
}: BuildExecuteTransactionInput): Promise<SignedExecuteTransaction> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  );

  const compressed = lookupTables
    ? compressTransactionMessageUsingAddressLookupTables(message, lookupTables)
    : message;
  const transaction = await signTransactionMessageWithSigners(compressed);
  assertIsTransactionWithBlockhashLifetime(transaction);

  return transaction;
}
