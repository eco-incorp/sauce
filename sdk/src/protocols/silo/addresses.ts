import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      siloRepository: "0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      // Arbitrum's SiloRepository; the Ethereum address has no code here.
      siloRepository: "0x8658047e48CC09161f4152c79155Dac1d710Ff0a",
    },
  },
];
