import type { Abi } from "viem";
import type { ContractDescriptor } from "./types.js";
import type { ChainSlug } from "../chains/canonical.js";
/**
 * Per-protocol ABI-export lookup, one module namespace import per starter
 * protocol above. Kept as a flat Record<abiExportName, Abi> per protocol
 * rather than resolved through `protocols/index.ts` (which only carries
 * `ProtocolInfo`, no raw `as const` ABI arrays) — this is the one place the
 * descriptor layer reaches into a protocol's own module directly.
 */
declare const ABI_EXPORTS: Readonly<Record<string, Readonly<Record<string, Abi>>>>;
/** Exposed for the linkage test's fail-closed invariants — not part of the public query API (see query.ts/index.ts). */
export { ABI_EXPORTS };
/** The whole flat registry, built once at module load. Stable order: as declared in CONTRACT_LINKS. */
export declare const DESCRIPTORS: readonly ContractDescriptor[];
/** protocol slug (normalized) -> its descriptors, in DESCRIPTORS order. */
export declare const byProtocol: ReadonlyMap<string, readonly ContractDescriptor[]>;
/** protocol slug (normalized) -> contract name (normalized) -> descriptor. */
export declare const byProtocolAndContract: ReadonlyMap<string, ReadonlyMap<string, ContractDescriptor>>;
/** REVERSE INDEX: chain slug -> descriptors with an address on that chain (kind:"interface" descriptors are always excluded — see listInterfaces). */
export declare const byChain: ReadonlyMap<ChainSlug, readonly ContractDescriptor[]>;
//# sourceMappingURL=registry.d.ts.map