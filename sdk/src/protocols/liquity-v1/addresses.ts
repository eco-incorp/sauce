import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      lusd: "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0",
      borrowerOperations: "0x24179CD81c9e782A4096035f7eC97fB8B783e007",
    },
  },
];
