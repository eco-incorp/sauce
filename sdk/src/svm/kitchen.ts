/**
 * The v12 **kitchen** — the Anchor loader that stages bytecode and owns Pots.
 *
 * The engine used to do its own staging (`INIT_BUFFER`, `EXECUTE_AND_CLOSE`). It no longer does:
 * code buffers and Pots belong here. Engine 1.1.0 adds direct paid cooks but no staging
 * instructions. Sending the old staging discriminators to the current engine yields
 * `InvalidInstruction` (`Custom(11)`).
 *
 * Two things a caller should know before reading further:
 *
 * **The engine is named per call, not compiled in.** `cook`, `create_pot` and `close_pot` all take
 * an `engine_program` account. The kitchen validates nothing about it (its own IDL says so): naming
 * an address with no program behind it produces an unusable Pot whose rent is stranded. Choosing
 * the interpreter is the caller's business, exactly as it is on the EVM side.
 *
 * **A Pot is named AND attached, and it is attached UNSIGNED.** Both cooks take a readonly `pot`
 * account whose `seeds` constraint validates the address; the kitchen then signs for it with
 * `invoke_signed` from `["pot", owner, salt]`. A program that writes Pot storage attaches the Pot a
 * SECOND time in the caller's tail, writable — the named slot proves which Pot, the tail slot is
 * where the program addresses it. A program's manifest marks that tail slot `writable_signer` (what
 * the PROGRAM needs) while the transaction attaches it unsigned (what the TRANSACTION provides);
 * `resolve.ts`'s per-ref `signer: false` is what expresses that difference.
 *
 * **Every cook pays an execution fee**, quoted from the canonical `["execution_fee"]` config PDA and
 * capped by the caller's signed `maxExecutionFee`. The three fee accounts sit after `pot` and never
 * enter the engine's account list, so bytecode indices and `MSG_SENDER` keep their meanings. A zero
 * configured fee performs no transfer at all; the config must still exist and be writable, because
 * an absent one is a failure rather than a free cook.
 *
 * The same config prices the engine's DIRECT cooks (`buildCookAndPayInstruction` and the staged
 * pair, in `instructions.ts`): the engine reads this account itself, re-derived against the Kitchen
 * id it bakes in, and pays the fee into it. One fee and one treasury, whichever way a program runs;
 * `fetchExecutionFee` reads it for either.
 */
import { getAddressEncoder, getBase64Encoder, AccountRole } from "@solana/kit";
import type {
  AccountLookupMeta,
  AccountMeta,
  Address,
  GetAccountInfoApi,
  Instruction,
  Rpc,
} from "@solana/kit";

import {
  memoizedFindProgramAddressSync,
  memoizedGetProgramDerivedAddressWithBump,
} from "./venues/pda-memo.js";
import { assertEngineRunsCompiler } from "../deployments/releases.js";

/** One entry of a program's own account tail, in the shape a kit `Instruction` carries. */
export type TailAccount = AccountLookupMeta | AccountMeta;

/** Anchor discriminators, verbatim from the release's `kitchen-idl.json`. */
const DISCRIMINATOR = {
  closeCodeBuffer: new Uint8Array([195, 203, 47, 242, 198, 177, 247, 6]),
  closePot: new Uint8Array([214, 103, 62, 202, 132, 229, 27, 86]),
  cook: new Uint8Array([51, 57, 168, 9, 240, 151, 154, 1]),
  cookFromAccount: new Uint8Array([241, 24, 247, 35, 76, 46, 240, 209]),
  createCodeBuffer: new Uint8Array([94, 72, 190, 83, 17, 60, 103, 35]),
  createPot: new Uint8Array([232, 45, 123, 181, 204, 121, 131, 9]),
  finalizeCodeBuffer: new Uint8Array([191, 246, 136, 59, 56, 1, 0, 48]),
  growCodeBuffer: new Uint8Array([152, 136, 215, 167, 37, 51, 197, 62]),
  initializeExecutionFee: new Uint8Array([68, 234, 94, 137, 217, 86, 56, 118]),
  setExecutionFee: new Uint8Array([118, 2, 66, 35, 4, 211, 24, 114]),
  withdrawExecutionFees: new Uint8Array([231, 223, 184, 186, 204, 49, 248, 119]),
  writeCodeBuffer: new Uint8Array([205, 152, 182, 5, 148, 70, 20, 25]),
} as const;

