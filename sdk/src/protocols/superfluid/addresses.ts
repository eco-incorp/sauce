import type { ChainDeployment } from "../../core/types.js";

// Each chain's Host is Superfluid's own (`contractsV1.host` in `@superfluid-finance/metadata`'s
// networks.json): it differs per chain. The CFAv1Forwarder has one address on every chain.
export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      host: "0x4E583d9390082B65Bef884b629DFA426114CED6d",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      host: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      host: "0xCf8Acb4eF033efF16E8080aed4c7D5B9285D2192",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      host: "0x567c4B141ED61923967cA25Ef4906C8781069a10",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      host: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
];
