import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Balancer V2",
  slug: "balancer-v2",
  description:
    "Generalized AMM with weighted pools, single Vault architecture, and flash loans. Supports custom pool types and multi-token pools.",
  website: "https://balancer.fi",
  github: "https://github.com/balancer/balancer-v2-monorepo",
  npm: "@balancer-labs/v2-deployments",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$1B+",
};
