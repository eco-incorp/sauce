import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "DODO",
  slug: "dodo",
  description:
    "Proactive market maker (PMM) DEX with capital-efficient liquidity provision. Features single-token LP, customizable price curves, and smart routing.",
  website: "https://dodoex.io",
  github: "https://github.com/DODOEX",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
