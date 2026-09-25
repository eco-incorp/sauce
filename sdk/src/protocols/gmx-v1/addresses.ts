import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      vault: "0x489ee077994B6658eAfA855C308275EAd8097C4A",
      router: "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064",
      positionRouter: "0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868",
      glp: "0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      vault: "0x9ab2De34A33fB459b538c43f251eB825645e8595",
      router: "0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8",
    },
  },
];
