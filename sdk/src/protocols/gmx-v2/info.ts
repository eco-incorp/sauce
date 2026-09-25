import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "GMX V2",
  slug: "gmx-v2",
  description:
    "Next generation of GMX perpetual exchange with isolated markets, improved risk management, and GM liquidity tokens replacing GLP.",
  website: "https://gmx.io",
  github: "https://github.com/gmx-io/gmx-synthetics",
  category: "perpetuals",
  chains: deployments,
  audited: true,
  tvl: "$800M+",
};
