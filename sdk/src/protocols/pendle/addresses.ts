import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Monad (143) — Pendle. router getCode-verified on-chain 2026-08-31; it is Pendle's
    // standard cross-chain router proxy (the SAME 0x8888…F946 the other chains use here),
    // confirmed for chain 143 by pendle-finance/pendle-core-v2-public deployments/143-core.json.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      router: "0x888888888889758F76e7103c6CbF23ABbF58F946",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      router: "0x888888888889758F76e7103c6CbF23ABbF58F946",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      router: "0x888888888889758F76e7103c6CbF23ABbF58F946",
    },
  },
];
