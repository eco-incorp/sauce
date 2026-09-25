import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      uniProxy: "0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      uniProxy: "0xA42d55074869491D60Ac05490376B74cF19B00e6",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      uniProxy: "0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599",
    },
  },
];
