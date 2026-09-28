import type { ChainDeployment } from "../../core/types.js";
import { CANONICAL_CHAINS } from "../../chains/canonical.js";
import { ECO_ROUTES_ADDRESSES } from "./addresses.generated.js";

/**
 * The catalog view of the production v3 deployment — one entry per canonical chain that has one.
 * The full picture, including the v2 generation and the staging environment, is in `lookup.ts`;
 * `ChainDeployment` has room for neither axis, so this is deliberately the default slice rather
 * than a flattening that would put two generations' addresses in one bag.
 */
export const deployments: ChainDeployment[] = CANONICAL_CHAINS.flatMap((chain) => {
  const addresses = (
    ECO_ROUTES_ADDRESSES.v3.chains as Record<
      string,
      Record<string, Record<string, string>> | undefined
    >
  )[String(chain.id)]?.default;
  if (addresses === undefined) return [];

  return [
    {
      chainId: Number(chain.id),
      chainName: chain.slug,
      addresses: addresses as ChainDeployment["addresses"],
    },
  ];
});
