import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Monad (143) — PancakeSwap V2. Both addresses getCode-verified on-chain 2026-08-31.
    // Source: pancakeswap/pancake-developer contracts/v2/addresses. The Factory is a
    // shared CREATE2 address (identical across several chains); the Router is Monad-specific.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      router: "0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      factory: "0x1097053Fd2ea711dad45caCcc45EfF7548fCB362",
      router: "0xEfF92A263d31888d860bD50809A8D171709b7b1c",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    },
  },
  {
    chainId: 59144,
    chainName: "Linea",
    addresses: {
      factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    },
  },
  {
    chainId: 204,
    chainName: "opBNB",
    addresses: {
      factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    },
  },
];
