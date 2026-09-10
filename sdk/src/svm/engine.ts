/**
 * SVM engine wire constants for the RELEASED engine — the only engine this repo has.
 *
 * It holds exactly three instructions (`execute`, `executeFromAccount`, `closeAccount`) and no
 * staging: code buffers and Pots belong to the kitchen (`kitchen.ts`). The pre-release engine's
 * buffer surface, the `engine-abi.json` describing it and the vendored binary that ran it are all
 * deleted, so nothing here describes a buffer header, a staging discriminator or a payload flag.
 */

// ── wire contract (declared here, asserted against the release's wire artifact — see below) ──
/**
 * The released engine's three instruction discriminators.
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
