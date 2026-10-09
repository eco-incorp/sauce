import type { ChainDeployment } from "../../core/types.js";

// BoundlessMarket, an ERC-1967 proxy, on Base: `contracts/deployment.toml` and docs.boundless.network.
// Ethereum has no market (`deployment.toml` sets it to zero); only RISC Zero's verifiers are there.
export const deployments: ChainDeployment[] = [
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      market: "0xfd152dadc5183870710fe54f939eae3ab9f0fe82",
    },
  },
];
