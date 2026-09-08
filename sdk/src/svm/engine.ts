/**
 * SVM engine wire constants.
 *
 * The wire-contract values (discriminators, header offsets/sizes, payload flags,
 * seed scheme) are NOT hand-copied here anymore — they are re-exported from
 * `engine-abi.generated.ts`, which `sdk/scripts/gen-engine-abi.mjs` derives from
 * the pinned `sauce` dep's `svm/abi/engine-abi.json`. That artifact is generated
 * from the engine's live Rust constants and CI-asserted byte-equal to them
 * (engine `tests/abi_artifact.rs`). CI regenerates the module and `git diff`s it,
 * and `engine-abi-drift.test.ts` asserts every artifact key is mapped — so a repin
 * that changes the wire can't silently leave this file stale.
 *
 * This closes the drift that motivated the whole exercise: the SDK once carried
 * `BYTECODE_FORMAT_EPOCH = 2` while the engine's value was 4, then the field was
 * deleted entirely — two repos, one constant, three values, and no test could see
 * it. That constant (and `BUFFER_VERSION`, and the index/epoch header fields) are
 * gone from the engine, not merely renumbered: the engine deploys **non-upgradeable**
 * (`--final`), so one program id has exactly one ISA and one header layout forever.
 * A format change ships as a NEW program id, and buffer PDAs are derived under a
 * program id — a buffer written under the old format isn't even addressable from
 * the new program. So a client-side version/epoch check compared a constant
 * against itself; there was never a value a reader could act on. `kind` (byte 0)
 * is now the whole account discriminant. Do NOT reintroduce a version/epoch field
 * "for safety" — it would be a fabricated guarantee against a value the engine no
 * longer publishes.
 *
 * Only the constants NOT expressible in the ABI live here directly: BPF heap-frame
 * sizing, packet budgets, the staging chunk, CU limits, and the synthetic chain
 * ids — all SDK/transaction-shape concerns, not engine wire values.
 */

// ── wire contract (generated from svm/abi/engine-abi.json — see the header) ──
export {
  // sizes / discriminants
  BUFFER_HEADER_BYTES,
  BUFFER_SEED_BYTES,
  BUFFER_SEED,
  KIND_BUFFER,
  MAX_BUFFER_CAPACITY,
  // header flags
  FLAG_FINALIZED,
  // execute_from_account / execute_and_close payload flags
  EXECUTE_FLAG_HAS_PIN,
  EXECUTE_FLAG_HAS_SLICE,
  // header offsets (`len`@40 and `contentSha256`@48 kept their offsets across the
  // 80→112 growth on purpose, so code reading either did not move; `seed`@80 is new)
  BUFFER_OFFSET_KIND,
  BUFFER_OFFSET_BUMP,
  BUFFER_OFFSET_FLAGS,
  BUFFER_OFFSET_AUTHORITY,
  BUFFER_OFFSET_LEN,
  BUFFER_OFFSET_CONTENT_SHA256,
  BUFFER_OFFSET_CONTENT_SHA256 as BUFFER_OFFSET_HASH,
  BUFFER_OFFSET_SEED,
  // instruction discriminators (all 8)
  EXECUTE_DISCRIMINATOR,
  EXECUTE_FROM_ACCOUNT_DISCRIMINATOR,
  EXECUTE_AND_CLOSE_DISCRIMINATOR,
  INIT_BUFFER_DISCRIMINATOR,
  WRITE_BUFFER_DISCRIMINATOR,
  FINALIZE_BUFFER_DISCRIMINATOR,
  CLOSE_BUFFER_DISCRIMINATOR,
  CLOSE_BUFFER_CHECKED_DISCRIMINATOR,
  // the whole structural mirror, for the drift test
  ENGINE_ABI,
} from "./engine-abi.generated.js";

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

/** MAX_PERMITTED_DATA_INCREASE — a Solana runtime limit (not an engine constant): max account growth per init_buffer invocation. */
export const PDA_GROWTH_STEP = 10240;

/**
 * The SDK's staging write chunk. The hard packet ceiling for a minimal
 * write_buffer transaction is ≈ 1,016 bytes of chunk; 1,000 leaves margin for
 * compute-budget prepends / address-table variance. At this chunk a 4/8/16 KB
 * program stages-and-executes in 8/12/20 transactions.
 */
export const BUFFER_WRITE_CHUNK_BYTES = 1000;

// ── packet budgets (measured — engine tests/payload_args.rs; re-measured by test/svm/packet-budget.test.ts) ──

/**
 * Fixed wire cost of the staged execute transaction (managed, pinned shape):
 * signature, message overhead, both ComputeBudget instructions, the pinned
 * execute_from_account instruction, buffer + payer accounts — 293 bytes plus
 * 33 per extra user account (32-byte key + 1-byte index). The engine's
 * `payload_args.rs` pins the packet against PACKET_DATA_SIZE = 1232; this SDK
 * mirrors that measurement in `test/svm/packet-budget.test.ts` rather than
 * trusting the number across a repin.
 *
 * NOTE the shipped shape: pin present (bit 0x01), NO slice (bit 0x02). The new
 * slice field costs 8 bytes when present (→ budget − 8); omitting the pin frees
 * 32. The SDK's managed staged-execute path always pins and never slices, so
 * `939 − 33·N` is the correct budget for it — but it is a *measured* size, not a
 * formula to rescale by editing one term. See the re-measurement test.
 */
export const STAGED_PACKET_FIXED_BYTES = 293;
export const STAGED_PACKET_BYTES_PER_ACCOUNT = 33;

/**
 * Payload-args budget of a pinned, sliceless staged execute in the 1,232-byte
 * packet with `extraAccounts` user accounts beyond the payer: 939 − 33·N.
 * Bigger args belong in a second buffer used as a data account, read on-chain.
 */
export function stagedArgsBudget(extraAccounts: number): number {
  return 1232 - STAGED_PACKET_FIXED_BYTES - STAGED_PACKET_BYTES_PER_ACCOUNT * extraAccounts;
}

// ── execution limits ──

export const MAX_RETURN_DATA = 1024;
export const MAX_CPI_ACCOUNTS = 64;
export const ENGINE_GAS_LIMIT_CU = 1_400_000;

/**
 * Measured staged-minus-inline CU premium on identical bytecode (buffer
 * validation: one create_program_address, the header parse, the hash-pin
 * compare, the payload-args parse, the buffer's loaded-accounts contribution).
 * Informational — the engine's cu_budget suite pins it under a 5,000 CU ceiling.
 */
export const STAGED_EXECUTE_CU_PREMIUM = 2216;

/**
 * Synthetic CHAIN_ID values reported by the engine's CHAIN_ID opcode. The
 * devnet id is what a default `cargo build-sbf` build reports — localnet and
 * LiteSVM runs use it too; mainnet requires building with `--features mainnet`.
 */
export const ENGINE_CHAIN_IDS = {
  mainnet: 1399811149n,
  devnet: 1399811150n,
} as const;
