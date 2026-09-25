/**
 * eco-routes runtime schema — CURRENT/DEPLOYED shape (not the unmerged v3).
 *
 * Isolated in its own file so a future v3 reward-leg model is a one-file swap:
 * only this file and `intent.ts` (the assembly seam) know the current field
 * names. Nothing else in `routes/` depends on the exact shape beyond what's
 * declared here.
 *
 * Deliberately schema-only: no ABI/Borsh encoding lives here (that's E3.2),
 * and no Sauce-bytecode slotting into `route.calls` (that's E3.3).
 */
import type { Hex } from "viem";

export type { Hex };

/**
 * bytes32-normalized 0x-hex address, the eco-routes cross-VM address format.
 * An EVM 20-byte address is left-padded to 32 bytes; an SVM 32-byte pubkey
 * passes through unchanged. See `normalize.ts#toUniversalAddress`.
 */
export type UniversalAddress = Hex;

export interface TokenAmount {
  readonly token: UniversalAddress;
  readonly amount: bigint;
}

/**
 * Unified call shape. SVM's on-chain `Call` has no `value` field — that
 * narrowing (dropping `value` for an SVM leg, or rejecting a nonzero one) is
 * an SVM-encode-time (E3.2) concern, deliberately NOT modeled here so this
 * layer stays engine-agnostic.
 */
export interface Call {
  readonly target: UniversalAddress;
  readonly data: Hex;
  readonly value: bigint;
}

export interface Route {
  readonly salt: Hex;
  readonly deadline: bigint;
  readonly portal: UniversalAddress;
  readonly nativeAmount: bigint;
  readonly tokens: readonly TokenAmount[];
  readonly calls: readonly Call[];
}

export interface Reward {
  readonly deadline: bigint;
  readonly creator: UniversalAddress;
  readonly prover: UniversalAddress;
  readonly nativeAmount: bigint;
  readonly tokens: readonly TokenAmount[];
}

export interface Intent {
  readonly destination: bigint;
  readonly sourceChainId: bigint;
  readonly route: Route;
  readonly reward: Reward;
}

/** Loosened address input: 20-byte EVM hex, 32-byte hex, or an already-typed UniversalAddress. */
export type AddressInput = Hex | UniversalAddress;

export interface TokenAmountInput {
  readonly token: AddressInput;
  readonly amount: bigint | number | string;
}

export interface CallInput {
  readonly target: AddressInput;
  readonly data: Hex;
  readonly value?: bigint | number | string;
}

/** Caller-facing, widened `Route` — what a `.<DestChain>(route)` call accepts. */
export interface RouteInput {
  readonly salt?: Hex;
  readonly deadline: bigint | number | string;
  readonly portal: AddressInput;
  readonly nativeAmount?: bigint | number | string;
  readonly tokens?: readonly TokenAmountInput[];
  readonly calls?: readonly CallInput[];
}

/** Caller-facing, widened `Reward` — what a `.route(reward)` call accepts. */
export interface RewardInput {
  readonly deadline: bigint | number | string;
  readonly creator: AddressInput;
  readonly prover: AddressInput;
  readonly nativeAmount?: bigint | number | string;
  readonly tokens?: readonly TokenAmountInput[];
}
