import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Tokemak",
  slug: "tokemak",
  description:
    "Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.",
  website: "https://www.tokemak.xyz",
  github: "https://github.com/Tokemak",
  category: "yield",
  chains: deployments,
  audited: true,
};
