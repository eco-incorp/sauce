import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
      wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      wstETH: "0x5979D7b546E38E414F7E9822514be443A4800529",
    },
  },
];
