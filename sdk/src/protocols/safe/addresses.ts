import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — safe-global/safe-deployments lists both singletons as canonical for 5042.
    // getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): VERSION() == "1.4.1" / "1.3.0", and each code hash equals Ethereum's.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      safeV141: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      safeL2V130: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    },
  },
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
