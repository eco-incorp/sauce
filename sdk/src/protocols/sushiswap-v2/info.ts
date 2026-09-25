import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "SushiSwap V2",
  slug: "sushiswap-v2",
  description:
    "Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment.",
  website: "https://sushi.com",
  github: "https://github.com/sushiswap/v2-core",
  npm: "@sushiswap/core",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
