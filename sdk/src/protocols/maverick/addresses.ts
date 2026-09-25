import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      v2Router: "0x62e31802c6145A2D5E842EeD8efe01fC224422fA",
      v2Factory: "0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      v2Router: "0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      v2Router: "0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527",
    },
  },
];
