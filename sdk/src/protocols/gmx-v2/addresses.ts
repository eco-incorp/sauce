import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      // GMX redeploys the ExchangeRouter on upgrades and revokes the old one's CONTROLLER role;
      // this is the router RoleStore (0x3c3d99FD298f679DBC2CEcd132b4eC4d0F5e6e72) currently grants it.
      exchangeRouter: "0x7dE39FF2e232A2203196788d37e234cF8F1b83f1",
      dataStore: "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8",
    },
  },
];
