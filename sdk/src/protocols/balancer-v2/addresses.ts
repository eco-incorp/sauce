import type { ChainDeployment } from "../../core/types.js";

const VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: { vault: VAULT },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: { vault: VAULT },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: { vault: VAULT },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: { vault: VAULT },
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    addresses: { vault: VAULT },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: { vault: VAULT },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: { vault: VAULT },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: { vault: VAULT },
  },
];
