import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Monad (143) — Aave V3.7. Both addresses getCode-verified on-chain 2026-08-31
    // (rpc-mainnet.monadinfra.com). Source: bgd-labs/aave-address-book AaveV3Monad.sol.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
      poolAddressesProvider: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      poolAddressesProvider: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
      poolAddressesProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      pool: "0x11fCfe756c05AD438e312a7fd934381537D3cFfe",
    },
  },
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    },
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    addresses: {
      pool: "0xb50201558B00496A145fE76f7424749556E326D8",
    },
  },
  {
    chainId: 1088,
    chainName: "Metis",
    addresses: {
      pool: "0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57",
    },
  },
];
