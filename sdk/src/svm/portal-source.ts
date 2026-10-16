/**
 * The eco-routes Portal on Solana as an intent's SOURCE: the intent published there, its reward
 * escrowed in a vault there, and paid out there once the destination's proof arrives — `publish`,
 * `fund`, `withdraw` (the claim) and `refund`, and what each reads: the vault, the proof the
 * reward's prover records when Hyperlane delivers it, and the marker a claim leaves.
 *
 * Pure, as `portal.ts` is: every builder returns an `Instruction` and reads nothing. Accounts,
 * seeds and argument layouts are the Portal's own (eco/eco-routes-svm at the rotated v2.1.0 ids,
 * `programs/portal/src/instructions/{publish,fund,fund_context,withdraw,refund}.rs`) and the
 * HyperProver's (`programs/hyper-prover/src/{state.rs,instructions/handle.rs,close_proof.rs}`),
 * cited where each is used; the LiteSVM suites run them against the programs dumped from mainnet.
 *
 * The route of an intent Solana publishes is encoded for its DESTINATION (ABI for an EVM chain),
 * and its reward in Borsh, so its hashes are `routes/encode.ts#hashIntent`'s for a Solana source:
 * `keccak256(destination as 8 big-endian bytes ++ routeHash ++ rewardHash)`.
 */
import {
  AccountRole,
  getAddressEncoder,
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

import { decodeRewardSvm, encodeRoute, encodeRewardSvm, hashIntent } from "../routes/encode.js";
import type { Intent, Reward } from "../routes/types.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAccount,
  SYSTEM_PROGRAM_ID,
  svmKeyOf,
} from "./portal.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./token-program.js";
import { memoizedGetProgramDerivedAddress } from "./venues/pda-memo.js";

/** Solana's chain id in eco-routes, and its Hyperlane domain: what an EVM prover proves to. */
export const SOLANA_CHAIN_ID = 1399811149n;

/** Anchor discriminators: the first 8 bytes of sha256 of `global:<instruction>`,
 *  `account:<Account>` or `event:<Event>`, pinned in `svm-portal-source.test.ts` against that
 *  derivation. */
export const PORTAL_SOURCE_DISCRIMINATORS = {
  publish: new Uint8Array([129, 177, 182, 160, 184, 224, 219, 5]),
  fund: new Uint8Array([218, 188, 111, 221, 152, 113, 174, 7]),
  withdraw: new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34]),
  refund: new Uint8Array([2, 96, 183, 251, 63, 208, 46, 46]),
  /** The marker `withdraw` writes (`state.rs` `WithdrawnMarker`). */
  withdrawnMarker: new Uint8Array([163, 137, 163, 33, 38, 73, 205, 42]),
  /** The HyperProver's proof account (`state.rs` `ProofAccount`). */
  proofAccount: new Uint8Array([54, 244, 192, 233, 218, 58, 44, 242]),
  /** The HyperProver's whitelist (`state.rs` `Config`). */
  config: new Uint8Array([155, 12, 170, 224, 30, 250, 204, 130]),
  /** The Portal's `emit!`s, logged as `Program data: <base64>`. */
  intentPublished: new Uint8Array([194, 169, 103, 197, 21, 235, 236, 166]),
  intentFunded: new Uint8Array([14, 106, 10, 45, 124, 28, 211, 173]),
  intentWithdrawn: new Uint8Array([28, 22, 16, 41, 101, 254, 123, 228]),
  intentRefunded: new Uint8Array([192, 129, 4, 158, 184, 25, 83, 113]),
} as const;

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const keyBytes = (value: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(value));
const pda = (program: Address, seeds: Uint8Array[]): Promise<Address> =>
  memoizedGetProgramDerivedAddress(program, seeds);
const u64 = (value: bigint): Uint8Array =>
  Uint8Array.from(getU64Encoder().encode(value) as ArrayLike<number>);
const u32 = (value: number): Uint8Array =>
  Uint8Array.from(getU32Encoder().encode(value) as ArrayLike<number>);
const u8 = (value: number): Uint8Array =>
  Uint8Array.from(getU8Encoder().encode(value) as ArrayLike<number>);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

/** The intent's reward escrow, a bare lamport holder that owns the reward's token accounts:
 *  `[b"vault", intent_hash]` (portal state.rs). */
export const svmVaultPda = (portal: Address, intentHash: Hex): Promise<Address> =>
  pda(portal, [text("vault"), hexToBytes(intentHash)]);

/** The marker a claim writes, after which the reward is never paid again:
 *  `[b"claimed_marker", intent_hash]` (portal state.rs `WithdrawnMarker`). */
