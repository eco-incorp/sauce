import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "QuickSwap",
  slug: "quickswap",
  description:
    "The leading DEX on Polygon with V2 (constant product) and V3 (Algebra concentrated liquidity) pools. Low-fee trading powered by Polygon's infrastructure.",
  website: "https://quickswap.exchange",
  github: "https://github.com/QuickSwap",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$80M+",
};
