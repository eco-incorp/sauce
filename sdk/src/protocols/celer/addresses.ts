import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      bridge: "0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      bridge: "0x1619DE6B6B20eD217a58d00f37B9d47C7663feca",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      bridge: "0x9D39Fc627A6d9d9F8C831c16995b209548cc3401",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      bridge: "0x88DCDC47D2f83a99CF0000FDF667A468bB958a78",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      bridge: "0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      bridge: "0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4",
    },
  },
];
