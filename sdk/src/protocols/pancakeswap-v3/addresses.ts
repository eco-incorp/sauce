import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      smartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
      nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      smartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
      nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      smartRouter: "0x32226588378236Fd0c7c4053999F88aC0e5cAc77",
      nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      smartRouter: "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86",
      nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  {
    chainId: 59144,
    chainName: "Linea",
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      smartRouter: "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86",
      nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
];
