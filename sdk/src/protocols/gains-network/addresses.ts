import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      diamond: "0xFF162c694eAA571f685030649814282eA457f169",
      gns: "0x18c11FD286C5EC11c3b683Caa813B77f5163A122",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      diamond: "0x209A9A01980377916851af2cA075C2b170452018",
    },
  },
];
