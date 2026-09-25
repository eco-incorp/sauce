import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      v2Factory: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32",
      v2Router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
      v3Factory: "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28",
      v3SwapRouter: "0xf5b509bB0909a69B1c207E495f687a596C168e12",
    },
  },
];
