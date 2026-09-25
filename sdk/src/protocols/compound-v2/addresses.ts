import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      comptroller: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B",
      cETH: "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5",
      cUSDC: "0x39AA39c021dfbaE8faC545936693aC917d5E7563",
    },
  },
];
