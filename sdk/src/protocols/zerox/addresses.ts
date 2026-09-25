import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      exchangeProxy: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
    },
  },
];
