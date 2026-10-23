import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "KyberSwap",
  slug: "kyberswap",
  description:
    "Multi-chain DEX aggregator and concentrated liquidity protocol (Elastic). Features dynamic fees and a meta-aggregation router that routes across DEXes.",
  website: "https://kyberswap.com",
  github: "https://github.com/KyberNetwork",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$50M+",
};
