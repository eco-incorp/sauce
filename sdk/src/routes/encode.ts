/**
 * Chain-kind resolution and the 32-byte universal address narrowed to an EVM one.
 *
 * `ChainKind` is currently `"evm" | "svm"` only — there is no `"tvm"`. A Tron (or other TVM) chain
 * reaching this module today must already be registered with `kind: "evm"` (encoding-correct: TVM
 * ABI-encodes identically to EVM; identity-misleading) or this fork has nothing to dispatch on.
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { type CanonicalChain, type ChainKind, requireChain } from "../chains/canonical.js";
import type { UniversalAddress } from "./types.js";

/** Anything that can select which fork to use: an explicit kind, or anything `resolveChain`
 *  accepts — including a native `bigint` chain id, so a caller can pass one straight through
 *  without a silent evm mis-classification. */
export type ChainKindRef = ChainKind | number | bigint | string | CanonicalChain;

const CHAIN_KINDS = new Set<string>(["evm", "svm"]);

function isChainKindLiteral(ref: ChainKindRef): ref is ChainKind {
  return typeof ref === "string" && CHAIN_KINDS.has(ref);
}

/**
 * Resolves a `ChainKindRef` to a `ChainKind`. An explicit `"evm"`/`"svm"`
 * literal is returned as-is (the escape hatch for a chain id not yet in the
 * canonical registry). Anything else is looked up via `requireChain`, which
 * THROWS for an unregistered id — this never silently defaults to `"evm"`.
 */
export function kindOf(ref: ChainKindRef): ChainKind {
  if (isChainKindLiteral(ref)) return ref;
  return requireChain(ref).kind;
}

/**
 * Narrows a 32-byte `UniversalAddress` to a 20-byte EVM address. Throws
 * (rather than silently truncating) if the leading 12 bytes aren't zero —
 * that shape means the address is not EVM-representable (e.g. a real SVM
 * pubkey), and truncating it would produce a plausible-looking but wrong address.
 */
export function denormalizeToEvm(u: UniversalAddress): Hex {
  const bytes = hexToBytes(u);
  if (bytes.length !== 32) {
    throw new Error(
      `denormalizeToEvm: expected a 32-byte UniversalAddress, got ${bytes.length} bytes`,
    );
  }
  for (let i = 0; i < 12; i++) {
    if (bytes[i] !== 0) {
      throw new Error(
        `denormalizeToEvm: '${u}' is not EVM-representable (nonzero high 12 bytes) — check the destination chain`,
      );
    }
  }
  return bytesToHex(bytes.slice(12)) as Hex;
}
