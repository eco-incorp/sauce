import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Celer Network",
  slug: "celer",
  description:
    "Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.",
  website: "https://cbridge.celer.network",
  github: "https://github.com/celer-network/sgn-v2-contracts",
  npm: "@celer-network/contracts",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$150M+",
};
