import { requireChain } from "../chains/canonical.js";
import { createChainGlobals, makeChainGlobal, pascalOfSlug, } from "./builder.js";
export { pascalOfSlug };
/** The generated record: `const { Base, Solana, Ethereum } = chainAccessors;` -- each entry is
 *  BOTH callable (`Base(sauce, opts)`) and a namespace (`Base.chain`/`Base.route`). */
export const chainAccessors = createChainGlobals();
/**
 * Dynamic front door for a runtime-resolved chain (`chain('eth')`,
 * `chain(8453)`, `chain('BNB Chain')`) — delegates to `requireChain`, so it
 * inherits the registry's alias resolution and unknown-chain throw.
 */
export function chain(ref) {
    const resolved = requireChain(ref);
    return makeChainGlobal(resolved);
}
//# sourceMappingURL=accessors.js.map