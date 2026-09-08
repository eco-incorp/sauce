import type { Address } from "viem";

/** Chain ID to deployment addresses mapping */
export interface ChainDeployment {
  chainId: number;
  chainName: string;
  addresses: Record<string, Address>;
}

/** Protocol metadata */
export interface ProtocolInfo {
  name: string;
  slug: string;
  description: string;
  website: string;
  github?: string;
  npm?: string;
  category: ProtocolCategory;
  chains: ChainDeployment[];
  audited: boolean;
  tvl?: string;
  deprecated?: boolean;
}

export type ProtocolCategory =
  | "dex"
  | "lending"
  | "bridge"
  | "yield"
  | "derivatives"
  | "staking"
  | "oracle"
  | "cdp"
  | "insurance"
  | "launchpad"
  | "nft-marketplace"
  | "liquid-staking"
  | "restaking"
  | "rwa"
  | "payments"
  | "privacy"
  | "governance"
  | "options"
  | "perpetuals"
  | "synthetics"
  | "aggregator"
  | "cross-chain"
  | "infrastructure";

/** ABI entry for a protocol contract */
export interface ContractABI {
  contractName: string;
  abi: readonly object[];
  address?: Address;
}

/** A Sauce function that interacts with a protocol */
export interface SauceFunction {
  name: string;
  description: string;
  params: SauceParam[];
  returns?: string;
  sauceScript: string;
}

export interface SauceParam {
  name: string;
  type: "Address" | "Uint256" | "Bytes" | "Bytes32" | "Bool";
  description: string;
}

/** EVM chain definition */
export interface Chain {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  testnet: boolean;
}
