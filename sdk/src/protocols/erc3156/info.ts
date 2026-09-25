import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ERC-3156",
  slug: "erc3156",
  description:
    "Standard interface for flash loans defined in EIP-3156. Provides flashLoan, flashFee, and maxFlashLoan functions that any conforming lender can implement.",
  website: "https://eips.ethereum.org/EIPS/eip-3156",
  github: "https://github.com/OpenZeppelin/openzeppelin-contracts",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
