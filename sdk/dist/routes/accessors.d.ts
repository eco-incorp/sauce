/**
 * Default-schema instantiation of the chain-global builder, generated from
 * `../chains/canonical.js` at module-eval time. Adding a chain to
 * `CANONICAL_CHAINS` adds a global here with zero code changes — see
 * `sdk/test/routes.test.ts`'s "accessor generation is registry-derived"
 * case for the proof.
 *
 * `PascalOf`/`pascalOfSlug` live in `builder.ts` (needed there for the
 * `ChainGlobals` mapped type) and are re-exported here so a caller only
 * needs one import site for the whole `routes/` surface, matching the
 * module layout in the design doc.
 */
import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { pascalOfSlug, type ChainGlobal, type ChainGlobals, type PascalOf } from "./builder.js";
export type { PascalOf, ChainRef };
export { pascalOfSlug };
/** The generated record: `const { Base, Solana, Ethereum } = chainAccessors;` -- each entry is
 *  BOTH callable (`Base(sauce, opts)`) and a namespace (`Base.chain`/`Base.route`). */
export declare const chainAccessors: ChainGlobals;
/**
 * Dynamic front door for a runtime-resolved chain (`chain('eth')`,
 * `chain(8453)`, `chain('BNB Chain')`) — delegates to `requireChain`, so it
 * inherits the registry's alias resolution and unknown-chain throw.
 */
export declare function chain(ref: number | string | bigint | CanonicalChain): ChainGlobal;
//# sourceMappingURL=accessors.d.ts.map