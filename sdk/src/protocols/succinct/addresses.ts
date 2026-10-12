import type { ChainDeployment } from "../../core/types.js";

// The SP1 verifier gateways, one for Groth16 proofs and one for PLONK, at the same addresses on
// every chain Succinct deploys them to: `contracts/deployments/<chainId>.json` in
// succinctlabs/sp1-contracts. Each routes a proof to a version's verifier, which Succinct adds and
// may freeze.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      verifierGatewayGroth16: "0x397A5f7f3dBd538f23DE225B51f532c34448dA9B",
      verifierGatewayPlonk: "0x3B6041173B80E77f038f3F2C0f9744f04837185e",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      verifierGatewayGroth16: "0x397A5f7f3dBd538f23DE225B51f532c34448dA9B",
      verifierGatewayPlonk: "0x3B6041173B80E77f038f3F2C0f9744f04837185e",
    },
  },
];
