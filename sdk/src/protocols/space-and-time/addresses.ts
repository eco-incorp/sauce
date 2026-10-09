import type { ChainDeployment } from "../../core/types.js";

// The QueryRouter a query is asked of, and the CallbackExecutor its result is called back from: the
// same addresses on both chains (deployed by 0x00f8B1Cc17EA5fb9983d069ED2B71Ea9D07D700F at nonces 6
// and 5), with source verified on Sourcify. They differ in one library: Base's CallbackExecutor
// charges no callback gas when its gas-cost scaling factor is zero, which Base's is.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      queryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
      callbackExecutor: "0xaCf075862425A0c839844369ac20e334B3710e47",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      queryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
      callbackExecutor: "0xaCf075862425A0c839844369ac20e334B3710e47",
    },
  },
];
