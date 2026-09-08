import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Wormhole",
  slug: "wormhole",
  description:
    "Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.",
  website: "https://wormhole.com",
  github: "https://github.com/wormhole-foundation/wormhole",
  npm: "@wormhole-foundation/sdk",
  category: "cross-chain",
  chains: deployments,
  audited: true,
  tvl: "$3B+",
};
