/**
 * The v12 **kitchen** — the Anchor loader that stages bytecode and owns Pots.
 *
 * The engine used to do its own staging (`INIT_BUFFER`, `EXECUTE_AND_CLOSE`). It no longer does:
 * the released engine is a pure interpreter with exactly three instructions (`execute`,
 * `executeFromAccount`, `closeAccount`), and everything else moved here. The two instruction sets
 * do not overlap, so this is a new surface rather than a migration — sending the old staging
 * discriminators to the current engine yields `InvalidInstruction` (`Custom(11)`).
 *
 * Two things a caller should know before reading further:
 *
 * **The engine is named per call, not compiled in.** `cook`, `create_pot` and `close_pot` all take
 * an `engine_program` account. The kitchen validates nothing about it (its own IDL says so): naming
 * an address with no program behind it produces an unusable Pot whose rent is stranded. Choosing
 * the interpreter is the caller's business, exactly as it is on the EVM side.
 *
 * **A Pot is attached UNSIGNED.** `cook` takes no `pot` account of its own — the Pot rides in the
 * caller's tail, and the kitchen signs for it with `invoke_signed` from `["pot", owner, salt]`. A
 * program's manifest therefore marks the slot `writable_signer` (what the PROGRAM needs) while the
 * transaction must attach it unsigned (what the TRANSACTION provides); `resolve.ts`'s per-ref
 * `signer: false` is what expresses that difference.
 */
import { getAddressEncoder, getProgramDerivedAddress, AccountRole } from "@solana/kit";
import type { AccountLookupMeta, AccountMeta, Address, Instruction } from "@solana/kit";

/** One entry of a program's own account tail, in the shape a kit `Instruction` carries. */
export type TailAccount = AccountLookupMeta | AccountMeta;

/** Anchor discriminators, verbatim from the release's `kitchen-idl.json`. */
const DISCRIMINATOR = {
  closeCodeBuffer: new Uint8Array([195, 203, 47, 242, 198, 177, 247, 6]),
  closePot: new Uint8Array([214, 103, 62, 202, 132, 229, 27, 86]),
  cook: new Uint8Array([147, 233, 205, 239, 200, 21, 190, 159]),
  cookFromAccount: new Uint8Array([247, 166, 195, 248, 78, 176, 147, 84]),
  createCodeBuffer: new Uint8Array([94, 72, 190, 83, 17, 60, 103, 35]),
  createPot: new Uint8Array([232, 45, 123, 181, 204, 121, 131, 9]),
  finalizeCodeBuffer: new Uint8Array([191, 246, 136, 59, 56, 1, 0, 48]),
  growCodeBuffer: new Uint8Array([152, 136, 215, 167, 37, 51, 197, 62]),
  writeCodeBuffer: new Uint8Array([205, 152, 182, 5, 148, 70, 20, 25]),
} as const;

/** The kitchen's own `#[constant]`s, from the same IDL. */
export const CODE_BUFFER_SEED = "buffer";
export const CODE_SEED = "code";
export const POT_SEED = "pot";
/** One `grow_code_buffer` step: `MAX_PERMITTED_DATA_INCREASE`, the most a CPI-created account can
 *  grow in a single instruction. IDL-guarded by `engine-wire-drift.test.ts`. */
export const GROWTH_STEP = 10_240;
export const MAX_CODE_LEN = 1_048_576;
export const MAX_POT_LEN = 10_240;

/** A Pot's salt and a code buffer's `expected_sha256` are both exactly 32 bytes. */
export const SALT_BYTES = 32;

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;

export interface KitchenPda {
  address: Address;
  bump: number;
}

function assertLength(value: Uint8Array, bytes: number, what: string): void {
  if (!(value instanceof Uint8Array) || value.length !== bytes) {
    const got = value instanceof Uint8Array ? `${value.length} bytes` : "a non-Uint8Array";
    throw new Error(`${what} must be exactly ${bytes} bytes, got ${got}`);
  }
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);

  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);

  return bytes;
}

/** Borsh `bytes`: a u32 length prefix then the payload. */
function borshBytes(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  out.set(u32(value.length), 0);
  out.set(value, 4);

  return out;
}

/** Borsh `Option<[u8; 32]>`: a 1-byte tag, then the value when present. */
function borshOption32(value: Uint8Array | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array([0]);
  assertLength(value, 32, "an optional 32-byte field");
  const out = new Uint8Array(33);
  out[0] = 1;
  out.set(value, 1);

  return out;
}

