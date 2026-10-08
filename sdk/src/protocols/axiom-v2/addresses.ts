import type { ChainDeployment } from "../../core/types.js";

// AxiomV2Query, the contract a query is sent to and its callback comes from: an ERC-1967 proxy on
// each chain, whose HeaderVerifier proves that chain's own history (`getSourceChainId()` is the
// chain's id). Ethereum's is axiom-v2-contracts' `script/config/deployed.json` and the docs'
// contract-address page; Base's is `@axiom-crypto/client`'s `lib/address.ts` from its Base mainnet
// support (2024-04-21) until v2.1.1 dropped Base.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      query: "0x83c8c0B395850bA55c830451Cfaca4F2A667a983",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      query: "0xfe059442B0379D5f22Bec384A588766f98A36812",
    },
  },
];
