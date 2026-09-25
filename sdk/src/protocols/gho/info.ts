import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "GHO",
  slug: "gho",
  description:
    "Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.",
  website: "https://aave.com/gho",
  github: "https://github.com/aave/gho-core",
  category: "cdp",
  chains: deployments,
  audited: true,
};
