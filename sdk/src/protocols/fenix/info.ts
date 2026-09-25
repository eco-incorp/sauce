import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Fenix",
  slug: "fenix",
  description:
    "Blast-native ve(3,3) DEX and liquidity hub. Solidly-fork with concentrated liquidity and gauge voting, leveraging Blast native yield.",
  website: "https://fenix.finance",
  github: "https://github.com/fenix-finance",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$10M+",
};
