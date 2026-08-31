/**
 * The staged payload-args data shapes, owned by the SDK.
 *
 * These describe the byte layout of a staged SVM program's per-execution args — the contract
 * `args.ts` encodes against and `verify.ts` checks. They are plain data the SDK is HANDED, not
 * values it must receive from a compiler: `SvmClient`'s `StagedArgs` takes a layout as an INPUT
 * field, and `decodeSvmSettleArgs` validates a fixed known shape. So they live here rather than
 * being re-exported from a compiler package.
 */

/** A struct arg at the main() boundary, encoded as a TUPLE with fields sorted ALPHABETICALLY. */
export interface ArgObject {
  [key: string]: ArgValue;
}

export type ArgValue = bigint | string | ArgValue[] | ArgObject;

export type ArgsLayoutKind = 'scalar' | 'bytes';

export interface ArgsLayoutSlot {
  /** main() parameter position this slot feeds (slot i ↔ arg i, in order). */
  arg: number;
  kind: ArgsLayoutKind;
  /** Byte offset within the payload args (composite CALLDATA offset = programLength + offset). */
  offset: number;
  /** Slot byte length (32 for scalars; the fixed compile-time length for bytes). */
  length: number;
}

export interface ArgsLayout {
  /** Args transport: per-execution values ride the instruction payload, read via CALLDATA. */
  mode: 'calldata';
  /** Compiled program byte length L — arg i lives at composite offset L + slots[i].offset. */
  programLength: number;
  /** Total payload-arg bytes (slots laid out back to back, no padding). */
  byteLength: number;
  slots: ArgsLayoutSlot[];
}
