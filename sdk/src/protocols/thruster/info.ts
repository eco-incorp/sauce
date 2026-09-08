import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Thruster",
  slug: "thruster",
  description:
    "Blast-native DEX with concentrated liquidity (V3) pools. Optimized for Blast's native yield and gas rebate features.",
  website: "https://thruster.finance",
  github: "https://github.com/ThrusterX",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$40M+",
};
