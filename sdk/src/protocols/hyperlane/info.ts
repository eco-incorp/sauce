import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Hyperlane",
  slug: "hyperlane",
  description:
    "Permissionless interchain messaging protocol. Supports modular security with ISMs (Interchain Security Modules) across 150+ chains.",
  website: "https://hyperlane.xyz",
  github: "https://github.com/hyperlane-xyz/hyperlane-monorepo",
  npm: "@hyperlane-xyz/core",
  category: "cross-chain",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
