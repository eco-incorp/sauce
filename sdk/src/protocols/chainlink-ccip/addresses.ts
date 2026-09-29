import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — CCIP directory (docs.chain.link/api/ccip/v1/chains, arc-mainnet, selector
    // 6370580034781731079). getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): typeAndVersion() == "Router 1.2.0".
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      router: "0xB79791184973589c38e114D43Eb8E4588C283A18",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      router: "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      router: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      router: "0x3206695CaE29952f4b0c22a169725a865bc8Ce0f",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      router: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      router: "0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe",
    },
  },
];
