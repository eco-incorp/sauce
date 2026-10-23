import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      endpoint: "0x73EAB16c88B9f38d3f2661C9e5875Ec0eEEE2965",
      clearinghouse: "0x773BB71B0108b060b76746422eE810Bfec9A963d",
    },
  },
];
