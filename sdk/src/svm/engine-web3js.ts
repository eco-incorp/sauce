// @eco-incorp/sauce-sdk/svm/engine/web3js — a web3.js v1 (legacy) view of the Sauce SVM
// engine instruction builders.
//
// The core SDK emits @solana/kit (v2) `Instruction` objects
// ({ programAddress, accounts: [{ address, role }], data: Uint8Array }). Consumers still on
// @solana/web3.js v1 (`TransactionInstruction`, `PublicKey`) would otherwise wrap every builder
// themselves. This subpath does it once: each builder accepts and returns web3.js v1 types, and
// `toWeb3JsInstruction` converts a single kit instruction.
//
// @solana/web3.js is an OPTIONAL peer dependency — only consumers importing THIS subpath need it.
// Kit-only consumers are unaffected: this module is NOT re-exported from `engine-public.ts`, so its
// fs-free invariant is preserved. This module is itself CJS-require-safe (no `import.meta` /
// `__dirname`), so it loads under ts-jest / babel-jest CommonJS transforms.

import { AccountRole, isSignerRole, isWritableRole } from '@solana/kit';
import type { Address, Instruction } from '@solana/kit';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import { BUFFER_SEED, BUFFER_SEED_BYTES } from './engine.js';
import {
  buildCloseBufferCheckedInstruction as kitBuildCloseBufferChecked,
  buildCloseBufferInstruction as kitBuildCloseBuffer,
  buildExecuteAndCloseInstruction as kitBuildExecuteAndClose,
  buildExecuteFromAccountInstruction as kitBuildExecuteFromAccount,
  buildExecuteInstruction as kitBuildExecute,
  buildFinalizeBufferInstruction as kitBuildFinalizeBuffer,
  buildInitBufferInstructions as kitBuildInitBuffer,
  buildStagingPlan,
  buildWriteBufferInstruction as kitBuildWriteBuffer,
} from './instructions.js';

// Plan builder carries no instructions to convert — re-export it verbatim for one-import ergonomics.
export { buildStagingPlan };

// The content-hash helper web3.js consumers need for `buildFinalizeBufferInstruction`'s `sha256`
// argument. It lives in `instructions.js` (no web3.js dependency) so every pin producer shares one
// implementation; re-exported here so this subpath stays a one-import surface.
export { bytecodeSha256 } from './instructions.js';

/** web3.js v1 account meta — the shape `TransactionInstruction.keys` uses. */
export interface Web3JsAccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

const toAddress = (pubkey: PublicKey): Address => pubkey.toBase58() as Address;

const toRole = (isSigner: boolean, isWritable: boolean): AccountRole =>
  isWritable
    ? isSigner
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.WRITABLE
    : isSigner
      ? AccountRole.READONLY_SIGNER
      : AccountRole.READONLY;

const toResolvedMetas = (accounts: readonly Web3JsAccountMeta[]) =>
  accounts.map((a) => ({ address: toAddress(a.pubkey), role: toRole(a.isSigner, a.isWritable) }));

/**
 * Convert one kit `Instruction` to a web3.js v1 `TransactionInstruction`. Role decoding uses
 * kit's own `isSignerRole` / `isWritableRole`, so it tracks kit's `AccountRole` encoding rather
 * than assuming a bit layout. Byte-preserving: `data` is copied verbatim into a Buffer.
 */
export function toWeb3JsInstruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: isSignerRole(a.role),
      isWritable: isWritableRole(a.role),
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

export function buildInitBufferInstructions(params: {
  programId: PublicKey;
  payer: PublicKey;
  buffer: PublicKey;
  seed: Uint8Array;
  capacity: number;
  currentBytes?: number;
}): TransactionInstruction[] {
  return kitBuildInitBuffer({
    programId: toAddress(params.programId),
    payer: toAddress(params.payer),
    buffer: toAddress(params.buffer),
    seed: params.seed,
    capacity: params.capacity,
    currentBytes: params.currentBytes,
  }).map(toWeb3JsInstruction);
}

