import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      endpoint: "0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965",
      clearinghouse: "0x773bb71b0108b060b76746422ee810bfec9a963d",
    },
  },
];
