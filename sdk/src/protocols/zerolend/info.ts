import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ZeroLend",
  slug: "zerolend",
  description: "Lending protocol on zkSync Era. Aave V3 fork for zero-knowledge rollups.",
  website: "https://zerolend.xyz",
  github: "https://github.com/zerolend",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
