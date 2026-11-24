import type { ChainDeployment } from "../../core/types.js";

// Circle CCTP v2 TokenMessengerV2. Circle deploys it at the SAME address on every supported EVM
// mainnet (deterministic deployment) — every row below was confirmed by an on-chain `eth_getCode`
// probe returning the identical 2176-byte runtime. Listed per-chain (not a constant) so the accessor
// resolves it like every other protocol and a future chain-specific redeployment is a one-line edit.
const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

// The testnet TokenMessengerV2 (developers.circle.com/cctp/references/contract-addresses, "Testnet
// contract addresses"): one address on every testnet Circle lists, and not the mainnet one. Probed
// 2026-10-27 on Arc Testnet, Base Sepolia and Ethereum Sepolia: the same 2175-byte EIP-1967 proxy
// over an implementation the size of its mainnet's (14890 bytes; Arc Testnet's 16283, as on Arc),
// dispatching the 7-argument V2 depositForBurn; its localMessageTransmitter() is the testnet
// MessageTransmitterV2, whose localDomain() is the chain's domain (26, 6 and 0).
const TOKEN_MESSENGER_V2_TESTNET = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 10, chainName: "Optimism", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 130, chainName: "Unichain", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 137, chainName: "Polygon", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 143, chainName: "Monad", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 146, chainName: "Sonic", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 5042, chainName: "Arc", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 8453, chainName: "Base", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 43114, chainName: "Avalanche", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  { chainId: 59144, chainName: "Linea", addresses: { tokenMessenger: TOKEN_MESSENGER_V2 } },
  {
    chainId: 5042002,
    chainName: "Arc Testnet",
    addresses: { tokenMessenger: TOKEN_MESSENGER_V2_TESTNET },
  },
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    addresses: { tokenMessenger: TOKEN_MESSENGER_V2_TESTNET },
  },
  {
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    addresses: { tokenMessenger: TOKEN_MESSENGER_V2_TESTNET },
  },
];

/**
 * Circle CCTP DOMAIN ids (NOT EVM chain ids) — the `destinationDomain` argument of `depositForBurn`,
 * keyed by canonical chain slug. Kept beside the addresses so a route resolves BOTH the messenger
 * address and the destination domain from the protocol, never a hardcoded literal in the recipe.
 */
export const CCTP_DOMAIN: Readonly<Record<string, number>> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  unichain: 10,
  linea: 11,
  sonic: 13,
  monad: 15,
  // docs.arc.io contract-addresses (CCTP, domain 26); MessageTransmitterV2.localDomain() == 26 on-chain.
  arc: 26,
  // A testnet takes its mainnet's domain (developers.circle.com/cctp/concepts/
  // supported-chains-and-domains); MessageTransmitterV2.localDomain() reads 26, 6 and 0 on the three.
  "arc-testnet": 26,
  "base-sepolia": 6,
  sepolia: 0,
};