export function buildWriteBufferInstruction(params: {
  programId: PublicKey;
  authority: PublicKey;
  buffer: PublicKey;
  offset: number;
  chunk: Uint8Array;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildWriteBuffer({
      programId: toAddress(params.programId),
      authority: toAddress(params.authority),
      buffer: toAddress(params.buffer),
      offset: params.offset,
      chunk: params.chunk,
    }),
  );
}

export function buildFinalizeBufferInstruction(params: {
  programId: PublicKey;
  authority: PublicKey;
  buffer: PublicKey;
  length: number;
  sha256: Uint8Array;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildFinalizeBuffer({
      programId: toAddress(params.programId),
      authority: toAddress(params.authority),
      buffer: toAddress(params.buffer),
      length: params.length,
      sha256: params.sha256,
    }),
  );
}

export function buildCloseBufferInstruction(params: {
  programId: PublicKey;
  authority: PublicKey;
  buffer: PublicKey;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildCloseBuffer({
      programId: toAddress(params.programId),
      authority: toAddress(params.authority),
      buffer: toAddress(params.buffer),
    }),
  );
}

export function buildCloseBufferCheckedInstruction(params: {
  programId: PublicKey;
  authority: PublicKey;
  buffer: PublicKey;
  expectedSha256: Uint8Array;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildCloseBufferChecked({
      programId: toAddress(params.programId),
      authority: toAddress(params.authority),
      buffer: toAddress(params.buffer),
      expectedSha256: params.expectedSha256,
    }),
  );
}

export function buildExecuteInstruction(params: {
  programId: PublicKey;
  bytecode: Uint8Array;
  accounts: readonly Web3JsAccountMeta[];
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildExecute({
      programId: toAddress(params.programId),
      bytecode: params.bytecode,
      accounts: toResolvedMetas(params.accounts),
    }),
  );
}

export function buildExecuteFromAccountInstruction(params: {
  programId: PublicKey;
  buffer: PublicKey;
  accounts: readonly Web3JsAccountMeta[];
  expectedSha256?: Uint8Array;
  slice?: { offset: number; len: number };
  args?: Uint8Array;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildExecuteFromAccount({
      programId: toAddress(params.programId),
      buffer: toAddress(params.buffer),
      accounts: toResolvedMetas(params.accounts),
      expectedSha256: params.expectedSha256,
      slice: params.slice,
      args: params.args,
    }),
  );
}

export function buildExecuteAndCloseInstruction(params: {
  programId: PublicKey;
  buffer: PublicKey;
  accounts: readonly Web3JsAccountMeta[];
  expectedSha256?: Uint8Array;
  args?: Uint8Array;
}): TransactionInstruction {
  return toWeb3JsInstruction(
    kitBuildExecuteAndClose({
      programId: toAddress(params.programId),
      buffer: toAddress(params.buffer),
      accounts: toResolvedMetas(params.accounts),
      expectedSha256: params.expectedSha256,
      args: params.args,
    }),
  );
}

/**
 * Derive a bytecode buffer PDA — the sync web3.js twin of the SDK's async kit `deriveBufferPda`
 * (`./pda.ts`). Same seed scheme `["buffer", authority, seed[32]]`, so it yields the identical
 * address; provided here because web3.js consumers stage synchronously.
 */
export function deriveBufferPda(
  programId: PublicKey,
  authority: PublicKey,
  seed: Uint8Array,
): PublicKey {
  if (!(seed instanceof Uint8Array) || seed.length !== BUFFER_SEED_BYTES) {
    const got = seed instanceof Uint8Array ? `${seed.length} bytes` : 'a non-Uint8Array';
    throw new Error(`buffer seed must be exactly ${BUFFER_SEED_BYTES} bytes, got ${got}`);
  }

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(BUFFER_SEED, 'utf8'), authority.toBuffer(), Buffer.from(seed)],
    programId,
  );

  return pda;
}

