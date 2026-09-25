import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      host: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
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
      host: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      host: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      host: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
      cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
    },
  },
];
