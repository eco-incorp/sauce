import type { ChainDeployment } from "../../core/types.js";

// No Polygon entry: the spoke address used on the other chains has no code on Polygon.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      everclearSpoke: "0xa05A3380889115bf313f1Db9d5f335157Be4D816",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      everclearSpoke: "0xa05A3380889115bf313f1Db9d5f335157Be4D816",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      everclearSpoke: "0xa05A3380889115bf313f1Db9d5f335157Be4D816",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      everclearSpoke: "0xa05A3380889115bf313f1Db9d5f335157Be4D816",
    },
  },
];