/** Each Kitchen instruction's discriminator, by name: what tells an instruction read back what it is. */
export const KITCHEN_DISCRIMINATORS: Readonly<Record<keyof typeof DISCRIMINATOR, Uint8Array>> =
  DISCRIMINATOR;

/** The kitchen's own `#[constant]`s, from the same IDL. */
export const CODE_BUFFER_SEED = "buffer";
export const CODE_SEED = "code";
export const POT_SEED = "pot";
export const EXECUTION_FEE_SEED = "execution_fee";
/** One `grow_code_buffer` step: `MAX_PERMITTED_DATA_INCREASE`, the most a CPI-created account can
 *  grow in a single instruction. IDL-guarded by `engine-wire-drift.test.ts`. */
export const GROWTH_STEP = 10_240;
export const MAX_CODE_LEN = 1_048_576;
export const MAX_POT_LEN = 10_240;

/** Rent-exempt lamports for an account of `bytes` of data, at mainnet's rent: 3,480 lamports per
 *  byte-year, two years, over the data and the 128 bytes every account carries. */
export const svmRentExempt = (bytes: number): bigint => BigInt(128 + bytes) * 6_960n;

/** A Pot's salt and a code buffer's `expected_sha256` are both exactly 32 bytes. */
export const SALT_BYTES = 32;

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
/** The loader that owns every upgradeable program's `ProgramData`, which is where the fee
 *  instructions read the kitchen's live upgrade authority from. */
export const BPF_LOADER_UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;

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

