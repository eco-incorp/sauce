import type { ChainDeployment } from "../../core/types.js";

// No Arbitrum entry: the address listed there before is an old Visor hypervisor (xUSDC-ETH.05),
// not a UniProxy. Gamma runs a separate UniProxy per DEX integration on Arbitrum.
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
];
