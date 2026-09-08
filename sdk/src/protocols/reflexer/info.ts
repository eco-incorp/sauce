import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Reflexer",
  slug: "reflexer",
  description:
    "Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.",
  website: "https://reflexer.finance",
  github: "https://github.com/reflexer-labs/geb",
  category: "cdp",
  chains: deployments,
  audited: true,
};
