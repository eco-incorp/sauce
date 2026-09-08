import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Pendle",
  slug: "pendle",
  description:
    "Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading.",
  website: "https://www.pendle.finance",
  github: "https://github.com/pendle-finance",
  npm: "@pendle/sdk-v2",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$2.6B+",
};
