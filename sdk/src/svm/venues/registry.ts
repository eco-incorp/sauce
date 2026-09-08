import type { SvmVenueAdapter } from "./types.js";
import { meteoraDammV1Stable } from "./meteora-damm-v1-stable/index.js";
import { meteoraDammV2 } from "./meteora-damm-v2/index.js";
import { meteoraDbc } from "./meteora-dbc/index.js";
import { orcaLegacyTokenSwap } from "./orca-legacy-token-swap/index.js";
import { pumpswapAdapter } from "./pumpswap/index.js";
import { raydiumAmmV4 } from "./raydium-amm-v4/index.js";
import { raydiumCpSwap } from "./raydium-cp-swap/index.js";
import { saberStableswap } from "./saber-stableswap/index.js";
import { stabbleStableSwap } from "./stabble-stable-swap/index.js";
import { stabbleWeightedSwap } from "./stabble-weighted-swap/index.js";

// Adapter table. Keys MUST equal adapter.slug — venueAdapter reports them as
// the known-venue list, and the accessor tree below (svm/accessors.ts) walks
// this exact table at the TYPE level via RegisteredVenueSlug. Constant-product
// venues first, then the sqrt-price and stable ones (the venue-matrix order in
// the solswap README). Literal keys (not computed `[x.slug]:`) so
// `keyof typeof adaptersTyped` is the real, checkable slug union — the loop
// right below promotes the "keys MUST equal slug" invariant from a comment
// into a module-eval assertion.
const adaptersTyped = {
  "raydium-cp-swap": raydiumCpSwap,
  "raydium-amm-v4": raydiumAmmV4,
  pumpswap: pumpswapAdapter,
  "orca-legacy-token-swap": orcaLegacyTokenSwap,
  "meteora-damm-v2": meteoraDammV2,
  "saber-stableswap": saberStableswap,
  "meteora-damm-v1-stable": meteoraDammV1Stable,
  "meteora-dbc": meteoraDbc,
  "stabble-stable-swap": stabbleStableSwap,
  "stabble-weighted-swap": stabbleWeightedSwap,
} as const satisfies Record<string, SvmVenueAdapter>;

for (const [key, adapter] of Object.entries(adaptersTyped)) {
  if (key !== adapter.slug) {
    throw new Error(
      `svm/venues/registry: table key '${key}' does not match adapter.slug '${adapter.slug}'`,
    );
  }
}

/** The registered venue slugs, as a literal union — what svm/accessors.ts builds its tree from. */
export type RegisteredVenueSlug = keyof typeof adaptersTyped;

const adapters: Record<string, SvmVenueAdapter> = adaptersTyped;

/** Known venue slugs, in table order. */
export function listVenues(): string[] {
  return Object.keys(adapters);
}

/** Looks up a venue adapter by slug; throws listing the known slugs. */
export function venueAdapter(slug: string): SvmVenueAdapter {
  const adapter = adapters[slug];
  if (adapter === undefined) {
    const known = listVenues();
    throw new Error(
      `unknown venue '${slug}' (known venues: ${known.length > 0 ? known.join(", ") : "none"})`,
    );
  }
  return adapter;
}
