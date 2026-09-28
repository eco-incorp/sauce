import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      routerV2: "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858",
      // routerV2.defaultFactory(). The address listed before (0x8134a2fd…54c5) is the
      // vAMMV2-USDC/VELO pool, not the factory.
      poolFactory: "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
    },
  },
];
