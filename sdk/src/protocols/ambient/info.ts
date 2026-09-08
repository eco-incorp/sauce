import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Ambient",
  slug: "ambient",
  description:
    "Single-contract DEX (formerly CrocSwap) with ambient and concentrated liquidity in one unified pool. Gas-efficient architecture on Ethereum and Scroll.",
  website: "https://ambient.finance",
  github: "https://github.com/CrocSwap",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$80M+",
};
