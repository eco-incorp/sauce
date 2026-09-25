import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      socketGateway: "0x3a23F943181408EAC424116Af7b7790c94Cb97a5",
    },
  },
];
