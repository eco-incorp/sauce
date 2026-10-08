import type { ChainDeployment } from "../../core/types.js";

// The MetalayerRouter, one address on every chain (Caldera's docs, metalayer/resources/
// contract-deployments). Listed on the chains where eco-routes proves intents through it: each row
// is the address eco-routes' MetaProver (0x52Adfe10…) reads as its `ROUTER()`, read on-chain
// 2026-10-08. Each router dispatches through Metalayer's own Hyperlane mailbox, not Hyperlane's
// (its `mailbox()`, whose `localDomain()` is the chain id on each of these).
const ROUTER = "0x09cE71C24EE2098e351C0cF2dC6431B414d247f3";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { router: ROUTER } },
  { chainId: 56, chainName: "BSC", addresses: { router: ROUTER } },
  { chainId: 8453, chainName: "Base", addresses: { router: ROUTER } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { router: ROUTER } },
];
