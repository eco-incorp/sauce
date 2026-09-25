import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "KyberSwap Aggregator",
  slug: "kyberswap-aggregator",
  description:
    "Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.",
  website: "https://kyberswap.com",
  github: "https://github.com/KyberNetwork",
  npm: "@kyberswap/ks-sdk-core",
  category: "aggregator",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
