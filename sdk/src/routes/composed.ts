/**
 * The composed chain accessor -- `Base` as the SDK hands it out: `.chain`, the lazy contract
 * namespace tree (`Uniswap`, `UniswapV4`, ...), the chain's registry tokens (`Base.USDC`) and, for
 * an `svm`-kind chain, the svm venue accessor tree. Calling it, or its `.route`, opened an intent:
 * both refuse, opening an intent being coming soon (`coming-soon.ts`).
 *
 * One shape, two delivery paths: the generated NAMED EXPORTS
 * (`./chain-exports.generated.ts`, what `import { Base }` resolves) and the
 * opt-in `installRouteGlobals()` (`./globals.ts`). Composition is memoised per
 * name, so both hand out the SAME object -- `Base === globalThis.Base` after
 * an install -- and the ~840 namespace descriptors are copied once per
 * process rather than once per install.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { chainAccessors } from "./accessors.js";
// Composes each chain accessor with its native contract accessor tree
// (`Base.Uniswap.UniversalRouter.method(...)`) -- see composeChainGlobal below.
import { chainContracts } from "../descriptors/accessors.js";
// The SVM twin of the above: composes the svm venue accessor tree
// (`Solana.RaydiumCpSwap.swap(...)`) onto an `svm`-kind chain only --
// see composeChainGlobal's `origin.chain.kind === "svm"` branch below.
import { venues as svmVenueAccessors } from "../svm/accessors.js";
// The chain's registry tokens (`Base.USDC` -> `{ address, decimals, symbol, chain }`), the rows a
// compiled program's `USDC` resolves to on the same chain.
import { registryTokens } from "./token-registry.js";
import { chainCallComingSoon } from "./coming-soon.js";

/** What `chainAccessors[name]` is, in the shape this module consumes it. */
type ChainOrigin = Record<string, unknown> & { chain: CanonicalChain; route: unknown };

/** Names a contract/venue namespace key must never take: a function's own intrinsics, since the
 *  accessor is one (a call that refuses), and what any object answers. */
const FUNCTION_INTRINSIC_DENYLIST: ReadonlySet<string> = new Set([
  "length",
  "name",
  "prototype",
  "arguments",
  "caller",
  "bind",
  "call",
  "apply",
  "toString",
  "constructor",
]);

/**
 * Composes one chain accessor: a FRESH arrow function whose call refuses, with `chain`, `route`
 * (non-enumerable, refusing too), the lazy contract-namespace tree
 * (`Uniswap`, `UniswapV4`, ...), the chain's registry tokens (`USDC`, ...) and, for an `svm`-kind
 * chain only, the svm venue accessor tree (`RaydiumCpSwap`, `MeteoraDammV2`, ...) — copied via
 * `Object.getOwnPropertyDescriptors` (NOT spread) so every namespace's memoising GETTERS stay lazy —
 * spread would invoke every one of them eagerly at composition time. `origin` itself is never
 * mutated. Throws on a name collision — a protocol, family, token or venue name literally "chain",
 * "route" or an intrinsic like "call"/"bind", or two of them sharing a name (a token symbol that is also a
 * protocol namespace) — mirroring `createChainGlobals`'s own duplicate-key throw. The
 * `kind === "svm"` gate is registry-derived (from `../chains/canonical.js`'s own
 * `CanonicalChain.kind`), not a hardcoded chain name -- a second SVM chain added to
 * `CANONICAL_CHAINS` gets the venue namespaces automatically, and every EVM chain provably cannot.
 */
function composeChainGlobal(name: string, origin: ChainOrigin): object {
  const contracts = chainContracts(origin.chain) as unknown as Record<string, unknown>;
  const sources: PropertyDescriptorMap[] = [
    Object.getOwnPropertyDescriptors(contracts),
    Object.fromEntries(
      Object.entries(registryTokens(origin.chain)).map(([symbol, token]) => [
        symbol,
        { value: token, enumerable: true, configurable: false, writable: false },
      ]),
    ),
  ];
  if (origin.chain.kind === "svm") {
    const svmVenues = svmVenueAccessors() as unknown as Record<string, unknown>;
    sources.push(Object.getOwnPropertyDescriptors(svmVenues));
  }

  const merged: PropertyDescriptorMap = {
    chain: { value: origin.chain, enumerable: true, configurable: false, writable: false },
    route: { value: origin.route, enumerable: false, configurable: false, writable: false },
  };
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (key in merged || FUNCTION_INTRINSIC_DENYLIST.has(key)) {
        throw new Error(
          `routes/composed: '${key}' collides with another name on the '${name}' accessor ` +
            "(its chain or route, an intrinsic, or a protocol, token or venue of the same name)",
        );
      }
    }
    Object.assign(merged, source);
  }
  return Object.defineProperties(() => chainCallComingSoon(name), merged);
}

const memo = new Map<string, object>();

/**
 * The composed accessor for one PascalCase chain name, memoised. Returns
 * `unknown` because the per-chain type is only known where the name is a
 * literal: `chain-exports.generated.ts` declares it (svm chains additionally
 * carry `SvmVenueAccessors`), which is exactly the cast the generator emits.
 */
export function composedChainGlobal(name: string): unknown {
  const cached = memo.get(name);
  if (cached !== undefined) return cached;
  const origin = (chainAccessors as unknown as Record<string, ChainOrigin | undefined>)[name];
  if (origin === undefined) {
    throw new Error(`routes/composed: no canonical chain accessor named '${name}'`);
  }
  const composed = composeChainGlobal(name, origin);
  memo.set(name, composed);
  return composed;
}

/** Every canonical chain, composed and memoised, PascalCase-keyed -- what
 *  `installRouteGlobals()` installs. Registry-derived: it enumerates
 *  `chainAccessors`, so adding a chain to `CANONICAL_CHAINS` adds an entry
 *  here with no code change. */
export function composedChainGlobals(): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(chainAccessors)) out[name] = composedChainGlobal(name);
  return out;
}
