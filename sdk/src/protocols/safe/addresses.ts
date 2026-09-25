import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      safeV141: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
];
