import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      exchangeRouter: "0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8",
      dataStore: "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8",
    },
  },
];
