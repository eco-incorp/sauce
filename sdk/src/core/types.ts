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

/**
 * A native coin that is ALSO an ERC-20: one balance, read two ways. `eth_getBalance`, `msg.value`
 * and gas use the native scale; `balanceOf` and `transfer` at `address` use `decimals`. Sending
 * native value and calling `transfer` move the same money. Nothing needs wrapping, so such a chain
 * has no canonical wrapped native, and a WETH9-style call has no canonical target there.
 */
export interface NativeErc20 {
  address: `0x${string}`;
  decimals: number;
}

/** EVM chain definition */
export interface Chain {
  id: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    /** Present only where the native coin is itself an ERC-20 (Arc's USDC). */
    erc20?: NativeErc20;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  testnet: boolean;
}
