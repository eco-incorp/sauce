import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — hyperlane-registry chains/arc/addresses.yaml. getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): localDomain() == 5042.
    // (0xeA87…4f1D, Base's mailbox in this file, is Arc's proxyAdmin — not a mailbox.)
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      mailbox: "0x7f50C5776722630a0024fAE05fDe8b47571D7B39",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      mailbox: "0xc005dc82818d67AF737725bD4bf75435d065D239",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      mailbox: "0x979Ca5202784112f4738403dBec5D0F3B9daabB9",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      mailbox: "0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      mailbox: "0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      mailbox: "0x5d934f4e2f797775e53561bB72aca21ba36B96BB",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      mailbox: "0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      mailbox: "0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4",
    },
  },
];
