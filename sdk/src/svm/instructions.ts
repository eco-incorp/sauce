import { createHash } from "node:crypto";

import { AccountRole } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  BUFFER_HEADER_BYTES,
  BUFFER_SEED_BYTES,
  BUFFER_WRITE_CHUNK_BYTES,
  CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
  CLOSE_BUFFER_DISCRIMINATOR,
  EXECUTE_AND_CLOSE_DISCRIMINATOR,
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FLAG_HAS_PIN,
  EXECUTE_FLAG_HAS_SLICE,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  FINALIZE_BUFFER_DISCRIMINATOR,
  INIT_BUFFER_DISCRIMINATOR,
  MAX_BUFFER_CAPACITY,
  PDA_GROWTH_STEP,
  WRITE_BUFFER_DISCRIMINATOR,
} from "./engine.js";
import type { ResolvedAccountMeta } from "./resolve.js";

function assertSeed(seed: Uint8Array, name: string): void {
  if (!(seed instanceof Uint8Array) || seed.length !== BUFFER_SEED_BYTES) {
    const got = seed instanceof Uint8Array ? `${seed.length} bytes` : "a non-Uint8Array";
    throw new Error(`${name} must be exactly ${BUFFER_SEED_BYTES} bytes, got ${got}`);
  }
}

