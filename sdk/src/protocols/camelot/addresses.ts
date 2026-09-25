import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      v2Factory: "0x6EcCab422D763aC031210895C81787E87B43A652",
      v2Router: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
      v3Factory: "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B",
      v3SwapRouter: "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
    },
  },
];
