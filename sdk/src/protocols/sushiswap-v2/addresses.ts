import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
      router: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    },
  },
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      factory: "0xFbc12984689e5f15626Bad03Ad60160Fe98B303C",
      router: "0x4C5D5234f232BD2D76B96aA33F5AE4FCF0E4BFAb",
    },
  },
];
