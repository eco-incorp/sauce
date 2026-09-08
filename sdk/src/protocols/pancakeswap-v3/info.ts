import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "PancakeSwap V3",
  slug: "pancakeswap-v3",
  description:
    "Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration.",
  website: "https://pancakeswap.finance",
  github: "https://github.com/pancakeswap/pancake-v3-contracts",
  npm: "@pancakeswap/v3-sdk",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$1.2B+",
};
