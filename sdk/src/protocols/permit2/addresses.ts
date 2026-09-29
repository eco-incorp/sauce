import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — canonical Permit2 (docs.arc.io contract-addresses). getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436):
    // DOMAIN_SEPARATOR() equals the EIP-712 domain for chain 5042 at this address.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    // Monad (143) — canonical cross-chain Permit2. getCode-verified on-chain 2026-08-31.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  },
];
