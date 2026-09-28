import type { ChainDeployment } from "../../core/types.js";

// Premia v3 trades on per-market pools; the factory deploys them (its `PoolDeployed` event names
// each pool). The addresses previously listed here as a "diamond" were Gnosis Safes.
export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      poolFactory: "0xAE4fB6622F25f397587F11638dA8CE88C27b5645",
    },
  },
];
