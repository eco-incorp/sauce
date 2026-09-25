import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      l1EthBridge: "0xb8901acb165ed027e32754e0ffe830802919727f",
      l1UsdcBridge: "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      l2AmmWrapper: "0x33ceb27b39d2Bb7D2e36F8Cda811Da1d199967c8",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      l2AmmWrapper: "0x86cA30bEF97fB651b8d866D45503684b90cb3312",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      l2AmmWrapper: "0x76b22b8C1079A44F1211D867D68b1eda76a635A7",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      l2AmmWrapper: "0x46ae9BaB8CEA96610807a275EBD36f8e916b5571",
    },
  },
];
