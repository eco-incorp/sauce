/**
 * The address and call shapes the route compile and the call builders share.
 */
import type { Hex } from "viem";

export type { Hex };

/**
 * bytes32-normalized 0x-hex address, the cross-VM address format. An EVM 20-byte address is
 * left-padded to 32 bytes; an SVM 32-byte pubkey passes through unchanged. See
 * `normalize.ts#toUniversalAddress`.
 */
export type UniversalAddress = Hex;

/** Loosened address input: 20-byte EVM hex, 32-byte hex, or an already-typed UniversalAddress. */
export type AddressInput = Hex | UniversalAddress;

/** One call: its target, its data and the native value it carries. */
export interface CallInput {
  readonly target: AddressInput;
  readonly data: Hex;
  readonly value?: bigint | number | string;
}
