import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ERC-4626",
  slug: "erc4626",
  description:
    "Standard interface for tokenized vaults (EIP-4626). Provides deposit, withdraw, mint, redeem and preview functions that any conforming vault implements.",
  website: "https://eips.ethereum.org/EIPS/eip-4626",
  github: "https://github.com/OpenZeppelin/openzeppelin-contracts",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
