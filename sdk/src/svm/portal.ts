/**
 * The eco-routes Portal on Solana, as a solver and a creator use it after an intent is published on
 * an EVM chain: the destination's `fulfill`, its `prove` through the HyperProver (with the
 * Interchain Gas Paymaster paid through eco-routes' proof_helper), and its `cancel`.
 *
 * Pure: every builder returns an `Instruction` and reads nothing. Accounts, seeds and argument
 * layouts are the programs' own (eco/eco-routes-svm at the rotated v2.1.0 ids, the release the
 * registry records; Hyperlane's sealevel Mailbox and IGP), each cited where it is used, and the
 * LiteSVM suites run them against the programs dumped from mainnet
 * (`test/fixtures/eco-routes-svm/`).
 *
 * The route an EVM chain publishes for Solana is Borsh, its every call a `CalldataWithAccounts`:
 * the instruction data and the accounts it runs with, committed with their signer and writable
 * flags. `fulfill` takes it in a compact form, each call's data a bare `Calldata`
 * `{ data, account_count }`, and the accounts passed in the transaction, which the Portal hashes
 * back into the committed route (portal/src/instructions/mod.rs `canonical_route`). So the
 * transaction's flags for those accounts must be the committed ones.
 */
import {
  AccountRole,
  address,
  addEncoderSizePrefix,
  getAddressDecoder,
  getAddressEncoder,
  getArrayEncoder,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU32Encoder,
  getU64Encoder,
  getU8Encoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { AccountManifest } from "sauce-compiler";

import { encodeRouteSvm, hashIntent } from "../routes/encode.js";
import type { Intent, Route, UniversalAddress } from "../routes/types.js";
import {
  decodePortalCalldataWithAccounts,
  encodePortalCalldataWithAccounts,
  type PortalAccountMeta,
} from "./intent.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./token-program.js";
import {
  buildCookInstruction,
  buildCreatePotInstruction,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  MAX_POT_LEN,
} from "./kitchen.js";
import { resolveAccounts, type AccountResolution } from "./resolve.js";
import { svmRouteCallsFor } from "./intent-route.js";
import { memoizedGetProgramDerivedAddress } from "./venues/pda-memo.js";

// ---------------------------------------------------------------------------------------------
// Programs and accounts
// ---------------------------------------------------------------------------------------------

/** The Associated Token Account program, which `fulfill` creates the executor's token accounts with. */
export const ASSOCIATED_TOKEN_PROGRAM_ID: Address = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM_ID: Address = address("11111111111111111111111111111111");

/**
 * What a Solana proof travels through, on mainnet: Hyperlane's Mailbox and the SPL Noop program it
 * logs with, its Interchain Gas Paymaster and the IGP accounts eco-solver pays (its
 * `solana.schema.ts` defaults), eco-routes' proof_helper, and the gas eco-solver buys per proof.
 * The Mailbox and IGP ids are the ones hyper-prover (`hyperlane.rs`) and proof-helper (`igp.rs`)
 * check by address under `--features mainnet`.
 */
export const SOLANA_HYPERLANE = {
  mailbox: address("E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi"),
  splNoop: address("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
  igpProgram: address("BhNcatUDC2D5JTyeaqrdSukiVFsEHK7e3hVmKMztwefv"),
  igpAccount: address("JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M"),
  overheadIgp: address("AkeHBbE5JkwVppujCQQ6WuxsVsJtruBAjUo6fDCFp6fF"),
  proofHelper: address("EcoouNeez8PvCP9NJTywGdjYFAXnZ6pkMapZwymxg2GC"),
  /** Destination gas paid per proof message: eco-solver's `hyperlane.gasAmount`. */
  gasAmount: 130_000n,
} as const;

/** Anchor discriminators: the first 8 bytes of sha256 of `global:<instruction>` or
 *  `account:<Account>`, pinned in `svm-portal.test.ts` against that derivation. */
export const PORTAL_DISCRIMINATORS = {
  fulfill: new Uint8Array([143, 2, 52, 206, 174, 164, 247, 72]),
  prove: new Uint8Array([52, 246, 26, 161, 211, 170, 86, 215]),
  cancel: new Uint8Array([232, 219, 223, 41, 219, 236, 220, 190]),
  payForGas: new Uint8Array([118, 206, 89, 159, 148, 167, 219, 205]),
  fulfillMarker: new Uint8Array([226, 174, 31, 239, 112, 220, 188, 31]),
} as const;

/** The claimant `cancel` writes (eco-svm-std `CANCELLED`): the EVM sentinel, left-padded. */
export const SVM_CANCELLED_CLAIMANT: Hex =
  "0x000000000000000000000000e685056aec77686a83e2a6bdf37c6f71dd2fdb5f";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const keyBytes = (value: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(value));
const pda = (program: Address, seeds: Uint8Array[]): Promise<Address> =>
  memoizedGetProgramDerivedAddress(program, seeds);

/** A 32-byte universal address as the base58 key it is on Solana. */
export function svmKeyOf(value: UniversalAddress | Hex): Address {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) throw new Error(`${value} is not a 32-byte Solana key`);

  return getAddressDecoder().decode(bytes);
}

/** A Solana key as the 32-byte universal address an intent records. */
export function universalOfSvmKey(key: Address): UniversalAddress {
  return bytesToHex(keyBytes(key)) as UniversalAddress;
}

/** The Portal's executor, which runs every route's calls: `[b"executor"]` (portal state.rs). */
export const svmExecutorPda = (portal: Address): Promise<Address> =>
  pda(portal, [text("executor")]);

/** The record `fulfill` (the claimant) or `cancel` (the sentinel) writes for an intent:
 *  `[b"fulfill_marker", intent_hash]`. */
export const svmFulfillMarkerPda = (portal: Address, intentHash: Hex): Promise<Address> =>
  pda(portal, [text("fulfill_marker"), hexToBytes(intentHash)]);

/** The Portal's per-prover authority `prove` signs with: `[b"dispatcher", prover]`. */
export const svmPortalDispatcherPda = (portal: Address, prover: Address): Promise<Address> =>
  pda(portal, [text("dispatcher"), keyBytes(prover)]);

/** The HyperProver's own dispatcher, the Hyperlane message's sender: `[b"dispatcher"]`
 *  (hyper-prover state.rs). The EVM HyperProvers whitelist it as Solana's sender. */
export const svmHyperDispatcherPda = (hyperProver: Address): Promise<Address> =>
  pda(hyperProver, [text("dispatcher")]);

/** Hyperlane's outbox: `[b"hyperlane", b"-", b"outbox"]`. */
export const hyperlaneOutboxPda = (mailbox: Address): Promise<Address> =>
  pda(mailbox, [text("hyperlane"), text("-"), text("outbox")]);

/** The account a dispatched message is written to, keyed by a fresh signer:
 *  `[b"hyperlane", b"-", b"dispatched_message", b"-", unique]`. */
export const hyperlaneDispatchedMessagePda = (
  mailbox: Address,
  unique: Address,
): Promise<Address> =>
  pda(mailbox, [
    text("hyperlane"),
    text("-"),
    text("dispatched_message"),
    text("-"),
    keyBytes(unique),
  ]);

/** The IGP's program data: `[b"hyperlane_igp", b"-", b"program_data"]`. */
export const igpProgramDataPda = (igp: Address): Promise<Address> =>
  pda(igp, [text("hyperlane_igp"), text("-"), text("program_data")]);

/** The account a gas payment is written to, keyed by a fresh signer:
 *  `[b"hyperlane_igp", b"-", b"gas_payment", b"-", unique]`. */
export const igpGasPaymentPda = (igp: Address, unique: Address): Promise<Address> =>
  pda(igp, [text("hyperlane_igp"), text("-"), text("gas_payment"), text("-"), keyBytes(unique)]);

/** An owner's associated token account for `mint` under `tokenProgram`. */
export const associatedTokenAccount = (
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> =>
  pda(ASSOCIATED_TOKEN_PROGRAM_ID, [keyBytes(owner), keyBytes(tokenProgram), keyBytes(mint)]);

// ---------------------------------------------------------------------------------------------
// The route, as fulfill and cancel take it
// ---------------------------------------------------------------------------------------------

/** A signer, or only its key: an instruction carries the signer when one is given, so a
 *  transaction built from it signs with it. */
export type SignerOrKey = TransactionSigner | Address;

const keyOf = (value: SignerOrKey): Address =>
  typeof value === "string" ? value : (value as TransactionSigner).address;

function signerMeta(value: SignerOrKey, writable: boolean): AccountMeta | AccountSignerMeta {
  const role = writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;

  return typeof value === "string"
    ? { address: value, role }
    : { address: value.address, role, signer: value as TransactionSigner };
}

const plainMeta = (key: Address, writable: boolean): AccountMeta => ({
  address: key,
  role: writable ? AccountRole.WRITABLE : AccountRole.READONLY,
});

/** The role a committed `SerializableAccountMeta` asks the transaction for. */
const committedRole = (meta: PortalAccountMeta): AccountRole =>
  meta.isSigner
    ? meta.isWritable
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.READONLY_SIGNER
    : meta.isWritable
      ? AccountRole.WRITABLE
      : AccountRole.READONLY;

/** The route in `fulfill`'s compact form, and each call's committed accounts in order. */
export interface CompactSvmRoute {
  /** Borsh `Route`, each call's data a bare `Calldata { data, account_count }`. */
  readonly route: Uint8Array;
  /** Every call's accounts, in call order, with the flags the source committed. */
  readonly callAccounts: readonly PortalAccountMeta[];
  /** The programs the calls invoke, which the transaction must carry. */
  readonly targets: readonly Address[];
}

const calldataEncoder = getStructEncoder([
  ["data", addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
  ["accountCount", getU8Encoder()],
]);

/**
 * The route split for `fulfill` and `cancel`: each call's `CalldataWithAccounts` decoded, its
 * `Calldata` kept as the call's data and its accounts collected in order.
 *
 * `fulfill` hashes the flags the transaction gives each account, so a committed signer must sign
 * the fill. Given `signers` (the keys that will), a committed signer outside them is refused: no
 * one but that key's owner can sign it — the executor included, a PDA no transaction can sign
 * (the Portal signs it into each call itself, and a route commits it unsigned).
 */
export function compactSvmRoute(
  route: Route,
  options: { readonly signers?: readonly Address[] } = {},
): CompactSvmRoute {
  const callAccounts: PortalAccountMeta[] = [];
  const targets: Address[] = [];
  const calls = route.calls.map((call) => {
    const decoded = decodePortalCalldataWithAccounts(call.data);
    for (const account of decoded.accounts) {
      if (
        account.isSigner &&
        options.signers !== undefined &&
        !options.signers.includes(account.pubkey)
      ) {
        throw new Error(
          `the route commits ${account.pubkey} as a signer of a call: only that key's owner can ` +
            "sign it, so no solver can fill this route",
        );
      }
    }
    callAccounts.push(...decoded.accounts);
    targets.push(svmKeyOf(call.target));

    return {
      ...call,
      data: bytesToHex(
        Uint8Array.from(
          calldataEncoder.encode({
            data: decoded.instructionData,
            accountCount: decoded.accountCount,
          }) as ArrayLike<number>,
        ),
      ),
    };
  });

  return {
    route: hexToBytes(encodeRouteSvm({ ...route, calls })),
    callAccounts,
    targets,
  };
}

// ---------------------------------------------------------------------------------------------
// fulfill
// ---------------------------------------------------------------------------------------------

export interface PortalFulfillInput {
  /** The intent, as published: an EVM source, Solana its destination. */
  readonly intent: Intent;
  /** The Portal program the route names. */
  readonly portal: Address;
  /** The solver: signs, and pays the route's tokens and native amount from its own accounts. */
  readonly solver: SignerOrKey;
  /** Pays the fulfill marker's and any new executor token account's rent. Default: the solver. */
  readonly payer?: SignerOrKey;
  /** Who the source pays once the fill is proven: a 32-byte claimant (an EVM address, padded). */
  readonly claimant: Hex;
  /** The token program each of the route's mints is owned by (base58 mint -> program). */
  readonly tokenPrograms: Readonly<Record<string, Address>>;
}

/**
 * The Portal's `fulfill` (portal/src/instructions/fulfill.rs): the solver's tokens moved into the
 * executor (one `(from, to, mint)` chunk per route token: the solver's associated token account,
 * the executor's, created if absent, and the mint), the native amount with them, the calls run
 * as the executor, and the marker that records `claimant` claimed.
 */
export async function buildPortalFulfillInstruction(
  input: PortalFulfillInput,
): Promise<Instruction> {
  const { intent, portal } = input;
  const solver = keyOf(input.solver);
  const payer = input.payer ?? input.solver;
  const executor = await svmExecutorPda(portal);
  const { intentHash, rewardHash } = hashIntent(intent);
  const compact = compactSvmRoute(intent.route, { signers: [solver, keyOf(payer)] });
  const chunks: AccountMeta[] = [];
  for (const token of intent.route.tokens) {
    const mint = svmKeyOf(token.token);
    const program = input.tokenPrograms[mint];
    if (program === undefined)
      throw new Error(`no token program given for the route's mint ${mint}`);
    chunks.push(
      plainMeta(await associatedTokenAccount(solver, mint, program), true),
      plainMeta(await associatedTokenAccount(executor, mint, program), true),
      plainMeta(mint, false),
    );
  }
  const claimant = hexToBytes(input.claimant);
  if (claimant.length !== 32) throw new Error("the claimant is not 32 bytes");
  if (input.claimant.toLowerCase() === SVM_CANCELLED_CLAIMANT) {
    throw new Error("the claimant is the cancellation sentinel, which only cancel may write");
  }
  const data = concat(
    PORTAL_DISCRIMINATORS.fulfill,
    hexToBytes(intentHash),
    compact.route,
    hexToBytes(rewardHash),
    claimant,
  );

  return {
    programAddress: portal,
    accounts: [
      signerMeta(payer, true),
      signerMeta(input.solver, true),
      plainMeta(executor, false),
      plainMeta(await svmFulfillMarkerPda(portal, intentHash), true),
      plainMeta(TOKEN_PROGRAM_ID, false),
      plainMeta(TOKEN_2022_PROGRAM_ID, false),
      plainMeta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      ...chunks,
      ...compact.callAccounts.map((meta) => ({
        address: meta.pubkey,
        role: committedRole(meta),
      })),
      // Each call's program: invoked, so carried, but not part of the committed route.
      ...compact.targets.map((target) => plainMeta(target, false)),
    ],
    data,
  };
}

// ---------------------------------------------------------------------------------------------
// prove, with the gas paid
// ---------------------------------------------------------------------------------------------

export interface PortalHyperProveInput {
  readonly portal: Address;
  /** The HyperProver on Solana. */
  readonly hyperProver: Address;
  /** The hashes to prove, each filled (or cancelled) on Solana. */
  readonly intentHashes: readonly Hex[];
  /** The source chain: its Hyperlane domain is its EVM chain id, a u32. */
  readonly sourceChainId: bigint;
  /** The source chain's HyperProver, which receives the message (an EVM address). */
  readonly sourceProver: Hex;
  /** Pays the message account's rent and the gas. */
  readonly payer: SignerOrKey;
  /** A fresh key the dispatched message is written under; it signs the transaction. */
  readonly uniqueMessage: SignerOrKey;
  /** A fresh key the gas payment is written under; it signs the transaction. */
  readonly uniqueGasPayment: SignerOrKey;
  /** Hyperlane's programs and accounts: mainnet's by default. */
  readonly hyperlane?: Partial<typeof SOLANA_HYPERLANE>;
}

const proveArgsEncoder = getStructEncoder([
  ["prover", getAddressEncoder()],
  ["sourceChainDomainId", getU64Encoder()],
  [
    "intentHashes",
    getArrayEncoder(fixEncoderSize(getBytesEncoder(), 32), { size: getU32Encoder() }),
  ],
  ["data", addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
]);

/**
 * The proof of `intentHashes` to their source through the HyperProver, and the gas for its
 * delivery, as two instructions for one transaction (eco-solver's `svm-hyper.prover.ts`):
 *
 *  1. the Portal's `prove` (portal/src/instructions/prove.rs): its prover and per-prover dispatcher,
 *     then each intent's fulfill marker, then the HyperProver's own accounts
 *     (hyper-prover/src/instructions/prove.rs): its dispatcher, the payer, the Mailbox outbox, the
 *     Noop program, the fresh message key, the dispatched-message account, System and the Mailbox.
 *     `data` is the source HyperProver, the message's recipient, as 32 bytes;
 *  2. proof_helper's `pay_for_gas` (proof-helper/src/instructions/pay_for_gas.rs), which reads the
 *     message the first wrote, derives its id and pays the IGP for `gasAmount` on the source.
 */
export async function buildPortalHyperProveInstructions(
  input: PortalHyperProveInput,
): Promise<readonly [Instruction, Instruction]> {
  const hyperlane = { ...SOLANA_HYPERLANE, ...input.hyperlane };
  if (input.intentHashes.length === 0) throw new Error("no intent to prove");
  if (input.sourceChainId > 0xffff_ffffn) {
    throw new Error(`chain ${input.sourceChainId} is past Hyperlane's u32 domains`);
  }
  const sourceProver = hexToBytes(input.sourceProver);
  if (sourceProver.length !== 20 && sourceProver.length !== 32) {
    throw new Error("the source prover is neither an EVM address nor 32 bytes");
  }
  const recipient = new Uint8Array(32);
  recipient.set(sourceProver, 32 - sourceProver.length);
  const uniqueMessage = keyOf(input.uniqueMessage);
  const dispatched = await hyperlaneDispatchedMessagePda(hyperlane.mailbox, uniqueMessage);
  const markers = await Promise.all(
    input.intentHashes.map((hash) => svmFulfillMarkerPda(input.portal, hash)),
  );
  const prove: Instruction = {
    programAddress: input.portal,
    accounts: [
      plainMeta(input.hyperProver, false),
      plainMeta(await svmPortalDispatcherPda(input.portal, input.hyperProver), false),
      ...markers.map((marker) => plainMeta(marker, false)),
      plainMeta(await svmHyperDispatcherPda(input.hyperProver), false),
      signerMeta(input.payer, true),
      plainMeta(await hyperlaneOutboxPda(hyperlane.mailbox), true),
      plainMeta(hyperlane.splNoop, false),
      signerMeta(input.uniqueMessage, false),
      plainMeta(dispatched, true),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      plainMeta(hyperlane.mailbox, false),
    ],
    data: concat(
      PORTAL_DISCRIMINATORS.prove,
      Uint8Array.from(
        proveArgsEncoder.encode({
          prover: input.hyperProver,
          sourceChainDomainId: input.sourceChainId,
          intentHashes: input.intentHashes.map((hash) => hexToBytes(hash)),
          data: recipient,
        }) as ArrayLike<number>,
      ),
    ),
  };
  const uniqueGasPayment = keyOf(input.uniqueGasPayment);
  const payForGas: Instruction = {
    programAddress: hyperlane.proofHelper,
    accounts: [
      plainMeta(dispatched, false),
      signerMeta(input.payer, true),
      plainMeta(await igpProgramDataPda(hyperlane.igpProgram), true),
      signerMeta(input.uniqueGasPayment, false),
      plainMeta(await igpGasPaymentPda(hyperlane.igpProgram, uniqueGasPayment), true),
      plainMeta(hyperlane.igpAccount, true),
      plainMeta(hyperlane.overheadIgp, false),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      plainMeta(hyperlane.igpProgram, false),
    ],
    data: concat(
      PORTAL_DISCRIMINATORS.payForGas,
      Uint8Array.from(getU32Encoder().encode(Number(input.sourceChainId)) as ArrayLike<number>),
      Uint8Array.from(getU64Encoder().encode(hyperlane.gasAmount) as ArrayLike<number>),
    ),
  };

  return [prove, payForGas];
}

// ---------------------------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------------------------

/**
 * The Portal's `cancel` (portal/src/instructions/cancel.rs), strictly after the route's deadline:
 * the route in `fulfill`'s compact form, its call accounts passed read-only and unsigned, and
 * their committed flags as one byte each (bit 0 signer, bit 1 writable). Writes the sentinel into
 * the intent's fulfill marker, so it can never be filled; `prove` then carries it to the source.
 */
export async function buildPortalCancelInstruction(input: {
  readonly intent: Intent;
  readonly portal: Address;
  readonly payer: SignerOrKey;
}): Promise<Instruction> {
  const { intentHash, rewardHash } = hashIntent(input.intent);
  const compact = compactSvmRoute(input.intent.route);
  const flags = compact.callAccounts.map(
    (meta) => (meta.isSigner ? 1 : 0) | (meta.isWritable ? 2 : 0),
  );

  return {
    programAddress: input.portal,
    accounts: [
      signerMeta(input.payer, true),
      plainMeta(await svmFulfillMarkerPda(input.portal, intentHash), true),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      ...compact.callAccounts.map((meta) => plainMeta(meta.pubkey, false)),
    ],
    data: concat(
      PORTAL_DISCRIMINATORS.cancel,
      hexToBytes(intentHash),
      compact.route,
      hexToBytes(rewardHash),
      Uint8Array.from(getU32Encoder().encode(flags.length) as ArrayLike<number>),
      Uint8Array.from(flags),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// What the destination recorded
// ---------------------------------------------------------------------------------------------

/**
 * The claimant an intent's fulfill marker records (portal state.rs `FulfillMarker`: the Anchor
 * discriminator, the 32-byte claimant, the bump — 41 bytes), or `null` when `data` is not one.
 * The sentinel `SVM_CANCELLED_CLAIMANT` means it was cancelled.
 */
export function decodeFulfillMarker(data: Uint8Array): Hex | null {
  if (data.length < 41) return null;
  for (const [index, byte] of PORTAL_DISCRIMINATORS.fulfillMarker.entries()) {
    if (data[index] !== byte) return null;
  }

  return bytesToHex(data.subarray(8, 40));
}

// ---------------------------------------------------------------------------------------------
// A route call
// ---------------------------------------------------------------------------------------------

/**
 * A route call moving `amount` of `mint` from the executor's associated token account to
 * `recipient`, a token account (SPL `TransferChecked`, the executor its authority): the call
 * eco-routes' `DepositAddress_USDCTransfer_Solana` publishes, account for account.
 */
export async function svmTokenTransferCall(input: {
  readonly portal: Address;
  readonly mint: Address;
  readonly amount: bigint;
  readonly decimals: number;
  /** The token account paid: it must exist when the route runs. */
  readonly recipient: Address;
  readonly tokenProgram?: Address;
}): Promise<{ target: UniversalAddress; data: Hex; value: bigint }> {
  const program = input.tokenProgram ?? TOKEN_PROGRAM_ID;
  const executor = await svmExecutorPda(input.portal);
  const instruction = new Uint8Array(10);
  instruction[0] = 12;
  new DataView(instruction.buffer).setBigUint64(1, input.amount, true);
  instruction[9] = input.decimals;

  return {
    target: universalOfSvmKey(program),
    data: encodePortalCalldataWithAccounts({
      instructionData: instruction,
      accounts: [
        {
          pubkey: await associatedTokenAccount(executor, input.mint, program),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: input.mint, isSigner: false, isWritable: false },
        { pubkey: input.recipient, isSigner: false, isWritable: true },
        { pubkey: executor, isSigner: false, isWritable: false },
      ],
    }),
    value: 0n,
  };
}

/** A token a route delivers to the executor, whose associated token account the fill writes. */
export interface SvmRouteToken {
  readonly mint: Address;
  readonly tokenProgram?: Address;
}

/**
 * Route calls that run `instructions` as the Portal's executor, in order, each committed with the
 * flags the fill transaction will give its accounts.
 *
 * `fulfill` hashes each call account's flags as the TRANSACTION has them, and a transaction gives
 * an account one set of flags however many instructions name it: an account writable anywhere is
 * writable everywhere. So each account is committed writable if any call writes it, or if the fill
 * writes it itself (the executor's token account for each of `tokens`), and as a signer only where
 * a call needs its signature — never the executor's, which no transaction can carry: the Portal
 * signs each call for it. A route committing different flags hashes to another intent and can
 * never be filled.
 */
export async function svmRouteCalls(
  portal: Address,
  instructions: readonly Instruction[],
  tokens: readonly SvmRouteToken[] = [],
): Promise<Array<{ target: UniversalAddress; data: Hex; value: bigint }>> {
  const executor = await svmExecutorPda(portal);
  const writable = await Promise.all(
    tokens.map((token) =>
      associatedTokenAccount(executor, token.mint, token.tokenProgram ?? TOKEN_PROGRAM_ID),
    ),
  );

  return svmRouteCallsFor(executor, instructions, writable);
}

/** The Kitchen Pot the Portal's executor owns under `salt`, which every intent's cook through
 *  that Portal shares (the zero salt by convention, as on an EVM chain). */
export async function svmIntentPot(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly salt?: Uint8Array;
}): Promise<Address> {
  const executor = await svmExecutorPda(input.portal);

  return (await derivePotPda(input.kitchen, executor, input.salt ?? new Uint8Array(32))).address;
}

/**
 * The Kitchen's `create_pot` for the executor's Pot: the executor its owner and its rent's payer,
 * so the route carrying it delivers the rent as its native amount. Created once, by the first
 * intent whose route carries it; a later one would fail, the Pot existing.
 */
export async function svmIntentPotInstruction(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly engineProgram: Address;
  readonly salt?: Uint8Array;
}): Promise<Instruction> {
  const salt = input.salt ?? new Uint8Array(32);

  return buildCreatePotInstruction({
    kitchen: input.kitchen,
    owner: await svmExecutorPda(input.portal),
    engineProgram: input.engineProgram,
    pot: await svmIntentPot({ ...input, salt }),
    salt,
    space: MAX_POT_LEN,
  });
}

/**
 * The Kitchen's `cook` of `bytecode` on the executor's Pot: the executor the Pot's owner and the
 * Kitchen fee's payer (the route delivers the fee as its native amount), the program's accounts
 * resolved from its manifest as for any cook. The fill's transaction must request the engine's
 * heap frame, as every cook does; `planSvmFill` adds it when a route call is the Kitchen's.
 */
export async function svmIntentCookInstruction(input: {
  readonly portal: Address;
  readonly kitchen: Address;
  readonly engineProgram: Address;
  readonly salt?: Uint8Array;
  readonly bytecode: Uint8Array;
  readonly manifest: AccountManifest;
  readonly resolution: AccountResolution;
  readonly maxExecutionFee: bigint;
}): Promise<Instruction> {
  const executor = await svmExecutorPda(input.portal);
  const salt = input.salt ?? new Uint8Array(32);
  const pot = await derivePotPda(input.kitchen, executor, salt);

  return buildCookInstruction({
    kitchen: input.kitchen,
    owner: executor,
    engineProgram: input.engineProgram,
    potSalt: salt,
    pot: pot.address,
    potBump: pot.bump,
    feeConfig: (await deriveExecutionFeeConfigPda(input.kitchen)).address,
    bytecode: input.bytecode,
    maxExecutionFee: input.maxExecutionFee,
    feePayer: executor,
    tail: resolveAccounts(input.manifest, input.resolution, executor),
  });
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}
