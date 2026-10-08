import type { ChainDeployment } from "../../core/types.js";

// The Entropy contract, from Pyth's own deployment list (pyth-crosschain
// contract_manager/src/store/contracts/EvmEntropyContracts.json and the entropy explorer's
// entropy-deployments.tsx). Base's is an ERC1967Proxy (Sourcify) whose `version()` is "2.0.0" and
// whose `getDefaultProvider()` is Pyth's provider 0x52DeaA1c84233F7bb8C8A45baeDE41091c616506.
// getCode + view-call verified on-chain 2026-10-08. Entropy is not deployed on Ethereum mainnet:
// chain 1 is in neither list nor Fortuna's chain configs, and no Entropy address has code there.
export const deployments: ChainDeployment[] = [
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      entropy: "0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb",
    },
  },
];
