import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Vertex",
  slug: "vertex",
  description:
    "Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for fast order matching on Arbitrum.",
  website: "https://vertex-protocol.gitbook.io",
  github: "https://github.com/vertex-protocol",
  deprecated: true,
  category: "perpetuals",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
