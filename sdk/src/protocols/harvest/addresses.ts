import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      controller: "0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C",
      farm: "0xa0246c9032bC3A600820415aE600c6388619A14D",
      depositHelper: "0xF8ce90c2710713552fb564869694B2505Bfc0846",
    },
  },
];
