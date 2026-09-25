import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      cbETH: "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    },
  },
];
