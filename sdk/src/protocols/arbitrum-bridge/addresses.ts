import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1GatewayRouter: "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      l2GatewayRouter: "0x5288c571Fd7aD117beA99bF60FE0846C4E84F933",
    },
  },
];
