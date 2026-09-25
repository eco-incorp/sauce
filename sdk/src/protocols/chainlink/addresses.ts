import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      ethUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      feedRegistry: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf",
      vrfV2Coordinator: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    },
  },
];
