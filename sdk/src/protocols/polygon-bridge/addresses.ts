import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      rootChainManager: "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77",
      erc20Predicate: "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf",
      etherPredicate: "0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      childChainManager: "0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa",
    },
  },
];
