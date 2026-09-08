import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Arbitrum Native Bridge",
  slug: "arbitrum-bridge",
  description:
    "Official Arbitrum L1-L2 gateway bridge. Routes tokens through the canonical Arbitrum rollup bridge with 7-day withdrawal finality.",
  website: "https://bridge.arbitrum.io",
  github: "https://github.com/OffchainLabs/token-bridge-contracts",
  category: "bridge",
  chains: deployments,
  audited: true,
};
