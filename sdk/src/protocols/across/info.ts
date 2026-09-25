import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Across",
  slug: "across",
  description:
    "Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.",
  website: "https://across.to",
  github: "https://github.com/across-protocol/contracts",
  npm: "@across-protocol/contracts",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};
