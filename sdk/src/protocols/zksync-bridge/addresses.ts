import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      diamondProxy: "0x32400084C286CF3E17e7B677ea9583e60a000324",
    },
  },
  {
    chainId: 324,
    chainName: "zkSync",
    addresses: {
      l2Bridge: "0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102",
    },
  },
];