function data(discriminator: Uint8Array, ...parts: Uint8Array[]): Uint8Array {
  const total = discriminator.length + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  out.set(discriminator, 0);
  let offset = discriminator.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

// --- PDAs -------------------------------------------------------------------

/**
 * A Pot: `["pot", owner, salt]`. The salt is what lets one owner hold many — it is raw bytes, not a
 * counter, so a caller with a natural 32-byte id (an intent hash, say) passes it directly.
 */
export async function derivePotPda(
  kitchen: Address,
  owner: Address,
  salt: Uint8Array,
): Promise<KitchenPda> {
  assertLength(salt, SALT_BYTES, "a pot salt");
  const [address, bump] = await getProgramDerivedAddress({
    programAddress: kitchen,
    seeds: [POT_SEED, getAddressEncoder().encode(owner), salt],
  });

  return { address, bump };
}

/** A code buffer's metadata account: `["buffer", owner, nonce_le]`. */
export async function deriveCodeBufferPda(
  kitchen: Address,
  owner: Address,
  nonce: bigint,
): Promise<KitchenPda> {
  const [address, bump] = await getProgramDerivedAddress({
    programAddress: kitchen,
    seeds: [CODE_BUFFER_SEED, getAddressEncoder().encode(owner), u64(nonce)],
  });

  return { address, bump };
}

/**
 * The bytes account for a buffer: `["code", code_buffer]`.
 *
 * Seeded on the METADATA account's address, so the pair is bound by derivation and neither needs to
 * store a pointer to the other for the kitchen to validate.
 */
export async function deriveCodePda(kitchen: Address, codeBuffer: Address): Promise<KitchenPda> {
  const [address, bump] = await getProgramDerivedAddress({
    programAddress: kitchen,
    seeds: [CODE_SEED, getAddressEncoder().encode(codeBuffer)],
  });

  return { address, bump };
}

// --- Pot lifecycle ----------------------------------------------------------

export interface CreatePotInput {
  kitchen: Address;
  owner: Address;
  /** Not validated by the kitchen — see this module's header. */
  engineProgram: Address;
  pot: Address;
  salt: Uint8Array;
  /** Bounded by `MAX_POT_LEN`; the kitchen rejects anything larger before allocating. */
  space: number;
}

export function buildCreatePotInstruction({
  kitchen,
  owner,
  engineProgram,
  pot,
  salt,
  space,
}: CreatePotInput): Instruction {
  assertLength(salt, SALT_BYTES, "a pot salt");

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: engineProgram, role: AccountRole.READONLY },
      { address: pot, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data(DISCRIMINATOR.createPot, salt, u32(space)),
  };
}

export interface ClosePotInput {
  kitchen: Address;
  owner: Address;
  engineProgram: Address;
  pot: Address;
  salt: Uint8Array;
}

export function buildClosePotInstruction({
  kitchen,
  owner,
  engineProgram,
  pot,
  salt,
}: ClosePotInput): Instruction {
  assertLength(salt, SALT_BYTES, "a pot salt");

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: engineProgram, role: AccountRole.READONLY },
      { address: pot, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.closePot, salt),
  };
}

// --- cook -------------------------------------------------------------------

export interface CookInput {
  kitchen: Address;
  owner: Address;
  engineProgram: Address;
  /** Identifies the Pot to sign for; the Pot itself rides in `tail`, unsigned. */
  potSalt: Uint8Array;
  bytecode: Uint8Array;
  /** The program's own accounts, at their natural indices after the kitchen's two. */
  tail?: readonly TailAccount[];
}

/**
 * `cook` — stage-free execution: the bytecode travels in the instruction data.
 *
 * **The transaction MUST carry a RequestHeapFrame(`HEAP_FRAME_BYTES`).** The kitchen CPIs into the
 * engine, whose interpreter memory lives in the transaction's heap frame and not in accounts, so
 * without it the ENGINE access-violates before any opcode runs — surfacing from the kitchen as an
 * opaque `ProgramFailedToComplete`. Use `buildHeapFramePrepend()` (`./prepends.js`). Pot and
 * code-buffer lifecycle instructions need no such thing; only the two cooks execute.
 *
 * Note there is no `pot` account here. The kitchen derives it from `pot_salt` and `owner` and signs
 * for it, so a Pot the program touches belongs in `tail` **unsigned**.
 */
export function buildCookInstruction({
  kitchen,
  owner,
  engineProgram,
  potSalt,
  bytecode,
  tail = [],
}: CookInput): Instruction {
  assertLength(potSalt, SALT_BYTES, "a pot salt");

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: engineProgram, role: AccountRole.READONLY },
      ...tail,
    ],
    data: data(DISCRIMINATOR.cook, potSalt, borshBytes(bytecode)),
  };
}