export const svmWithdrawnMarkerPda = (portal: Address, intentHash: Hex): Promise<Address> =>
  pda(portal, [text("claimed_marker"), hexToBytes(intentHash)]);

/** The proof the reward's prover records: `[b"proof", intent_hash]` under the PROVER
 *  (eco-svm-std prover.rs `Proof::pda`). */
export const svmProofPda = (prover: Address, intentHash: Hex): Promise<Address> =>
  pda(prover, [text("proof"), hexToBytes(intentHash)]);

/** The Portal's authority over a prover's `close_proof`: `[b"proof_closer", prover]`. */
export const svmProofCloserPda = (portal: Address, prover: Address): Promise<Address> =>
  pda(portal, [text("proof_closer"), keyBytes(prover)]);

/** The HyperProver's rent payer for proof accounts, which `close_proof` refunds:
 *  `[b"pda_payer"]` (hyper-prover state.rs). */
export const svmHyperPdaPayerPda = (hyperProver: Address): Promise<Address> =>
  pda(hyperProver, [text("pda_payer")]);

/** The HyperProver's whitelist of the senders it takes a proof from: `[b"config"]`. */
export const svmHyperConfigPda = (hyperProver: Address): Promise<Address> =>
  pda(hyperProver, [text("config")]);

type SignerOrKey = TransactionSigner | Address;

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

/** The reward's tokens as the Portal reads them: one entry per mint (amounts of a mint listed
 *  twice added up), in the mints' byte order — `Reward::token_amounts`, a `BTreeMap<Pubkey, u64>`,
 *  which `withdraw` requires its token accounts to follow. */
export function svmRewardTokens(
  reward: Reward,
): ReadonlyArray<{ readonly mint: Address; readonly amount: bigint }> {
  const sums = new Map<Hex, bigint>();
  for (const entry of reward.tokens) {
    const key = entry.token.toLowerCase() as Hex;
    sums.set(key, (sums.get(key) ?? 0n) + entry.amount);
  }

  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, amount]) => ({ mint: svmKeyOf(key), amount }));
}

/** The token program each reward mint is owned by (base58 mint -> program). */
export type SvmTokenPrograms = Readonly<Record<string, Address>>;

function programOf(programs: SvmTokenPrograms, mint: Address): Address {
  const program = programs[mint];
  if (program === undefined)
    throw new Error(`no token program given for the reward's mint ${mint}`);
  if (program !== TOKEN_PROGRAM_ID && program !== TOKEN_2022_PROGRAM_ID) {
    throw new Error(`the reward's mint ${mint} is owned by ${program}, neither token program`);
  }

  return program;
}

/** `(destination, route_hash, reward)`, the arguments `fund`, `withdraw` and `refund` start with:
 *  the intent named by what its hash is made of. */
function intentArgs(intent: Intent): Uint8Array {
  const { routeHash } = hashIntent(intent);

  return concat(
    u64(intent.destination),
    hexToBytes(routeHash),
    hexToBytes(encodeRewardSvm(intent.reward)),
  );
}

