import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — lifinance/contracts deployments/arc.json. Not the cross-chain 0x1231…4EaE
    // diamond. getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): facetAddresses() is non-empty (EIP-2535 loupe).
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      lifiDiamond: "0xA4072583658Fae592A3506A42431cb6316a8d40b",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      lifiDiamond: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    },
  },
];
