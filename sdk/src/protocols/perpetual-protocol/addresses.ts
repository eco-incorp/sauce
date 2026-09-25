import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      clearingHouse: "0x82ac2CE43e33683c58BE4cDc40975E73aA50f459",
      vault: "0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60",
    },
  },
];
