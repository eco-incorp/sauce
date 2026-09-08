import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aevo",
  slug: "aevo",
  description:
    "High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.",
  website: "https://www.aevo.xyz",
  github: "https://github.com/aevoxyz",
  category: "options",
  chains: deployments,
  audited: true,
};
