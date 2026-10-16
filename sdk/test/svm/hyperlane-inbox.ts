/**
 * Hyperlane's delivery INTO Solana, for the suites where an EVM chain proves an intent Solana
 * published: the message an EVM HyperProver dispatched, processed by Solana's REAL Mailbox (the
 * mainnet program the eco-routes dump carries, its inbox as mainnet held it), which hands it to
 * Solana's REAL HyperProver (`handle`, checking the sender against its whitelist and recording the
 * proof the Portal's `withdraw` pays on).
 *
 * MOCKED, and only this: the validators. Mainnet's inbox verifies a message through its default
 * Interchain Security Module, a multisig of Hyperlane's validators whose signatures a relayer
 * carries; here the inbox's default ISM is the SPL Noop program, which accepts any `verify`, so a
 * message is delivered with no signature. The Mailbox still checks the message is for this domain,
 * not processed before, and that the recipient's ISM is the inbox's default.
 */
import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { FailedTransactionMetadata, type LiteSVM } from "litesvm";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";

import { buildExecuteTransaction } from "../../src/svm/transaction.js";
import { memoizedGetProgramDerivedAddress } from "../../src/svm/venues/pda-memo.js";
import { SOLANA_HYPERLANE, SYSTEM_PROGRAM_ID } from "../../src/svm/index.js";
import { svmHyperConfigPda, svmHyperPdaPayerPda, svmProofPda } from "../../src/svm/index.js";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const key = (value: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(value));
const pda = (program: Address, seeds: Uint8Array[]) =>
  memoizedGetProgramDerivedAddress(program, seeds);

/** The inbox's default ISM, at byte 6 of its account: `AccountData<Inbox>`'s initialized flag, then
 *  `Inbox { local_domain: u32, inbox_bump_seed: u8, default_ism: Pubkey, processed_count: u64 }`. */
const DEFAULT_ISM_AT = 1 + 4 + 1;

/** Points Solana's inbox at a pass-through ISM: the validators' signatures are not checked. */
export async function passThroughIsm(svm: LiteSVM): Promise<void> {
  const inbox = await pda(SOLANA_HYPERLANE.mailbox, [text("hyperlane"), text("-"), text("inbox")]);
  const account = svm.getAccount(inbox);
  if (!account.exists) throw new Error("the eco-routes dump carries no Mailbox inbox");
  const data = new Uint8Array(account.data);
  data.set(key(SOLANA_HYPERLANE.splNoop), DEFAULT_ISM_AT);
  svm.setAccount({ ...account, data });
}

/** What the HyperProver's `handle` takes after the Mailbox's accounts (its `handle_account_metas`):
 *  its config, System, its rent payer, its event authority, itself, and each intent's proof. */
async function hyperHandleAccounts(hyperProver: Address, body: Uint8Array): Promise<AccountMeta[]> {
  const proofs: AccountMeta[] = [];
  for (let at = 8; at + 64 <= body.length; at += 64) {
    proofs.push({
      address: await svmProofPda(hyperProver, bytesToHex(body.subarray(at, at + 32))),
      role: AccountRole.WRITABLE,
    });
  }

  return [
    { address: await svmHyperConfigPda(hyperProver), role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    { address: await svmHyperPdaPayerPda(hyperProver), role: AccountRole.WRITABLE },
    { address: await pda(hyperProver, [text("__event_authority")]), role: AccountRole.READONLY },
    { address: hyperProver, role: AccountRole.READONLY },
    ...proofs,
  ];
}

const u32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);

  return out;
};

/**
 * Delivers `message` (a Hyperlane message an EVM Mailbox dispatched to Solana's HyperProver) through
 * Solana's Mailbox: `InboxProcess { metadata: [], message }`, the relayer paying. Fails with the
 * transaction's logs where the Mailbox or the HyperProver refuse it.
 */
export async function deliverToSolana(
  svm: LiteSVM,
  relayer: KeyPairSigner,
  message: Hex,
): Promise<readonly string[]> {
  const bytes = hexToBytes(message);
  const recipient = getAddressDecoder().decode(bytes.subarray(45, 77));
  const body = bytes.subarray(77);
  const mailbox = SOLANA_HYPERLANE.mailbox;
  const payer: AccountSignerMeta = {
    address: relayer.address,
    role: AccountRole.WRITABLE_SIGNER,
    signer: relayer,
  };
  const process: Instruction = {
    programAddress: mailbox,
    accounts: [
      payer,
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      {
        address: await pda(mailbox, [text("hyperlane"), text("-"), text("inbox")]),
        role: AccountRole.WRITABLE,
      },
      {
        address: await pda(mailbox, [
          text("hyperlane"),
          text("-"),
          text("process_authority"),
          text("-"),
          key(recipient),
        ]),
        role: AccountRole.READONLY,
      },
      {
        address: await pda(mailbox, [
          text("hyperlane"),
          text("-"),
          text("processed_message"),
          text("-"),
          hexToBytes(keccak256(bytes)),
        ]),
        role: AccountRole.WRITABLE,
      },
      // The recipient's ISM getter takes no accounts; then Noop, the ISM (Noop too), no verify
      // accounts, the recipient, and its handle's accounts.
      { address: SOLANA_HYPERLANE.splNoop, role: AccountRole.READONLY },
      { address: SOLANA_HYPERLANE.splNoop, role: AccountRole.READONLY },
      { address: recipient, role: AccountRole.READONLY },
      ...(await hyperHandleAccounts(recipient, body)),
    ],
    // `MailboxInstruction::InboxProcess` (variant 1) of `{ metadata: Vec<u8>, message: Vec<u8> }`.
    data: new Uint8Array([1, ...u32(0), ...u32(bytes.length), ...bytes]),
  };
  svm.expireBlockhash();
  const transaction = await buildExecuteTransaction({
    payer: relayer,
    instructions: [process],
    latestBlockhash: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
  });
  const result = svm.sendTransaction(transaction);
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(
      `Solana's Mailbox refused the message: ${String(result.err())}\n${result.meta().logs().join("\n")}`,
    );
  }

  return result.logs();
}
