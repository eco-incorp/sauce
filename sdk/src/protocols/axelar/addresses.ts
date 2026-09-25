import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      gateway: "0x4F4495243837681061C4743b74B3eEdf548D56A5",
      gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      gateway: "0x6f015F16De9fC8791b234eF68D486d2bF203FBA8",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      gateway: "0x5029C0EFf6C34351a0CEc334542cDb22c7928f78",
      its: "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C",
    },
  },
];
