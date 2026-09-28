import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      // lToken.core() on Scroll. The address listed here before (0x009a0b7C…3833) is the
      // Linea deployment's Core and has no code on Scroll.
      core: "0xEC53c830f4444a8A56455c6836b5D2aA794289Aa",
    },
  },
];
