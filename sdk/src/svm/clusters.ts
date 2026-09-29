import type { Address } from "@solana/kit";
import { ENGINE_CHAIN_IDS } from "./engine.js";

/**
 * Solana cluster definition (parallel to the EVM `Chain` registry in chains/).
 *
 * Carries no RPC endpoint: the SDK ships none. Pass your cluster's URL as `rpcUrl` to
 * `createSauceSvmClient`.
 */
export interface SolanaCluster {
  cluster: "mainnet-beta" | "devnet" | "localnet";
  /** Synthetic chain id reported by the engine's CHAIN_ID opcode on this cluster. */
  engineChainId: bigint;
  /** No engine deployment exists yet — callers supply the program id, matching the repo convention. */
  engineProgramId?: Address;
}

export const SOLANA_CLUSTERS: Record<SolanaCluster["cluster"], SolanaCluster> = {
  "mainnet-beta": {
    cluster: "mainnet-beta",
    engineChainId: ENGINE_CHAIN_IDS.mainnet,
  },
  devnet: {
    cluster: "devnet",
    engineChainId: ENGINE_CHAIN_IDS.devnet,
  },
  localnet: {
    cluster: "localnet",
    engineChainId: ENGINE_CHAIN_IDS.devnet,
  },
};
