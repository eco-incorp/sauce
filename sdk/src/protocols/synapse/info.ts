import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Synapse Protocol",
  slug: "synapse",
  description:
    "Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.",
  website: "https://synapseprotocol.com",
  github: "https://github.com/synapsecns/synapse-contracts",
  npm: "@synapsecns/sdk-router",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
