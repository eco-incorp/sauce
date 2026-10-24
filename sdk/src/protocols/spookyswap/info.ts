import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "SpookySwap",
  slug: "spookyswap",
  description:
    "DEX on Fantom with UniV2-style constant product pools. Features yield farming, bridges, and limit orders.",
  website: "https://spooky.fi",
  github: "https://github.com/SpookySwap",
  category: "dex",
  chains: deployments,
  audited: true,
  tvl: "$30M+",
};
