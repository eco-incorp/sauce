import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1StandardBridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      l2StandardBridge: "0x4200000000000000000000000000000000000010",
    },
  },
];