function assertU32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be a u32 (0-4294967295), got ${value}`);
  }
}

function u32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);

  return bytes;
}

function concatBytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

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

/**
 * Explicit bytecode extent within a FOREIGN account: run `data[offset..offset+len]`.
 * Only meaningful on the foreign path (an account the engine does not own / cannot
 * parse as a buffer header) — it lets a consumer hold bytecode in its own program's
 * accounts without a storage program. For a MANAGED buffer the engine derives the
 * extent from the header, and accepts an explicit slice ONLY if it equals
 * `(BUFFER_HEADER_BYTES, header.len)`; omit it for managed buffers.
 */
export interface ExecuteBytecodeSlice {
  offset: number;
  len: number;
}

/**
 * Encodes the shared execute_from_account / execute_and_close payload grammar:
 * `[flags: u8][pin: 32B iff 0x01][offset: u32 LE ++ len: u32 LE iff 0x02][args…]`.
 * The flags byte is REQUIRED — an empty payload is InvalidInstruction — so the
 * minimal pinless, sliceless, argless payload is `[0x00]`.
 */
function encodeExecutePayload(
  expectedSha256: Uint8Array | undefined,
  slice: ExecuteBytecodeSlice | undefined,
  args: Uint8Array | undefined,
): Uint8Array {
  if (expectedSha256 !== undefined && expectedSha256.length !== 32) {
    throw new Error(`expectedSha256 must be exactly 32 bytes, got ${expectedSha256.length}`);
  }
  if (slice !== undefined) {
    assertU32(slice.offset, "slice offset");
    assertU32(slice.len, "slice len");
  }

  let flags = 0x00;
  if (expectedSha256 !== undefined) flags |= EXECUTE_FLAG_HAS_PIN;
  if (slice !== undefined) flags |= EXECUTE_FLAG_HAS_SLICE;

  return concatBytes(
    [flags],
    expectedSha256 ?? new Uint8Array(0),
    // Order matters: pin precedes the slice, both precede args (engine grammar).
    slice === undefined ? new Uint8Array(0) : concatBytes(u32Le(slice.offset), u32Le(slice.len)),
    args ?? new Uint8Array(0),
  );
}

export interface ExecuteFromAccountInstructionInput {
  programId: Address;
  /** The bytecode account — listed FIRST and read-only. A finalized engine buffer (managed) or any other account (foreign). */
  buffer: Address;
  accounts: readonly ResolvedAccountMeta[];
  /**
   * Optional 32-byte content-hash pin (managed path): must equal the buffer's
   * stored content_sha256 or the engine rejects (BufferHashMismatch). The only
   * cross-lifecycle trust anchor — always pass it for buffers this process did
   * not stage itself. On the FOREIGN path a pin is InvalidInstruction (no stored
   * hash to compare), so pass a slice instead, not a pin.
   */
  expectedSha256?: Uint8Array;
  /**
   * Optional explicit bytecode extent for the FOREIGN path (see ExecuteBytecodeSlice).
   * Omit for a managed engine buffer.
   */
  slice?: ExecuteBytecodeSlice;
  /**
   * Per-execution payload args (already encoded — encodePayloadArgs), appended
   * after the flags byte, optional pin, and optional slice. Surfaces to the
   * bytecode through CALLDATA as the composite `buffer bytecode ++ args`.
   */
  args?: Uint8Array;
}

/**
 * Builds the staged/foreign execute instruction. Account order is
 * [code (read-only), ...user] — the code account rides FIRST so the user tail
 * (and every account index baked into compiled bytecode) is byte-identical to
 * inline execute's list. The engine dispatches on the ACCOUNT (engine-owned +
 * header-parseable ⇒ managed; anything else ⇒ foreign), never on a payload flag.
 */
export function buildExecuteFromAccountInstruction({
  programId,
  buffer,
  accounts,
  expectedSha256,
  slice,
  args,
}: ExecuteFromAccountInstructionInput): Instruction {
  return {
    programAddress: programId,
    accounts: [{ address: buffer, role: AccountRole.READONLY }, ...accounts],
    data: withDiscriminator(
      EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
      encodeExecutePayload(expectedSha256, slice, args),
    ),
  };
}

export interface ExecuteAndCloseInstructionInput {
  programId: Address;
  /** The managed engine buffer to run then reap — listed FIRST and WRITABLE (it gets resized to 0). */
  buffer: Address;
  /**
   * The user account tail. It MUST include the buffer's authority as a
   * signer+writable account (it receives the rent refund); the engine finds it
   * by key match, not by position. Managed-only — a foreign account rejects.
   */
  accounts: readonly ResolvedAccountMeta[];
  /** Optional 32-byte content-hash pin — gates the execute AND the close together (TOCTOU-free). */
  expectedSha256?: Uint8Array;
  args?: Uint8Array;
}

/**
 * Builds execute_and_close: run a managed buffer and reap it (drain rent to the
 * authority, resize to 0, reassign to system) in ONE atomic instruction. Use this
 * instead of an execute_from_account + close_buffer pair: the execute needs the
 * buffer read-only and the close needs it writable, and account writability is a
 * transaction-level property — so the pair can never share a transaction. The
 * fixed prefix stays ONE account (buffer), so baked account indices agree with
 * execute_from_account. No slice: managed only.
 */
export function buildExecuteAndCloseInstruction({
  programId,
  buffer,
  accounts,
  expectedSha256,
  args,
}: ExecuteAndCloseInstructionInput): Instruction {
  return {
    programAddress: programId,
    accounts: [{ address: buffer, role: AccountRole.WRITABLE }, ...accounts],
    data: withDiscriminator(
      EXECUTE_AND_CLOSE_DISCRIMINATOR,
      encodeExecutePayload(expectedSha256, undefined, args),
    ),
  };
}

// ── bytecode buffer lifecycle ──

export interface InitBufferInstructionsInput {
  programId: Address;
  /** Pays rent and becomes the buffer AUTHORITY (only key allowed to write/finalize/grow/close). */
  payer: Address;
  buffer: Address;
  /**
   * The 32-byte PDA seed (must match the one `deriveBufferPda` derived `buffer`
   * from). Stored in the header, so the address stays re-derivable from the
   * account alone. A caller with a natural 32-byte id (e.g. an intent hash) uses
   * it directly; a shorter id is the caller's to hash.
   */
  seed: Uint8Array;
  /** Bytecode capacity in bytes (≤ 65,535); account size = BUFFER_HEADER_BYTES + capacity. */
  capacity: number;
  /** Current account data length (0 = not created); emits only the missing growth steps. */
  currentBytes?: number;
}

/**
 * Builds the create-then-grow init sequence for a bytecode buffer. Capacity
 * ≤ ~10,128 is one instruction; a 16 KB buffer is 2 — all packable into one
 * transaction. Payload is `seed[32] ++ capacity u32 LE` (exactly 36 bytes) on
 * every step (the engine grows toward BUFFER_HEADER_BYTES + capacity per
 * invocation; at/above target is a no-op). The seed is fixed across steps — the
 * engine records it once at create and rejects a mismatch thereafter.
 */
export function buildInitBufferInstructions({
  programId,
  payer,
  buffer,
  seed,
  capacity,
  currentBytes = 0,
}: InitBufferInstructionsInput): Instruction[] {
  assertSeed(seed, "buffer seed");

  if (!Number.isInteger(capacity) || capacity <= 0 || capacity > MAX_BUFFER_CAPACITY) {
    throw new Error(`buffer capacity must be 1-${MAX_BUFFER_CAPACITY} bytes, got ${capacity}`);
  }

  const targetBytes = BUFFER_HEADER_BYTES + capacity;
  const steps = Math.ceil(Math.max(0, targetBytes - currentBytes) / PDA_GROWTH_STEP);

  // Fresh objects per step, with fresh data arrays, so mutating one returned
  // instruction cannot corrupt the others.
  return Array.from({ length: steps }, (): Instruction => ({
    programAddress: programId,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: buffer, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: withDiscriminator(INIT_BUFFER_DISCRIMINATOR, seed, u32Le(capacity)),
  }));
}

export interface WriteBufferInstructionInput {
  programId: Address;
  authority: Address;
  buffer: Address;
  /** Byte offset into the bytecode region (not the account) — chunks may land in any order. */
  offset: number;
  chunk: Uint8Array;
}

export function buildWriteBufferInstruction({
  programId,
  authority,
  buffer,
  offset,
  chunk,
}: WriteBufferInstructionInput): Instruction {
  return {
    programAddress: programId,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: buffer, role: AccountRole.WRITABLE },
    ],
    data: withDiscriminator(WRITE_BUFFER_DISCRIMINATOR, u32Le(offset), chunk),
  };
}

/**
 * sha256 of the bytecode — the content hash `finalize_buffer` pins and `execute` may verify. Lives
 * beside the builders that take it so every producer of a pin (kit, web3.js, route compile) shares one
 * implementation. Sync (node:crypto); the kit client hashes the same bytes via async WebCrypto.
 */
export function bytecodeSha256(bytecode: Uint8Array): Uint8Array {
  return createHash("sha256").update(bytecode).digest();
}

export interface FinalizeBufferInstructionInput {
  programId: Address;
  authority: Address;
  buffer: Address;
  /** The exact bytecode length — the engine hashes data[80..80+length] on-chain. */
  length: number;
  /** sha256 of the bytecode; a mismatch (straggler write, hole) fails loudly, state unchanged. */
  sha256: Uint8Array;
}

export function buildFinalizeBufferInstruction({
  programId,
  authority,
  buffer,
  length,
  sha256,
}: FinalizeBufferInstructionInput): Instruction {
  if (sha256.length !== 32)
    throw new Error(`sha256 must be exactly 32 bytes, got ${sha256.length}`);

  return {
    programAddress: programId,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: buffer, role: AccountRole.WRITABLE },
    ],
    data: withDiscriminator(FINALIZE_BUFFER_DISCRIMINATOR, u32Le(length), sha256),
  };
}

export interface CloseBufferInstructionInput {
  programId: Address;
  /** Receives the drained rent; must sign. Finalized buffers close too (the recompile path). */
  authority: Address;
  buffer: Address;
}

export function buildCloseBufferInstruction({
  programId,
  authority,
  buffer,
}: CloseBufferInstructionInput): Instruction {
  return {
    programAddress: programId,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: buffer, role: AccountRole.WRITABLE },
    ],
    data: CLOSE_BUFFER_DISCRIMINATOR.slice(),
  };
}

export interface CloseBufferCheckedInstructionInput {
  programId: Address;
  /** Receives the drained rent; must sign. */
  authority: Address;
  buffer: Address;
  /**
   * 32-byte content-hash pin — the close proceeds only if it equals the buffer's
   * stored content_sha256. TOCTOU-free: guards against closing a buffer that was
   * closed and re-init'd to different bytecode at the same address since you read it.
   */
  expectedSha256: Uint8Array;
}

/** Builds close_buffer_checked — close only if the content hash still matches. */
export function buildCloseBufferCheckedInstruction({
  programId,
  authority,
  buffer,
  expectedSha256,
}: CloseBufferCheckedInstructionInput): Instruction {
  if (expectedSha256.length !== 32)
    throw new Error(`expectedSha256 must be exactly 32 bytes, got ${expectedSha256.length}`);

  return {
    programAddress: programId,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: buffer, role: AccountRole.WRITABLE },
    ],
    data: withDiscriminator(CLOSE_BUFFER_CHECKED_DISCRIMINATOR, expectedSha256),
  };
}

// ── staging plan ──

export interface StagingChunk {
  offset: number;
  length: number;
}

export interface StagingPlan {
  /** Buffer capacity to init (= the bytecode length). */
  capacity: number;
  /** init_buffer invocations to reach 80 + capacity (all fit one transaction). */
  initInstructionCount: number;
  /** write_buffer chunk schedule — one transaction per chunk. */
  chunks: StagingChunk[];
  /**
   * End-to-end transactions: 1 init tx + one per chunk + a DEDICATED finalize
   * tx (sent only after every write confirmed — landing order across
   * concurrently broadcast txs is not guaranteed; the on-chain hash gate is
   * the backstop) + the execute tx. 8/12/20 for 4/8/16 KB at the 1,000-byte chunk.
   */
  transactions: { init: number; writes: number; finalize: number; execute: number; total: number };
}

/** Mirrors the engine's staging protocol batching (spec §2.5/§6.3). */
export function buildStagingPlan(
  bytecodeLength: number,
  chunkBytes: number = BUFFER_WRITE_CHUNK_BYTES,
): StagingPlan {
  if (
    !Number.isInteger(bytecodeLength) ||
    bytecodeLength <= 0 ||
    bytecodeLength > MAX_BUFFER_CAPACITY
  ) {
    throw new Error(
      `bytecode length must be 1-${MAX_BUFFER_CAPACITY} bytes, got ${bytecodeLength}`,
    );
  }

  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error(`chunk size must be a positive integer, got ${chunkBytes}`);
  }

  const chunks: StagingChunk[] = [];
  for (let offset = 0; offset < bytecodeLength; offset += chunkBytes) {
    chunks.push({ offset, length: Math.min(chunkBytes, bytecodeLength - offset) });
  }

  const initInstructionCount = Math.ceil((BUFFER_HEADER_BYTES + bytecodeLength) / PDA_GROWTH_STEP);

  return {
    capacity: bytecodeLength,
    initInstructionCount,
    chunks,
    transactions: {
      init: 1,
      writes: chunks.length,
      finalize: 1,
      execute: 1,
      total: 1 + chunks.length + 2,
    },
  };
}
