import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Stargate",
  slug: "stargate",
  description:
    "Omnichain liquidity transport protocol built on LayerZero. Provides native asset bridging with unified liquidity pools.",
  website: "https://stargate.finance",
  github: "https://github.com/stargate-protocol/stargate-v2",
  npm: "@stargatefinance/stg-definitions-v2",
  category: "bridge",
  chains: deployments,
  audited: true,
  tvl: "$400M+",
};
