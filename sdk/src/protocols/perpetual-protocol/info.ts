import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Perpetual Protocol",
  slug: "perpetual-protocol",
  description:
    "Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.",
  website: "https://perp.com",
  github: "https://github.com/perpetual-protocol/perp-curie-contract",
  npm: "@perp/curie-contract",
  category: "perpetuals",
  chains: deployments,
  audited: true,
};
