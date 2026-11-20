import type { ChainDeployment } from "../../core/types.js";

// `oracle` is each market's AaveOracle, read on chain as `poolAddressesProvider.getPriceOracle()`
// (its `ADDRESSES_PROVIDER()` answers the provider back); where the provider was not listed, it is
// `pool.ADDRESSES_PROVIDER()`, whose `getPool()` answers the pool. Both read 2026-11-02.
export const deployments: ChainDeployment[] = [
  {
    // Monad (143) — Aave V3.7. Both addresses getCode-verified on-chain 2026-08-31
    // (rpc-mainnet.monadinfra.com). Source: bgd-labs/aave-address-book AaveV3Monad.sol.
    chainId: 143,
    chainName: "Monad",
    addresses: {
      pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
      poolAddressesProvider: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615",
      oracle: "0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      poolAddressesProvider: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
      oracle: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      oracle: "0xb023e699F5a33916Ea823A16485e259257cA8Bd1",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      oracle: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      oracle: "0xD81eb3728a631871a7eBBaD631b5f424909f0c77",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      oracle: "0xEBd36016B3eD09D4693Ed4251c67Bd858c3c7C9C",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
      poolAddressesProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
      oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
      poolAddressesProvider: "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D",
      oracle: "0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697",
    },
  },
  {
    chainId: 534352,
    chainName: "Scroll",
    addresses: {
      pool: "0x11fCfe756c05AD438e312a7fd934381537D3cFfe",
      poolAddressesProvider: "0x69850D0B276776781C063771b161bd8894BCdD04",
      oracle: "0x04421D8C506E2fA2371a08EfAaBf791F624054F3",
    },
  },
  {
    chainId: 250,
    chainName: "Fantom",
    addresses: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      oracle: "0xfd6f3c1845604C8AE6c6E402ad17fb9885160754",
    },
  },
  {
    chainId: 100,
    chainName: "Gnosis",
    addresses: {
      pool: "0xb50201558B00496A145fE76f7424749556E326D8",
      poolAddressesProvider: "0x36616cf17557639614c1cdDb356b1B83fc0B2132",
      oracle: "0xeb0a051be10228213BAEb449db63719d6742F7c4",
    },
  },
  {
    chainId: 1088,
    chainName: "Metis",
    addresses: {
      pool: "0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57",
      poolAddressesProvider: "0xB9FABd7500B2C6781c35Dd48d54f81fc2299D7AF",
      oracle: "0x38D36e85E47eA6ff0d18B0adF12E5fC8984A6f8e",
    },
  },
];
