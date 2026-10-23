import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "CoW Swap",
  slug: "cowswap",
  description:
    "MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) and protects users from frontrunning.",
  website: "https://cow.fi",
  github: "https://github.com/cowprotocol",
  npm: "@cowprotocol/cow-sdk",
  category: "aggregator",
  chains: deployments,
  audited: true,
};
