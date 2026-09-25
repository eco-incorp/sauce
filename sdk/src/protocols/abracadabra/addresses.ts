import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      degenBox: "0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce",
      mim: "0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      degenBox: "0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38",
      mim: "0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A",
    },
  },
];
