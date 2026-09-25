import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      gpv2Settlement: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      gpv2Settlement: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    },
  },
];
