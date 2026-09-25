import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Swell",
  slug: "swell",
  description:
    "Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking.",
  website: "https://www.swellnetwork.io",
  github: "https://github.com/SwellNetwork",
  category: "liquid-staking",
  chains: deployments,
  audited: true,
  tvl: "$800M+",
};
