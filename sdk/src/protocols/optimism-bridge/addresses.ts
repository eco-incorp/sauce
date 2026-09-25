import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1StandardBridge: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      l2StandardBridge: "0x4200000000000000000000000000000000000010",
    },
  },
];
