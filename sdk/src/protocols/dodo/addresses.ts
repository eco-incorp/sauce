import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      dodoV2Proxy: "0xa356867fDCEa8e71AEaF87805808803806231FdC",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      dodoV2Proxy: "0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486",
    },
  },
];
