/**
 * `prepareExecuteTransaction`: the transaction `buildExecuteTransaction` builds, compiled with every
 * signature slot empty, signed only when asked. A caller simulates or measures the prepared one and
 * signs it afterwards, so what it checked must be what it signs: the same message bytes, and the
 * same signed transaction kit's own build-and-sign pipeline makes of the same input.
 */
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Transaction,
  type TransactionPartialSigner,
} from "@solana/kit";

import {
  buildExecuteTransaction,
  prepareExecuteTransaction,
  type BuildExecuteTransactionInput,
} from "../../src/svm/transaction.js";

const PROGRAM = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" as Address;
const WRITTEN = "Vote111111111111111111111111111111111111111" as Address;
const READ = "SysvarRent111111111111111111111111111111111" as Address;
const TABLE = "8Vaso6eE1pWktDHwy2qQBB1fhjmBgwzhoXQKe1sxtFjn" as Address;
const LIFETIME = {
  blockhash: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi" as Blockhash,
  lastValidBlockHeight: 1_000n,
};

/** `signer`, and how many times it has been asked to sign (kit freezes a signer it attaches, so
 *  the count is kept beside it). */
const counting = (
  signer: KeyPairSigner,
): { readonly signer: TransactionPartialSigner; readonly calls: () => number } => {
  let calls = 0;

  return {
    signer: {
      address: signer.address,
      signTransactions: (transactions) => {
        calls += 1;

        return signer.signTransactions(transactions);
      },
    },
    calls: () => calls,
  };
};

/** `buildExecuteTransaction`'s input as it was before it was prepared first: kit, end to end. */
const builtByKit = (input: BuildExecuteTransactionInput) => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(input.payer, m),
    (m) => appendTransactionMessageInstructions(input.instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(input.latestBlockhash, m),
  );

  return signTransactionMessageWithSigners(
    input.lookupTables === undefined
      ? message
      : compressTransactionMessageUsingAddressLookupTables(message, input.lookupTables),
  );
};

const hex = (bytes: ArrayLike<number>) => Buffer.from(Uint8Array.from(bytes)).toString("hex");
const signatures = (transaction: Transaction) =>
  Object.fromEntries(
    Object.entries(transaction.signatures).map(([key, signature]) => [
      key,
      signature === null ? null : hex(signature),
    ]),
  );

describe("prepareExecuteTransaction", () => {
  let payer: KeyPairSigner;
  let cosigner: KeyPairSigner;
  beforeAll(async () => {
    [payer, cosigner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  });

  /** An instruction a second key signs for, beside accounts a table can hold. */
  const instructions = (second: TransactionPartialSigner): Instruction[] => [
    {
      programAddress: PROGRAM,
      accounts: [
        { address: second.address, role: AccountRole.READONLY_SIGNER, signer: second },
        { address: WRITTEN, role: AccountRole.WRITABLE },
        { address: READ, role: AccountRole.READONLY },
      ] as Instruction["accounts"],
      data: Uint8Array.of(1, 2, 3),
    },
  ];
  const TABLES: AddressesByLookupTableAddress = { [TABLE]: [WRITTEN, READ] };

  it.each([
    ["with no lookup table", undefined],
    ["through a lookup table", TABLES],
  ] as const)(
    "compiles %s with every slot empty, signs nothing until asked, and signs those bytes",
    async (_, lookupTables) => {
      const paying = counting(payer);
      const second = counting(cosigner);
      const input = {
        payer: paying.signer,
        instructions: instructions(second.signer),
        latestBlockhash: LIFETIME,
        ...(lookupTables === undefined ? {} : { lookupTables }),
      };
      const prepared = prepareExecuteTransaction(input);
      const prepareCalls = { payer: paying.calls(), second: second.calls() };
      const signed = await prepared.sign();

      expect({
        prepareCalls,
        slots: signatures(prepared.transaction),
        signedCalls: { payer: paying.calls(), second: second.calls() },
        sameMessage: hex(signed.messageBytes) === hex(prepared.transaction.messageBytes),
        signedSlots: Object.keys(signed.signatures).sort(),
        allSigned: Object.values(signed.signatures).every((one) => one !== null),
      }).toEqual({
        prepareCalls: { payer: 0, second: 0 },
        slots: { [payer.address]: null, [cosigner.address]: null },
        signedCalls: { payer: 1, second: 1 },
        sameMessage: true,
        signedSlots: [payer.address, cosigner.address].sort(),
        allSigned: true,
      });
      // Through the table, the message names it and not the accounts it holds.
      const message = hex(prepared.transaction.messageBytes);
      const key = (at: Address) => hex(new Uint8Array(getAddressEncoder().encode(at)));
      expect({
        table: message.includes(key(TABLE)),
        written: message.includes(key(WRITTEN)),
      }).toEqual(
        lookupTables === undefined
          ? { table: false, written: true }
          : { table: true, written: false },
      );
    },
  );

  it.each([
    ["with no lookup table", undefined],
    ["through a lookup table", TABLES],
  ] as const)(
    "signs %s exactly what kit's own build-and-sign makes of the same input, as buildExecuteTransaction does",
    async (_, lookupTables) => {
      const input = {
        payer,
        instructions: instructions(cosigner),
        latestBlockhash: LIFETIME,
        ...(lookupTables === undefined ? {} : { lookupTables }),
      };
      const [prepared, built, kit] = await Promise.all([
        prepareExecuteTransaction(input).sign(),
        buildExecuteTransaction(input),
        builtByKit(input),
      ]);
      const plain = (transaction: Transaction & { lifetimeConstraint?: unknown }) => ({
        message: hex(transaction.messageBytes),
        signatures: signatures(transaction),
        lifetime: JSON.stringify(transaction.lifetimeConstraint, (_key, value: unknown) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      });

      expect({ prepared: plain(prepared), built: plain(built) }).toEqual({
        prepared: plain(kit),
        built: plain(kit),
      });
    },
  );
});
