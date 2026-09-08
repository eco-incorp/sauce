import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Curve Finance",
  slug: "curve",
  description:
    "StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens).",
  website: "https://curve.fi",
  github: "https://github.com/curvefi",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$2B+",
};
