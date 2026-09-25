import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      liquidityPool: "0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      liquidityPool: "0x32B7bF19cb8b95C27E644183837813d4b595dcc6",
    },
  },
];
