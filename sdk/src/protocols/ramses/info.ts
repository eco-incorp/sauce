import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Ramses",
  slug: "ramses",
  description:
    "Arbitrum-native ve(3,3) DEX with concentrated liquidity. Features gauge voting, bribes, and protocol-owned liquidity mechanisms.",
  website: "https://ramses.exchange",
  github: "https://github.com/RamsesExchange",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$30M+",
};
