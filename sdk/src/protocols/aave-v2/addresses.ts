import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      lendingPool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      lendingPool: "0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      lendingPool: "0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C",
    },
  },
];
