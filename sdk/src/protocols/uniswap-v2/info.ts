import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Uniswap V2",
  slug: "uniswap-v2",
  description:
    "Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi.",
  website: "https://uniswap.org",
  github: "https://github.com/Uniswap/v2-core",
  npm: "@uniswap/v2-core",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$1.5B+",
};
