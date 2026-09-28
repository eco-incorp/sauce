import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      // factory() is SpookySwap's factory and WETH() is WFTM; the address listed before had no code.
      v2Router: "0xF491e7B69E4244ad4002BC14e878a34207E38c29",
    },
  },
];
