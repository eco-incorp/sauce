import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Euler V2",
  slug: "euler-v2",
  description:
    "Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.",
  website: "https://euler.finance",
  github: "https://github.com/euler-xyz/euler-vault-kit",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
