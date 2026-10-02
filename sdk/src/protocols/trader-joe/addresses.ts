import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      lbFactory: "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c",
      lbRouter: "0x18556DA13313f3532c54711497A8FedAC273220E",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      // LB v2.2, at its Avalanche address: lbRouter.getFactory().
      lbFactory: "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c",
      lbRouter: "0x18556da13313f3532c54711497a8fedac273220e",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      // LB v2.1 here, router and factory both: lbRouter.getFactory(). Its getLBPairInformation and
      // its pairs' reads and swap are v2.2's.
      lbFactory: "0x8e42f2F4101563bF679975178e880FD87d3eFd4e",
      lbRouter: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
    },
  },
];
