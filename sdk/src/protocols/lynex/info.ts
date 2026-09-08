import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Lynex",
  slug: "lynex",
  description:
    "Linea-native ve(3,3) DEX and liquidity marketplace. Solidly-fork with gauge voting and concentrated liquidity pools.",
  website: "https://lynex.fi",
  github: "https://github.com/Lynexfi",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$20M+",
};
