import type { ChainDeployment } from "../../core/types.js";

// Circle CCTP v2 TokenMessengerV2. Circle deploys it at the SAME address on every supported EVM
// mainnet (deterministic deployment), so `tokenMessenger` is identical across chains here — it is
// still listed per-chain (not a constant) so the accessor resolves it the same way as every other
// protocol and a future chain-specific redeployment is a one-line change.
const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 10, chainName: "Optimism", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 137, chainName: "Polygon", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 8453, chainName: "Base", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 43114, chainName: "Avalanche", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
];

/**
 * Circle CCTP DOMAIN ids (NOT EVM chain ids) — the `destinationDomain` argument of `depositForBurn`,
 * keyed by canonical chain slug. Kept beside the addresses so a route resolves BOTH the messenger
 * address and the destination domain from the protocol, never a hardcoded literal in the recipe.
 */
export const CCTP_DOMAIN: Readonly<Record<string, number>> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
};
