import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Harvest Finance",
  slug: "harvest",
  description:
    "Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.",
  website: "https://harvest.finance",
  github: "https://github.com/harvest-finance/harvest",
  category: "yield",
  chains: deployments,
  audited: true,
};
