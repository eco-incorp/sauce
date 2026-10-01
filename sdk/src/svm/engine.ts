/**
 * SVM engine wire constants for the RELEASED engine — the only engine this repo has.
 *
 * The engine answers two kinds of cook. The Kitchen-mediated pair (`execute`,
 * `executeFromAccount`) is gated: only a Kitchen cook, which signs the acting Pot, reaches them. The
 * direct paid trio (`cookAndPay`, `cookAndPayFromAccount`, `cookAndPayFromAccountPinned`) is called
 * by the transaction itself and charges the Kitchen's execution fee before the interpreter runs;
 * `instructions.ts` builds them. `closeAccount` is the third legacy instruction. Staging code
 * buffers and Pots belong to the kitchen (`kitchen.ts`). The pre-release engine's buffer surface, the
 * `engine-abi.json` describing it and the vendored binary that ran it are all deleted, so nothing
 * here describes a buffer header, a staging discriminator or a payload flag.
 */

// ── wire contract (declared here, asserted against the release's wire artifact — see below) ──
/**
 * The Kitchen-mediated engine instruction discriminators.
 *
 * Declared here, not generated. The pre-release engine shipped an `engine-abi.json` these were
 * derived from; neither that artifact nor the engine it described exists any more — nothing about
 * the engine is source-controlled now, it is fetched from a pinned release. These are still not
 * hand-copies in the sense that let `BYTECODE_FORMAT_EPOCH` rot: `engine-wire-drift.test.ts` asserts
 * each against the release's own `engine-wire-<cluster>.json`, which the engine generates from its
 * Rust constants.
 */
export const EXECUTE_DISCRIMINATOR = new Uint8Array([
  0x82, 0xdd, 0xf2, 0x9a, 0x0d, 0xc1, 0xbd, 0x1d,
]);
export const EXECUTE_FROM_ACCOUNT_DISCRIMINATOR = new Uint8Array([
  0x71, 0x2c, 0xd5, 0x72, 0x82, 0x95, 0x58, 0xc3,
]);
/** `closeAccount` — the third instruction, previously unrepresented here. */
export const CLOSE_ACCOUNT_DISCRIMINATOR = new Uint8Array([
  0x7d, 0xff, 0x95, 0x0e, 0x6e, 0x22, 0x48, 0x18,
]);

/**
 * The direct paid cooks: `sha256("global:<name>")[..8]`, as the engine declares them, and asserted
 * against the release's wire artifact by `engine-wire-drift.test.ts` like the pair above.
 *
 * `cookAndPay` carries `max_execution_fee` (u64 LE) and then the bytecode; `cookAndPayFromAccount`
 * the fee cap alone, the program being account 0's data; `cookAndPayFromAccountPinned` the fee cap
 * and the SHA-256 that account 0's whole data must hash to. None carries a Pot gate header.
 */
export const COOK_AND_PAY_DISCRIMINATOR = new Uint8Array([147, 140, 71, 21, 126, 197, 212, 249]);
export const COOK_AND_PAY_FROM_ACCOUNT_DISCRIMINATOR = new Uint8Array([
  68, 213, 224, 101, 123, 129, 48, 6,
]);
export const COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR = new Uint8Array([
  141, 234, 73, 26, 238, 82, 64, 47,
]);

/**
 * The engine's `Custom(n)` fault codes, by name — what a failed engine instruction's
 * `InstructionError` carries. `Revert` (0) is a program's own `throw`/`require`, its payload the
 * return data; every other code is the engine refusing. The direct cooks add the fee faults
 * (`InvalidFeeConfig` … `ExecutionFeeExceedsMaximum`) and `CodeHashMismatch`; a legacy instruction
 * sent by anything but a Kitchen cook is `NotCookedByKitchen`.
 *
 * The release's wire artifact publishes the same table; `engine-wire-drift.test.ts` asserts this
 * one equals it, so a renumbered fault fails there rather than being named wrongly.
 */
export const ENGINE_FAULTS = {
  AccountDataTooSmall: 63,
  AccountIndexOutOfBounds: 60,
  AccountNotFound: 61,
  AccountNotSigner: 66,
  AccountNotWritable: 62,
  BytecodeOutOfBounds: 12,
  CodeHashMismatch: 72,
  DataTooLarge: 41,
  DivisionByZero: 50,
  ExecutionFeeExceedsMaximum: 84,
  ExecutionFeeNotPaid: 82,
  ExpectedDescriptor: 30,
  ExpectedScalar: 31,
  HeapFull: 40,
  IndexOutOfBounds: 42,
  InvalidArrayElement: 14,
  InvalidDescriptor: 32,
  InvalidFeeConfig: 80,
  InvalidFeePayer: 81,
  InvalidInstruction: 11,
  InvalidOpcode: 10,
  InvalidStackSlot: 13,
  InvalidSystemProgram: 83,
  InvokeFailed: 64,
  NotCookedByKitchen: 67,
  Overflow: 51,
  Revert: 0,
  SeedTooLong: 71,
  StackOverflow: 20,
  StackUnderflow: 21,
  SysvarUnavailable: 65,
  TooManySeeds: 70,
} as const;

export type EngineFault = keyof typeof ENGINE_FAULTS;

/** `ENGINE_FAULTS` inverted, once. Each code names one fault (`instructions.test.ts` asserts it). */
const FAULT_BY_CODE: ReadonlyMap<number, EngineFault> = new Map(
  (Object.keys(ENGINE_FAULTS) as EngineFault[]).map((name) => [ENGINE_FAULTS[name], name]),
);

/** The fault a `Custom(code)` from the engine names, or `undefined` for a code it does not use. */
export function engineFaultName(code: number): EngineFault | undefined {
  return FAULT_BY_CODE.get(code);
}

// ── interpreter memory (BPF heap frame) ──

/**
 * The 256 KiB BPF heap frame every execute transaction MUST request:
 * interpreter memory (operand stack, heap, frames) lives above the default
 * 32 KiB Rust bump arena, not in accounts. Attach RequestHeapFrame(262144)
 * beside SetComputeUnitLimit on every execute/simulate transaction —
 * **add-once**: duplicate ComputeBudget instruction types fail the whole
 * transaction. A transaction without it aborts deterministically (SBF
 * AccessViolation) before any opcode runs. Buffer staging transactions do
 * not need it — their instructions never touch interpreter memory.
 */
export const HEAP_FRAME_BYTES = 262_144;

/** CU cost of the heap-frame request, charged per program invocation in the transaction. */
export const HEAP_FRAME_CU_PER_INVOCATION = 56;

/**
 * Wire cost of the RequestHeapFrame instruction: 8 bytes beside an existing
 * ComputeBudget instruction (the program key and count byte are already paid),
 * 9 standalone. Measured — engine tests/cu_budget.rs.
 */
export const REQUEST_HEAP_FRAME_WIRE_BYTES = 9;

// ── packet budgets (measured — engine tests/payload_args.rs; re-measured by test/svm/packet-budget.test.ts) ──

// ── execution limits ──

export const MAX_RETURN_DATA = 1024;
export const MAX_CPI_ACCOUNTS = 64;
export const ENGINE_GAS_LIMIT_CU = 1_400_000;

/**
 * Synthetic CHAIN_ID values reported by the engine's CHAIN_ID opcode. The
 * devnet id is what a default `cargo build-sbf` build reports — localnet and
 * LiteSVM runs use it too; mainnet requires building with `--features mainnet`.
 */
export const ENGINE_CHAIN_IDS = {
  mainnet: 1399811149n,
  devnet: 1399811150n,
} as const;
