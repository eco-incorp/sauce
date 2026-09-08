import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Synthetix V3",
  slug: "synthetix-v3",
  description:
    "Modular liquidity protocol powering perpetual futures and synthetic assets on Base and Optimism. Provides liquidity infrastructure for derivative protocols.",
  website: "https://synthetix.io",
  github: "https://github.com/Synthetixio/synthetix-v3",
  category: "synthetics",
  chains: deployments,
  audited: true,
  tvl: "$300M+",
};
