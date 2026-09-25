import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      diamond: "0xa079C6B032133b95Cf8b3d273D27eeb6B110a469",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      diamond: "0xc22FAe86443aEed038A4ED887bbA8F5035FD12F0",
    },
  },
];
