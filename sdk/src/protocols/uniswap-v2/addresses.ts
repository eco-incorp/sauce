import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
      router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      factory: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9",
      router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      factory: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
      router: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      factory: "0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C",
      router: "0xedf6066a2b290C185783862C7F4776A2C8077AD1",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
      router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
      router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      factory: "0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C",
      router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    },
  },
  {
    chainId: 81457,
    chainName: "Blast",
    addresses: {
      factory: "0x5C346464d33F90bABaf70dB6388507CC889C1070",
      router: "0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035",
    },
  },
  {
    chainId: 7777777,
    chainName: "Zora",
    addresses: {
      factory: "0x0F797dC7efaEA995bB916f268D919d0a1950eE3C",
      router: "0xa00F34A632630EFd15223B1968358bA4845bEEC7",
    },
  },
];
