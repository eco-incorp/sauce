import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Camelot",
  slug: "camelot",
  description:
    "Native Arbitrum DEX with dual AMM (V2 constant product + V3 concentrated liquidity), custom fee structures, and launchpad features.",
  website: "https://camelot.exchange",
  github: "https://github.com/CamelotLabs",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$100M+",
};
