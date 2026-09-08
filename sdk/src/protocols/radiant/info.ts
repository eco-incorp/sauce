import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Radiant",
  slug: "radiant",
  description:
    "Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.",
  website: "https://radiant.capital",
  github: "https://github.com/radiant-capital",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
