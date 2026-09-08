import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "BaseSwap",
  slug: "baseswap",
  description:
    "Base-native DEX with UniV2-style constant product pools. Features yield farming, launchpad, and NFT marketplace.",
  website: "https://baseswap.fi",
  github: "https://github.com/baseswapfi",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$15M+",
};
