import type { ChainDeployment } from "../../core/types.js";

const EXCHANGE_V2 = "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 56, chainName: "BSC", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 137, chainName: "Polygon", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 43114, chainName: "Avalanche", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 250, chainName: "Fantom", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { exchangeV2: EXCHANGE_V2 } },
  { chainId: 10, chainName: "Optimism", addresses: { exchangeV2: EXCHANGE_V2 } },
];
