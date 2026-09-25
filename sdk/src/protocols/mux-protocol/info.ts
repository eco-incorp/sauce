import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "MUX Protocol",
  slug: "mux-protocol",
  description:
    "Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs for best execution with shared liquidity pool.",
  website: "https://mux.network",
  github: "https://github.com/mux-world/mux-protocol",
  category: "perpetuals",
  chains: deployments,
  audited: true,
};
