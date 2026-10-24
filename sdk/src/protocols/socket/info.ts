import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Socket",
  slug: "socket",
  description:
    "Cross-chain bridge aggregator that routes transfers across multiple bridges and DEXes for token transfers.",
  website: "https://socket.tech",
  github: "https://github.com/SocketDotTech/socket-DL",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
