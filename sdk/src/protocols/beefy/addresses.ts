import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      BIFI: "0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      BIFI: "0xCa3F508B8e4Dd382eE878A314789373D80A5190A",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      BIFI: "0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      BIFI: "0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      BIFI: "0xd6070ae98b8069de6B494332d1A1a81B6179D960",
    },
  },
];
