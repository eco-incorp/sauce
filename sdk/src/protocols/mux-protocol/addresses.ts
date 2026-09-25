import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      orderBook: "0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3",
      liquidityPool: "0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633",
    },
  },
];
