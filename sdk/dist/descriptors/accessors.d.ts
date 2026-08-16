/**
 * The E2.3 native accessor tree: `chainContracts(chainRef)` builds the lazy
 * `Chain -> Protocol -> Contract -> method` object a chain global (`Base`)
 * or `contracts.on(ref)` exposes. A walk over `describeContract`/
 * `requireContract` (query.ts) and `DESCRIPTORS` (registry.ts) — not a
 * reimplementation of either.
 *
 * Every namespace and leaf is a memoising GETTER (`Object.defineProperty`,
 * never eager construction/spread) so nothing is built until touched — see
 * the design doc's laziness note for why that matters (39 chains x ~29
 * contracts eagerly built on the SDK's import path would be real cost).
 */
import type { Address, Abi } from "viem";
import { type CanonicalChain, type ChainRef, type ChainSlug } from "../chains/canonical.js";
import type { ContractCoverage, ContractDescriptor, DescriptorMethod } from "./types.js";
import type { FamilyContracts, FamilyKey, ContractNameOf, PascalOf, ProtocolSlug } from "./names.js";
/**
 * One leaf: a bound (protocol, contract) on a specific chain, plus every
 * real ABI method as a callable producing a `ContractCall`. Method names are
 * NOT part of the static type (kept loose as `unknown` via the index
 * signature below) — they are derived from the descriptor's real ABI at
 * BUILD time, so `Base.UniswapV4.UniversalRouter.execute(...)` resolves a
 * real method and `.exactIn` is `undefined`, matching E2.2's "surface what
 * exists, invent nothing" stance.
 */
export interface ContractAccessor {
    readonly descriptor: ContractDescriptor;
    readonly chain: CanonicalChain;
    /** `undefined` when this contract has no address on `chain` (a hole), or for an unbound `kind:"interface"`. */
    readonly address: Address | undefined;
    readonly available: boolean;
    readonly chains: readonly ChainSlug[];
    readonly coverage: ContractCoverage;
    readonly abi: Abi;
    readonly methods: readonly DescriptorMethod[];
    /** Rebinds this accessor to a specific instance address — REQUIRED for `kind:"interface"`, an optional override otherwise. */
    at(address: Address): ContractAccessor;
    readonly [method: string]: unknown;
}
/**
 * The whole typed tree `chainContracts(...)` returns — chain-INDEPENDENT by
 * design (per-chain address presence is runtime data, not literally typed;
 * see the design doc's `ChainContracts` note), so it instantiates once
 * regardless of how many chain globals intersect it.
 */
export type ChainContracts = {
    readonly [P in ProtocolSlug as PascalOf<P>]: {
        readonly [C in ContractNameOf<P>]: ContractAccessor;
    };
} & {
    readonly [F in FamilyKey]: {
        readonly [C in FamilyContracts<F>]: ContractAccessor;
    };
};
/**
 * Builds the whole lazy tree for one resolved chain. Every canonical
 * protocol namespace is memoised once per `chainContracts` call, so a family
 * alias resolving a non-ambiguous name (`Base.Uniswap.UniversalRouter`)
 * forwards to the EXACT SAME accessor object as the canonical path
 * (`Base.UniswapV4.UniversalRouter`) — verified by identity in
 * `test/descriptors-accessors.test.ts`.
 */
export declare function chainContracts(chainRef: ChainRef): ChainContracts;
/** Import-based front door (option-b): `contracts.on('base').Uniswap.UniversalRouter.execute(...)`.
 *  Escape hatch for `__ECO_ROUTES_NO_GLOBALS__` hosts and for the TS2451 own-`const Base` caveat. */
export declare function on(chainRef: ChainRef): ChainContracts;
//# sourceMappingURL=accessors.d.ts.map