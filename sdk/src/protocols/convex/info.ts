import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Convex Finance",
  slug: "convex",
  description:
    "Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives.",
  website: "https://www.convexfinance.com",
  github: "https://github.com/convex-eth",
  category: "yield",
  chains: deployments,
  audited: true,
  tvl: "$2B+",
};
