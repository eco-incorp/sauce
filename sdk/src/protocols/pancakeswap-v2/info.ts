import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "PancakeSwap V2",
  slug: "pancakeswap-v2",
  description:
    "DEX on BNB Chain using the constant product AMM model. Forked from Uniswap V2 with additional features like yield farming and lottery.",
  website: "https://pancakeswap.finance",
  github: "https://github.com/pancakeswap/pancake-smart-contracts",
  npm: "@pancakeswap/v2-sdk",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$1.5B+",
};