export interface CookFromAccountInput {
  kitchen: Address;
  owner: Address;
  codeBuffer: Address;
  code: Address;
  engineProgram: Address;
  potSalt: Uint8Array;
  /** When given, the kitchen refuses unless the staged bytes hash to it. */
  pin?: Uint8Array;
  tail?: readonly TailAccount[];
}

/**
 * `cook_from_account` — the staged transport: the bytecode is read from a finalized code account.
 *
 * Needs the same RequestHeapFrame as `cook` — see there.
 */
export function buildCookFromAccountInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
  engineProgram,
  potSalt,
  pin,
  tail = [],
}: CookFromAccountInput): Instruction {
  assertLength(potSalt, SALT_BYTES, "a pot salt");

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: codeBuffer, role: AccountRole.READONLY },
      { address: code, role: AccountRole.READONLY },
      { address: engineProgram, role: AccountRole.READONLY },
      ...tail,
    ],
    data: data(DISCRIMINATOR.cookFromAccount, potSalt, borshOption32(pin)),
  };
}

// --- code buffer lifecycle --------------------------------------------------

export interface CodeBufferAccounts {
  kitchen: Address;
  owner: Address;
  codeBuffer: Address;
  code: Address;
}

/**
 * Creates the `codeBuffer` metadata account and its `code` data account, sized for `capacity`.
 *
 * `capacity` must be 1..=`MAX_CODE_LEN`; the kitchen rejects anything else with
 * `CapacityOutOfRange`, and this throws first so the bound is visible without a simulation.
 *
 * **A create allocates at most ONE `GROWTH_STEP`.** The runtime caps how much an account can grow
 * per instruction, so a `capacity` above that is only partly allocated here and needs
 * `Math.ceil(capacity / GROWTH_STEP) - 1` further `buildGrowCodeBufferInstruction` calls before the
 * `code` account is the full size. The cap resets per instruction, so those repeats can share one
 * transaction. Writing before the account is fully grown fails with `WriteOutOfBounds`.
 */
export function buildCreateCodeBufferInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
  nonce,
  capacity,
}: CodeBufferAccounts & { nonce: bigint; capacity: number }): Instruction {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CODE_LEN) {
    throw new Error(
      `a code buffer capacity must be an integer in 1..=${MAX_CODE_LEN}, got ${capacity}`,
    );
  }

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: codeBuffer, role: AccountRole.WRITABLE },
      { address: code, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data(DISCRIMINATOR.createCodeBuffer, u64(nonce), u32(capacity)),
  };
}

/**
 * One growth step. A CPI-created account cannot be allocated more than `GROWTH_STEP` at once, so a
 * larger buffer repeats this — the runtime's limit resets per instruction, so the repeats fit in one
 * transaction.
 */
export function buildGrowCodeBufferInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
}: CodeBufferAccounts): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: codeBuffer, role: AccountRole.READONLY },
      { address: code, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data(DISCRIMINATOR.growCodeBuffer),
  };
}

export function buildWriteCodeBufferInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
  offset,
  chunk,
}: CodeBufferAccounts & { offset: number; chunk: Uint8Array }): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: codeBuffer, role: AccountRole.READONLY },
      { address: code, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.writeCodeBuffer, u32(offset), borshBytes(chunk)),
  };
}

/**
 * Seals the buffer at `len` and pins its digest.
 *
 * The kitchen shrinks the code account to exactly `len` here, which is the security property: the
 * engine executes the account's whole data slice and bounds jumps only by that slice's length, so
 * any byte past `len` would be jump-reachable but outside the hash.
 */
export function buildFinalizeCodeBufferInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
  len,
  expectedSha256,
}: CodeBufferAccounts & { len: number; expectedSha256: Uint8Array }): Instruction {
  assertLength(expectedSha256, 32, "expectedSha256");

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: codeBuffer, role: AccountRole.WRITABLE },
      { address: code, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.finalizeCodeBuffer, u32(len), expectedSha256),
  };
}

/** Closes both accounts and refunds their rent. `expectedSha256` gates the close on the staged bytes. */
export function buildCloseCodeBufferInstruction({
  kitchen,
  owner,
  codeBuffer,
  code,
  expectedSha256,
}: CodeBufferAccounts & { expectedSha256?: Uint8Array }): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: codeBuffer, role: AccountRole.WRITABLE },
      { address: code, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.closeCodeBuffer, borshOption32(expectedSha256)),
  };
}
