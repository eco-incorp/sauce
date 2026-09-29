import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Synthra V3",
  slug: "synthra-v3",
  description:
    "Concentrated-liquidity spot DEX on Arc and Robinhood Chain: a Uniswap V3 fork whose pool callbacks are renamed (synthraV3SwapCallback / synthraV3MintCallback).",
  website: "https://synthra.org",
  category: "dex",
  chains: deployments,
  audited: false,
};
