import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Gamma Strategies",
  slug: "gamma",
  description:
    "Active concentrated liquidity management protocol. Manages Uniswap V3 and other DEX positions with automated rebalancing.",
  website: "https://www.gamma.xyz",
  github: "https://github.com/GammaStrategies",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
