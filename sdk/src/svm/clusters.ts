import type { Address } from "@solana/kit";
import { ENGINE_CHAIN_IDS } from "./engine.js";

/** Solana cluster definition (parallel to the EVM `Chain` registry in chains/). */
export interface SolanaCluster {
  cluster: "mainnet-beta" | "devnet" | "localnet";
  /** Synthetic chain id reported by the engine's CHAIN_ID opcode on this cluster. */
  engineChainId: bigint;
  rpcUrl?: string;
  /** No engine deployment exists yet — callers supply the program id, matching the repo convention. */
  engineProgramId?: Address;
}

export const SOLANA_CLUSTERS: Record<SolanaCluster["cluster"], SolanaCluster> = {
  "mainnet-beta": {
    cluster: "mainnet-beta",
    engineChainId: ENGINE_CHAIN_IDS.mainnet,
    rpcUrl: "https://api.mainnet-beta.solana.com",
  },
  devnet: {
    cluster: "devnet",
    engineChainId: ENGINE_CHAIN_IDS.devnet,
    rpcUrl: "https://api.devnet.solana.com",
  },
  localnet: {
    cluster: "localnet",
    engineChainId: ENGINE_CHAIN_IDS.devnet,
  },
};