function assertSolanaSource(intent: Intent): void {
  if (intent.sourceChainId !== SOLANA_CHAIN_ID) {
    throw new Error(
      `the intent's source is chain ${intent.sourceChainId}, not Solana (${SOLANA_CHAIN_ID}): ` +
        "its reward is not escrowed by Solana's Portal",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// publish and fund
// ---------------------------------------------------------------------------------------------

/**
 * The Portal's `publish` (publish.rs): no accounts, only `(destination, route, reward)`, the route
 * as the destination encodes it. It hashes them into the intent's hash and emits `IntentPublished`,
 * which is how a solver finds the intent; it moves nothing.
 */
export function buildPortalPublishInstruction(input: {
  readonly intent: Intent;
  readonly portal: Address;
}): Instruction {
  assertSolanaSource(input.intent);
  const route = hexToBytes(encodeRoute(input.intent.route, input.intent.destination));

  return {
    programAddress: input.portal,
    accounts: [],
    data: concat(
      PORTAL_SOURCE_DISCRIMINATORS.publish,
      u64(input.intent.destination),
      u32(route.length),
      route,
      hexToBytes(encodeRewardSvm(input.intent.reward)),
    ),
  };
}

/**
 * The Portal's `fund` (fund.rs, fund_context.rs): the reward moved from `funder` into the intent's
 * vault — the native amount by a System transfer, each token by `TransferChecked` from the funder's
 * associated token account to the vault's, which `fund` creates when absent (the payer pays its
 * rent). Each token is one `(from, to, mint)` chunk. Only what the vault lacks moves, so funding
 * twice moves nothing the second time; without `allowPartial` a funder that cannot cover the whole
 * reward is refused (`InsufficientFunds`). Emits `IntentFunded`.
 */
export async function buildPortalFundInstruction(input: {
  readonly intent: Intent;
  readonly portal: Address;
  /** Signs, and pays the rent of any vault token account `fund` creates. */
  readonly payer: SignerOrKey;
  /** Signs, and pays the reward from its own accounts. Default: the payer. */
  readonly funder?: SignerOrKey;
  readonly tokenPrograms: SvmTokenPrograms;
  readonly allowPartial?: boolean;
}): Promise<Instruction> {
  const { intent, portal } = input;
  assertSolanaSource(intent);
  const funder = input.funder ?? input.payer;
  const { intentHash } = hashIntent(intent);
  const vault = await svmVaultPda(portal, intentHash);
  const chunks: AccountMeta[] = [];
  for (const { mint } of svmRewardTokens(intent.reward)) {
    const program = programOf(input.tokenPrograms, mint);
    chunks.push(
      plainMeta(await associatedTokenAccount(keyOf(funder), mint, program), true),
      plainMeta(await associatedTokenAccount(vault, mint, program), true),
      plainMeta(mint, false),
    );
  }
  const accounts = [signerMeta(input.payer, true)];
  // One key signing twice is one signer: a second meta for it would only repeat the first.
  accounts.push(
    keyOf(funder) === keyOf(input.payer) ? accounts[0]! : signerMeta(funder, true),
    plainMeta(vault, true),
    plainMeta(TOKEN_PROGRAM_ID, false),
    plainMeta(TOKEN_2022_PROGRAM_ID, false),
    plainMeta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
    plainMeta(SYSTEM_PROGRAM_ID, false),
    ...chunks,
  );

  return {
    programAddress: portal,
    accounts,
    data: concat(
      PORTAL_SOURCE_DISCRIMINATORS.fund,
      intentArgs(intent),
      u8(input.allowPartial === true ? 1 : 0),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// withdraw (the claim) and refund
// ---------------------------------------------------------------------------------------------

/**
 * The Portal's `withdraw` (withdraw.rs): the reward paid to the claimant the prover recorded, once
 * its proof is for this intent's destination and is not a cancellation. Permissionless: anyone may
 * send it, and the tokens go to the claimant's associated token accounts, which must exist (the
 * caller creates them first). The native amount goes to the claimant's account. It then writes the
 * withdrawn marker, so it is paid once, and has the prover close the proof, its rent going back to
 * the HyperProver's payer (`close_proof`, which this passes `pda_payer` for).
 */
export async function buildPortalWithdrawInstruction(input: {
  readonly intent: Intent;
  readonly portal: Address;
  /** Signs; pays the withdrawn marker's rent. */
  readonly payer: SignerOrKey;
  /** The claimant the proof records. */
  readonly claimant: Address;
  readonly tokenPrograms: SvmTokenPrograms;
}): Promise<Instruction> {
  const { intent, portal } = input;
  assertSolanaSource(intent);
  const { intentHash } = hashIntent(intent);
  const prover = svmKeyOf(intent.reward.prover);
  const vault = await svmVaultPda(portal, intentHash);
  const chunks: AccountMeta[] = [];
  for (const { mint } of svmRewardTokens(intent.reward)) {
    const program = programOf(input.tokenPrograms, mint);
    chunks.push(
      plainMeta(await associatedTokenAccount(vault, mint, program), true),
      plainMeta(await associatedTokenAccount(input.claimant, mint, program), true),
      plainMeta(mint, false),
    );
  }

  return {
    programAddress: portal,
    accounts: [
      signerMeta(input.payer, true),
      plainMeta(input.claimant, true),
      plainMeta(vault, true),
      plainMeta(await svmProofPda(prover, intentHash), true),
      plainMeta(await svmProofCloserPda(portal, prover), false),
      plainMeta(prover, false),
      plainMeta(await svmWithdrawnMarkerPda(portal, intentHash), true),
      plainMeta(TOKEN_PROGRAM_ID, false),
      plainMeta(TOKEN_2022_PROGRAM_ID, false),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      ...chunks,
      // What the prover's `close_proof` takes after the closer and the proof: its rent payer.
      plainMeta(await svmHyperPdaPayerPda(prover), true),
    ],
    data: concat(PORTAL_SOURCE_DISCRIMINATORS.withdraw, intentArgs(intent)),
  };
}

/**
 * The Portal's `refund` (refund.rs): everything the vault holds returned to the reward's creator —
 * its lamports, and each token account given drained to the creator's associated token account
 * (which must exist) and closed, its rent to the payer. Permissionless, and allowed once the reward
 * was claimed (its leftovers), once the reward's deadline has passed with no proof for this
 * destination, or at once when the proof is a cancellation's — which `closesProof` must then say,
 * so the prover's `close_proof` is called (and, before the deadline, every reward mint must be
 * swept).
 */
export async function buildPortalRefundInstruction(input: {
  readonly intent: Intent;
  readonly portal: Address;
  /** Signs; is paid the closed token accounts' rent. */
  readonly payer: SignerOrKey;
  /** The reward mints whose vault token account holds something: each is drained and closed. */
  readonly mints: readonly Address[];
  readonly tokenPrograms: SvmTokenPrograms;
  /** A proven cancellation: the prover closes its proof (and is passed what that takes). */
  readonly closesProof: boolean;
}): Promise<Instruction> {
  const { intent, portal } = input;
  assertSolanaSource(intent);
  const { intentHash } = hashIntent(intent);
  const prover = svmKeyOf(intent.reward.prover);
  const creator = svmKeyOf(intent.reward.creator);
  const vault = await svmVaultPda(portal, intentHash);
  const chunks: AccountMeta[] = [];
  for (const mint of input.mints) {
    const program = programOf(input.tokenPrograms, mint);
    chunks.push(
      plainMeta(await associatedTokenAccount(vault, mint, program), true),
      plainMeta(await associatedTokenAccount(creator, mint, program), true),
      plainMeta(mint, false),
    );
  }
  const closer = input.closesProof ? [plainMeta(await svmHyperPdaPayerPda(prover), true)] : [];

  return {
    programAddress: portal,
    accounts: [
      signerMeta(input.payer, true),
      plainMeta(creator, true),
      plainMeta(vault, true),
      plainMeta(await svmProofPda(prover, intentHash), true),
      // Optional accounts, given only where the proof is closed: Anchor reads the program's own id
      // in an optional account's place as "none".
      plainMeta(input.closesProof ? await svmProofCloserPda(portal, prover) : portal, false),
      plainMeta(input.closesProof ? prover : portal, false),
      plainMeta(await svmWithdrawnMarkerPda(portal, intentHash), true),
      plainMeta(TOKEN_PROGRAM_ID, false),
      plainMeta(TOKEN_2022_PROGRAM_ID, false),
      plainMeta(SYSTEM_PROGRAM_ID, false),
      ...chunks,
      ...closer,
    ],
    data: concat(PORTAL_SOURCE_DISCRIMINATORS.refund, intentArgs(intent), u8(closer.length)),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading what Solana recorded
// ---------------------------------------------------------------------------------------------

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean =>
  data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);

/**
 * A proof the reward's prover recorded (eco-svm-std `Proof { destination: u64, claimant: Pubkey }`
 * after the 8-byte discriminator): the chain it was filled on and who it pays, `null` when `data`
 * is not one. A claimant of `SVM_CANCELLED_CLAIMANT`'s bytes is a proven cancellation.
 */
export function decodeSvmProof(
  data: Uint8Array,
): { readonly destination: bigint; readonly claimant: Hex } | null {
  if (data.length < 48 || !startsWith(data, PORTAL_SOURCE_DISCRIMINATORS.proofAccount)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return { destination: view.getBigUint64(8, true), claimant: bytesToHex(data.subarray(16, 48)) };
}

/** The senders a HyperProver takes a proof from (`Config.whitelisted_senders`, 32 bytes each),
 *  `null` when `data` is not its config. */
export function decodeHyperWhitelist(data: Uint8Array): readonly Hex[] | null {
  if (data.length < 12 || !startsWith(data, PORTAL_SOURCE_DISCRIMINATORS.config)) return null;
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(8, true);
  if (data.length < 12 + 32 * count) return null;

  return Array.from({ length: count }, (_, index) =>
    bytesToHex(data.subarray(12 + 32 * index, 44 + 32 * index)),
  );
}

/** One `publish` the Portal ran, from its instruction data: what the intent is made of. */
export interface SvmPublished {
  readonly destination: bigint;
  /** The route as the destination encodes it. */
  readonly route: Hex;
  readonly reward: Reward;
}

/** A `publish` instruction's data decoded, or `null` when `data` is not one. */
export function decodePortalPublish(data: Uint8Array): SvmPublished | null {
  if (data.length < 20 || !startsWith(data, PORTAL_SOURCE_DISCRIMINATORS.publish)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const destination = view.getBigUint64(8, true);
  const length = view.getUint32(16, true);
  if (data.length < 20 + length) return null;
  try {
    return {
      destination,
      route: bytesToHex(data.subarray(20, 20 + length)),
      reward: decodeRewardSvm(bytesToHex(data.subarray(20 + length))),
    };
  } catch {
    return null;
  }
}
