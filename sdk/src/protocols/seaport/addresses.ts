import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Seaport 1.6's canonical address (ProjectOpenSea/seaport; a keyless CREATE2
    // deployment, so the address commits to the init code). getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): information() returns version
    // "1.6" and the canonical ConduitController 0x00000000F9490004C11Cef243f5400493c00Ad63.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      seaportV16: "0x0000000000000068F116a894984e2DB1123eB395",
    },
  },
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
