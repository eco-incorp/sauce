import type { ChainDeployment } from "../../core/types.js";

// Polymer's CrossL2ProverV2, at its mainnet canonical address (polymerdao/prover-contracts
// docs/deployments.md, `PROVER_V2_ADDRESS`). Listed on the chains where eco-routes proves intents
// through it: each row is the address eco-routes' PolymerProver (0xEC0DeD08…) reads as its
// `CROSS_L2_PROVER_V2()`, read on-chain 2026-10-08, and the prover there answers `clientType()`
// "proof_api" and its sequencer 0x4632e987…6209.
const CROSS_L2_PROVER_V2 = "0x95ccEAE71605c5d97A0AC0EA13013b058729d075";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 10, chainName: "Optimism", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 130, chainName: "Unichain", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 137, chainName: "Polygon", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 143, chainName: "Monad", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 5042, chainName: "Arc", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 8453, chainName: "Base", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 9745, chainName: "Plasma", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { crossL2ProverV2: CROSS_L2_PROVER_V2 } },
];
