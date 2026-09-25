import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
];
