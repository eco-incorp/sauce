import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      lendingPool: "0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1",
    },
  },
];
