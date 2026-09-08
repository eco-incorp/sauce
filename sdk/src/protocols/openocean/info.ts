import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "OpenOcean",
  slug: "openocean",
  description:
    "Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.",
  website: "https://openocean.finance",
  github: "https://github.com/openocean-finance",
  category: "aggregator",
  chains: deployments,
  audited: true,
  tvl: "$200M+",
};
