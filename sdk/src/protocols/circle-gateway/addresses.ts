import type { ChainDeployment } from "../../core/types.js";

// Circle Gateway (developers.circle.com/gateway/references/contract-addresses). The Wallet and
// Minter share these two addresses on every mainnet Circle lists; both are EIP-1967 proxies. Each
// chain below was verified on-chain 2026-09-28: getCode, domain() == that chain's Circle domain
// (CCTP's numbering, not the EVM chain id), isTokenSupported(<the chain's native USDC>) == true on
// both contracts, and every function in abis.ts dispatches. Circle also lists HyperEVM (19) and
// World Chain (14), which are not canonical chains here, and Solana with no mainnet deployment.
// Neither contract has code on Linea, Monad, Celo, Ink, Plasma or zkSync.
const GATEWAY = {
  gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
  gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
} as const;

// The testnet pair (the same page, "Testnet contract addresses"): one Wallet and one Minter address
// on every testnet Circle lists, NOT the mainnet pair. Probed 2026-10-27 on Arc Testnet, Base
// Sepolia and Ethereum Sepolia: mainnet's 163-byte EIP-1967 proxy over a 22818-byte wallet and a
// 12101-byte minter implementation, every function in abis.ts dispatches, domain() is the chain's
// Circle domain (26, 6 and 0) and isTokenSupported(<the chain's testnet USDC>) is true on both.
// Circle's Solana Devnet programs are not here: this registry's deployments are EVM contracts.
const GATEWAY_TESTNET = {
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
} as const;

export const deployments: ChainDeployment[] = [
  // domain 0, block 26079936
  { chainId: 1, chainName: "Ethereum", addresses: { ...GATEWAY } },
  // domain 2, block 157523873
  { chainId: 10, chainName: "Optimism", addresses: { ...GATEWAY } },
  // domain 7, block 94627591
  { chainId: 137, chainName: "Polygon", addresses: { ...GATEWAY } },
  // domain 10, block 59898210
  { chainId: 130, chainName: "Unichain", addresses: { ...GATEWAY } },
  // domain 13, block 80062710
  { chainId: 146, chainName: "Sonic", addresses: { ...GATEWAY } },
  // domain 16, block 234696448
  { chainId: 1329, chainName: "Sei", addresses: { ...GATEWAY } },
  // domain 6, block 51928590
  { chainId: 8453, chainName: "Base", addresses: { ...GATEWAY } },
  // domain 3, block 509888208
  { chainId: 42161, chainName: "Arbitrum", addresses: { ...GATEWAY } },
  // domain 1, block 96359930
  { chainId: 43114, chainName: "Avalanche", addresses: { ...GATEWAY } },
  // Arc (5042) — docs.arc.io/arc/references/contract-addresses#gateway, domain 26. Verified at
  // blocks 23287436 and 23293084 (Arc mainnet). Arc's Minter runs a different, smaller
  // implementation from the other chains' (11619 vs 12101 bytes) that dispatches the same
  // functions.
  { chainId: 5042, chainName: "Arc", addresses: { ...GATEWAY } },
  // Testnets: domain 26, 6 and 0.
  { chainId: 5042002, chainName: "Arc Testnet", addresses: { ...GATEWAY_TESTNET } },
  { chainId: 84532, chainName: "Base Sepolia", addresses: { ...GATEWAY_TESTNET } },
  { chainId: 11155111, chainName: "Ethereum Sepolia", addresses: { ...GATEWAY_TESTNET } },
];
