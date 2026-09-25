import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      poolNative: "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931",
      poolUSDC: "0xc026395860Db2d07ee33e05fE50ed7bD583189C7",
      poolUSDT: "0x933597a323Eb81cAe705C5bC29985172fd5A3973",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      poolNative: "0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F",
      poolUSDC: "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      poolNative: "0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7",
      poolUSDC: "0x27a16dc786820B16E5c9028b75B99F6f604b5d26",
    },
  },
];
