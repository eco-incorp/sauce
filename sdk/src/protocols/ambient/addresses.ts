import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      crocSwapDex: "0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      // Scroll has its own CrocSwapDex; the Ethereum address has no code here.
      crocSwapDex: "0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106",
    },
  },
];
