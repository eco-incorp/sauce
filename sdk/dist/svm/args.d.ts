/**
 * Staged payload-args encoder — the SDK half of the compiler's staged arg ABI
 * (CompileResult.argsLayout, mode 'calldata'). Per-execution args ride the
 * execute_from_account INSTRUCTION PAYLOAD after the flags byte and optional
 * hash pin; the engine exposes the composite `buffer bytecode ++ args` through
 * CALLDATA and the compiled prologue reads arg i at composite offset
 * `programLength + slot.offset` — so this module's byte layout must mirror the
 * layout's slots exactly.
 *
 * Slot ABI (normative, mirrored from the compiler):
 * - scalar slots: 32 bytes, u256 BIG-ENDIAN (the prologue reads them with
 *   SLICE + CAST_BE);
 * - bytes slots: the raw bytes, length fixed at compile time.
 *
 * Packet budget: 939 − 33·N payload-arg bytes with a pin and N extra user
 * accounts (stagedArgsBudget) — bigger args belong in a second buffer used as
 * a data account, read on-chain via accountData.
 */
import type { ArgsLayout, ArgsLayoutSlot, ArgValue } from './layout.js';
/** Encodes one runtime value against its layout slot (scalar → 32B BE word, bytes → raw). */
export declare function encodeArgSlot(slot: ArgsLayoutSlot, value: ArgValue): Uint8Array;
/**
 * Encodes the full payload-args tail against the compile's argsLayout: slot i's
 * bytes land at exactly layout.slots[i].offset, back to back — the compiled
 * prologue's baked SLICE offsets leave no room for drift, so any layout/value
 * mismatch throws instead of producing silently shifted reads.
 */
export declare function encodePayloadArgs(layout: ArgsLayout, values: readonly ArgValue[]): Uint8Array;
//# sourceMappingURL=args.d.ts.map