import { requireChain } from "../chains/canonical.js";
import { createChainAccessors, makeChainOrigin, pascalOfSlug, } from "./builder.js";
import { assembleIntent } from "./intent.js";
export { pascalOfSlug };
/** The generated record: `const { Base, Solana, Ethereum } = chainAccessors;`. */
export const chainAccessors = createChainAccessors(assembleIntent);
/**
 * Dynamic front door for a runtime-resolved chain (`chain('eth')`,
 * `chain(8453)`, `chain('BNB Chain')`) — delegates to `requireChain`, so it
 * inherits the registry's alias resolution and unknown-chain throw.
 */
export function chain(ref) {
    const resolved = requireChain(ref);
    return makeChainOrigin(resolved, assembleIntent);
}
//# sourceMappingURL=accessors.js.map