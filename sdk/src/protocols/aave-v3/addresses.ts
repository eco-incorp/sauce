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
  // Ethereum Sepolia (11155111) — Aave's "Ethereum Sepolia V3 Market" (aave.com/docs/resources/addresses,
  // V3 > Testnet; bgd-labs/aave-address-book AaveV3Sepolia.sol). Verified on-chain 2026-10-27:
  // pool.ADDRESSES_PROVIDER() == poolAddressesProvider, poolAddressesProvider.getPool() == pool, and
  // getMarketId() == "Ethereum Aave Market". Its reserves are Aave's own test tokens (its USDC and
  // WETH are not the registry's), so a program names them by address.
  {
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    addresses: {
      pool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      poolAddressesProvider: "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A",
    },
  },
  // Base Sepolia (84532) — Aave's address book, bgd-labs/aave-address-book AaveV3BaseSepolia.sol
  // (aave.com/docs/resources/addresses lists only the Sepolia testnet market). Verified on-chain
  // 2026-10-27: pool.ADDRESSES_PROVIDER() == poolAddressesProvider, poolAddressesProvider.getPool()
  // == pool, and getMarketId() == "Aave V3 Base Testnet Market". Its WETH reserve is Base Sepolia's
  // WETH9 predeploy; its USDC is Aave's own test token, not the registry's.
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    addresses: {
      pool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
      poolAddressesProvider: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00",
    },
  },
];
