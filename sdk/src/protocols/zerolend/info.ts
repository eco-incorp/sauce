import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "ZeroLend",
  slug: "zerolend",
  description:
    "Leading lending protocol on zkSync Era. Aave V3 fork optimized for zero-knowledge rollups with low transaction costs.",
  website: "https://zerolend.xyz",
  github: "https://github.com/zerolend",
  category: "lending",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