/** Borsh `Option<u64>`: a 1-byte tag, then a little-endian u64 when present. */
function borshOptionU64(value: bigint | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array([0]);
  const out = new Uint8Array(9);
  out[0] = 1;
  out.set(u64(value), 1);

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
 * counter, so a caller with a natural 32-byte id (a hash, say) passes it directly.
 */
export async function derivePotPda(
  kitchen: Address,
  owner: Address,
  salt: Uint8Array,
): Promise<KitchenPda> {
  assertLength(salt, SALT_BYTES, "a pot salt");
  const [address, bump] = await memoizedGetProgramDerivedAddressWithBump(kitchen, [
    utf8(POT_SEED),
    getAddressEncoder().encode(owner),
    salt,
  ]);

  return { address, bump };
}

/**
 * The execution-fee config: `["execution_fee"]`, one per kitchen.
 *
 * It is both the fee's source of truth and the treasury the fees accumulate in, so every cook takes
 * it writable even when the configured fee is zero.
 */
export async function deriveExecutionFeeConfigPda(kitchen: Address): Promise<KitchenPda> {
  const [address, bump] = await memoizedGetProgramDerivedAddressWithBump(kitchen, [
    utf8(EXECUTION_FEE_SEED),
  ]);

  return { address, bump };
}

/**
 * The Anchor account discriminator of `ExecutionFeeConfig`, `sha256("account:ExecutionFeeConfig")
 * [..8]` — the release IDL's own, which `engine-wire-drift.test.ts` asserts, and the bytes the
 * engine's direct cooks check before trusting the account.
 */
export const EXECUTION_FEE_CONFIG_DISCRIMINATOR = new Uint8Array([
  60, 73, 184, 44, 4, 104, 241, 138,
]);

/**
 * The fee in an `ExecutionFeeConfig` account's data: 8 discriminator bytes, then the fee as a u64
 * LE — exactly 16 bytes, the length the engine requires too. Anything else throws: a lookalike
 * account is not a fee of zero.
 */
export function decodeExecutionFeeConfig(data: Uint8Array): bigint {
  if (
    data.length !== 16 ||
    !EXECUTION_FEE_CONFIG_DISCRIMINATOR.every((byte, index) => data[index] === byte)
  ) {
    throw new Error(
      `not a Kitchen ExecutionFeeConfig: expected 16 bytes starting with its discriminator, got ${data.length} bytes`,
    );
  }

  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(8, true);
}

/**
 * The Kitchen's execution fee in lamports, read from its `["execution_fee"]` config — what a cook
 * through the Kitchen and a direct engine cook both pay. Throws when the config is absent, is not
 * owned by `kitchen`, or does not decode: every cook is refused on chain then, so there is no fee to
 * report.
 */
export async function fetchExecutionFee(
  rpc: Rpc<GetAccountInfoApi>,
  kitchen: Address,
): Promise<bigint> {
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const { value } = await rpc.getAccountInfo(feeConfig, { encoding: "base64" }).send();
  if (value === null) {
    throw new Error(
      `the Kitchen ${kitchen} has no execution-fee config (${feeConfig}) on this cluster, so every ` +
        "cook there is refused: is the Kitchen deployed and initialized?",
    );
  }
  if (value.owner !== kitchen) {
    throw new Error(
      `the execution-fee config ${feeConfig} is owned by ${value.owner}, not the Kitchen ${kitchen}`,
    );
  }

  return decodeExecutionFeeConfig(new Uint8Array(getBase64Encoder().encode(value.data[0])));
}

/**
 * A program's `ProgramData` under the upgradeable loader: `[program]`.
 *
 * The fee instructions authorize against the authority recorded there rather than a stored admin
 * key, so whoever can upgrade the kitchen is whoever can price it.
 */
export async function deriveProgramDataPda(program: Address): Promise<KitchenPda> {
  const [address, bump] = await memoizedGetProgramDerivedAddressWithBump(BPF_LOADER_UPGRADEABLE, [
    getAddressEncoder().encode(program),
  ]);

  return { address, bump };
}

/** A code buffer's metadata account: `["buffer", owner, nonce_le]`. */
export async function deriveCodeBufferPda(
  kitchen: Address,
  owner: Address,
  nonce: bigint,
): Promise<KitchenPda> {
  const [address, bump] = await memoizedGetProgramDerivedAddressWithBump(kitchen, [
    utf8(CODE_BUFFER_SEED),
    getAddressEncoder().encode(owner),
    u64(nonce),
  ]);

  return { address, bump };
}

/**
 * The bytes account for a buffer: `["code", code_buffer]`.
 *
 * Seeded on the METADATA account's address, so the pair is bound by derivation and neither needs to
 * store a pointer to the other for the kitchen to validate.
 */
export async function deriveCodePda(kitchen: Address, codeBuffer: Address): Promise<KitchenPda> {
  const [address, bump] = await memoizedGetProgramDerivedAddressWithBump(kitchen, [
    utf8(CODE_SEED),
    getAddressEncoder().encode(codeBuffer),
  ]);

  return { address, bump };
}

/** Seeds reach the memo as bytes only (no string/byte aliasing); kit encodes a string seed as UTF-8. */
const utf8 = (seed: string): Uint8Array => new TextEncoder().encode(seed);

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

/** The `ExecutionFee` group both cooks carry, flattened in the order Anchor declares it. */
function executionFeeAccounts(feeConfig: Address, feePayer: Address): AccountMeta[] {
  return [
    { address: feeConfig, role: AccountRole.WRITABLE },
    { address: feePayer, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ];
}

/** The canonical bump shares the memo populated by `derivePotPda`, keeping builders synchronous. */
function potBump(kitchen: Address, owner: Address, salt: Uint8Array): Uint8Array {
  const [, bump] = memoizedFindProgramAddressSync(kitchen, [
    utf8(POT_SEED),
    getAddressEncoder().encode(owner),
    salt,
  ]);

  return new Uint8Array([bump]);
}

// --- cook -------------------------------------------------------------------

export interface CookInput {
  kitchen: Address;
  owner: Address;
  engineProgram: Address;
  /** Identifies the Pot to sign for. A program that writes Pot storage attaches it again in `tail`,
   *  writable and unsigned. */
  potSalt: Uint8Array;
  /** `derivePotPda(kitchen, owner, potSalt).address`. The canonical bump is derived internally
   *  through the same memo, without making the instruction builder asynchronous. */
  pot: Address;
  /** `deriveExecutionFeeConfigPda(kitchen)`. */
  feeConfig: Address;
  bytecode: Uint8Array;
  /** What the caller consents to pay. The cook is refused if the live fee exceeds it, so a quote
   *  that went stale upward fails closed rather than overcharging. */
  maxExecutionFee: bigint;
  /** Who pays it. Defaults to `owner`; a sponsor here does not change `MSG_SENDER`. */
  feePayer?: Address;
  /** The program's own accounts, at their natural indices after the kitchen's named ones. */
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
 * The named readonly `pot` is validated using `potSalt` and its canonical bump (derived here).
 * A Pot the program writes also belongs in `tail` **unsigned**.
 */
export function buildCookInstruction({
  kitchen,
  owner,
  engineProgram,
  potSalt,
  pot,
  feeConfig,
  bytecode,
  maxExecutionFee,
  feePayer = owner,
  tail = [],
}: CookInput): Instruction {
  assertLength(potSalt, SALT_BYTES, "a pot salt");
  assertEngineRunsCompiler("svm", engineProgram);

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: engineProgram, role: AccountRole.READONLY },
      { address: pot, role: AccountRole.READONLY },
      ...executionFeeAccounts(feeConfig, feePayer),
      ...tail,
    ],
    data: data(
      DISCRIMINATOR.cook,
      potSalt,
      potBump(kitchen, owner, potSalt),
      borshBytes(bytecode),
      u64(maxExecutionFee),
    ),
  };
}

