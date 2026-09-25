import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      liquidity: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      liquidity: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497",
    },
  },
];
