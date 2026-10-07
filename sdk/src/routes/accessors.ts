/**
 * Default-schema instantiation of the chain-global builder, generated from
 * `../chains/canonical.js` at module-eval time. Adding a chain to
 * `CANONICAL_CHAINS` adds a global here with zero code changes — see
 * `sdk/test/routes.test.ts`'s "accessor generation is registry-derived"
 * case for the proof.
 *
 * `PascalOf`/`pascalOfSlug` live in `pascal.ts` and are re-exported here so a caller only
 * needs one import site for the whole `routes/` surface.
 */
import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import {
  createChainGlobals,
  makeChainGlobal,
  pascalOfSlug,
  type ChainGlobal,
  type ChainGlobals,
  type PascalOf,
} from "./builder.js";

export type { PascalOf, ChainRef };
export { pascalOfSlug };

/** The generated record: `const { Base, Solana, Ethereum } = chainAccessors;` -- each entry a
 *  namespace with `.chain` and `.hop`. */
export const chainAccessors: ChainGlobals = createChainGlobals();

/**
 * Dynamic front door for a runtime-resolved chain (`chain('eth')`,
 * `chain(8453)`, `chain('BNB Chain')`) — delegates to `requireChain`, so it
 * inherits the registry's alias resolution and unknown-chain throw.
 */
export function chain(ref: number | string | bigint | CanonicalChain): ChainGlobal {
  const resolved = requireChain(ref as ChainRef);
  return makeChainGlobal(resolved);
}