export interface CookFromAccountInput {
  kitchen: Address;
  owner: Address;
  codeBuffer: Address;
  code: Address;
  engineProgram: Address;
  potSalt: Uint8Array;
  pot: Address;
  feeConfig: Address;
  /** When given, the kitchen refuses unless the staged bytes hash to it. */
  pin?: Uint8Array;
  maxExecutionFee: bigint;
  feePayer?: Address;
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
  pot,
  feeConfig,
  pin,
  maxExecutionFee,
  feePayer = owner,
  tail = [],
}: CookFromAccountInput): Instruction {
  assertLength(potSalt, SALT_BYTES, "a pot salt");
  assertEngineRunsCompiler("svm", engineProgram);

  return {
    programAddress: kitchen,
    accounts: [
      { address: owner, role: AccountRole.READONLY_SIGNER },
      { address: codeBuffer, role: AccountRole.READONLY },
      { address: code, role: AccountRole.READONLY },
      { address: engineProgram, role: AccountRole.READONLY },
      { address: pot, role: AccountRole.READONLY },
      ...executionFeeAccounts(feeConfig, feePayer),
      ...tail,
    ],
    data: data(
      DISCRIMINATOR.cookFromAccount,
      potSalt,
      potBump(kitchen, owner, potSalt),
      borshOption32(pin),
      u64(maxExecutionFee),
    ),
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

// --- execution fee administration -------------------------------------------

/**
 * The three fee instructions authorize against the kitchen's LIVE upgrade authority, read from its
 * `ProgramData` — so the party that can replace the code is the party that can price it, and an
 * immutable kitchen has a frozen fee and an uncollectable balance. Each therefore takes the kitchen
 * program and its `ProgramData` as accounts; the constraint links the two, so a foreign program's
 * `ProgramData` cannot be substituted.
 */
export interface ExecutionFeeAdminInput {
  kitchen: Address;
  authority: Address;
  /** `deriveProgramDataPda(kitchen)`. */
  programData: Address;
  /** `deriveExecutionFeeConfigPda(kitchen)`. */
  feeConfig: Address;
}

/** `initialize_execution_fee` — creates the config PDA. The initial fee must be greater than zero;
 *  a kitchen is unusable until it is priced, and a later `set` may take it back to zero. */
export function buildInitializeExecutionFeeInstruction({
  kitchen,
  authority,
  programData,
  feeConfig,
  payer = authority,
  initialFee,
}: ExecutionFeeAdminInput & { payer?: Address; initialFee: bigint }): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: kitchen, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: feeConfig, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data(DISCRIMINATOR.initializeExecutionFee, u64(initialFee)),
  };
}

/** `set_execution_fee` — repricing, including back to zero. */
export function buildSetExecutionFeeInstruction({
  kitchen,
  authority,
  programData,
  feeConfig,
  fee,
}: ExecutionFeeAdminInput & { fee: bigint }): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: kitchen, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: feeConfig, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.setExecutionFee, u64(fee)),
  };
}

/** `withdraw_execution_fees` — collect what the config PDA holds. `amount` omitted sweeps everything
 *  ABOVE the account's rent-exempt minimum, which the withdrawal never spends: that same account is
 *  the config every cook reads, and a zero balance would have the runtime reap it. The recipient
 *  must already be rent-exempt, or the runtime refuses the transaction for leaving it rent-paying. */
export function buildWithdrawExecutionFeesInstruction({
  kitchen,
  authority,
  programData,
  feeConfig,
  recipient,
  amount,
}: ExecutionFeeAdminInput & { recipient: Address; amount?: bigint }): Instruction {
  return {
    programAddress: kitchen,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: kitchen, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: feeConfig, role: AccountRole.WRITABLE },
      { address: recipient, role: AccountRole.WRITABLE },
    ],
    data: data(DISCRIMINATOR.withdrawExecutionFees, borshOptionU64(amount)),
  };
}
