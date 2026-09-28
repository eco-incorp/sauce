import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      // Base's CoreProxy (getUsdToken() is snxUSD); the address listed before is not deployed on Base.
      coreProxy: "0x32C222A9A159782aFD7529c87FA34b96CA72C696",
      perpsMarketProxy: "0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce",
    },
  },
];
